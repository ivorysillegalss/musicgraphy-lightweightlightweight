/**
 * topster-svg.ts —— Topster 高清导出 SVG（W11 批，W10-12-1 #2；评审案 docs/topster-review.md §3 案 A，
 * 用户 2026-11-14 AskUserQuestion 批准 A+C 组合）。零依赖纯文本生成（G1 零新包；禁 base64 纪律②③——
 * 封面以 URL 引用不内嵌像素；署名 "made with Musicgraphy" 内嵌 = 04B 引擎一「分享的是作品图，不是产品」）。
 * 诚实边界（评审案 §3 披露）：SVG 是纯文本矢量格式，主流社交平台不接受其作为图片上传、部分查看器不加载
 * 外链资源——现实分享路径由案 C 海报页（/topsters/:id/poster，用户截图即成图）补位。
 * 注意：本文件输出原始 XML 字符串（不经 hono/html），**所有插值必须过 escapeXml**（禁 raw 插用户数据的
 * 同款纪律在 SVG 面的等价实现——title/subtitle 是用户输入）。
 */
import type { TopsterMeta } from '../db/topster';
import { coverSrcOf } from '../html';
import type { CollectionItem } from '../db/types';

/** XML 文本/属性转义（SVG 是 XML：& < > " ' 全部转义为命名实体——用户输入零 raw 插入） */
function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&apos;'));
}

const CELL = 260; // 封面格边长（高清导出：4 列 × N 行，4×260=1040 画布宽 + 边距）
const COLS = 4;
const GAP = 16;
const MARGIN = 48;
const HEAD_H = 168; // 标题 + 副标题区
const FOOT_H = 72; // 署名区

export const topsterSvgSignature = 'made with Musicgraphy';

/**
 * 生成 SVG 源码（Content-Type: image/svg+xml；Content-Disposition: attachment = 导出语义）。
 * 封面绘制分层：fallback 色块+标题在前、<image> 在后——图片加载成功盖住 fallback，
 * 失败/查看器拒绝外链时露出色块+标题（SVG 按文档序绘制，失败不显示破图）。
 * href：本地缓存拼 origin（脱离服务器后按部署地址可加载）/ 外部封面用原 URL——外链资源
 * 能否显示取决于查看器安全模型（评审案已披露，不静默假设全显示）。
 */
export function buildTopsterSvg(t: TopsterMeta, items: CollectionItem[], origin: string): string {
  const cols = Math.min(COLS, Math.max(items.length, 1));
  const rows = Math.ceil(Math.max(items.length, 1) / COLS);
  const gridW = cols * CELL + (cols - 1) * GAP;
  const width = gridW + MARGIN * 2;
  const height = HEAD_H + rows * CELL + Math.max(rows - 1, 0) * GAP + FOOT_H;

  const tiles = items.map((it, i) => {
    const x = MARGIN + (i % COLS) * (CELL + GAP);
    const y = HEAD_H + Math.floor(i / COLS) * (CELL + GAP);
    const base =
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="#8a8580"/>` +
      `<text x="${x + CELL / 2}" y="${y + CELL / 2}" text-anchor="middle" dominant-baseline="middle" font-size="15" fill="#ffffff" font-family="sans-serif">${escapeXml(it.album.title.slice(0, 12))}</text>`;
    const src = coverSrcOf(it);
    const img =
      src === null
        ? ''
        : `<image x="${x}" y="${y}" width="${CELL}" height="${CELL}" preserveAspectRatio="xMidYMid slice" href="${escapeXml(src.startsWith('/') ? origin + src : src)}"/>`;
    return base + img;
  });

  const subtitle =
    t.subtitle === null ? '' : `<text x="${MARGIN}" y="118" font-size="19" fill="#5a544d" font-family="serif">${escapeXml(t.subtitle)}</text>`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#faf7f0"/>`,
    `<text x="${MARGIN}" y="76" font-size="34" font-weight="600" fill="#2b2621" font-family="serif">${escapeXml(t.title)}</text>`,
    subtitle,
    `<text x="${MARGIN}" y="148" font-size="13" fill="#8a8378" font-family="sans-serif">ORDER IS THE STORY · ${String(items.length)} 张 · ${escapeXml(t.created_at.slice(0, 10))}</text>`,
    ...tiles,
    `<text x="${MARGIN}" y="${height - 28}" font-size="13" fill="#a49b8d" font-family="sans-serif">${escapeXml(topsterSvgSignature)}</text>`,
    '</svg>'
  ]
    .filter((line) => line !== '')
    .join('\n');
}
