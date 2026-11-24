/* data.js — 数据层：统一 state + 通用 DAO + 变更提交
 *
 * 写路径：内存 state（真相源）→ localStorage 镜像 → LocalAdapter(SQLite/IndexedDB)
 *         → sync.outbox → bus.emit('data') → 五区重绘
 * 每条记录附带 meta（同步元数据），视图层不感知，sync.js 消费。
 */
import { store, bus } from './base.js';
import { persist, registerDomainStorage } from './storage.js';
import { enqueue } from './sync.js';
import { getDeviceId } from './platform.js';
import { nextTs } from './hlc.js';
import { mergeDomain, purgeTombstones, getLastPullAt } from './sync.js';

/* ---------- 通用工具 ---------- */
export const uid = () => crypto.randomUUID?.()
  || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const clone = value => JSON.parse(JSON.stringify(value));

/**
 * 为新记录生成同步元数据。
 * 只含同步四字段：updatedAt/updatedBy/deletedAt/rev。
 * 家庭/组织归属字段（userId/ownerId/scope/householdId）已随基座撤销移除。
 */
export function newMeta() {
  return {
    updatedAt: nextTs(),
    updatedBy: getDeviceId(),
    deletedAt: null,
    rev: 1,
  };
}

/** 触碰记录：刷新 LWW 时间戳并递增版本号 */
export function touch(record) {
  record.meta = record.meta || newMeta();
  record.meta.updatedAt = nextTs();
  record.meta.updatedBy = getDeviceId();
  record.meta.rev = (record.meta.rev || 0) + 1;
  return record;
}

/* ---------- 领域声明（扩展用 declareDomain 注册自己的数据域） ---------- */
const domains = new Map(); // name -> { seed, table }
/**
 * 扩展声明自己的数据域。
 *   seed   首次使用的初始数据
 *   opts.table  可选，自带持久化表名（须形如 ext_<扩展id>_<名称>）。
 *               给出后无需修改内核 db.js：适配器会自动建表并读写（记录存为 JSON 文档 + 同步元数据列）。
 *               不给则只存 localStorage 镜像（内置域 todos 等由 db.js 手写映射）。
 */
export function declareDomain(name, seed = [], opts = {}) {
  if (domains.has(name)) return;
  domains.set(name, { seed, table: opts.table || null });
  if (state[name] === undefined) state[name] = store.get(name, clone(seed)); // 先从本地镜像恢复，无则用种子
  if (opts.table) registerDomainStorage(name, { table: opts.table });
}
export const domainNames = () => [...domains.keys()];

/* ---------- 全局状态 ----------
 * 只由 declareDomain 按需创建：内核不再硬编码任何业务域，扩展声明才存在。
 * 启动时 db.js 会用 SQLite 中的真实数据覆盖（initStorage 之后）。 */
export const state = {};

/* ---------- 统一提交：镜像 + 适配器 + outbox + 重绘 ---------- */
export function commit(key, op = 'upsert', record = null) {
  store.set(key, state[key]);
  persist(key, state[key]);
  if (record) enqueue(key, op, record);
  bus.emit('data', { key, op });
}

/* ---------- 通用领域 CRUD ---------- */
export function insert(domain, data) {
  const record = { id: uid(), ...data, meta: newMeta() };
  (state[domain] ||= []).unshift(record);
  commit(domain, 'upsert', record);
  return record;
}

export function update(domain, id, patch) {
  const record = (state[domain] || []).find(item => item.id === id);
  if (!record) return null;
  Object.assign(record, patch);
  touch(record);
  commit(domain, 'upsert', record);
  return record;
}

export function remove(domain, id) {
  const record = (state[domain] || []).find(item => item.id === id);
  if (!record) return;
  // 软删除墓碑：保留以便多端传播删除事件
  record.meta = record.meta || newMeta();
  record.meta.deletedAt = nextTs();
  record.meta.updatedAt = record.meta.deletedAt;
  record.meta.updatedBy = getDeviceId();
  record.meta.rev = (record.meta.rev || 0) + 1;
  commit(domain, 'delete', record);
}

export const alive = domain => (state[domain] || []).filter(item => !item.meta?.deletedAt);
export const byId = (domain, id) => alive(domain).find(item => item.id === id);

/**
 * 接收远端记录：按 LWW 与本地合并，再清理「已同步过且过期」的墓碑，最后落盘。
 * 调用方只需传远端原始记录，无需自己合并（旧实现直接替换整域，调用方写错就会覆盖本地未推送的数据）。
 * 不入 outbox（避免回环）。返回变更条数。
 */
export function applyRemote(domain, remoteRecords) {
  const merged = mergeDomain(state[domain] || [], remoteRecords);
  const { records, purged } = purgeTombstones(merged.records, { syncedUpTo: getLastPullAt() });
  state[domain] = records;
  store.set(domain, records);
  persist(domain, records);
  bus.emit('data', { key: domain, op: 'remote' });
  return merged.changed + purged;
}

/** 数据库恢复：把从 SQLite 读回的 state 同步到内存。 */
export function hydrate(restored) {
  for (const [key, value] of Object.entries(restored)) {
    if (value !== undefined) state[key] = value;
  }
  bus.emit('data', { key: '*', op: 'hydrate' });
}
