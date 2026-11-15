/**
 * StylePort 的注册表实现（DR-M0 · 设计参考 03 §5.5 波次 0）。
 *
 * 主题 = 不透明 ThemeDescriptor 记录的注册表：getThemes 列出、setTheme 校验并切换
 * （未知 id 抛错）、subscribe 通知切换。视觉落实（setStyle/paint 映射、§2.4 的
 * setStyle(diff:false) 语义）归 D3 的 maplibre 适配器——本实现只管「主题 id 账本」，
 * M0 阶段即 StylePort 的可用实现（§5.5 波次 2 换真样式注册表时零改地图）。
 * 默认两主题 = 设计参考 03 §5.3 DR-M2 建议收敛的 1+1 最小集（奶油纸面明式 + 暗式）。
 */
import type { StylePort, ThemeDescriptor } from '../ports';

/** 默认主题注册表（M0 最小集；D3 适配器可传入带扩展字段的同构描述符替换）。 */
export const DEFAULT_THEMES: ThemeDescriptor[] = [
  { id: 'light', label: '奶油纸面' },
  { id: 'dark', label: '暗色' }
];

export class RegistryStyleAdapter implements StylePort {
  private readonly themes: ThemeDescriptor[];
  private active: string;
  private readonly listeners = new Set<(themeId: string) => void>();

  constructor(themes: ThemeDescriptor[] = DEFAULT_THEMES) {
    // 防御性拷贝：注册表不共享外部数组引用（构造后外部改动不串扰注册表状态）
    this.themes = [...themes];
    // noUncheckedIndexedAccess：空注册表 active 退化为 ''（getThemes 也为空，无可用主题）
    this.active = this.themes[0]?.id ?? '';
  }

  getThemes(): ThemeDescriptor[] {
    return [...this.themes];
  }

  getActiveTheme(): string {
    return this.active;
  }

  setTheme(id: string): void {
    const theme = this.themes.find((t) => t.id === id);
    if (theme === undefined) {
      throw new Error(`[globe-view] 未知主题 id「${id}」——注册表内无此主题。`);
    }
    this.active = id;
    for (const listener of this.listeners) {
      listener(id);
    }
  }

  subscribe(listener: (themeId: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
