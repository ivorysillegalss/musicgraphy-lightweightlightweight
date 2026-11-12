/**
 * main.ts —— 岛屿加载器（ADR-003：SSR 直出 + 原生 TS 岛屿，无框架无 hydration）。
 *
 * 契约：页面在 HTML 里声明 `<div data-island="island-name">…</div>`，本加载器按名
 * 动态 import 对应岛屿模块并调用其 `mount(root)`。岛屿 = 渐进增强：JS 失败时页面
 * 回退无 JS 基线（chips=<a>、搜索=GET form、添加=POST+303，V4 P0）。
 * 每个 chunk 独立打包（vite.config.ts input 只含本入口，动态 import 自动切 chunk）。
 */

/* 设计系统样式（文档包 07-前端设计包/MASTER.md 的代码实现；静态导入 → vite 抽出
   为 /static/assets/main.css，SSR 侧 html.ts asset() 引用）。 */
import './styles/tokens.css';
import './styles/app.css';

export interface IslandModule {
  mount: (root: HTMLElement) => void;
}

type IslandLoader = () => Promise<IslandModule>;

/** 岛屿注册表（ADR-003 四岛屿；键 = data-island 属性值；保持懒加载勿静态引入）。 */
const ISLANDS: Record<string, IslandLoader> = {
  'add-dialog': () => import('./islands/add-dialog.js'),
  'filter-cabin': () => import('./islands/filter-cabin.js'),
  'search-box': () => import('./islands/search-box.js'),
  'keyboard-flow': () => import('./islands/keyboard-flow.js')
};

async function mountIslands(container: ParentNode = document): Promise<void> {
  const roots = container.querySelectorAll<HTMLElement>('[data-island]:not([data-island-mounted])');
  await Promise.all(
    Array.from(roots).map(async (root) => {
      const name = root.dataset.island;
      if (name === undefined) return;
      const loader = ISLANDS[name];
      if (loader === undefined) {
        console.warn(`[islands] 未注册的岛屿「${name}」——已跳过（页面保留 SSR 内容）。`);
        return;
      }
      try {
        const mod = await loader();
        mod.mount(root);
        root.dataset.islandMounted = 'true';
      } catch (err) {
        // 岛屿失败不拖垮页面：SSR 内容仍在（AGENTS §14 三态原则）
        console.error(`[islands] 岛屿「${name}」挂载失败：`, err);
      }
    })
  );
}

if (typeof document !== 'undefined') {
  void mountIslands();
}
