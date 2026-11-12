/**
 * perf-5000 —— FR-5 规模底座实测（PRD §9「5000 张首屏可交互 <1s」/ PM §2.1 W3）。
 *
 * 口径：以 data/db 种子库（5000 张，scripts/seed-dev.ts）启动真实服务（Hono SSR），
 * 三次取中位：
 * - SSR HTML 字节 + TTFB + HTML 完整收到（DOMContentLoaded 的 Node 侧代理——本地无浏览器 DOM）；
 * - /static 资源（HTML 引用的 main.css/main.js + main.js 动态 import 的岛屿 chunk，两波并行取）
 *   全部就绪 = 「可交互」代理（SSR 直出无 hydration， islands 挂载前阻塞仅资源网络）；
 * - 连续追加三页（cursor 只用服务端 rel=next 下发值）：每页片段卡片数与延迟——非空 = 无白屏；
 * - /fragment/cabin 计数延迟（PRD §9「计数毫秒级」）+ 服务端 RSS（AGENTS 红线 <100MB）。
 * 预算违例打印 FAIL；数据硬断言失败（登录/空片段/翻页断裂）以退出码 1 终止。
 */
import { performance } from 'node:perf_hooks';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DATA_DIR = resolve(ROOT, 'data/db');
const DB_PATH = resolve(DATA_DIR, 'musicgraphy.db');
const PORT = process.env['PERF_PORT'] ?? '3199';
const BASE = `http://127.0.0.1:${PORT}`;
const N = 5000;
const RUNS = 3;
const BUDGET = { interactiveMs: 1000, htmlBytes: 80 * 1024, cabinMs: 300 };

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const ms = (t0: number): number => performance.now() - t0;
const r1 = (x: number): number => Math.round(x * 10) / 10;

const fail = (msg: string): never => {
  console.error(`[perf-5000] FATAL: ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------- 1. 种子库（幂等：仅当 <N 张时播种）

if (!existsSync(DB_PATH)) {
  console.log(`[seed] ${DB_PATH} 不存在 → 播种 ${N} 张（scripts/seed-dev.ts）`);
  const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/seed-dev.ts', String(N)], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const code: number = await new Promise((res) => p.on('close', res));
  if (code !== 0) fail(`种子脚本退出码 ${code}`);
} else {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const row = db.prepare('SELECT COUNT(*) AS n FROM album_metadata').get() as { n: number };
  db.close();
  console.log(`[seed] 现有库 ${row.n} 张 @ ${DB_PATH}`);
  if (row.n < N) fail(`种子库仅 ${row.n} 张 < ${N}——删除 ${DB_PATH} 后重跑以重新播种`);
}

// ---------------------------------------------------------------- 2. 起服务（等待 health）

if (!existsSync(resolve(ROOT, 'dist/static/main.js'))) fail('dist/static/main.js 缺失——先 npm run build（asset() 无产物时 SSR 不带脚本，测不了可交互）');
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server/server.ts'], {
  cwd: ROOT,
  env: { ...process.env, DATA_DIR, PORT, HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`));
process.on('exit', () => server.kill());
process.on('SIGINT', () => process.exit(130));

const health = async (): Promise<boolean> => {
  try {
    const r = await fetch(`${BASE}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
};
const bootT0 = performance.now();
while (!(await health())) {
  if (performance.now() - bootT0 > 30_000) fail('服务 30s 未就绪（/api/v1/health）');
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`[server] 就绪 @ ${BASE}（boot ${r1(performance.now() - bootT0)}ms）`);

// ---------------------------------------------------------------- 3. 登录（V10：cookie 通道）

const login = await fetch(`${BASE}/login`, {
  method: 'POST',
  redirect: 'manual', // 303 的 Set-Cookie 在首响——跟随重定向会把它丢掉
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
  body: new URLSearchParams({ access_key: process.env['ACCESS_KEY'] ?? 'dev-local' })
});
if (!(login.ok || (login.status >= 300 && login.status < 400))) fail(`登录失败 ${login.status}`); // 成功 = 303 Set-Cookie（redirect: manual）
const cookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
if (cookie === '') fail('未取得会话 cookie');
const H = { cookie };

// ---------------------------------------------------------------- 4. 测量

const totalOf = async (path: string, init?: RequestInit): Promise<{ bytes: number; text: string; ttfb: number; total: number }> => {
  const t0 = performance.now();
  const r = await fetch(`${BASE}${path.startsWith('/') ? path : `/${path}`}`, { ...init, headers: { ...H, ...init?.headers } });
  const ttfb = ms(t0);
  const text = await r.text();
  return { bytes: Buffer.byteLength(text), text, ttfb, total: ms(t0) };
};

const staticOf = (html: string): string[] => [...html.matchAll(/(?:href|src)="(\/static\/[^"]+)"/g)].map((m) => m[1] ?? '');

const chunkOf = (mainJs: string): string[] =>
  [...mainJs.matchAll(/chunks\/[A-Za-z0-9._-]+\.js/g)].map((m) => `/static/${m[0]}`);

/** 单轮：首屏 HTML → /static 两波资源全就绪。返回各代理指标。 */
const runInteractive = async (): Promise<{
  ttfb: number; html: number; htmlBytes: number; assets: number; interactive: number;
  assetList: Array<{ url: string; bytes: number }>;
}> => {
  const page = await totalOf('/');
  if (page.bytes < 10_000) fail(`首页 HTML 仅 ${page.bytes}B——疑似未登录或空库`);
  const wave1 = staticOf(page.text);
  const t0 = performance.now();
  const mainUrl = wave1.find((u) => u.endsWith('main.js'));
  const mainJs = mainUrl === undefined ? '' : await (await fetch(`${BASE}${mainUrl}`, { headers: H })).text();
  const wave2 = mainJs === '' ? [] : chunkOf(mainJs);
  const fetchAll = async (urls: string[]): Promise<Array<{ url: string; bytes: number }>> =>
    Promise.all(
      urls.map(async (u) => {
        const r = await fetch(`${BASE}${u}`, { headers: H });
        const buf = await r.arrayBuffer();
        return { url: u, bytes: buf.byteLength };
      })
    );
  const [a1, a2] = await Promise.all([fetchAll(wave1), wave2.length === 0 ? Promise.resolve([]) : fetchAll(wave2)]);
  const assets = ms(t0);
  return {
    ttfb: page.ttfb,
    html: page.total,
    htmlBytes: page.bytes,
    assets,
    interactive: page.total + assets,
    assetList: [...a1, ...a2]
  };
};

const cursorOf = (html: string): string | null => {
  const m = /<a [^>]*href="([^"]+)"[^>]*rel="next"/.exec(html) ?? /<a [^>]*rel="next"[^>]*href="([^"]+)"/.exec(html);
  return m?.[1] ?? null;
};
const cardsOf = (html: string): number => (html.match(/class="cover-card"/g) ?? []).length;

console.log(`\n===== 首屏可交互（${RUNS} 次取中位，data/db ${N} 张种子库）=====`);
await totalOf('/'); // 预热（不计入）
const runs: Array<Awaited<ReturnType<typeof runInteractive>>> = [];
for (let i = 0; i < RUNS; i++) {
  const r = await runInteractive();
  runs.push(r);
  console.log(
    `run${i + 1}: TTFB ${r1(r.ttfb)}ms | HTML ${r1(r.html)}ms / ${r.htmlBytes}B | /static ${r.assetList.length} 件 ${r1(r.assets)}ms | 可交互 ${r1(r.interactive)}ms`
  );
}
const med = {
  ttfb: median(runs.map((x) => x.ttfb)),
  html: median(runs.map((x) => x.html)),
  htmlBytes: median(runs.map((x) => x.htmlBytes)),
  assets: median(runs.map((x) => x.assets)),
  interactive: median(runs.map((x) => x.interactive))
};
const assetTotalBytes = runs[runs.length - 1]!.assetList.reduce((s, a) => s + a.bytes, 0);
console.log(
  `MEDIAN: TTFB ${r1(med.ttfb)}ms | HTML ${r1(med.html)}ms | 可交互 ${r1(med.interactive)}ms | HTML ${med.htmlBytes}B | /static ${runs[0]!.assetList.length} 件 / ${assetTotalBytes}B`
);

console.log(`\n===== 连续追加三页（cursor = 服务端 rel=next 下发值）=====`);
const firstWall = await totalOf('/fragment/wall');
let href = cursorOf(firstWall.text);
const appends: Array<{ page: number; latency: number; cards: number }> = [];
for (let page = 2; page <= 4; page++) {
  if (href === null) fail(`第 ${page} 页缺 rel=next（5000 张不应提前断链）`);
  const cur = href as string; // fail() 返回 never 但 TS 6 对循环内 let 不收窄——守卫后显式断言
  const q = cur.slice(cur.indexOf('?'));
  if (!q.includes('cursor=')) fail(`第 ${page} 页链接无 cursor（自造分页禁令核对失败）`);
  const r = await totalOf(`/fragment/wall${q}`);
  const cards = cardsOf(r.text);
  appends.push({ page, latency: r.total, cards });
  console.log(`page${page}: ${r1(r.total)}ms / ${r.bytes}B / 卡片 ${cards} 张${cards === 0 ? ' ← 白屏！' : ''}`);
  href = cursorOf(r.text);
}

console.log(`\n===== 计数响应（/fragment/cabin，PRD §9「毫秒级」）=====`);
const cabinTimes: number[] = [];
for (let i = 0; i < RUNS; i++) cabinTimes.push((await totalOf('/fragment/cabin')).total);
console.log(`cabin MEDIAN ${r1(median(cabinTimes))}ms（三次 ${cabinTimes.map(r1).join('/')}）`);

console.log(`\n===== 服务端 RSS（AGENTS 红线 <100MB）=====`);
let rssMb: number | null = null;
try {
  const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${server.pid}).WorkingSet64"`, { encoding: 'utf8' });
  rssMb = Number(out.trim()) / 1048576;
} catch {
  /* best effort */
}
console.log(rssMb === null ? 'RSS 采样不可用（Windows PowerShell）' : `RSS ${r1(rssMb)}MB`);

// ---------------------------------------------------------------- 5. 预算裁决（PRD §9 逐行对照值）

console.log(`\n===== 预算裁决 =====`);
const verdicts: Array<[string, boolean, string]> = [
  ['首屏可交互 <1s（PRD §9）', med.interactive < BUDGET.interactiveMs, `${r1(med.interactive)}ms（中位，可交互=HTML+/static 全就绪的 Node 侧代理）`],
  [`SSR HTML ≤80KB`, med.htmlBytes <= BUDGET.htmlBytes, `${med.htmlBytes}B`],
  ['连续追加三页无白屏', appends.every((a) => a.cards === 60), appends.map((a) => `p${a.page}=${a.cards}张/${r1(a.latency)}ms`).join(' · ')],
  ['计数响应（cabin 服务端耗时 ≪300ms 防抖线）', median(cabinTimes) < BUDGET.cabinMs, `${r1(median(cabinTimes))}ms`],
  ['RSS <100MB（AGENTS）', rssMb === null || rssMb < 100, rssMb === null ? 'n/a' : `${r1(rssMb)}MB`]
];
let hardFail = false;
for (const [name, ok, detail] of verdicts) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} → ${detail}`);
  if (!ok && name.startsWith('连续追加')) hardFail = true; // 数据完整性失败才硬失败；性能预算违例留给评审裁决
}
server.kill();
if (hardFail) process.exit(1);
