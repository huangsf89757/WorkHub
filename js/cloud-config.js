/* cloud-config.js — Supabase 连接配置（浏览器直连，零构建）
 *
 * 配置来自用户在设置页填写的 Project URL / anon key，不走环境变量（浏览器无构建时 env）。
 * 存 localStorage 走 store（物理 key = wh_sys_settings_cloud_*），与偏好同一命名空间。
 * anon key 是公开标识（Supabase 设计如此），不是密钥；service_role key 绝不进前端。
 * CLOUD_PREFILL 仅用于设置页输入框预填，不改变 getCloudConfig 的生效语义（仍需用户点「保存配置」）。
 */
import { store } from './base.js';

const KEY_URL = 'cloudUrl';
const KEY_ANON = 'cloudAnonKey';

/** WorkHub 云端项目的连接信息，仅作设置页预填；publishable key 为公开标识，非密钥 */
export const CLOUD_PREFILL = {
  url: 'https://jdrgadgjejgdxjttxcpb.supabase.co',
  anonKey: 'sb_publishable_3ggs2EevdW2Ff7zPoxkT3Q__5Tey5ns',
};

export const getCloudConfig = () => {
  const url = (store.get(KEY_URL, '') || '').trim().replace(/\/+$/, '');
  const anonKey = (store.get(KEY_ANON, '') || '').trim();
  return { url, anonKey, configured: !!url && !!anonKey };
};

export const setCloudConfig = (url, anonKey) => {
  store.set(KEY_URL, (url || '').trim().replace(/\/+$/, ''));
  store.set(KEY_ANON, (anonKey || '').trim());
};

export const clearCloudConfig = () => {
  store.set(KEY_URL, '');
  store.set(KEY_ANON, '');
};

/** 校验 URL 形态（必须是 https 的 supabase 域名或自建网关），仅提示用，不拦保存 */
export const isValidCloudUrl = url => /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d+)?$/.test(url || '');
