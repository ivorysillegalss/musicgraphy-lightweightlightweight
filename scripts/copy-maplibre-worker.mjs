/**
 * copy-maplibre-worker.mjs —— 把 maplibre-gl 的 worker 模块拷入 public/static（vite 构建时随 public/ 进 dist）。
 *
 * 为什么必须自托管 worker 文件（2026-11-17 实跑发现，见提交说明）：
 * maplibre-gl v6 的 worker URL = `new URL('./maplibre-gl-worker' + '.mjs', import.meta.url)`——
 * **非字面量拼接**，vite 静态分析无法识别 → 构建产物缺 worker 文件 → 运行时解析到
 * /static/chunks/maplibre-gl-worker.mjs（404）→ worker 加载失败 → 地图静默停摆
 * （style 不派发、零事件、/atlas 两主题皆空白，任何浏览器皆然）。
 * 修复 = ① 本脚本把 worker 文件带进构建产物 ② maplibre-adapter.ts 顶层
 * `setWorkerUrl('/static/maplibre-gl-worker.mjs')` 显式指路（v6 公开 API setWorkerUrl）。
 * 升级 maplibre 时本文件随 node_modules 重拷（每次 build 自动执行）；文件名不带 hash，
 * 升级后首次构建 mtime 变化触发缓存刷新，如遇顽固缓存可在此追加 ?v= 查询参数。
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');
// public/** 直接镜像 dist/static/**（publicDir 默认行为，public/geo → /static/geo 同构）——
// 目标 = public 根，服务 URL 即 /static/maplibre-gl-worker.mjs。
const destDir = resolve(root, 'public');
const dest = resolve(destDir, 'maplibre-gl-worker.mjs');

if (!existsSync(src)) {
  console.error(`[copy-maplibre-worker] 源不存在：${src}（node_modules 未安装或 maplibre-gl 版本变更？）`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
const kb = Math.round(statSync(dest).size / 1024);
console.log(`[copy-maplibre-worker] maplibre-gl-worker.mjs → public/static/（${kb}KB）`);
