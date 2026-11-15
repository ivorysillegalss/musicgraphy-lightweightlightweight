/**
 * globe-view 端口契约（DR-M0 · 设计参考 03 §5.5 第 0 步「接口契约先行」）。
 *
 * 两道缝先定型（原理依据 = 设计参考 03 §2.3/§2.4 对 Radiooooo 的拆解）：
 * ① PlaybackPort = 播放状态源——五态染色是「外部播放状态的函数」（feature-state 数据
 *    表达式，§2.3），地图渲染层只消费状态、不关心状态从哪来（无播放引擎/真音频/演示
 *    注入皆可换）；
 * ② StylePort = 样式主题源——样式是 substrate（setStyle 整换 + paint 挂在 style 上，
 *    §2.4），切换语义由本端口约定，渲染适配器自行落实「不重载页面、不重建数据层」。
 * 这两条缝不在第 0 步定型，后面必然硬编码返工（§5.5 排序原理①）。
 *
 * 红线：本文件禁止 import maplibre 或任何渲染库——契约必须引擎无关，
 * DoD =「换实现零改地图」（§5.5 预留接口验收口径）。
 */

/** 国家面的播放语义态（featureId = 地图要素标识，M0 阶段不约定具体形状，由渲染适配器定义）。 */
export type PlayState = 'idle' | 'selected' | 'playing';

/** 播放状态端口：地图渲染层据此染色（idle/selected/playing），不感知真实播放器存在与否。 */
export interface PlaybackPort {
  /** 读取某国家面当前播放语义态；未知 featureId 容错返回 'idle'，不抛错。 */
  getPlayState(featureId: string): PlayState;
  /** 订阅状态变化（参数 = featureId + 新状态）；返回退订函数，调用后不再收到通知。 */
  subscribe(listener: (featureId: string, state: PlayState) => void): () => void;
}

/**
 * 主题描述记录：M0 阶段保持不透明（id + label 是最小稳定面），具体视觉字段
 * （style URL/paint 映射等）由 D3 的 maplibre 适配器以扩展字段填充（索引签名放行）。
 */
export interface ThemeDescriptor {
  id: string;
  label: string;
  [key: string]: unknown;
}

/** 样式主题端口：主题注册表 + 切换语义（类比 Radiooooo setStyle(diff:false)，§2.4）。 */
export interface StylePort {
  /** 可选主题列表（渲染层据此渲染主题选择 UI）。 */
  getThemes(): ThemeDescriptor[];
  /** 当前激活主题 id。 */
  getActiveTheme(): string;
  /** 切换主题；未知 id 抛错（由实现校验注册表）。 */
  setTheme(id: string): void;
  /** 订阅主题切换（参数 = 新主题 id）；返回退订函数，调用后不再收到通知。 */
  subscribe(listener: (themeId: string) => void): () => void;
}
