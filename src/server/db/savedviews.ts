// 命名视图域（P1-10，评审案 docs/saved-views-review.md Q5；用户 2026-11-14 批准实现；域文件委托先例 = associations/taggov/metrics）
// 只存查询状态不存专辑集合（裁决案 4 附条件）；UNIQUE(user_id,name) 防重名（复审 V12 精神）→ 重名复用 DuplicateRecordError。
import { randomUUID } from 'node:crypto';
import type { Db } from './connection';
import { DuplicateRecordError, NotFoundError } from './errors';
import { nowIso, type Row, type StmtCache } from './sql';
import { asStr, cell } from './types';

export interface SavedView {
  id: string;
  name: string;
  query_json: string;
  created_at: string;
}

const SQL_LIST =
  'SELECT id, name, query_json, created_at FROM saved_views WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100';
const SQL_VIEW_BY_NAME = 'SELECT id, name, query_json, created_at FROM saved_views WHERE user_id = ? AND name = ?';

export function listSavedViews(st: StmtCache, userId = 'local'): SavedView[] {
  const rows = st.get(SQL_LIST).all(userId) as Row[];
  return rows.map(mapView);
}

/** 按名取视图（恢复用 GET /?view=<name>）；不存在 → undefined（调用方静默回正常渲染） */
export function getViewByName(st: StmtCache, name: string, userId = 'local'): SavedView | undefined {
  const row = st.get(SQL_VIEW_BY_NAME).get(userId, name) as Row | undefined;
  return row ? mapView(row) : undefined;
}

export function createSavedView(db: Db, st: StmtCache, name: string, queryJson: string, userId = 'local'): { id: string } {
  const id = randomUUID();
  try {
    st.get('INSERT INTO saved_views (id, user_id, name, query_json, created_at) VALUES (?,?,?,?,?)').run(id, userId, name, queryJson, nowIso());
  } catch (err) {
    // 重名（UNIQUE(user_id,name)）→ 复用 DuplicateRecordError（评审案 Q5；onError 映射 duplicate_record 409 零改动）
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) throw new DuplicateRecordError('');
    throw err;
  }
  void db; // db 参数保留签名对称（createSavedView 无多语句事务需求）
  return { id };
}

export function deleteSavedView(st: StmtCache, id: string, userId = 'local'): { id: string } {
  const res = st.get('DELETE FROM saved_views WHERE id = ? AND user_id = ?').run(id, userId);
  if (Number(res['changes'] ?? 0) === 0) throw new NotFoundError();
  return { id };
}

function mapView(r: Row): SavedView {
  return {
    id: asStr(cell(r, 'id'), 'saved_view.id'),
    name: asStr(cell(r, 'name'), 'saved_view.name'),
    query_json: asStr(cell(r, 'query_json'), 'saved_view.query_json'),
    created_at: asStr(cell(r, 'created_at'), 'saved_view.created_at')
  };
}
