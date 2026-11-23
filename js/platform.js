/* platform.js — 全端平台适配层
 *
 * 一套代码跑在：浏览器 / PWA / Electron / Tauri / Capacitor(iOS·Android·iPad)。
 * 上层只调用统一 API，不判断宿主；新增端只在本文件加探测分支。
 * 零构建：全部通过全局对象/UA 探测，不依赖任何包。
 */
import { storageKey } from './core.js';

/* ---------- 运行环境探测 ---------- */
export function detectPlatform() {
  const w = window;
  const ua = navigator.userAgent || '';
  const standalone = w.matchMedia?.('(display-mode: standalone)').matches
    || w.navigator.standalone === true;

  if (w.__TAURI_INTERNALS__ || w.__TAURI__) return 'tauri';
  if (w.electronAPI || ua.includes('Electron')) return 'electron';
  if (w.Capacitor || ua.includes('Capacitor')) {
    const isIOS = /iPad|iPhone|iPod/.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isIOS ? 'capacitor-ios' : 'capacitor-android';
  }
  if (standalone) return 'pwa';
  return 'web';
}

export const PLATFORM_LABEL = {
  web: '浏览器',
  pwa: 'PWA',
  electron: 'Electron 桌面',
  tauri: 'Tauri 桌面',
  'capacitor-ios': 'iOS / iPadOS',
  'capacitor-android': 'Android',
};

/* ---------- 设备身份（同步 LWW 打破平局用，持久化） ----------
   物理 key 走 core.storageKey('deviceId') → wh_sys_settings_deviceId，
   与 sys_settings 命名空间统一；core 不反向依赖 platform，无循环。 */
const DEVICE_KEY = storageKey('deviceId');
export function getDeviceId() {
  // 兼容老 key：白_deviceId → 新 key（一次性，老值优先）
  const LEGACY_KEY = 'wh_deviceId';
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy !== null && localStorage.getItem(DEVICE_KEY) === null) {
      localStorage.setItem(DEVICE_KEY, legacy);
    }
    if (legacy !== null) localStorage.removeItem(LEGACY_KEY);
  } catch { /* 降级 */ }
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch { /* 降级 */ }
  if (!id) {
    id = 'dev_' + (crypto.randomUUID?.()
      || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)));
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* 降级 */ }
  }
  return id;
}

/* ---------- 统一能力 API ---------- */
const platform = detectPlatform();

/** 存储根：桌面壳未来可切文件系统，当前各端统一 IndexedDB */
export const storageKind = () =>
  (platform === 'electron' || platform === 'tauri') ? 'fs-or-idb' : 'idb';

export const isOnline = () => navigator.onLine !== false;

export function onNetworkChange(callback) {
  window.addEventListener('online', () => callback(true));
  window.addEventListener('offline', () => callback(false));
}

/** 应用数据目录：壳环境返回真实路径，Web 返回 null（仅浏览器存储） */
export async function appDataDir() {
  if (platform === 'electron' && window.electronAPI?.appDataDir) {
    return window.electronAPI.appDataDir();
  }
  if (platform === 'tauri' && window.__TAURI_INTERNALS__) {
    try {
      const { appDataDir } = await import('https://esm.sh/@tauri-apps/api/path@2');
      return await appDataDir();
    } catch { return null; }
  }
  return null;
}

export const supportsFs = () => platform === 'electron' || platform === 'tauri';

export default {
  platform,
  label: PLATFORM_LABEL[platform] || platform,
  deviceId: getDeviceId(),
  isMobile: platform.startsWith('capacitor') || platform === 'pwa',
  isDesktop: platform === 'electron' || platform === 'tauri' || platform === 'web',
  detect: detectPlatform,
  storageKind,
  isOnline,
  onNetworkChange,
  appDataDir,
  supportsFs,
};
