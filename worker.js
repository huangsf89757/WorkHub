/* worker.js — Cloudflare Workers 同步代理
 *
 * 前端只调同源 /api/rpc/*；Supabase 账号凭据留在服务端环境变量，不进浏览器。
 * 其他路径交给 Workers Assets 返回静态站点。
 */
const RPC_ALLOW = new Set(['sync_push', 'sync_pull']);

let session = null; // { token, expiresAt }：模块级缓存，Worker 实例内复用

async function accessToken(env) {
  if (session && Date.now() < session.expiresAt) return session.token;
  const { SUPABASE_URL, SUPABASE_ANON_KEY, WORKHUB_EMAIL, WORKHUB_PASSWORD } = env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !WORKHUB_EMAIL || !WORKHUB_PASSWORD) {
    throw new Error('Workers 同步代理未配置环境变量');
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: WORKHUB_EMAIL, password: WORKHUB_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Supabase 登录失败：HTTP ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Supabase 登录响应缺少 access_token');
  session = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 60_000,
  };
  return session.token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/rpc/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    const fn = url.pathname.slice('/api/rpc/'.length);
    if (!RPC_ALLOW.has(fn)) return new Response('Unknown RPC', { status: 404 });
    try {
      const token = await accessToken(env);
      const body = await request.text();
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ message: error?.message || '同步代理失败' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      });
    }
  },
};
