/* sync.js — 多端同步引擎（架构骨架，v1 no-op，API 已冻结）
 *
 * 目标形态：手机添加一条 todo → 云端 → Mac 自动出现。
 * 本版只搭骨架并暴露稳定 API；真正联网在后端/凭据就绪后注入 CloudAdapter。
 *
 * 同步模型（详见 docs/sync-protocol.md）：
 *   - 每条记录携带 meta：{ updatedAt, updatedBy, deletedAt, rev }
 *   - 冲突策略 LWW：updatedAt 大者胜，相等用 deviceId 字典序打破平局
 *   - 删除 = 软删除墓碑（deletedAt），保留 N 天后清理
 *   - 变更日志 outbox：本地写入即入队，push 成功后出队
 *   - 拉取按 since=lastPullAt 增量，按领域合并
 */

import { bus } from './core.js';
import { getDeviceId, isOnline } from './platform.js';
import { storageInfo } from './storage.js';

export const SYNC_STATE = { OFF: 'off', IDLE: 'idle', SYNCING: 'syncing', ERROR: 'error' };

let state = SYNC_STATE.OFF;
let remote = null;             // CloudAdapter，注入后才启用
let lastPullAt = 0;
let outbox = [];               // [{ seq, domain, op, record, at }]
let seq = 0;

function setState(next) {
  state = next;
  bus.emit('sync:state', next);
}

export const isSyncEnabled = () => !!remote;
export const getSyncState = () => state;
export const getOutboxSize = () => outbox.length;
export const getDevice = () => getDeviceId();

/** 注入远端适配器；未注入时引擎保持离线，所有 API 安全 no-op */
export function setRemoteAdapter(adapter) {
  remote = adapter || null;
  setState(remote ? SYNC_STATE.IDLE : SYNC_STATE.OFF);
}

/** 记录一次本地变更（由 data.commit 调用）。离线也入队，恢复在线统一推送。 */
export function enqueue(domain, op, record) {
  outbox.push({ seq: ++seq, domain, op, record: { ...record }, at: Date.now() });
  if (remote) bus.emit('sync:dirty', outbox.length);
}

/** LWW 胜者：updatedAt 大者胜；相等按 deviceId 字典序打破平局。 */
export function lwwWinner(local, incoming) {
  if (!local) return incoming;
  if (!incoming) return local;
  const lt = local.meta?.updatedAt ?? 0;
  const it = incoming.meta?.updatedAt ?? 0;
  if (it > lt) return incoming;
  if (it < lt) return local;
  return (incoming.meta?.updatedBy || '') > (local.meta?.updatedBy || '') ? incoming : local;
}

/** 远端记录按 LWW 合并进本地领域，返回新数组与变更条数。 */
export function mergeDomain(localArr, remoteArr) {
  const map = new Map();
  for (const record of localArr) map.set(record.id, record);
  let changed = 0;
  for (const record of remoteArr || []) {
    const winner = lwwWinner(map.get(record.id), record);
    if (winner !== map.get(record.id)) changed++;
    map.set(record.id, winner);
  }
  // 墓碑：物理清理超过 30 天的删除记录
  const cutoff = Date.now() - 30 * 86400000;
  for (const [id, record] of map) {
    if (record.meta?.deletedAt && record.meta.deletedAt < cutoff) {
      map.delete(id);
      changed++;
    }
  }
  return { records: [...map.values()], changed };
}

/** 推送本地 outbox；无 remote 或离线时返回 0。 */
export async function push() {
  if (!remote || !isOnline() || !outbox.length) return 0;
  setState(SYNC_STATE.SYNCING);
  try {
    const batch = outbox.slice();
    await remote.push(batch);
    outbox = outbox.filter(item => !batch.includes(item));
    setState(SYNC_STATE.IDLE);
    bus.emit('sync:pushed', batch.length);
    return batch.length;
  } catch (error) {
    setState(SYNC_STATE.ERROR);
    bus.emit('sync:error', error);
    return 0;
  }
}

/** 增量拉取；applyFn(domain, records) 由调用方提供合并逻辑。 */
export async function pull(applyFn) {
  if (!remote || !isOnline()) return {};
  setState(SYNC_STATE.SYNCING);
  try {
    const { domains, serverTime } = await remote.pull({ since: lastPullAt });
    const result = {};
    for (const [domain, records] of Object.entries(domains || {})) {
      result[domain] = applyFn(domain, records);
    }
    lastPullAt = serverTime || Date.now();
    setState(SYNC_STATE.IDLE);
    bus.emit('sync:pulled', result);
    return result;
  } catch (error) {
    setState(SYNC_STATE.ERROR);
    bus.emit('sync:error', error);
    return {};
  }
}

/** 一次完整同步 = 先推后拉。 */
export async function syncNow(applyFn) {
  const pushed = await push();
  const pulled = await pull(applyFn);
  return { pushed, pulled };
}

/** 诊断快照（设置页展示用）。 */
export function syncSnapshot() {
  return {
    enabled: isSyncEnabled(),
    state,
    deviceId: getDeviceId(),
    online: isOnline(),
    pending: outbox.length,
    lastPullAt,
    storage: storageInfo(),
  };
}

/* ---------- 自动同步：在线 + 有远端时轮询，离线不空转 ---------- */
let timer = null;
export function startAutoSync(applyFn, intervalMs = 30000) {
  if (timer) return;
  timer = setInterval(() => {
    if (remote && isOnline() && (outbox.length || Date.now() - lastPullAt > intervalMs)) {
      syncNow(applyFn);
    }
  }, intervalMs);
}
export function stopAutoSync() {
  if (timer) { clearInterval(timer); timer = null; }
}
