/* data.js — 数据层：统一 state + 通用 DAO + 变更提交
 *
 * 写路径：内存 state（真相源）→ localStorage 镜像 → LocalAdapter(SQLite/IndexedDB)
 *         → sync.outbox → bus.emit('data') → 五区重绘
 * 每条记录附带 meta（同步元数据），视图层不感知，sync.js 消费。
 */
import { store, bus } from './core.js';
import { persist } from './storage.js';
import { enqueue } from './sync.js';
import { getDeviceId } from './platform.js';
import { ownershipMeta, getCurrentUserId } from './identity.js';

/* ---------- 通用工具 ---------- */
export const uid = () => crypto.randomUUID?.()
  || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const clone = value => JSON.parse(JSON.stringify(value));

/**
 * 为新记录生成同步元数据。
 * 归属字段（ownerId/scope/householdId）随 meta 持久化，单机默认 = 当前用户/private/当前家庭。
 * updatedBy 仍是 deviceId（LWW 平局规则不变）；userId 记录"由谁创建"用于未来审计。
 */
export function newMeta(opts = {}) {
  return {
    updatedAt: Date.now(),
    updatedBy: getDeviceId(),
    deletedAt: null,
    rev: 1,
    userId: opts.userId ?? getCurrentUserId(), // 创建者/作者，默认当前用户（单机=me）
    ...ownershipMeta(opts),
  };
}

/** 触碰记录：刷新 LWW 时间戳并递增版本号；保留原归属，仅更新作者维度 */
export function touch(record) {
  record.meta = record.meta || newMeta();
  record.meta.updatedAt = Date.now();
  record.meta.updatedBy = getDeviceId();
  record.meta.userId = getCurrentUserId(); // 最后修改者（单机=me），归属 ownerId 保持不变
  record.meta.rev = (record.meta.rev || 0) + 1;
  if (record.meta.ownerId === undefined) Object.assign(record.meta, ownershipMeta());
  return record;
}

/* ---------- 领域声明（扩展用 declareDomain 注册自己的数据域） ---------- */
const domains = new Map(); // name -> { seed }

export function declareDomain(name, seed = []) {
  if (domains.has(name)) return;
  domains.set(name, { seed });
  if (state[name] === undefined) state[name] = clone(seed);
}
export const domainNames = () => [...domains.keys()];

/* ---------- 全局状态（首次从 localStorage 镜像恢复，随后由 initDb 覆盖为 SQLite 真相） ---------- */
export const state = {
  projects: store.get('projects', []),
  tasks: store.get('tasks', []),
  snippets: store.get('snippets', []),
  notes: store.get('notes', []),
  learning: store.get('learning', []),
  links: store.get('links', {}),
  todos: store.get('todos', []),
  todoGroups: store.get('todoGroups', []),
  complaints: store.get('complaints', []),
  posts: store.get('posts', []),
};

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
  record.meta.deletedAt = Date.now();
  record.meta.updatedAt = record.meta.deletedAt;
  record.meta.updatedBy = getDeviceId();
  commit(domain, 'delete', record);
}

export const alive = domain => (state[domain] || []).filter(item => !item.meta?.deletedAt);
export const byId = (domain, id) => alive(domain).find(item => item.id === id);

/** 接收远端合并结果：只替换 state 与镜像，不再入队（避免回环）。 */
export function applyRemote(domain, records) {
  state[domain] = records;
  store.set(domain, state[domain]);
  persist(domain, state[domain]);
  bus.emit('data', { key: domain, op: 'remote' });
  return records.length;
}

/* ---------- 兼容 DAO（保留旧签名） ---------- */
export const tasksOf = pid => alive('tasks').filter(t => t.projectId === pid);
export const pendingCount = pid => alive('tasks').filter(t => !t.done).length;

/** 数据库恢复：把从 SQLite 读回的 state 同步到内存。 */
export function hydrate(restored) {
  for (const [key, value] of Object.entries(restored)) {
    if (value !== undefined) state[key] = value;
  }
  bus.emit('data', { key: '*', op: 'hydrate' });
}
