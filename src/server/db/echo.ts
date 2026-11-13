// 回响域（P1-1 那年今日；自 dao.ts 外拆保持 G3<200——IM-10a 先例同款机械搬移，零行为变更；saved_views 委托腾位预案 = 评审案 §4）
import type { Row, StmtCache } from './sql';
import { SQL_ECHO } from './queries';
import { mapItem, type CollectionItem } from './types';

/** 那年今日（P1-1，确定性时间锚）：本地时区 + 周年边界已修（复审注，02 §3） */
export function echoToday(st: StmtCache, userId = 'local', limit = 10): CollectionItem[] {
  const rows = st.get(SQL_ECHO).all(userId, limit) as Row[];
  return rows.map(mapItem);
}
