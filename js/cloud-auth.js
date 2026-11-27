/* cloud-auth.js — Supabase Auth REST 封装（零构建，无 SDK）
 *
 * 端点：{url}/auth/v1/{signup,token,logout,user}
 * 令牌策略（纯前端零构建的必要权衡）：
 *   · access_token 仅内存（刷新页面即失效，走 refresh 静默续期）
 *   · refresh_token 存 localStorage（Supabase 官方纯前端方案；无法用 httpOnly cookie 无 BFF）
 *   · anon key 作为 apikey header 发送（公开标识，非密钥）
 * 所有错误映射为中文文案，不抛原始堆栈。
 */
import { store } from './base.js';
import { getCloudConfig, isProxyMode } from './cloud-config.js';

const KEY_REFRESH = 'cloudRefreshToken';
const TOKEN_ENDPOINT = '/auth/v1/token?grant_type=password';
const REFRESH_ENDPOINT = '/auth/v1/token?grant_type=refresh_token';

let session = null; // { accessToken, userId, email, expiresAt }

export const getSession = () => session;
export const isSignedIn = () => isProxyMode() || !!session?.accessToken;

const err = (op, e) => {
  const msg = e?.msg || e?.message || e?.error_description || '网络请求失败';
  return new Error(`Cloud Auth ${op} 失败：${msg}`);
};

/** 统一 fetch：注入 apikey/Authorization，解析 JSON 错误体 */
async function request(path, { method = 'GET', body, token, extraHeaders = {} } = {}) {
  const { url, anonKey } = getCloudConfig();
  if (!url || !anonKey) throw new Error('未配置 Supabase 连接信息');
  const headers = {
    apikey: anonKey,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw err('request', { message: '无法连接云端，请检查网络与 Project URL' });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
  if (!res.ok) {
    throw err('request', data || { message: `HTTP ${res.status}` });
  }
  return data;
}

/** 解析 Supabase token 响应并写入内存 session + 持久化 refresh token */
function applyToken(data) {
  if (!data?.access_token) throw new Error('Cloud Auth 响应缺少 access_token');
  session = {
    accessToken: data.access_token,
    userId: data.user?.id || null,
    email: data.user?.email || null,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 30_000, // 提前 30s 续期
  };
  if (data.refresh_token) store.set(KEY_REFRESH, data.refresh_token);
  return session;
}

export async function signUp(email, password) {
  const data = await request('/auth/v1/signup', {
    method: 'POST',
    body: { email, password },
  });
  // 未开启邮箱确认时 signUp 直接返回 token；开启确认时只返回 user，需登录
  return data?.access_token ? applyToken(data) : { pendingConfirmation: true, email };
}

export async function signIn(email, password) {
  const data = await request(TOKEN_ENDPOINT, {
    method: 'POST',
    body: { email, password },
  });
  return applyToken(data);
}

export async function signOut() {
  const { url, anonKey } = getCloudConfig();
  if (url && anonKey && session?.accessToken) {
    try {
      await request('/auth/v1/logout', {
        method: 'POST',
        token: session.accessToken,
        extraHeaders: { 'Content-Type': 'application/json' },
      });
    } catch { /* 登出网络失败也要清本地状态 */ }
  }
  session = null;
  store.set(KEY_REFRESH, '');
}

/** 启动/请求前调用：内存无 token 时用 refresh token 静默续期 */
export async function ensureAccessToken() {
  if (session?.accessToken && Date.now() < session.expiresAt) return session.accessToken;
  const refresh = store.get(KEY_REFRESH, '');
  if (!refresh) { session = null; return null; }
  try {
    const data = await request(REFRESH_ENDPOINT, { method: 'POST', body: { refresh_token: refresh } });
    return applyToken(data).accessToken;
  } catch (e) {
    // refresh 失效：清理本地，要求重新登录（不抛出，交调用方按未登录处理）
    session = null;
    store.set(KEY_REFRESH, '');
    return null;
  }
}

export const cloudAuthSnapshot = () => ({
  signedIn: isSignedIn(),
  email: isProxyMode() ? 'Workers 代理' : (session?.email || null),
  userId: session?.userId || null,
  hasRefresh: isProxyMode() || !!store.get(KEY_REFRESH, ''),
});
