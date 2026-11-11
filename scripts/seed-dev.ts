// 开发数据种子：确定性（mulberry32 固定种子），默认 5000 张专辑 + 记录 + 标签
// 用途：FR-5 性能压测（5000 张首屏 <1s）、LIKE/json_each 实测、开发期封面墙
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { loadConfig, ensureDirs } from '../src/server/config';
import { openDatabase } from '../src/server/db/connection';
import { runMigrations } from '../src/server/db/migrate';

const N = Number(process.argv[2] ?? 5000);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20261111);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;

const ADJ = ['Neon', 'Silent', 'Golden', 'Blue', 'Midnight', 'Electric', 'Velvet', 'Crimson', 'Hollow', 'Paper', 'Iron', 'Wild', 'Frozen', 'Burning', 'Quiet', 'Distant'] as const;
const NOUN = ['Waves', 'Rooms', 'Letters', 'Gardens', 'Echoes', 'Trains', 'Coastline', 'Machine', 'Skyline', 'Harbor', 'Circuit', 'Cathedral', 'Orchard', 'Horizon', 'Signals', 'Ashes'] as const;
const CN_A = ['蓝色', '夜晚', '夏日', '沉默', '远行', '告别', '回声', '白昼', '南方', '群山'] as const;
const CN_B = ['列车', '信件', '海岸', '房间', '公路', '码头', '车站', '屋顶', '岛屿', '灯塔'] as const;
const ARTISTS = ['John Coltrane', 'Miles Davis', 'Radiohead', 'Daft Punk', 'Aphex Twin', 'Björk', 'Nirvana', 'Stevie Wonder', 'Fleetwood Mac', 'Kendrick Lamar', 'Portishead', 'Massive Attack', 'New Order', 'The Cure', 'Sufjan Stevens', 'Joni Mitchell', 'Flying Lotus', 'Bonobo', 'Nils Frahm', '坂本龙一', '周璇', '邓丽君', '罗大佑', '王菲', '万能青年旅店', '惘闻', 'The Radio Dept.', 'Boards of Canada', 'Burial', 'Sade'] as const;
const GENRES = ['Jazz', 'Electronic', 'Rock', 'Hip-Hop', 'Ambient', 'House', 'Techno', 'Folk', 'Classical', 'Pop', 'Metal', 'Soul', 'Funk', 'Disco', '爵士', '摇滚', '电子', '氛围'] as const;
const TAGS = ['夜晚', '通勤', '大学', '2026最爱', '循环', '冬天', '夏天', '深夜', '清晨', '雨天', '跑步', '旅行', 'jazz', 'electronic', 'favorite', 'roadtrip', 'workout', 'sleep', 'focus', 'party', '旧时光', '新找到', '年度盘点', '想再去听一次现场'] as const;

const cfg = loadConfig();
ensureDirs(cfg);
const db = openDatabase(cfg.dbPath);
runMigrations(db, 'db/migrations');

const t0 = performance.now();
db.exec('BEGIN IMMEDIATE');
const insA = db.prepare('INSERT INTO album_metadata (id, source, source_id, title, artist, release_year, genres, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
const insR = db.prepare('INSERT INTO collection_record (id, user_id, album_id, added_at, listened_at, listened_precision, note, is_favorite, cover_color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
const insT = db.prepare('INSERT INTO tags (id, user_id, name, normalized_name, created_at) VALUES (?,?,?,?,?)');
const selTag = db.prepare('SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?');
const insRT = db.prepare('INSERT INTO record_tag (record_id, tag_id, created_at) VALUES (?,?,?)');

const nowMs = Date.now();
const THREE_YEARS = 3 * 365.25 * 86_400_000;
let newTags = 0;
let tagLinks = 0;
for (let i = 0; i < N; i++) {
  const cn = rng() < 0.3;
  const title = cn ? `${pick(CN_A)}${pick(CN_B)}` : `${pick(ADJ)} ${pick(NOUN)}`;
  const artist = pick(ARTISTS);
  const year = 1950 + Math.floor(rng() * 76);
  const genreCount = rng() < 0.2 ? 0 : 1 + Math.floor(rng() * 2);
  const genres: string[] = [];
  for (let g = 0; g < genreCount; g++) {
    const x = pick(GENRES);
    if (!genres.includes(x)) genres.push(x);
  }
  const albumId = randomUUID();
  const created = new Date(nowMs - Math.floor(rng() * THREE_YEARS)).toISOString();
  insA.run(albumId, 'musicbrainz', `dev-${100000 + i}`, title, artist, year, genres.length > 0 ? JSON.stringify(genres) : null, created, created);

  const addedMs = nowMs - Math.floor(rng() * THREE_YEARS);
  const hasListen = rng() < 0.7;
  const listenYear = new Date(addedMs).getUTCFullYear();
  const note =
    rng() < 0.4 ? `为《${title}》写的记录：${pick(['深夜循环', '通勤伴侣', '大学毕业那年的声音', 'rainy day rotation', '唱片行淘到的绝版', '朋友推荐的宝藏'])}。` : null;
  const recordId = randomUUID();
  insR.run(
    recordId,
    'local',
    albumId,
    new Date(addedMs).toISOString(),
    hasListen ? `${listenYear}-01-01T00:00:00Z` : null,
    hasListen ? 'year' : null,
    note,
    rng() < 0.3 ? 1 : 0,
    rng() < 0.85 ? 1 + Math.floor(rng() * 16) : null,
    created,
    created
  );

  const tagN = Math.floor(rng() * 5);
  const pickedTags = new Set<string>();
  for (let k = 0; k < tagN; k++) pickedTags.add(pick(TAGS));
  for (const tag of pickedTags) {
    const norm = tag.toLowerCase();
    const found = selTag.get('local', norm) as { id: string } | undefined;
    let tagId: string;
    if (found !== undefined) {
      tagId = found.id;
    } else {
      tagId = randomUUID();
      insT.run(tagId, 'local', tag, norm, created);
      newTags++;
    }
    insRT.run(recordId, tagId, created);
    tagLinks++;
  }
}
db.exec('COMMIT');
const insertMs = Math.round(performance.now() - t0);

const records = (db.prepare('SELECT COUNT(*) AS n FROM collection_record').get() as { n: number }).n;
const albums = (db.prepare('SELECT COUNT(*) AS n FROM album_metadata').get() as { n: number }).n;
db.close();
const sizeMb = Number((statSync(cfg.dbPath).size / 1048576).toFixed(2));

console.log(
  JSON.stringify({ albums, records, tags_new: newTags, tag_links: tagLinks, insert_ms: insertMs, db_size_mb: sizeMb, path: cfg.dbPath }, null, 2)
);
