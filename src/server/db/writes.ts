// 写路径实现（自 dao.ts 拆出，保持 DAO <200 行护栏，PM §7.1）——接口经 DAO 类委托，调用方无感
import { randomUUID } from 'node:crypto';
import type { Db } from './connection';
import { DuplicateRecordError, NotFoundError } from './errors';
import { normalizeTag, nowIso, type Row, type StmtCache } from './sql';
import { asStr, cell } from './types';
import { appendAlias, resolveAlbumTarget, type AlbumUpsertInput } from './album-merge';

/**
 * 元数据落库（I2 / AGENTS §4：永不触碰用户数据）。三级落点（02 §5.2，见 album-merge.ts）：
 * 主键命中 / 别名命中 / title+artist 归并 → 保守更新既有行（首个挂接的 album_metadata 保留，
 * 其余源 ID 追加进 alias_sources）；均未命中 → 新建行。
 */
export function upsertAlbum(db: Db, st: StmtCache, input: AlbumUpsertInput): { id: string; existed: boolean } {
  const genresJson = input.genres && input.genres.length > 0 ? JSON.stringify(input.genres) : null;
  const target = resolveAlbumTarget(st, input);
  if (target.kind !== 'new') {
    const id = asStr(cell(target.row, 'id'), 'id');
    if (target.kind === 'identity') appendAlias(st, id, input.source, input.source_id);
    updateAlbumFields(st, id, input, genresJson);
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

/** 保守合并（IM-12）：只有非空字段才覆盖——重复添加路径（409 转化提示）不会清空已有快照 */
function updateAlbumFields(st: StmtCache, id: string, input: AlbumUpsertInput, genresJson: string | null): void {
  const sets: string[] = ['updated_at = ?'];
  const params: (string | number | null)[] = [nowIso()];
  if (input.title !== '') {
    sets.push('title = ?');
    params.push(input.title);
  }
  if (input.artist !== '') {
    sets.push('artist = ?');
    params.push(input.artist);
  }
  if (input.release_year !== undefined && input.release_year !== null) {
    sets.push('release_year = ?');
    params.push(input.release_year);
  }
  if (input.cover_url !== undefined && input.cover_url !== null && input.cover_url !== '') {
    sets.push('cover_url = ?');
    params.push(input.cover_url);
  }
  if (genresJson !== null) {
    sets.push('genres = ?');
    params.push(genresJson);
  }
  if (input.country !== undefined && input.country !== null && input.country !== '') {
    sets.push('country = ?');
    params.push(input.country);
  }
  st.get(`UPDATE album_metadata SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
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

/** Step 2 封面落盘回填（F3）：cover_local 存文件名（服务层拼 /covers/ 前缀，IM-12） */
export function setAlbumCoverLocal(st: StmtCache, albumId: string, filename: string | null): void {
  st.get('UPDATE album_metadata SET cover_local = ?, updated_at = ? WHERE id = ?').run(filename, nowIso(), albumId);
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
