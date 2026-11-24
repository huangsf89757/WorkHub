/* cloud-sync.js — 云端同步引导层
 *
 * 职责：把 Auth 会话状态接到 sync.js 的 adapter 生命周期上。
 *   · 启动时若有配置且能续期 → 注入 Supabase adapter + 启动自动同步
 *   · 配置变更 / 登录 / 登出 → 通过 refreshCloudSync() 重新装配
 *   · 无配置 / 未登录 → 保持 sync 引擎 no-op，应用完全离线可用
 */
import { setRemoteAdapter, startAutoSync, stopAutoSync, syncNow } from './sync.js';
import { applyRemote } from './data.js';
import { getCloudConfig } from './cloud-config.js';
import { ensureAccessToken, isSignedIn } from './cloud-auth.js';
import { createSupabaseAdapter, canUseCloud } from './cloud-adapter.js';
import { bus } from './base.js';

let autoStarted = false;

/** 当前是否应启用云端同步 */
export const cloudSyncActive = () => canUseCloud() && isSignedIn();

/** 重新装配 adapter（登录成功后 / 登出 / 改配置后调用） */
export async function refreshCloudSync() {
  const { configured } = getCloudConfig();
  let usable = false;
  if (configured) {
    const token = await ensureAccessToken();
    usable = !!token;
  }
  if (usable) {
    setRemoteAdapter(createSupabaseAdapter());
    if (!autoStarted) {
      startAutoSync((domain, records) => applyRemote(domain, records));
      autoStarted = true;
    }
  } else {
    setRemoteAdapter(null);
    stopAutoSync();
    autoStarted = false;
  }
  bus.emit('cloud:state', { active: usable });
  return usable;
}

/** 立即同步一次（设置页「立即同步」按钮） */
export async function syncNowCloud() {
  if (!cloudSyncActive()) return null;
  return syncNow((domain, records) => applyRemote(domain, records));
}

/** 启动时引导：非阻塞，失败不影响本地使用 */
export function initCloudSync() {
  // 未登录 / 未配置时保持 no-op；仅当有 refresh token 时尝试静默续期
  if (!canUseCloud()) return Promise.resolve(false);
  return refreshCloudSync().catch(() => false);
}

// 会话过期时自动停用 adapter，避免持续用失效 token 重试
bus.on('sync:auth-error', () => {
  setRemoteAdapter(null);
  stopAutoSync();
  autoStarted = false;
  bus.emit('cloud:state', { active: false });
});
