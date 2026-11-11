// 写路径实现（自 dao.ts 拆出，保持 DAO <200 行护栏，PM §7.1）——接口经 DAO 类委托，调用方无感
import { randomUUID } from 'node:crypto';
import type { Db } from './connection';
import { DuplicateRecordError, NotFoundError } from './errors';
import { normalizeTag, nowIso, type Row, type StmtCache } from './sql';
import { asStr, cell } from './types';

/** 元数据落库：同 (source, source_id) 则更新外部快照字段——永不触碰用户数据（I2 / AGENTS §4） */
export function upsertAlbum(
  db: Db,
  st: StmtCache,
  input: {
    source: string;
    source_id: string;
    title: string;
    artist: string;
    release_year?: number | null;
    cover_url?: string | null;
    genres?: string[];
    country?: string | null;
  }
): { id: string; existed: boolean } {
  const genresJson = input.genres && input.genres.length > 0 ? JSON.stringify(input.genres) : null;
  const existing = st.get('SELECT id FROM album_metadata WHERE source = ? AND source_id = ?').get(input.source, input.source_id) as Row | undefined;
  if (existing) {
    const id = asStr(cell(existing, 'id'), 'id');
    st.get('UPDATE album_metadata SET title = ?, artist = ?, release_year = ?, cover_url = ?, genres = ?, country = ?, updated_at = ? WHERE id = ?').run(
      input.title,
      input.artist,
      input.release_year ?? null,
      input.cover_url ?? null,
      genresJson,
      input.country ?? null,
      nowIso(),
      id
    );
    return { id, existed: true };
  }
  const id = randomUUID();
  st.get('INSERT INTO album_metadata (id, source, source_id, title, artist, release_year, cover_url, genres, country, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id,
    input.source,
    input.source_id,
    input.title,
    input.artist,
    input.release_year ?? null,
    input.cover_url ?? null,
    genresJson,
    input.country ?? null,
    nowIso(),
    nowIso()
  );
  return { id, existed: false };
}

/** 落库记录（FR-1/D2）：重复 → DuplicateRecordError（409 duplicate_record，ADR-007 条 2） */
export function createRecord(
  db: Db,
  st: StmtCache,
  input: {
    album_id: string;
    userId?: string;
    added_at?: string;
    listened_at?: string | null;
    listened_precision?: 'day' | 'year' | null;
    note?: string | null;
  }
): { id: string } {
  const userId = input.userId ?? 'local';
  const id = randomUUID();
  const ts = nowIso();
  try {
    st.get('INSERT INTO collection_record (id, user_id, album_id, added_at, listened_at, listened_precision, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id,
      userId,
      input.album_id,
      input.added_at ?? ts,
      input.listened_at ?? null,
      input.listened_precision ?? null,
      input.note ?? null,
      ts,
      ts
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      const dup = st.get('SELECT id FROM collection_record WHERE user_id = ? AND album_id = ?').get(userId, input.album_id) as Row | undefined;
      throw new DuplicateRecordError(dup ? asStr(cell(dup, 'id'), 'id') : '');
    }
    throw err;
  }
  return { id };
}

/** 补/改 favorite、note、listened_at（FR-1/P1-7）：未命中 → NotFoundError */
export function updateRecord(
  st: StmtCache,
  id: string,
  patch: { note?: string | null; is_favorite?: boolean; listened_at?: string | null; listened_precision?: 'day' | 'year' | null; cover_color?: number | null },
  userId = 'local'
): { id: string } {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.note !== undefined) {
    sets.push('note = ?');
    params.push(patch.note);
  }
  if (patch.is_favorite !== undefined) {
    sets.push('is_favorite = ?');
    params.push(patch.is_favorite ? 1 : 0);
  }
  if (patch.listened_at !== undefined) {
    sets.push('listened_at = ?');
    params.push(patch.listened_at);
  }
  if (patch.listened_precision !== undefined) {
    sets.push('listened_precision = ?');
    params.push(patch.listened_precision);
  }
  if (patch.cover_color !== undefined) {
    sets.push('cover_color = ?');
    params.push(patch.cover_color);
  }
  if (sets.length === 0) throw new Error('empty_patch');
  sets.push('updated_at = ?');
  params.push(nowIso());
  params.push(id, userId);
  const res = st.get(`UPDATE collection_record SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  if (Number(res['changes'] ?? 0) === 0) throw new NotFoundError();
  return { id };
}

/** 挂标签（AGENTS §7）：normalized 唯一约束防分裂（复审 V12）；整组替换语义 */
export function setTags(db: Db, st: StmtCache, recordId: string, names: string[], userId = 'local'): string[] {
  const pairs = [...new Map(names.map((n) => [normalizeTag(n), n.trim()]))].filter(([norm]) => norm !== '');
  tx(db, () => {
    const cur = st.get('SELECT id FROM collection_record WHERE id = ? AND user_id = ?').get(recordId, userId) as Row | undefined;
    if (!cur) throw new NotFoundError();
    st.get('DELETE FROM record_tag WHERE record_id = ?').run(recordId);
    for (const [norm, raw] of pairs) {
      const row = st.get('SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?').get(userId, norm) as Row | undefined;
      let tagId: string;
      if (row) {
        tagId = asStr(cell(row, 'id'), 'tag.id');
      } else {
        tagId = randomUUID();
        st.get('INSERT INTO tags (id, user_id, name, normalized_name, created_at) VALUES (?,?,?,?,?)').run(tagId, userId, raw, norm, nowIso());
      }
      st.get('INSERT INTO record_tag (record_id, tag_id, created_at) VALUES (?,?,?)').run(recordId, tagId, nowIso());
    }
    st.get('UPDATE collection_record SET updated_at = ? WHERE id = ?').run(nowIso(), recordId);
  });
  return pairs.map(([norm]) => norm);
}

function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
