/**
 * color-extract.ts —— D3 主色提取管线：存量封面批量回填 collection_record.cover_color
 * （W4-6-3 · PM W5 提前，理由 = 服务 W4-6 场景实测与 W6 P1-4 色板；拆分方案 §7 P3）
 *
 * 规格出处：02-数据模型 §2.2（cover_color 1–16 派生字段，可批量回填）/ §2.5（主色聚类 → 最近色板项，
 * 失败 → NULL）；PM §3 W5 行（D3 主色提取管线 k-means + 存量回填脚本）；html.ts COLOR_TABLE（1–15 有效，
 * 16 保留，渲染按灰兜底）；色板 Hex 唯一事实源 = 文档包 07-前端设计包 MASTER.md「封面主色数据色板」。
 *
 * 算法：分块读盘（64KB）→ jpeg-js 解码（RGB）→ 步长缩样 ≤64×64 样本 → k-means（k=4，k-means++
 * 固定种子，确定性）→ 主色 = 最大簇中心 → 欧氏距离吸附 16 槽色板：命中 1–15 写值；
 * 最近定义色距离 > MAX_DIST 视为命中保留槽 16（色板外/无归属）→ 记 NULL（02 §2.5：前端按"无色板"占位）。
 *
 * 内存纪律（ADR-005②推导，服务内存红线 RSS<100MB 不因批处理工具失守）：逐张处理即取即弃；
 * 磁盘读取分块（64KB chunk）且单文件有界（≤5MB，与 metadata/covers.ts 上限一致）；
 * 解码产物缩样后整图缓冲即释放；不积压数据集、不缓存像素、prepared statement 复用（纪律④）。
 *
 * 依赖：jpeg-js = devDependency（仅本脚本与冒烟测试使用，0 传递依赖；运行时依赖仍 = 2）。
 * ADR-004"三问"：①Node 无内置图像解码器 ②基线 JPEG 熵解码+IDCT 无法 <60 行自写 ③jpeg-js 传递依赖 = 0
 * ——登记 05/实现决策记录.md IM-17，待追认。
 *
 * 用法：node 前置 PATH 后 `tsx scripts/color-extract.ts [--limit N] [--dry-run]`
 * 输出：stdout JSON 统计（候选/写入/失败分类/回填率）。
 * 口径：只回填 cover_color IS NULL 的记录（不动已有值）；只更新 cover_color 列
 * （不触碰 updated_at——那是用户编辑语义，DAO updateRecord 所有；派生数据回填不算编辑）。
 * 逐行自动提交（不开长事务）：批处理期间不阻塞服务端写入，中断即保留已回填部分。
 */
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decode } from 'jpeg-js';
import { loadConfig } from '../src/server/config';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';

// ---------------------------------------------------------------- 色板（MASTER.md `--swatch-*` × html.ts COLOR_TABLE 编号）

export interface PaletteEntry {
  readonly id: number; // 1–15（16 = 保留槽，无 RGB，不参与吸附）
  readonly varName: string;
  readonly hex: string;
  readonly rgb: readonly [number, number, number];
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
];

const SWATCH: ReadonlyArray<readonly [number, string, string]> = [
  [1, 'red', '#DC2626'],
  [2, 'orange', '#EA580C'],
  [3, 'amber', '#D97706'],
  [4, 'yellow', '#CA8A04'],
  [5, 'lime', '#65A30D'],
  [6, 'green', '#16A34A'],
  [7, 'teal', '#0D9488'],
  [8, 'blue', '#2563EB'],
  [9, 'indigo', '#4F46E5'],
  [10, 'purple', '#7C3AED'],
  [11, 'magenta', '#DB2777'],
  [12, 'brown', '#92400E'],
  [13, 'gray', '#78716C'],
  [14, 'black', '#1C1917'],
  [15, 'white', '#F5F5F4']
];

export const PALETTE: readonly PaletteEntry[] = SWATCH.map(([id, varName, hex]) => ({
  id,
  varName,
  hex,
  rgb: hexToRgb(hex)
}));

/** 命中保留槽 16 的判据：与最近定义色的 RGB 欧氏距离超过该阈值 = 色板外（150 ≈ 纯青/纯品红级饱和度仍可归位，仅真正无归属的颜色落 16）。 */
export const MAX_PALETTE_DIST = 150;

/** 主色吸附：欧氏距离最近色板项；超 MAX_PALETTE_DIST → null（命中保留槽 16）。 */
export function snapToPalette(rgb: readonly [number, number, number]): number | null {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of PALETTE) {
    const d =
      (rgb[0] - p.rgb[0]) * (rgb[0] - p.rgb[0]) +
      (rgb[1] - p.rgb[1]) * (rgb[1] - p.rgb[1]) +
      (rgb[2] - p.rgb[2]) * (rgb[2] - p.rgb[2]);
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return bestD > MAX_PALETTE_DIST * MAX_PALETTE_DIST ? null : best;
}

// ---------------------------------------------------------------- 缩样 + k-means

interface DecodeResult {
  width: number;
  height: number;
  data: Uint8Array; // RGB 三元组平面（formatAsRGBA:false）
}

/** 步长缩样：长边 ≤ maxSide 的网格采样（逐点跳读，不复制整图）。 */
export function samplePixels(img: DecodeResult, maxSide = 64): [number, number, number][] {
  const step = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxSide));
  const out: [number, number, number][] = [];
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const o = (y * img.width + x) * 3;
      out.push([img.data[o] ?? 0, img.data[o + 1] ?? 0, img.data[o + 2] ?? 0]);
    }
  }
  return out;
}

/** mulberry32（与 seed-dev 同款确定性 PRNG，固定种子 → 同一封面提取结果可复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (a: readonly [number, number, number], b: readonly [number, number, number]): number =>
  (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);

/**
 * k-means（k=4）：k-means++ 播种（确定性 PRNG）+ 空簇以最远样本重播种；
 * 返回各簇中心与成员数。样本 ≤64×64=4096，迭代 12 轮，开销毫秒级。
 */
export function kmeans(
  samples: readonly [number, number, number][],
  k: number,
  rng: () => number = mulberry32(20261113),
  iters = 12
): { centers: [number, number, number][]; counts: number[] } {
  const n = samples.length;
  if (n === 0) return { centers: [], counts: [] };
  const kk = Math.min(k, n);

  // k-means++ 播种
  const centers: [number, number, number][] = [[...samples[Math.floor(rng() * n)]!]];
  const minD = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  while (centers.length < kk) {
    const c = centers[centers.length - 1]!;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = dist2(samples[i]!, c);
      if (d < minD[i]!) minD[i] = d;
      sum += minD[i]!;
    }
    let target = rng() * sum;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      target -= minD[i]!;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    centers.push([...samples[pick]!]);
  }

  const assign = new Array<number>(n).fill(0);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(samples[i]!, centers[c]!);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) moved++;
      assign[i] = best;
    }
    // 重算中心；空簇 → 最远样本重播种
    const sums = centers.map((): [number, number, number] => [0, 0, 0]);
    const counts = centers.map(() => 0);
    for (let i = 0; i < n; i++) {
      const a = assign[i]!;
      const s = samples[i]!;
      sums[a]![0] += s[0];
      sums[a]![1] += s[1];
      sums[a]![2] += s[2];
      counts[a]!++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (counts[c]! > 0) {
        centers[c] = [sums[c]![0] / counts[c]!, sums[c]![1] / counts[c]!, sums[c]![2] / counts[c]!];
      } else {
        let far = 0;
        let farD = -1;
        for (let i = 0; i < n; i++) {
          const d = dist2(samples[i]!, centers[assign[i]!]!);
          if (d > farD) {
            farD = d;
            far = i;
          }
        }
        centers[c] = [...samples[far]!];
      }
    }
    if (moved === 0) break;
  }

  const counts = centers.map(() => 0);
  for (let i = 0; i < n; i++) counts[assign[i]!]!++;
  return { centers, counts };
}

// ---------------------------------------------------------------- 单张提取

export type ExtractResult = { ok: true; color: number | null } | { ok: false; reason: string };

/**
 * 单张封面字节 → 主色色板值（1–15）或 null（命中保留槽 16）。
 * 提取失败（非 JPEG/解码超限等）返回 ok:false reason，由调用方计失败不抛异常。
 */
export function extractCoverColor(bytes: Uint8Array): ExtractResult {
  let img: DecodeResult;
  try {
    const d = decode(bytes, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 64 });
    if (d.width <= 0 || d.height <= 0 || d.data.length < d.width * d.height * 3) {
      return { ok: false, reason: 'empty_image' };
    }
    img = { width: d.width, height: d.height, data: d.data };
  } catch (e) {
    return { ok: false, reason: `decode_error: ${e instanceof Error ? e.message : String(e)}` };
  }
  const samples = samplePixels(img);
  const { centers, counts } = kmeans(samples, 4);
  if (centers.length === 0 || counts.every((c) => c === 0)) return { ok: false, reason: 'empty_image' };
  let dom = 0;
  for (let c = 1; c < counts.length; c++) if (counts[c]! > counts[dom]!) dom = c;
  const center = centers[dom]!;
  return { ok: true, color: snapToPalette([Math.round(center[0]), Math.round(center[1]), Math.round(center[2])]) };
}

// ---------------------------------------------------------------- 批量回填

export interface BackfillStats {
  total_records: number;
  with_cover: number;
  already_colored: number;
  candidates: number;
  processed: number;
  /** 命中 1–15，已写（dry-run 则为"将写"） */
  written_color: number;
  /** 命中保留槽 16（色板外）→ 记 NULL */
  written_reserved16_null: number;
  failed: Record<string, number>;
  failed_samples: { record_id: string; file: string; reason: string }[];
  /** 回填率 = (原有 + 本次写值) / 有封面记录（回填 NULL 不计——02 §2.5：NULL = 合法"无色板"态） */
  backfill_rate: number;
  dry_run: boolean;
  elapsed_ms: number;
}

const MAX_COVER_BYTES = 5 * 1024 * 1024; // 与 metadata/covers.ts 上限一致
const READ_CHUNK = 64 * 1024; // 分块读盘（内存纪律：非整文件盲读）

/** 分块读盘，超限返回 null（调用方计 too_large）。缓冲 ≤ MAX_COVER_BYTES 有界。 */
async function readCapped(path: string): Promise<Buffer | null> {
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    if (size > MAX_COVER_BYTES) return null;
    const buf = Buffer.allocUnsafe(size);
    let off = 0;
    while (off < size) {
      const { bytesRead } = await fh.read(buf, off, Math.min(READ_CHUNK, size - off), off);
      if (bytesRead <= 0) break;
      off += bytesRead;
    }
    return buf.subarray(0, off);
  } finally {
    await fh.close();
  }
}

export async function runBackfill(
  db: Db,
  coversDir: string,
  opts: { limit?: number; dryRun?: boolean; userId?: string } = {}
): Promise<BackfillStats> {
  const userId = opts.userId ?? 'local';
  const dryRun = opts.dryRun ?? false;
  const t0 = performance.now();

  const statRow = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN m.cover_local IS NOT NULL THEN 1 ELSE 0 END) AS with_cover,
              SUM(CASE WHEN r.cover_color IS NOT NULL THEN 1 ELSE 0 END) AS colored
       FROM collection_record r JOIN album_metadata m ON m.id = r.album_id WHERE r.user_id = ?`
    )
    .get(userId) as { total: number | null; with_cover: number | null; colored: number | null };

  const stats: BackfillStats = {
    total_records: Number(statRow.total ?? 0),
    with_cover: Number(statRow.with_cover ?? 0),
    already_colored: Number(statRow.colored ?? 0),
    candidates: 0,
    processed: 0,
    written_color: 0,
    written_reserved16_null: 0,
    failed: {},
    failed_samples: [],
    backfill_rate: 0,
    dry_run: dryRun,
    elapsed_ms: 0
  };

  const limit = opts.limit !== undefined ? Math.max(0, Math.floor(opts.limit)) : Number.POSITIVE_INFINITY;
  const rows = db
    .prepare(
      `SELECT r.id AS rid, m.cover_local AS cl FROM collection_record r
       JOIN album_metadata m ON m.id = r.album_id
       WHERE r.user_id = ? AND m.cover_local IS NOT NULL AND r.cover_color IS NULL
       ORDER BY r.added_at`
    )
    .all(userId) as { rid: string; cl: string | null }[];
  const candidates = rows.slice(0, Number.isFinite(limit) ? limit : rows.length) as { rid: string; cl: string }[];
  stats.candidates = candidates.length;

  const update = db.prepare('UPDATE collection_record SET cover_color = ? WHERE id = ?');
  const fail = (rid: string, file: string, reason: string) => {
    stats.failed[reason] = (stats.failed[reason] ?? 0) + 1;
    if (stats.failed_samples.length < 10) stats.failed_samples.push({ record_id: rid, file, reason });
  };

  for (const { rid, cl } of candidates) {
    if (cl === null || cl.length === 0 || cl.includes('/') || cl.includes('\\') || cl.includes('..')) {
      fail(rid, cl ?? '', 'bad_name');
      continue;
    }
    let bytes: Buffer;
    try {
      const read = await readCapped(join(coversDir, cl));
      if (read === null) {
        fail(rid, cl, 'too_large');
        continue;
      }
      bytes = read;
    } catch {
      fail(rid, cl, 'missing_file');
      continue;
    }
    stats.processed++;
    const result = extractCoverColor(bytes);
    if (!result.ok) {
      fail(rid, cl, result.reason);
      continue;
    }
    if (result.color === null) {
      stats.written_reserved16_null++; // 命中保留槽 16 → 记 NULL（NULL 本就无需 UPDATE）
      continue;
    }
    if (!dryRun) update.run(result.color, rid);
    stats.written_color++;
  }

  const colored = stats.already_colored + stats.written_color;
  stats.backfill_rate = stats.with_cover > 0 ? colored / stats.with_cover : 0;
  stats.elapsed_ms = Math.round(performance.now() - t0);
  return stats;
}

// ---------------------------------------------------------------- CLI 入口

function parseArgs(argv: readonly string[]): { limit?: number; dryRun: boolean } {
  let limit: number | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--limit') {
      const v = Number(argv[i + 1]);
      if (!Number.isFinite(v) || v < 0) throw new Error('--limit 需要非负整数参数');
      limit = Math.floor(v);
      i++;
    } else if (a?.startsWith('--limit=')) {
      const v = Number(a.slice('--limit='.length));
      if (!Number.isFinite(v) || v < 0) throw new Error('--limit 需要非负整数参数');
      limit = Math.floor(v);
    } else throw new Error(`未知参数：${String(a)}（支持 --limit N / --dry-run）`);
  }
  return { limit, dryRun };
}

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  const cfg = loadConfig();
  const db = openDatabase(cfg.dbPath);
  try {
    runMigrations(db, 'db/migrations'); // 幂等，与 seed-dev 同款兜底
    const stats = await runBackfill(db, cfg.coversDir, { limit: args.limit, dryRun: args.dryRun });
    console.log(JSON.stringify({ ...stats, db_path: cfg.dbPath, covers_dir: cfg.coversDir }, null, 2));
  } finally {
    db.close();
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) void main(process.argv.slice(2));
