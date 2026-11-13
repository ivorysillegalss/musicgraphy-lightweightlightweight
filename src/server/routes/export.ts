// 导出域路由（P1-3 · 永久免费红线；02 §4 export 行 + §5.4 导出形状 + 评审 R6 封面边界）：
// GET /export?format=json|csv&with_covers=1 —— 鉴权同全局（/api/v1/* 守卫，Bearer 备用通道供导出脚本）
// with_covers=1 → store-only ZIP（records.json + records.csv + covers/ 全量），自写零新依赖：
// CRC-32 取自 node:zlib（Node ≥22.2），条目一律 STORE（covers 本已是压缩 JPEG，不重复压缩），
// 异步生成器逐块产出、管道背压生效——同一时刻至多一个封面文件在内存（内存纪律②：封面禁整目录读入）。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { Hono } from 'hono';
import type { DAO } from '../db/dao';
import type { ExportItem, ExportPayload } from '../db/types';
import { errorBody } from '../http';

// —— §5.4 投影 JSON（2 空格缩进：档案可读性优先于传输体积）——
const buildJson = (p: ExportPayload): string => JSON.stringify(p, null, 2);

// —— CSV（RFC4180：",\r\n 才引号转义 + \r\n 行尾 + 前置 BOM 便于 Excel 识别 UTF-8；genres/tags 用 | 连接）——
const CSV_COLUMNS = [
  'title',
  'artist',
  'release_year',
  'cover_url',
  'genres',
  'added_at',
  'listened_at',
  'listened_precision',
  'is_favorite',
  'cover_color',
  'note',
  'tags'
];

const csvCell = (v: string | number | boolean | null): string => {
  const s = v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const csvRow = (it: ExportItem): string =>
  [
    it.album.title,
    it.album.artist,
    it.album.release_year,
    it.album.cover_url,
    it.album.genres.join('|'),
    it.record.added_at,
    it.record.listened_at,
    it.record.listened_precision,
    it.record.is_favorite,
    it.record.cover_color,
    it.record.note,
    it.tags.join('|')
  ]
    .map(csvCell)
    .join(',');

const buildCsv = (p: ExportPayload): string => `\uFEFF${[CSV_COLUMNS.join(','), ...p.records.map(csvRow)].join('\r\n')}\r\n`;

// —— store-only ZIP（APPNOTE：local header 30+n + central directory 46+n + EOCD 22，全小端）——
const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
const u32 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** MS-DOS 时间/日期（ZIP 规范）；统一取导出时刻。 */
const dosTimeDate = (d: Date): [Uint8Array, Uint8Array] => [
  u16((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)),
  u16(((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate())
];

interface ZipEntry {
  name: string;
  /** 数据在产出时刻才加载（covers 逐文件读盘；单个不可读文件跳过并告警，不报废整份导出） */
  load: () => Uint8Array;
}

async function* zipChunks(entries: ZipEntry[], now: Date): AsyncGenerator<Uint8Array> {
  const [time, date] = dosTimeDate(now);
  const encode = new TextEncoder().encode.bind(new TextEncoder());
  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];
  let offset = 0;

  for (const entry of entries) {
    let data: Uint8Array;
    try {
      data = entry.load();
    } catch (err) {
      console.warn(`[export] 跳过不可读文件 ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const name = encode(entry.name);
    const crc = crc32(data);
    const head = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800), // general purpose flags：bit11 = UTF-8 条目名
      u16(0), // method = STORE
      time,
      date,
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name
    ]);
    yield head;
    for (let i = 0; i < data.length; i += 256 * 1024) yield data.subarray(i, Math.min(i + 256 * 1024, data.length));
    central.push({ name, crc, size: data.length, offset });
    offset += head.length + data.length;
  }

  const cdStart = offset;
  for (const rec of central) {
    const cd = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      time,
      date,
      u32(rec.crc),
      u32(rec.size),
      u32(rec.size),
      u16(rec.name.length),
      u16(0), // extra len
      u16(0), // comment len
      u16(0), // disk number start
      u16(0), // internal attrs
      u32(0), // external attrs
      u32(rec.offset),
      rec.name
    ]);
    yield cd;
    offset += cd.length;
  }

  yield concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(offset - cdStart), u32(cdStart), u16(0)]);
}

/** 递归收集 covers 目录普通文件（目录穿透、符号链接跳过防逃逸），条目名 posix 化并排序（产物确定可复现）。 */
function coverEntries(coversDir: string): ZipEntry[] {
  const walk = (dir: string, rel: string): ZipEntry[] => {
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return []; // covers 目录缺省/不可读 → 导出仍提供 json+csv
    }
    return dirents.flatMap((d) => {
      if (d.isSymbolicLink()) return [];
      const relPath = rel === '' ? d.name : `${rel}/${d.name}`;
      if (d.isDirectory()) return walk(join(dir, d.name), relPath);
      if (!d.isFile()) return [];
      const abs = join(dir, d.name);
      return [{ name: `covers/${relPath}`, load: () => new Uint8Array(readFileSync(abs)) }];
    });
  };
  return walk(coversDir, '').sort((a, b) => a.name.localeCompare(b.name));
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export function exportRoutes(dao: DAO, coversDir: string): Hono {
  const app = new Hono();

  app.get('/export', (c) => {
    const now = new Date();
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json' && format !== 'csv') {
      return c.json(errorBody('invalid_format', "format 只支持 'json' 或 'csv'"), 400);
    }
    const attach = (ext: string): Record<string, string> => ({
      'Content-Type': ext === 'zip' ? 'application/zip' : ext === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="musicgraphy-${ymd(now)}.${ext}"`
    });

    // 评审 R6：with_covers=1 → zip（records.json + records.csv + covers/**），I4「可重建档案」以此为准
    if (c.req.query('with_covers') === '1') {
      const payload = dao.exportAll();
      const encode = new TextEncoder();
      const entries: ZipEntry[] = [
        { name: 'records.json', load: () => encode.encode(buildJson(payload)) },
        { name: 'records.csv', load: () => encode.encode(buildCsv(payload)) },
        ...coverEntries(coversDir)
      ];
      const stream = Readable.toWeb(Readable.from(zipChunks(entries, now))) as unknown as ReadableStream<Uint8Array>;
      return c.body(stream, 200, attach('zip'));
    }

    const payload = dao.exportAll();
    if (format === 'csv') return c.body(buildCsv(payload), 200, attach('csv'));
    return c.body(buildJson(payload), 200, attach('json'));
  });

  return app;
}
