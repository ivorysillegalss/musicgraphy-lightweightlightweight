// 行为埋点域（W8-9 立项 · PRD §6 行为类四仪表数据源；评审案 docs/telemetry-review.md——用户 2026-11-15 执行令，Q1–Q5 全按建议值）
// 天粒度本地计数（0005 telemetry_days）：匿名 = 仅聚合计数、无个人标识符；数据本地派生零外发。
// 「可关闭」= cookie mg_metrics=closed → 停记（opt-out，评审案 Q3；无 cookie = 记）——与呈现开关同枚 cookie 同语义。
// dao.ts 零改动（G3）：自建 StmtCache 直连（savedviews/lookups 直连先例）；
// 路由侧经 AppOptions.telemetry 注入共享实例（B4 cover.gate 注入先例）。
// best-effort：埋点失败仅 debug 日志，绝不阻塞主功能（仪表是馈赠不是依赖，P1-1 馈赠语义同款）。
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Db } from './connection';
import { nowIso, StmtCache, type Row } from './sql';
import { logger } from '../logger';

const METRICS_COOKIE = 'mg_metrics'; // 呈现开关（pages.ts W8 同名 cookie）；closed = 停记
const COLS = ['search_total', 'search_fail', 'echo_shown', 'echo_click', 'detail_view', 'note_view', 'export_cnt'] as const;
export type TelemetryCol = (typeof COLS)[number];

/** 行为四仪表窗口（评审案 Q1：4 周，对齐 04B T1–T5 决策窗）；coverage/named_view_rate 维持全量口径 */
export const WINDOW_DAYS = 28;

/** 本地日 YYYY-MM-DD（echo.ts 本地时区口径） */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** 28 天窗口起点（含今天往前 WINDOW_DAYS-1 天） */
export function windowStartDay(now: Date = new Date()): string {
  return localDay(new Date(now.getTime() - (WINDOW_DAYS - 1) * 86_400_000));
}

export interface WindowSums {
  search_total: number;
  search_fail: number;
  echo_shown: number;
  echo_click: number;
  detail_view: number;
  note_view: number;
  export_cnt: number;
  /** 窗口内 export_cnt>0 的天数（export_usage 分子，评审案 Q1d） */
  export_days: number;
}

/** 读侧（metrics.ts 消费）：窗口内各列合计 + 有导出的天数 */
export function windowSums(st: StmtCache, startDay: string): WindowSums {
  const rows = st.get(`SELECT ${COLS.join(',')} FROM telemetry_days WHERE day >= ?`).all(startDay) as Row[];
  const out: WindowSums = { search_total: 0, search_fail: 0, echo_shown: 0, echo_click: 0, detail_view: 0, note_view: 0, export_cnt: 0, export_days: 0 };
  for (const r of rows) {
    for (const col of COLS) {
      const v = Number(r[col] ?? 0);
      if (!Number.isFinite(v)) continue;
      out[col] += v;
    }
    if (Number(r['export_cnt'] ?? 0) > 0) out.export_days += 1;
  }
  return out;
}

export interface Telemetry {
  /** 首页回响卡曝光（echoToday 命中才计——P1-1 曝光面） */
  echoShown(c: Context): void;
  /** 详情页视图：detail_view +1；fromEcho → echo_click +1；note 非空且添加日早于今日 → note_view +1（回访 = 排除添加当日，评审案 Q1c） */
  albumView(c: Context, fromEcho: boolean, note: string | null, addedAt: string | null): void;
  /** 外部搜索会话：search_total +1；failed（零结果/上游不可用）→ search_fail +1（429/422 不计 = 搜索未发生，评审案 Q1a） */
  searched(c: Context, failed: boolean): void;
  /** 导出响应（200）：export_cnt +1 */
  exported(c: Context): void;
  /** 读侧：窗口内各列合计 + 有导出的天数（metrics.ts 消费） */
  windowSums(startDay: string): WindowSums;
}

export function createTelemetry(db: Db, opts: { nowFn?: () => Date } = {}): Telemetry {
  const st = new StmtCache(db);
  const nowFn = opts.nowFn ?? (() => new Date());

  const bump = (c: Context, col: TelemetryCol): void => {
    if (getCookie(c, METRICS_COOKIE) === 'closed') return; // opt-out：停记（评审案 Q3）
    try {
      const day = localDay(nowFn());
      // 列名取自 COLS 白名单（代码内常量，无注入面）；upsert 单行累加（IM-7：UNIQUE 冲突走 ON CONFLICT，不依赖 errcode）
      st
        .get(
          `INSERT INTO telemetry_days (day, ${col}, updated_at) VALUES (?, 1, ?)
           ON CONFLICT(day) DO UPDATE SET ${col} = ${col} + 1, updated_at = excluded.updated_at`
        )
        .run(day, nowIso());
    } catch (err) {
      logger.debug('telemetry', 'record failed (best-effort)', { col, err: String(err) });
    }
  };

  return {
    echoShown: (c) => bump(c, 'echo_shown'),
    albumView: (c, fromEcho, note, addedAt) => {
      bump(c, 'detail_view');
      if (fromEcho) bump(c, 'echo_click');
      const addedDay = addedAt === null ? '' : addedAt.slice(0, 10);
      if ((note ?? '') !== '' && addedDay !== '' && addedDay < localDay(nowFn())) bump(c, 'note_view');
    },
    searched: (c, failed) => {
      bump(c, 'search_total');
      if (failed) bump(c, 'search_fail');
    },
    exported: (c) => bump(c, 'export_cnt'),
    windowSums: (startDay) => windowSums(st, startDay)
  };
}
