/* cloud-adapter.js — Supabase CloudAdapter（接到 sync.js 的 setRemoteAdapter）
 *
 * 契约：{ push(changes), pull({ since }) }
 *   push: changes = outbox 条目 [{seq, domain, op, record, at}]，成功后 sync.js 负责 ack
 *   pull: 返回 { domains: { domain: [record...] }, serverTime }
 *
 * 传输：PostgREST RPC（POST /rest/v1/rpc/{fn}），body = 参数对象。
 * 认证：每次请求前 ensureAccessToken() 静默续期；401 发 sync:auth-error 让 UI 提示重新登录。
 */
import { bus } from './base.js';
import { getCloudConfig } from './cloud-config.js';
import { ensureAccessToken } from './cloud-auth.js';

/** 统一 RPC 调用：注入 apikey + Bearer token，解析 JSON 错误 */
async function rpc(fn, params) {
  const { url, anonKey } = getCloudConfig();
  if (!url || !anonKey) throw new Error('未配置 Supabase 连接信息');
  const token = await ensureAccessToken();
  if (!token) {
    bus.emit('sync:auth-error', { reason: '未登录或会话已过期' });
    throw new Error('云端同步未登录');
  }
  let res;
  try {
    res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error('无法连接云端，请检查网络');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!res.ok) {
    if (res.status === 401) bus.emit('sync:auth-error', { reason: '会话已过期' });
    const msg = data?.message || data?.details || `HTTP ${res.status}`;
    throw new Error(`云端同步失败：${msg}`);
  }
  return data;
}

export function createSupabaseAdapter() {
  return {
    name: 'supabase',

    /** 批量推送变更。record 自带 meta（updatedAt/by/deletedAt/rev），服务端据此做 LWW。 */
    async push(changes) {
      const payload = (changes || []).map(({ domain, op, record }) => ({
        domain,
        op: op || 'upsert',
        record,
      }));
      if (!payload.length) return { accepted: 0, skipped: 0 };
      const result = await rpc('sync_push', { p_changes: payload });
      return result || { accepted: payload.length, skipped: 0 };
    },

    /** 增量拉取；serverTime 是客户端 HLC 游标（bigint 毫秒）。 */
    async pull({ since } = {}) {
      const result = await rpc('sync_pull', { p_since: since || 0 });
      return {
        domains: result?.domains || {},
        serverTime: result?.serverTime || since || 0,
      };
    },
  };
}

/** 连接配置/登录状态是否有效，用于决定是否注入 adapter */
export const canUseCloud = () => {
  const { configured } = getCloudConfig();
  return configured;
};
