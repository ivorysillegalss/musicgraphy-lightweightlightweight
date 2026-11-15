// 第 5 岛屿 wall-scroll 冒烟（FR-5 · ADR-003 评审条款；独立文件名防冲突）。
// A 部分 = 服务端契约：SSR 挂载点 / fragment/wall 分页链（cursor 服务端下发、has_next=false 无 data-next）。
// B 部分 = 岛屿行为（假 DOM 驱动 mount）：IO 预取追加、has_next=false 解除观察、错误注入 .error-strip
// （禁吞错禁 alert）、点击兜底、在途判废（舱岛换墙后旧页作废）。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { Hono } from 'hono';
import { createApp } from '../src/server/app';
import { ensureDirs, loadConfig, type Config } from '../src/server/config';
import { DAO } from '../src/server/db/dao';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { MusicBrainzClient } from '../src/server/metadata/musicbrainz';
import { MusicBrainzSource } from '../src/server/metadata/sources';
import { MetadataRateLimiter } from '../src/server/metadata/queue';
import { mount as mountWallScroll } from '../src/client/islands/wall-scroll';
import { cabinSection, EMPTY_FILTER } from '../src/server/pages/collection';

const stubFetch = (async () =>
  new Response(JSON.stringify({ releases: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

const cardIdsOf = (html: string): string[] => [...html.matchAll(/href="\/album\/([0-9a-f-]{36})"/g)].map((m) => m[1] ?? '');
const PAGE = 60;
const nextHrefOf = (html: string): string | null => {
  const m = /<a [^>]*href="([^"]+)"[^>]*rel="next"[^>]*>/.exec(html) ?? /<a [^>]*rel="next"[^>]*href="([^"]+)"/.exec(html);
  return m?.[1] ?? null;
};

describe('wall-scroll 岛屿（FR-5，第 5 岛屿）', () => {
  // ---------------------------------------------------------- A：服务端契约
  let dir: string;
  let db: Db;
  let dao: DAO;
  let cfg: Config;
  let app: Hono;
  let cookie = '';

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mg-wallscroll-'));
    db = openDatabase(join(dir, 't.db'));
    runMigrations(db, 'db/migrations');
    db.exec('BEGIN IMMEDIATE');
    const insA = db.prepare('INSERT INTO album_metadata (id, source, source_id, title, artist, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
    const insR = db.prepare('INSERT INTO collection_record (id, user_id, album_id, added_at, created_at, updated_at) VALUES (?,?,?,?,?,?)');
    const now = new Date('2026-11-13T00:00:00Z').toISOString();
    for (let i = 0; i < PAGE * 2 + 10; i++) {
      const albumId = randomUUID();
      const recordId = randomUUID();
      insA.run(albumId, 'musicbrainz', `wall-${i}`, `Wall Album ${String(i).padStart(4, '0')}`, 'Various', now, now);
      insR.run(recordId, 'local', albumId, now, now, now);
    }
    db.exec('COMMIT');
    dao = new DAO(db);
    cfg = loadConfig();
    ensureDirs(cfg);
    app = createApp(dao, cfg, [new MusicBrainzSource(new MusicBrainzClient(new MetadataRateLimiter({ minIntervalMs: 0 }), cfg.userAgent, stubFetch))]);
    const ok = await app.request('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `access_key=${encodeURIComponent(cfg.accessKey)}` });
    cookie = (ok.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string) => app.request(path, { headers: { cookie } });

  test('SSR 页面含第 5 岛屿挂载点 data-island="wall-scroll"', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /data-island="wall-scroll"/);
    assert.match(html, /data-next/); // 无 JS 基线分页链接在场
  });

  test('fragment/wall：首页 60 卡 + rel=next（cursor 服务端下发）；顺链 60 卡零重叠', async () => {
    const p1 = await get('/fragment/wall');
    assert.equal(p1.status, 200);
    const h1 = await p1.text();
    const ids1 = cardIdsOf(h1);
    assert.equal(ids1.length, PAGE);
    const href = nextHrefOf(h1);
    assert.ok(href !== null, '首页应有 rel=next 分页链接');
    assert.match(href, /cursor=/);
    const p2 = await get(`/fragment/wall${href.slice(href.indexOf('?'))}`); // cursor 原样透传
    assert.equal(p2.status, 200);
    const ids2 = cardIdsOf(await p2.text());
    assert.equal(ids2.length, PAGE);
    assert.equal(ids2.filter((id) => ids1.includes(id)).length, 0, '第二页与第一页不得重叠（cursor 语义）');
  });

  test('has_next=false：末页片段无 data-next（解除观察信号）', async () => {
    let href: string | null = null;
    let ids: string[] = [];
    for (let page = 0; page < 5; page++) {
      const res = await get(page === 0 ? '/fragment/wall' : `/fragment/wall${(href ?? '').slice((href ?? '').indexOf('?'))}`);
      const html = await res.text();
      ids = cardIdsOf(html);
      href = nextHrefOf(html);
      if (href === null) {
        assert.equal(page, 2, '130 张应恰翻 3 页（60/60/10）');
        assert.equal(ids.length, 10, '末页应为剩余 10 张');
        assert.ok(!html.includes('data-next'), '末页不得残留 data-next');
        assert.match(html, /class="wall-end"/, 'R-104 b：末页 SSR 渲染到底条');
        assert.match(html, /回到顶部/);
        return;
      }
      assert.equal(ids.length, PAGE);
      assert.ok(!html.includes('class="wall-end"'), '有下一页不得提前出到底条');
    }
    assert.fail('cursor 链异常（超页数）');
  });

  test('R-104：单页结果（has_next=false）SSR 到底条 + #mg-top 回顶锚点；多页结果首页无到底条', async () => {
    const single = await get('/fragment/wall?q=0001'); // 仅命中 Wall Album 0001（四位补零编号唯一）
    assert.equal(single.status, 200);
    const h1 = await single.text();
    assert.match(h1, /class="wall-end"/);
    assert.match(h1, /id="mg-top"/); // 回到顶部 = 纯原生 <a href="#mg-top">（零 JS）
    assert.ok(!h1.includes('data-next'), '单页结果不得有分页链接');
    const multi = await get('/fragment/wall');
    const h2 = await multi.text();
    assert.match(h2, /data-next/);
    assert.match(h2, /id="mg-top"/); // 锚点恒在（回顶目标）
    assert.ok(!h2.includes('class="wall-end"'), '有下一页不得提前出到底条');
  });

  test('R-105：/fragment/cabin 长轴收纳形态在档（details/summary/axis-meta；chips 语义零改动）', async () => {
    const res = await get('/fragment/cabin');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<details class="filter-axis axis-fold" open>/); // Genre 缺省展开
    assert.match(html, /<details class="filter-axis axis-fold axis-fold-year">/); // 年份/听期缺省收起（无激活筛选）
    assert.match(html, /axis-meta/); // 项数摘要
    assert.ok(!html.includes('axis-fold-year" open'), '无激活筛选时年份轴不得自动展开');
  });

  // ---------------------------------------------------------- B：岛屿行为（假 DOM）
  describe('岛屿行为（假 DOM）', () => {
    interface LinkStub {
      href: string;
      isConnected: boolean;
      busy: string | null;
      textContent: string;
      getAttribute(name: string): string | null;
      setAttribute(name: string, v: string): void;
      removeAttribute(name: string): void;
    }
    interface IoStub {
      callback: (entries: Array<{ isIntersecting: boolean }>) => void;
      observed: unknown;
      disconnectCount: number;
    }

    const frag = (cards: number, nextCursor: string | null): string =>
      `<div class="result-status" role="status"><strong>${String(cards)} 张匹配</strong></div>` +
      `<div class="cover-wall">${Array.from({ length: cards }, (_, i) => `<a class="cover-card" href="/album/c${String(i)}">C</a>`).join('')}</div>` +
      (nextCursor === null
        ? '<div class="wall-end" role="status">已到底 · 匹配的专辑都在这了 <a class="btn-text" href="#mg-top">回到顶部</a></div>' // R-104 b：服务端 resultsSection 同款
        : `<div class="wall-next"><a class="btn btn-secondary" href="?cursor=${nextCursor}" rel="next" data-next>加载下一页</a></div>`);

    /** 按片段形态做最小解析的 document.createElement('template') 桩（覆盖 .cover-wall 计数与 .wall-next 游标）。 */
    const installParserDocument = (): void => {
      globalThis.document = {
        createElement: () => ({
          set innerHTML(v: string) {
            const self = this as unknown as { content?: unknown; __cards: number; __wall: boolean; __cursor: string | null; __end: boolean };
            self.__wall = /class="cover-wall"/.test(v);
            self.__cards = (v.match(/class="cover-card"/g) ?? []).length;
            const hrefM = /href="\?cursor=([^"]+)"/.exec(v);
            self.__cursor = /class="wall-next"/.test(v) ? (hrefM?.[1] ?? null) : null;
            self.__end = /class="wall-end"/.test(v); // R-104 b：服务端到底条标记
            self.content = {
              querySelector(sel: string): unknown {
                if (sel === '.cover-wall') return self.__wall ? { children: Array.from({ length: self.__cards }, () => ({})) } : null;
                if (sel === '.wall-next') {
                  return self.__cursor === null ? null : { getAttribute: (n: string) => (n === 'href' ? `?cursor=${self.__cursor ?? ''}` : null) };
                }
                if (sel === '.wall-end') {
                  return self.__end ? { getAttribute: () => null } : null; // 到底条无 href（fake append 记 linkHref=null）
                }
                return null;
              }
            };
          }
        })
      } as unknown as Document;
    };

    interface Harness {
      root: { linkHref: string | null; linkText: string; injected: string[]; endInjected: string[]; appendedToRoot: string[]; wallCards: object[] };
      clicks: Array<(e: unknown) => void>;
      ioInstances: IoStub[];
      link(): LinkStub;
      fire(): void;
    }

    /** 组装假 DOM + fetch 响应队列；initialHref = 服务端 SSR 出的首页分页链接（cursor 服务端下发）。 */
    const harness = (responses: Array<{ status: number; body: string } | Error>, initialHref = 'cursor=SRV1'): Harness => {
      const state = {
        linkHref: initialHref as string | null,
        linkText: '加载下一页' as string, // R-104：岛屿手动态改文案 → textContent 经 state 跟踪
        injected: [] as string[],
        endInjected: [] as string[], // R-104 兜底注入路径（insertAdjacentHTML）
        appendedToRoot: [] as string[],
        wallCards: [] as object[],
        clicks: [] as Array<(e: unknown) => void>,
        ioInstances: [] as IoStub[]
      };
      const link = (): LinkStub => ({
        get textContent() {
          return state.linkText;
        },
        set textContent(v: string) {
          state.linkText = v;
        },
        href: state.linkHref ?? '',
        isConnected: true,
        busy: null,
        getAttribute(name: string) {
          return name === 'href' ? this.href : name === 'aria-busy' ? this.busy : null;
        },
        setAttribute(name: string, v: string) {
          if (name === 'aria-busy') this.busy = v;
        },
        removeAttribute(name: string) {
          if (name === 'aria-busy') this.busy = null;
        }
      });
      const root = {
        get linkHref() {
          return state.linkHref;
        },
        set linkHref(v: string | null) {
          state.linkHref = v;
        },
        injected: state.injected,
        appendedToRoot: state.appendedToRoot,
        wallCards: state.wallCards,
        querySelector(sel: string): unknown {
          if (sel === '[data-next]') return state.linkHref === null ? null : link();
          if (sel === '.cover-wall') return { append: (card: object) => state.wallCards.push(card) };
          if (sel === '.wall-next') return { remove: () => (state.linkHref = null) };
          return null;
        },
        append(child: { getAttribute: (n: string) => string | null }): void {
          state.appendedToRoot.push(String(child.getAttribute('href') ?? ''));
          state.linkHref = child.getAttribute('href'); // 模拟新分页链接上墙
        },
        addEventListener(_type: string, handler: (e: unknown) => void): void {
          state.clicks.push(handler);
        },
        insertAdjacentHTML(_pos: string, html: string): void {
          state.endInjected.push(html); // R-104 兜底到底条注入路径
        },
        set innerHTML(v: string) {
          state.injected.push(v);
        }
      };
      globalThis.IntersectionObserver = class {
        callback: (entries: Array<{ isIntersecting: boolean }>) => void;
        observed: unknown = null;
        disconnectCount = 0;
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          this.callback = cb;
          state.ioInstances.push(this);
        }
        observe(el: unknown): void {
          this.observed = el;
        }
        disconnect(): void {
          this.disconnectCount++;
        }
      } as unknown as typeof IntersectionObserver;
      globalThis.MutationObserver = class {
        observe(): void {}
      } as unknown as typeof MutationObserver;
      let call = 0;
      globalThis.fetch = (async (): Promise<Response> => {
        const r = responses[call++];
        if (r === undefined) throw new Error('no queued response');
        if (r instanceof Error) throw r;
        return new Response(r.body, { status: r.status });
      }) as typeof fetch;
      mountWallScroll(root as unknown as HTMLElement);
      return {
        root: state,
        clicks: state.clicks,
        ioInstances: state.ioInstances,
        link,
        fire(): void {
          const io = state.ioInstances.at(-1);
          assert.ok(io !== undefined, '应有 IO 实例被创建');
          io.callback([{ isIntersecting: true }]);
        }
      };
    };

    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

    before(() => {
      globalThis.Element = class FakeElement {} as unknown as typeof Element;
      installParserDocument();
    });

    after(() => {
      for (const k of ['IntersectionObserver', 'MutationObserver', 'document', 'Element', 'fetch']) {
        delete (globalThis as Record<string, unknown>)[k];
      }
    });

    test('IO 预取 → 追加封面卡 → cursor 顺链三页 → has_next=false 解除观察', async () => {
      const h = harness([{ status: 200, body: frag(60, 'SRV2') }, { status: 200, body: frag(60, 'SRV3') }, { status: 200, body: frag(40, null) }]);
      h.fire();
      await flush();
      h.fire();
      await flush();
      h.fire();
      await flush();
      assert.equal(h.root.wallCards.length, 160, '三页卡片全部追加进 .cover-wall');
      const last = h.ioInstances.at(-1);
      assert.ok(last !== undefined && last.disconnectCount > 0, 'has_next=false 后应 disconnect（解除观察）');
      assert.equal(h.root.appendedToRoot.length, 3, '根级上墙 3 次（2 个分页链接 + R-104 服务端到底条）');
      assert.equal(h.root.injected.length, 0, '正常路径不得注入错误条');
    });

    test('R-104 a：自动追加 3 页后转手动——IO 不再创建 + 文案改「加载更多（手动）」+ 点击续页额度不恢复', async () => {
      const h = harness([{ status: 200, body: frag(60, 'SRV2') }, { status: 200, body: frag(60, 'SRV3') }, { status: 200, body: frag(60, 'SRV4') }, { status: 200, body: frag(40, null) }]);
      h.fire();
      await flush(); // 自动第 1 页
      h.fire();
      await flush(); // 自动第 2 页
      h.fire();
      await flush(); // 自动第 3 页 → 额度用尽转手动
      assert.equal(h.root.wallCards.length, 180, '三页自动追加');
      assert.equal(h.ioInstances.length, 3, 'mount + 两次重布防共 3 个 IO；额度用尽后不得再创建');
      assert.equal(h.root.linkText, '加载更多（手动）', '手动态文案（增强层；服务端原文/无 JS 视角不动）');
      const target = new (globalThis.Element as unknown as { new (): { closest: (s: string) => unknown } })();
      target.closest = () => h.link();
      h.clicks[0]?.({ target, preventDefault: () => {} });
      await flush(); // 手动点击续第 4 页
      assert.equal(h.root.wallCards.length, 220, '手动态点击继续追加（cursor 顺链不破坏）');
      assert.equal(h.ioInstances.length, 3, '手动态仍不创建 IO（自动滚已停）');
      assert.equal(h.root.linkText, '加载更多（手动）', '手动态追加后文案保持');
      assert.equal(h.root.injected.length, 0);
    });

    test('R-104 b 兜底：片段缺 .wall-end（无下一页）→ 注入同款到底条（防御性路径）', async () => {
      const bare = `<div class="cover-wall">${'<a class="cover-card" href="/album/x">C</a>'.repeat(3)}</div>`; // 无 wall-next 无 wall-end
      const h = harness([{ status: 200, body: bare }]);
      h.fire();
      await flush();
      assert.equal(h.root.wallCards.length, 3);
      assert.equal(h.root.endInjected.length, 1, '兜底注入到底条');
      assert.match(h.root.endInjected[0] ?? '', /wall-end/);
      assert.match(h.root.endInjected[0] ?? '', /回到顶部/);
      assert.equal(h.root.injected.length, 0);
    });

    test('cursor 只用服务端下发值：fetch URL 逐字核对', async () => {
      const h = harness([], '/?cursor=FROM-SERVER&q=Blue'); // SSR 分页链接形态（buildHref）
      const urls: string[] = [];
      globalThis.fetch = (async (url: string | URL): Promise<Response> => {
        urls.push(String(url));
        return new Response(frag(60, null), { status: 200 });
      }) as typeof fetch;
      h.fire();
      await flush();
      assert.deepEqual(urls, ['/fragment/wall?cursor=FROM-SERVER&q=Blue'], 'fetch 必须原样使用服务端链接（禁自造分页）');
      assert.equal(h.root.injected.length, 0);
    });

    test('fetch 失败 → 注入 .error-strip（禁吞错）；AbortError 静默；503 服务端条原样注入', async () => {
      const h = harness([new Error('network down')]);
      h.fire();
      await flush();
      assert.equal(h.root.injected.length, 1);
      assert.match(h.root.injected[0] ?? '', /error-strip/);
      assert.ok(!(h.root.injected[0] ?? '').includes('alert('));

      const h2 = harness([new DOMException('aborted', 'AbortError')]);
      h2.fire();
      await flush();
      assert.equal(h2.root.injected.length, 0, 'AbortError（竞态自我取消）不得注入错误条');

      const h3 = harness([{ status: 503, body: '<div class="error-strip" role="alert">服务端错误条</div>' }]);
      h3.fire();
      await flush();
      assert.equal(h3.root.injected.length, 1);
      assert.match(h3.root.injected[0] ?? '', /服务端错误条/, '503 响应体（服务端 error-strip）原样注入');
    });

    test('点击「加载下一页」→ preventDefault + 原地追加（无 JS 原生跳转是兜底）', async () => {
      const h = harness([{ status: 200, body: frag(60, null) }]);
      const target = new (globalThis.Element as unknown as { new (): { closest: (s: string) => unknown } })();
      target.closest = () => h.link();
      let prevented = false;
      h.clicks[0]?.({ target, preventDefault: () => { prevented = true; } });
      await flush();
      assert.equal(prevented, true, 'JS 在场应 preventDefault（无 JS 由原生 <a> 兜底）');
      assert.equal(h.root.wallCards.length, 60, '点击路径同样追加卡片');
      assert.equal(h.root.injected.length, 0);
    });

    test('在途判废：舱岛换墙后（link 失连）旧页响应被丢弃', async () => {
      const h = harness([]);
      let resolveFetch!: (r: Response) => void;
      globalThis.fetch = (async (): Promise<Response> => {
        await new Promise<Response>((r) => (resolveFetch = r));
        return new Response(frag(60, 'LATE'), { status: 200 });
      }) as typeof fetch;
      h.fire();
      await flush();
      const observed = h.ioInstances[0]?.observed as { isConnected: boolean };
      observed.isConnected = false; // 模拟在途期间舱岛 swap 换墙
      resolveFetch(new Response(frag(60, 'LATE'), { status: 200 }));
      await flush();
      assert.equal(h.root.wallCards.length, 0, '旧筛选的页不得追加进新墙');
      assert.equal(h.root.injected.length, 0);
    });
  });
});

// ---------------------------------------------------------- R-105 筛选舱收纳（cabinSection 纯函数；评审案 docs/iteration-batch3-review.md Q4）
describe('R-105 筛选舱收纳（cabinSection 纯函数）', () => {
  const counts = {
    genre: [{ value: 'Jazz', count: 3 }, { value: 'Electronic', count: 12 }],
    year: Array.from({ length: 75 }, (_, i) => ({ value: 1951 + i, count: 1 })), // 长尾年份轴（真库 75 项同量级）
    listened: [{ value: '2026', count: 4 }],
    favorite: [{ value: 1, count: 7 }],
    tag: [{ value: '深夜', count: 2 }],
    color: [{ value: 8, count: 5 }]
  };

  test('缺省开合：Genre 恒展开 / 年份·听期收起；summary = 轴名 + 项数摘要；Favorite/Tag/颜色仍平铺', () => {
    const html = String(cabinSection(EMPTY_FILTER, counts));
    assert.equal((html.match(/<details class="filter-axis axis-fold/g) ?? []).length, 3, '恰好三轴收纳（Genre/年份/听期）');
    assert.ok(html.includes('<details class="filter-axis axis-fold" open>'), 'Genre 缺省展开（主浏览轴不加一跳）');
    assert.ok(html.includes('<details class="filter-axis axis-fold axis-fold-year">'), '年份轴缺省收起');
    assert.ok(html.includes('<span class="axis-meta">75 项</span>'), '年份轴项数摘要');
    assert.ok(html.includes('<span class="axis-label">Genre</span><span class="axis-meta">2 项</span>'), 'Genre 摘要（无激活筛选不带已选标记）');
    assert.ok(html.includes('href="/?genre=Jazz"'), 'Genre chip 仍是 <a href="?…">（DD3 URL 即状态零新参数）');
    assert.ok(html.includes('href="/?year=1951"'), '年份 chip href 原语义');
    assert.ok(html.includes('class="filter-axis"'), 'Favorite/Tag/颜色三轴仍为平铺形态');
    assert.ok(html.includes('aria-label="渐进式筛选舱"'), '舱 role/aria 不变');
  });

  test('激活态：年份轴服务端置 open + 「已选」标记；激活 chip 可单独移除（轴排除语义零改动）', () => {
    const html = String(cabinSection({ ...EMPTY_FILTER, year: 2000 }, counts));
    assert.ok(html.includes('<details class="filter-axis axis-fold axis-fold-year" open>'), '激活年份轴展开（所选 chip 必然可见）');
    assert.ok(html.includes('75 项 · 已选'), 'summary 已选标记');
    assert.ok(html.includes('移除条件 2000（发行）'), '激活 chip 进入已选行可单独移除');
    assert.ok(html.includes('href="/?year=1951"'), '年份 chip = 轴内切换（替换 year 参数，buildHref 语义原样）');
    assert.ok(html.includes('href="/?genre=Jazz&amp;year=2000"'), 'Genre chip 携带全部激活筛选（跨轴叠加语义零改动；& 属性值转义）');
  });
});
