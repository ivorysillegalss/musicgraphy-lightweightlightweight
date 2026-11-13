// B5 网易云专辑导入器冒烟（IM-23 / 评审案 §4 测试口径：零网络注入 fetchFn 假 api-enhanced）
// 覆盖：三认证分支 / 分页拼装 / 歌单去重 / dedup 键 / preview-导入两段 / cookie 脱敏 /
// 失败容错 / fail-soft 停用 / 迁移 0003 存量库四步重建保真
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { openDatabase, type Db } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';
import { DAO } from '../src/server/db/dao';
import {
  dedupKey,
  fetchPlaylistAlbums,
  iterSavedAlbums,
  loginByCellphone,
  mapAlbumItem,
  neteaseBaseUrl,
  parsePlaylistId,
  qrLogin,
  redactCookie,
  sanitizeCookie,
  type NeteaseAlbumItem,
  type NeteaseError
} from '../src/server/metadata/netease';
import { collectExistingKeys, importSelected, markPreview } from '../scripts/netease-import';

// ---------------------------------------------------------------- 假 api-enhanced 网关

/** 零网络注入：URL 子串路由 → JSON 响应（值可为 (url)=>body 函数做逐页/逐态变化） */
function fakeGateway(routes: Record<string, unknown>): { fetchFn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: typeof fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (key === undefined) return new Response(JSON.stringify({ code: -1, message: 'no route' }), { status: 404 });
    const v = routes[key];
    const body = typeof v === 'function' ? (v as (url: string) => unknown)(url) : v;
    const status = typeof (body as { __status?: number })?.__status === 'number' ? (body as { __status: number }).__status : 200;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const ALBUM = (id: number, name: string, artist: string, savedAt?: number): Record<string, unknown> => ({
  id,
  name,
  artist: { name: artist },
  picUrl: `http://p/${id}.jpg`,
  publishTime: Date.UTC(1996, 0, 1),
  ...(savedAt === undefined ? {} : { savedAt })
});

describe('B5 网易云导入器（IM-23）', () => {
  // ---------------------------------------------------------------- fail-soft（Q2）
  test('fail-soft：未配置 NETEASE_API_BASE_URL → null（导入整体停用）；配置去尾斜杠', () => {
    assert.equal(neteaseBaseUrl({} as NodeJS.ProcessEnv), null);
    assert.equal(neteaseBaseUrl({ NETEASE_API_BASE_URL: '  ' } as NodeJS.ProcessEnv), null);
    assert.equal(neteaseBaseUrl({ NETEASE_API_BASE_URL: 'http://localhost:3001/' } as NodeJS.ProcessEnv), 'http://localhost:3001');
  });

  // ---------------------------------------------------------------- cookie（Q3）
  test('cookie sanitize：剥 Set-Cookie 属性与引号，仅留 name=value 对；redact 只出名不出值', () => {
    const pasted = 'MUSIC_U="abc123"; Path=/; Domain=.music.163.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure; SameSite=None; NUID=zzz=1';
    assert.equal(sanitizeCookie(pasted), 'MUSIC_U=abc123; NUID=zzz=1');
    const redacted = redactCookie('MUSIC_U=abc123; NUID=zzz=1');
    assert.equal(redacted, 'MUSIC_U=<redacted>; NUID=<redacted>');
    assert.ok(!redacted.includes('abc123') && !redacted.includes('zzz=1'), '脱敏形态不得含原始值（Q3 脱敏断言）');
    assert.equal(sanitizeCookie('Secure; HttpOnly'), '');
  });

  test('Q3 红线：netease.ts 零 logger（不写日志）；CLI 打印走 redactCookie', () => {
    const client = readFileSync('src/server/metadata/netease.ts', 'utf8');
    assert.ok(!/logger\s*\./.test(client) && !/import\s+[^;]*logger/.test(client), '瘦客户端不得引入/调用 logger（cookie 即用即弃不写日志）');
    const cli = readFileSync('scripts/netease-import.ts', 'utf8');
    assert.ok(cli.includes('redactCookie(') && cli.includes('sanitizeCookie('));
  });

  // ---------------------------------------------------------------- 三认证
  test('loginByCellphone：200 经 body.cookie 数组取 cookie（属性剥除）', async () => {
    const { fetchFn } = fakeGateway({
      '/login/cellphone': { code: 200, cookie: ['MUSIC_U=token1; Path=/; HttpOnly'], message: '登录成功' }
    });
    const r = await loginByCellphone({ baseUrl: 'http://gw', phone: '13800000000', password: 'pw', fetchFn });
    assert.equal(r.cookie, 'MUSIC_U=token1');
    assert.equal(r.profile, '登录成功');
  });

  test('loginByCellphone：code 502 → 密码错误/需验证码透传', async () => {
    const { fetchFn } = fakeGateway({ '/login/cellphone': { code: 502, message: '密码错误' } });
    await assert.rejects(loginByCellphone({ baseUrl: 'http://gw', phone: 'p', password: 'x', fetchFn }), (e: NeteaseError) => e.code === 502);
  });

  test('loginByCellphone：449 验证码透传（HTTP 449 与 body.code 449 两形态）', async () => {
    const a = fakeGateway({ '/login/cellphone': { __status: 449, code: 449 } });
    await assert.rejects(loginByCellphone({ baseUrl: 'http://gw', phone: 'p', password: 'x', fetchFn: a.fetchFn }), (e: NeteaseError) => e.code === 449);
    const b = fakeGateway({ '/login/cellphone': { code: 449 } });
    await assert.rejects(loginByCellphone({ baseUrl: 'http://gw', phone: 'p', password: 'x', fetchFn: b.fetchFn }), (e: NeteaseError) => e.code === 449);
  });

  test('qrLogin：key→create→check 801→802→803 全流程，cookie 从 803 提取', async () => {
    let checkCalls = 0;
    const states: string[] = [];
    const { fetchFn, calls } = fakeGateway({
      '/login/qr/key': { code: 200, data: { unikey: 'UNI1' } },
      '/login/qr/create': { code: 200, data: { qrimg: 'data:image/png;base64,AAAA' } },
      '/login/qr/check': () => {
        checkCalls++;
        return checkCalls === 1 ? { code: 801 } : checkCalls === 2 ? { code: 802 } : { code: 803, cookie: ['MUSIC_U=qrtoken; Path=/; HttpOnly'] };
      }
    });
    const sleeps: number[] = [];
    const qr: string[] = [];
    const r = await qrLogin({
      baseUrl: 'http://gw',
      fetchFn,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      onQrImage: (d) => {
        qr.push(d);
      },
      onState: (s) => {
        states.push(s);
      }
    });
    assert.equal(r.cookie, 'MUSIC_U=qrtoken');
    assert.deepEqual(states, ['waiting', 'scanned', 'authorized']);
    assert.equal(qr[0], 'data:image/png;base64,AAAA');
    assert.equal(checkCalls, 3);
    assert.ok(calls.some((u) => u.includes('/login/qr/key')) && calls.some((u) => u.includes('/login/qr/create')), 'key→create 调用序');
  });

  test('qrLogin：800 过期 → NeteaseError(800)', async () => {
    const { fetchFn } = fakeGateway({
      '/login/qr/key': { code: 200, data: { unikey: 'UNI1' } },
      '/login/qr/create': { code: 200, data: { qrimg: 'data:image/png;base64,AAAA' } },
      '/login/qr/check': { code: 800 }
    });
    await assert.rejects(qrLogin({ baseUrl: 'http://gw', fetchFn, sleepFn: async () => {} }), (e: NeteaseError) => e.code === 800);
  });

  // ---------------------------------------------------------------- 两导入源
  test('iterSavedAlbums 分页拼装：limit=100&offset 步进、页间 sleep 1000（≥1s 纪律）、流式产出', async () => {
    const { fetchFn, calls } = fakeGateway({
      '/album/sublist': (url: string) => {
        const offset = Number(new URL(url).searchParams.get('offset') ?? '0');
        const page = offset === 0 ? [ALBUM(1, 'A', 'AA'), ALBUM(2, 'B', 'BB')] : [ALBUM(3, 'C', 'CC')];
        return { code: 200, data: { count: 3, data: page } };
      }
    });
    const sleeps: number[] = [];
    const out: NeteaseAlbumItem[] = [];
    for await (const it of iterSavedAlbums({
      baseUrl: 'http://gw',
      cookie: 'MUSIC_U=t',
      fetchFn,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    })) {
      out.push(it);
    }
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((x) => x.sourceId), ['1', '2', '3']);
    assert.equal(out[0]?.artist, 'AA');
    assert.equal(out[0]?.releaseYear, 1996);
    assert.ok(calls.some((u) => u.includes('limit=100&offset=0')) && calls.some((u) => u.includes('limit=100&offset=100')), '分页 URL 拼装');
    assert.deepEqual(sleeps, [1000], '页间恰好一次 ≥1s 停顿');
  });

  test('parsePlaylistId：URL ?id=（含 #/playlist 形式）与裸数字；非法 → null', () => {
    assert.equal(parsePlaylistId('https://music.163.com/#/playlist?id=987654&app_version=8.9'), '987654');
    assert.equal(parsePlaylistId('https://music.163.com/playlist?id=246810'), '246810');
    assert.equal(parsePlaylistId('13579'), '13579');
    assert.equal(parsePlaylistId('https://music.163.com/#/album?ide=1'), null);
    assert.equal(parsePlaylistId('not-a-playlist'), null);
  });

  test('fetchPlaylistAlbums：跨页按 al.id 去重聚合，ar 名并集去重；整页(100)才翻页+页间 1s', async () => {
    const song = (alId: number, alName: string, ar: string[]): Record<string, unknown> => ({
      al: { id: alId, name: alName, picUrl: `http://p/${alId}.jpg` },
      ar: ar.map((n) => ({ name: n }))
    });
    const { fetchFn, calls } = fakeGateway({
      '/playlist/track/all': (url: string) => {
        const offset = Number(new URL(url).searchParams.get('offset') ?? '0');
        if (offset === 0) {
          const songs = Array.from({ length: 100 }, (_, i) => song(10, '同专辑', i === 0 ? ['主唱', '嘉宾'] : ['主唱']));
          songs.push(song(20, 'B 专辑', ['X']));
          return { code: 200, songs };
        }
        return { code: 200, songs: [song(20, 'B 专辑', ['X', 'Y'])] };
      }
    });
    const sleeps: number[] = [];
    const out = await fetchPlaylistAlbums({
      baseUrl: 'http://gw',
      cookie: '',
      playlistId: '246810',
      fetchFn,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      }
    });
    assert.equal(out.length, 2, 'al.id 去重：song×101 → 专辑×2');
    const same = out.find((x) => x.sourceId === '10');
    assert.equal(same?.artist, '主唱/嘉宾', '同页 artist 并集聚合');
    assert.equal(out.find((x) => x.sourceId === '20')?.artist, 'X/Y', '跨页 artist 并集聚合');
    assert.ok(calls.some((u) => u.includes('id=246810&limit=100&offset=0')) && calls.some((u) => u.includes('offset=100')), '整页才翻页');
    assert.deepEqual(sleeps, [1000], '页间恰好一次 ≥1s 停顿');
  });

  test('mapAlbumItem：缺 id → null（不可用条目跳过）；无 artist 兜底 Unknown Artist', () => {
    assert.equal(mapAlbumItem({ name: 'x' }), null);
    assert.equal(mapAlbumItem('nope'), null);
    const it = mapAlbumItem({ id: 7, name: 'No Artist Album' });
    assert.equal(it?.artist, 'Unknown Artist');
  });

  // ---------------------------------------------------------------- dedup 键
  test('dedupKey：artist|title 归一（trim+小写），同形异写同键', () => {
    assert.equal(dedupKey({ artist: ' John Coltrane ', title: 'Blue Train' }), 'john coltrane|blue train');
    assert.equal(dedupKey({ artist: 'JOHN COLTRANE', title: 'blue train' }), dedupKey({ artist: 'John Coltrane', title: 'Blue Train' }));
    assert.notEqual(dedupKey({ artist: 'A', title: 'B' }), dedupKey({ artist: 'A', title: 'C' }));
  });

  // ---------------------------------------------------------------- 迁移 0003（存量库四步重建保真）
  describe('迁移 0003_source_netease', () => {
    let dir: string;
    let db: Db;
    let dao: DAO;

    before(() => {
      dir = mkdtempSync(join(tmpdir(), 'mg-b5-mig-'));
      // 先在 user_version=2 的存量库上造数据（0001+0002 复制进临时目录 → 只跑到 0002）
      const mig2 = join(dir, 'mig-v2');
      mkdirSync(mig2, { recursive: true });
      copyFileSync('db/migrations/0001_init.sql', join(mig2, '0001_init.sql'));
      copyFileSync('db/migrations/0002_saved_views.sql', join(mig2, '0002_saved_views.sql'));
      db = openDatabase(join(dir, 't.db'));
      assert.equal(runMigrations(db, mig2), 2);
      dao = new DAO(db);
      const { id } = dao.upsertAlbum({ source: 'musicbrainz', source_id: 'mb-old', title: 'Blue Train', artist: 'John Coltrane', release_year: 1958, genres: ['Jazz'] });
      dao.createRecord({ album_id: id, note: '迁移保真锚' });
    });

    after(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    test('存量库应用 0003：数据保真 + CHECK 扩展生效 + FK 基线恢复 + user_version=3', () => {
      const applied = runMigrations(db, 'db/migrations'); // 只新增 0003
      assert.equal(applied, 1);
      dao = new DAO(db); // 重建后换新 DAO（语句缓存与新 schema 对齐）
      const rows = dao.listPage({ limit: 60 });
      assert.equal(rows.items.length, 1);
      assert.equal(rows.items[0]?.album.title, 'Blue Train');
      assert.equal(rows.items[0]?.note, '迁移保真锚');
      assert.equal(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version), 3);
      assert.equal(Number((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys), 1, '迁移窗口结束 FK=ON 恢复');
      // 新枚举可写；旧 CHECK 不放行的值仍拒绝
      const { id: nid } = dao.upsertAlbum({ source: 'netease', source_id: 'ne-1', title: 'NE 专辑', artist: 'NE Artist' });
      assert.ok(nid);
      assert.throws(() =>
        db
          .prepare('INSERT INTO album_metadata (id, source, source_id, title, artist, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
          .run('bogus', 'bogus-src', 'bogus', 't', 'a', 'now', 'now')
      );
      // 四步重建后子表 REFERENCES 仍锚定（改名重解析实测）
      assert.throws(() => db.prepare('INSERT INTO collection_record (id, album_id, added_at, created_at, updated_at) VALUES (?,?,?,?,?)').run('rec-x', 'no-such-album', 'now', 'now', 'now'));
      // 索引随重建在场（UNIQUE(source, source_id) 语义保持）
      assert.throws(() =>
        db
          .prepare('INSERT INTO album_metadata (id, source, source_id, title, artist, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
          .run('dup', 'netease', 'ne-1', 'dup', 'd', 'now', 'now')
      );
    });
  });

  // ---------------------------------------------------------------- preview → 导入两段
  describe('两段式 preview 与导入', () => {
    let dir: string;
    let db: Db;
    let dao: DAO;

    before(() => {
      dir = mkdtempSync(join(tmpdir(), 'mg-b5-imp-'));
      db = openDatabase(join(dir, 't.db'));
      runMigrations(db, 'db/migrations');
      dao = new DAO(db);
      const { id } = dao.upsertAlbum({ source: 'musicbrainz', source_id: 'mb-bt', title: 'Blue Train', artist: 'John Coltrane', release_year: 1958 });
      dao.createRecord({ album_id: id });
    });

    after(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    const items: NeteaseAlbumItem[] = [
      { sourceId: '101', title: 'Blue Train', artist: 'John Coltrane', coverUrl: null, releaseYear: 1958, savedAt: null }, // 已有（key 命中）
      { sourceId: '102', title: 'Kind of Blue', artist: 'Miles Davis', coverUrl: 'http://p/102.jpg', releaseYear: 1959, savedAt: '2023-11-14T00:00:00Z' },
      { sourceId: '103', title: 'A Love Supreme', artist: 'John Coltrane', coverUrl: null, releaseYear: 1965, savedAt: null }
    ];

    test('preview：isNew 标记（dedupKey 与 netease source_id 双通道）+ dry-run 零写入', () => {
      const preview = markPreview(items, dao);
      assert.deepEqual(preview.map((p) => p.isNew), [false, true, true]);
      const added: string[] = [];
      const summary = importSelected(dao, preview, { dryRun: true, onAlbumAdded: (id) => added.push(id) });
      assert.equal(summary.fetched, 3);
      assert.equal(summary.new, 2);
      assert.equal(summary.exists, 1);
      assert.equal(summary.imported, 0, 'dry-run 零写入');
      assert.equal(added.length, 0);
      assert.equal(dao.listPage({ limit: 60 }).items.length, 1, '库内仍只有原 1 条');
    });

    test('正式导入：summary 计数 + listened_at=savedAt(day) + tag netease + D2 不重复 + 重放幂等', () => {
      const added: Array<{ albumId: string; sourceId: string; coverUrl: string | null }> = [];
      const preview = markPreview(items, dao);
      const summary = importSelected(dao, preview, { onAlbumAdded: (albumId, sourceId, coverUrl) => added.push({ albumId, sourceId, coverUrl }) });
      assert.deepEqual({ fetched: summary.fetched, new: summary.new, exists: summary.exists, imported: summary.imported, failed: summary.failed }, {
        fetched: 3,
        new: 2,
        exists: 1,
        imported: 2,
        failed: 0
      });
      assert.equal(dao.listPage({ limit: 60 }).items.length, 3, '2 新增 + 1 原有（D2 不产生第二条 Blue Train）');
      const kob = dao.listPage({ limit: 60 }).items.find((it) => it.album.title === 'Kind of Blue');
      assert.ok(kob);
      assert.equal(kob.album.source, 'netease');
      const detail = dao.getRecord(kob.id);
      assert.equal(detail.tags[0], 'netease');
      assert.equal(detail.album.source_id, '102');
      // listened_at = 网易云 savedAt（day 精度），个人数据本地生成（用户资产口径）
      const row = db.prepare('SELECT listened_at, listened_precision FROM collection_record WHERE id = ?').get(kob.id) as { listened_at: string; listened_precision: string };
      assert.equal(row.listened_at, '2023-11-14T00:00:00Z');
      assert.equal(row.listened_precision, 'day');
      // onAlbumAdded 钩子逐张触发（封面懒下载对其透明；coverUrl null 也回调，CLI 内部过滤）
      assert.deepEqual(added.map((x) => x.sourceId), ['102', '103']);
      assert.equal(added[0]?.coverUrl, 'http://p/102.jpg');
      // 重放幂等：source_id 已知 → 全部 isNew=false → imported=0；fetched 全量口径不失真
      const replay = importSelected(dao, markPreview(items, dao));
      assert.equal(replay.fetched, 3);
      assert.equal(replay.chosen, 0);
      assert.equal(replay.imported, 0);
      assert.equal(replay.exists, 3);
    });
  });

  // ---------------------------------------------------------------- 失败容错
  test('失败容错：单张失败不阻塞整批；failures 截断 20 条；计数如实', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg-b5-fail-'));
    try {
      const fdb = openDatabase(join(dir, 't.db'));
      runMigrations(fdb, 'db/migrations');
      const fdao = new DAO(fdb);
      const orig = fdao.upsertAlbum;
      fdao.upsertAlbum = (input) => {
        if (input.source_id === 'boom') throw new Error('注入失败');
        return orig(input);
      };
      const batch: NeteaseAlbumItem[] = [
        ...Array.from({ length: 25 }, (_, i) => ({ sourceId: 'boom', title: `坏 ${i}`, artist: 'X', coverUrl: null, releaseYear: null, savedAt: null })),
        { sourceId: 'ok-1', title: '好专辑', artist: 'Y', coverUrl: null, releaseYear: 2000, savedAt: null }
      ];
      const summary = importSelected(fdao, markPreview(batch, fdao));
      assert.equal(summary.failed, 25);
      assert.equal(summary.imported, 1);
      assert.equal(summary.failures.length, 20, 'failures 前 20 条不阻塞整批');
      assert.equal(fdao.listPage({ limit: 60 }).items.length, 1);
      fdb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('collectExistingKeys：listPage 全量走查构建 dedupKey 集（读捷径零 DAO 新增）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg-b5-keys-'));
    try {
      const kdb = openDatabase(join(dir, 't.db'));
      runMigrations(kdb, 'db/migrations');
      const kdao = new DAO(kdb);
      const { id } = kdao.upsertAlbum({ source: 'musicbrainz', source_id: 'k-1', title: 'Kid A', artist: 'Radiohead' });
      kdao.createRecord({ album_id: id });
      const keys = collectExistingKeys(kdao);
      assert.ok(keys.has('radiohead|kid a'));
      kdb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
