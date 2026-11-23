/* backup.js — 数据导出 / 导入（备份与迁移）
 *
 * 浏览器存储（IndexedDB / localStorage）随时可能被清理，用户的唯一副本不应只放在里面。
 * 备份文件是纯 JSON，包含所有业务域记录（含 meta 与墓碑）和少量界面偏好。
 *
 * 导入模式：
 *   merge   （默认）按 LWW 与本地合并，不会丢本地较新的修改；变更会进 outbox，之后可同步出去。
 *   replace 以备份为准：备份里没有的本地记录打墓碑（而不是直接丢弃），保证其他设备也能收到删除。
 *
 * 纯逻辑部分（buildBackup / validateBackup / applyBackup）不依赖 DOM，可在 Node 中测试。
 */
import { store } from './base.js';
import { state, commit, newMeta } from './data.js';
import { mergeDomain, enqueue } from './sync.js';
import { nextTs } from './hlc.js';
import { getDeviceId } from './platform.js';
export const BACKUP_FORMAT = 'workhub-backup';
export const BACKUP_VERSION = 1;
/** 随备份保存的界面偏好（只含小体积、与设备无关的配置） */
export const BACKUP_PREFS = ['theme', 'skin', 'skinMounts', 'skinPoints', 'menuLayout', 'extEnabled', 'shortcuts'];
const DOMAIN_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const clone = value => JSON.parse(JSON.stringify(value));
const stripMeta = ({ meta, ...rest }) => rest;
/** 业务内容是否一致（忽略 meta），用于 replace 模式判断哪些记录需要提升版本 */
const sameContent = (a, b) => JSON.stringify(stripMeta(a)) === JSON.stringify(stripMeta(b));
/** 生成备份对象（深拷贝，之后修改 state 不影响它） */
export function buildBackup() {
  const domains = {};
  for (const [key, value] of Object.entries(state)) {
    if (Array.isArray(value)) domains[key] = clone(value);
  }
  const prefs = {};
  for (const key of BACKUP_PREFS) {
    const value = store.get(key);
    if (value !== undefined) prefs[key] = clone(value);
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    deviceId: getDeviceId(),
    counts: Object.fromEntries(Object.entries(domains).map(([k, v]) => [k, v.length])),
    domains,
    prefs,
  };
}
/**
 * 校验备份内容。只做结构检查，不改任何数据。
 * 返回 { ok, error?, domains, skipped, warnings }：
 *   domains  可导入的域（本地已声明且为数组的域）
 *   skipped  文件里有、但本地没有声明的域名（对应扩展未安装），不会导入
 */
export function validateBackup(obj) {
  const fail = error => ({ ok: false, error, domains: {}, skipped: [], warnings: [] });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('不是有效的备份文件');
  if (obj.format !== BACKUP_FORMAT) return fail('文件格式不是 WorkHub 备份');
  if (!Number.isInteger(obj.version) || obj.version > BACKUP_VERSION) {
    return fail(`备份版本 ${obj.version} 高于当前支持的 ${BACKUP_VERSION}，请先升级 WorkHub`);
  }
  if (!obj.domains || typeof obj.domains !== 'object' || Array.isArray(obj.domains)) return fail('备份缺少 domains');
  const domains = {};
  const skipped = [];
  const warnings = [];
  for (const [name, records] of Object.entries(obj.domains)) {
    if (!DOMAIN_NAME.test(name) || FORBIDDEN.has(name)) return fail(`非法的数据域名：${name}`);
    if (!Array.isArray(records)) return fail(`数据域 ${name} 不是数组`);
    const seen = new Set();
    for (const record of records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return fail(`数据域 ${name} 含非对象记录`);
      if (typeof record.id !== 'string' || !record.id) return fail(`数据域 ${name} 含缺少 id 的记录`);
      if (seen.has(record.id)) return fail(`数据域 ${name} 存在重复 id：${record.id}`);
      seen.add(record.id);
    }
    if (!Array.isArray(state[name])) { skipped.push(name); continue; }
    domains[name] = records;
  }
  if (!Object.keys(domains).length && !skipped.length) warnings.push('备份里没有任何数据');
  return { ok: true, domains, skipped, warnings };
}
/**
 * 把校验通过的备份写入本地。返回每个域的 { added, updated, removed }。
 * 调用前应先用 validateBackup 校验，并让用户确认（replace 模式会删除本地不在备份里的记录）。
 */
export function applyBackup(obj, { mode = 'merge' } = {}) {
  const checked = validateBackup(obj);
  if (!checked.ok) throw new Error(checked.error);
  if (mode !== 'merge' && mode !== 'replace') throw new Error(`未知导入模式：${mode}`);
  const report = {};
  for (const [name, incomingRaw] of Object.entries(checked.domains)) {
    const incoming = clone(incomingRaw).map(r => ({ ...r, meta: r.meta || newMeta() }));
    const local = state[name];
    const localById = new Map(local.map(r => [r.id, r]));
    let next;
    let changed;
    let removed = 0;
    if (mode === 'merge') {
      next = mergeDomain(local, incoming).records;
      changed = next.filter(r => localById.get(r.id) !== r);
    } else {
      // replace：备份为准。内容有差异的记录要「晚于」本地版本，否则多端同步时会被对端旧版本覆盖回去
      const incomingIds = new Set(incoming.map(r => r.id));
      const kept = [];
      changed = [];
      for (const record of incoming) {
        const current = localById.get(record.id);
        if (current && sameContent(current, record) && !current.meta?.deletedAt === !record.meta?.deletedAt) {
          kept.push(current);
          continue;
        }
        const ts = nextTs();
        record.meta = { ...record.meta, updatedAt: ts, updatedBy: getDeviceId(), rev: Math.max(current?.meta?.rev || 0, record.meta?.rev || 0) + 1 };
        kept.push(record);
        changed.push(record);
      }
      for (const record of local) {
        if (incomingIds.has(record.id) || record.meta?.deletedAt) continue;
        const ts = nextTs();
        record.meta = { ...(record.meta || newMeta()), deletedAt: ts, updatedAt: ts, updatedBy: getDeviceId(), rev: (record.meta?.rev || 0) + 1 };
        kept.push(record);
        changed.push(record);
        removed++;
      }
      // 本地已是墓碑、备份里没有的记录保持不动
      for (const record of local) if (!incomingIds.has(record.id) && record.meta?.deletedAt) kept.push(record);
      next = kept;
    }
    report[name] = {
      added: changed.filter(r => !localById.has(r.id)).length,
      updated: changed.filter(r => localById.has(r.id) && !r.meta?.deletedAt).length,
      removed,
    };
    state[name] = next;
    commit(name, 'upsert');
    for (const record of changed) enqueue(name, record.meta?.deletedAt ? 'delete' : 'upsert', record);
  }
  if (mode === 'replace' && obj.prefs && typeof obj.prefs === 'object') {
    for (const key of BACKUP_PREFS) {
      if (obj.prefs[key] !== undefined) store.set(key, obj.prefs[key]);
    }
  }
  return { report, skipped: checked.skipped };
}
/* ---------- 浏览器侧：下载 / 读取文件 ---------- */
const pad = n => String(n).padStart(2, '0');
export function backupFileName(date = new Date()) {
  return `workhub-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}
/** 触发浏览器下载备份文件，返回文件名 */
export function downloadBackup() {
  const backup = buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName();
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  store.set('lastBackupAt', backup.exportedAt);
  return { name: link.download, counts: backup.counts };
}
/** 读取用户选择的备份文件并解析；格式问题抛出带中文说明的 Error */
export async function readBackupFile(file) {
  if (file.size > 100 * 1024 * 1024) throw new Error('文件过大（超过 100MB）');
  let obj;
  try { obj = JSON.parse(await file.text()); }
  catch { throw new Error('文件不是有效的 JSON'); }
  const checked = validateBackup(obj);
  if (!checked.ok) throw new Error(checked.error);
  return { obj, checked };
}
export const getLastBackupAt = () => store.get('lastBackupAt', 0) || 0;
