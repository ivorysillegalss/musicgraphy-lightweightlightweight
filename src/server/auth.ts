// 鉴权（复审 V10 最小零依赖规格）：
// ① 无 cookie 访问页面 → 302 登录页；POST /login 以 timingSafeEqual 比对密钥
// ② 下发 HttpOnly + SameSite=Lax + Secure(prod) 的 HMAC 签名 cookie（无状态会话，无会话表）
// ③ API 通道：cookie 或 Authorization: Bearer <key>（自定义头天然免 CSRF，供导出脚本/外部工具）
// ④ CSRF：unsafe 方法 + cookie 通道 → 校验 Origin / Sec-Fetch-Site（约 10 行）
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import type { Config } from './config';
import { errorBody } from './http';

const COOKIE = 'mg_session';
const TTL_MS = 30 * 24 * 3600_000;

export function signToken(secret: string, now = Date.now()): string {
  const exp = String(now + TTL_MS);
  const mac = createHmac('sha256', secret).update(exp).digest('base64url');
  return `${Buffer.from(exp).toString('base64url')}.${mac}`;
}

export function verifyToken(secret: string, token: string, now = Date.now()): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  let exp: string;
  let mac: Buffer;
  try {
    exp = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');
    mac = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return false;
  }
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < now) return false;
  const expected = createHmac('sha256', secret).update(exp).digest();
  return mac.length === expected.length && timingSafeEqual(mac, expected);
}

function keyEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 同源证据（V10 CSRF）：Origin host 匹配，或 Sec-Fetch-Site ∈ {same-origin, none}；两者皆缺（非浏览器客户端）放行——密钥本身即凭据 */
export function sameOrigin(c: Context): boolean {
  const origin = c.req.header('Origin');
  if (origin !== undefined) {
    let host = c.req.header('Host');
    if (host === undefined) {
      // 构造的 Request（测试/内部调用）可能没有 Host 头——回退到请求 URL 的 host
      try {
        host = new URL(c.req.url).host;
      } catch {
        host = '';
      }
    }
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const sfs = c.req.header('Sec-Fetch-Site');
  if (sfs !== undefined) return sfs === 'same-origin' || sfs === 'none';
  return true;
}

export const isAuthed = (c: Context, cfg: Config): boolean => {
  const token = getCookie(c, COOKIE);
  return token !== undefined && verifyToken(cfg.sessionSecret, token);
};

const loginPage = (withError: boolean) => html`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>登录 · Musicgraphy</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:20rem;margin:6rem auto;color:#2b2622">
  <h1>Musicgraphy</h1>
  <p style="color:#8a8078">私人档案，请输入访问密钥。</p>
  ${withError ? html`<p style="color:#a33">密钥不正确。</p>` : ''}
  <form method="post" action="/login">
    <input type="password" name="access_key" placeholder="访问密钥" required autocomplete="current-password"
      style="width:100%;padding:.5rem;border:1px solid #d8d0c8;border-radius:8px;box-sizing:border-box" />
    <button type="submit" style="margin-top:.6rem;padding:.5rem 1.2rem">进入</button>
  </form>
</body>
</html>`;

export function installAuth(app: Hono, cfg: Config): void {
  // 登录页（无 JS 基线：原生表单，V4）
  app.get('/login', (c) => c.html(loginPage(c.req.query('error') === '1')));
  app.post('/login', async (c) => {
    if (!sameOrigin(c)) return c.text('cross-site login rejected', 403);
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const key = typeof body['access_key'] === 'string' ? body['access_key'] : '';
    if (!keyEqual(key, cfg.accessKey)) return c.html(loginPage(true), 401);
    setCookie(c, COOKIE, signToken(cfg.sessionSecret), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: cfg.env === 'production',
      path: '/',
      maxAge: TTL_MS / 1000
    });
    return c.redirect('/', 303);
  });

  // 页面守卫：无有效 cookie → 302 登录页（D1 修复 2026-11-15，用户裁决令：use('/*') 全路径拦截。
  // 原 use('/') 按 Hono 语义仅匹配根路径，/metrics /album/:id /topsters 等页面匿名可达 = V10
  // 「页面 302」规格偏差（登记于文档包 02-变现文档包 12-技术债与依赖复盘 §2.1 D1）。
  // 排除：/login（登录页本体）、/api（交下方 API 守卫保持 401 语义）、/static /covers
  // （公开拓扑 = app.ts V8 注记，与修复前公开性一致——原守卫本就不拦）。
  app.use('/*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/login' ||
      path.startsWith('/api/') ||
      path.startsWith('/static/') ||
      path === '/covers' ||
      path.startsWith('/covers/')
    ) {
      return next();
    }
    if (!isAuthed(c, cfg)) return c.redirect('/login', 302);
    await next();
  });

  // API 守卫：/api/v1/* 除 health 外均需凭据（IM-11：health 对守护探测保持公开，仅非敏感指标）
  app.use('/api/v1/*', async (c, next) => {
    if (c.req.path === '/api/v1/health') return next();
    const bearer = c.req.header('Authorization');
    if (bearer !== undefined && bearer.startsWith('Bearer ')) {
      if (keyEqual(bearer.slice(7), cfg.accessKey)) return next();
      return c.json(errorBody('unauthorized', '无效凭据'), 401);
    }
    if (!isAuthed(c, cfg)) return c.json(errorBody('unauthorized', '请先登录'), 401);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !sameOrigin(c)) {
      return c.json(errorBody('csrf_rejected', '跨站请求被拒绝'), 403);
    }
    await next();
  });
}
