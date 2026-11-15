/**
 * five-state.ts —— 国家面五态染色表达式（DR-M3 · 设计参考 03 §2.3 同构，配色走本项目 token）。
 *
 * 五态语义（对齐 Radiooooo §2.3 的 feature-state 数据表达式——GPU 侧求值，setFeatureState
 * 增量切换零重绘上传，「状态渲染 > 数据渲染」）：
 *   playing  → 强调色 + 最高透明度（播放中）
 *   selected → 强调色 + 中透明度（选中）
 *   hover    → 强调色（悬停；透明度略低于 playing）
 *   empty    → 基色 + 近隐身透明度（不在可用名单——白名单由 availableIsoCodes 注入）
 *   基态     → 基色弱填充（名单内但无任何交互态）
 * 配色规则（评审案 5db47b4 §5 第 2 条 + MASTER token 单一事实源）：全部色值经 tokens
 * 参数注入（来源 = app.css globe token 桥段 --globe-accent/--globe-land，其值引用
 * tokens.css 既有变量），本文件禁止硬编码任何色值——缺 token 直接抛错（fail loud）。
 *
 * 红线：本文件禁止 import maplibre 或任何渲染库——表达式 = 纯数据结构（可单测断言、
 * 换引擎零改染色语义，DR-M0 DoD「换实现零改地图」的染色侧延伸）。
 * availableIsoCodes = null 表示「全部可用」（D3 阶段白名单未接，先全可用；D4 派工接
 * Mock 白名单时传真实名单），此模式下 empty 态分支不出现。
 */

/** maplibre 数据表达式的纯数据表示（数组/字面量；表达式合法性由 maplibre 运行时按 style spec 校验）。 */
export type DataExpression = unknown[];

/**
 * 五态透明度（数值常量非色值，不入 token 管辖；梯度对齐 §2.3：
 * playing 高 / selected 中 / hover 交互提示 / base 弱填充 / empty 近隐身）。
 */
export const FIVE_STATE_OPACITY = {
  playing: 0.9,
  selected: 0.6,
  hover: 0.8,
  base: 0.5,
  empty: 0.06
} as const;

/** 染色 token（键 = 语义名；值 = CSS 自定义属性运行时解析结果，如 '#D97706'）。 */
export interface FiveStateTokens {
  /** 强调色（playing/selected/hover）——来源 = --globe-accent（引用 --color-accent 琥珀）。 */
  accent: string;
  /** 基态陆面弱填充色——来源 = --globe-land（light = --color-border 暖纸边 / dark = --stone-800）。 */
  base: string;
}

export interface FillPaintSpec {
  'fill-color': DataExpression;
  'fill-opacity': DataExpression;
}

function requireToken(tokens: FiveStateTokens, key: keyof FiveStateTokens): string {
  const v = tokens[key];
  if (typeof v !== 'string' || v === '') {
    throw new Error(`[globe-view] five-state token「${key}」缺失——app.css globe token 桥段未解析？（禁硬编码兜底色）`);
  }
  return v;
}

/** 白名单匹配表达式（要素属性 iso_a2 或 iso_a3 任一命中 = 可用）。 */
function inListExpression(availableIsoCodes: string[]): DataExpression {
  const codes = [...availableIsoCodes];
  // 已知边界（评审案披露口径）：NE 110m 有 5 个要素 iso_a2 与 iso_a3 均为 '-99'
  // （France/Norway/北塞浦路斯/索马里兰/科索沃）——白名单模式下它们恒 empty，
  // D4 接 G2 可用性 API 时按该 API 的 isocode 口径裁决兜底（如 name 兜底），本层不预置。
  return [
    'any',
    ['in', ['get', 'iso_a2'], ['literal', codes]],
    ['in', ['get', 'iso_a3'], ['literal', codes]]
  ];
}

/**
 * 五态 fill paint 表达式（纯函数）。
 * @param availableIsoCodes 可用国家 isocode 白名单；null = 全部可用（无 empty 分支）
 * @param tokens 染色 token（accent/base，缺一抛错）
 */
export function buildFillPaint(availableIsoCodes: string[] | null, tokens: FiveStateTokens): FillPaintSpec {
  const accent = requireToken(tokens, 'accent');
  const base = requireToken(tokens, 'base');
  const o = FIVE_STATE_OPACITY;
  const opacityCase: DataExpression = availableIsoCodes === null
    ? ['case',
        ['boolean', ['feature-state', 'playing'], false], o.playing,
        ['boolean', ['feature-state', 'selected'], false], o.selected,
        ['boolean', ['feature-state', 'hover'], false], o.hover,
        o.base]
    : ['case',
        ['boolean', ['feature-state', 'playing'], false], o.playing,
        ['boolean', ['feature-state', 'selected'], false], o.selected,
        ['boolean', ['feature-state', 'hover'], false], o.hover,
        inListExpression(availableIsoCodes), o.base,
        o.empty];
  return {
    'fill-color': [
      'case',
      ['boolean', ['feature-state', 'playing'], false], accent,
      ['boolean', ['feature-state', 'selected'], false], accent,
      ['boolean', ['feature-state', 'hover'], false], accent,
      base
    ],
    'fill-opacity': opacityCase
  };
}
