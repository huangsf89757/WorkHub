/* sync.js — 多端同步引擎（架构骨架，v1 no-op，API 已冻结）
 *
 * 目标形态：手机添加一条 todo → 云端 → Mac 自动出现。
 * 本版只搭骨架并暴露稳定 API；真正联网在后端/凭据就绪后注入 CloudAdapter。
 *
 * 同步模型（详见 docs/sync-protocol.md）：
 *   - 每条记录携带 meta：{ updatedAt, updatedBy, deletedAt, rev }
 *   - 冲突策略 LWW：updatedAt 大者胜；相等比 rev；再相等用 deviceId 字典序打破平局
 *     updatedAt 由 hlc.js 单调生成，吸收远端时间戳，缓解设备时钟偏差
 *   - 删除 = 软删除墓碑（deletedAt）；仅当「已过保留期 且 已被成功同步过」才物理清理（见 purgeTombstones）
 *   - 变更日志 outbox：本地写入即入队并持久化（sys_outbox），同记录多次修改合并为最新一条，push 成功后出队
 *   - 拉取按 since=lastPullAt 增量，按领域合并
 */

import { bus, store, SYNCED_PREF_KEYS, resetAppliedThisSession } from './base.js';
import { getDeviceId, isOnline } from './platform.js';
import { storageInfo, outboxAppend, outboxAck, outboxLoad } from './storage.js';
import { nextTs, observe } from './hlc.js';

export const SYNC_STATE = { OFF: 'off', IDLE: 'idle', SYNCING: 'syncing', ERROR: 'error' };

let state = SYNC_STATE.OFF;
let remote = null;             // CloudAdapter，注入后才启用
let lastPullAt = store.get('syncCursor', 0) || 0; // 增量拉取游标，持久化，重启不重拉全量
let outbox = [];               // [{ seq, domain, op, record, at }]
let seq = 0;

const saveCursor = () => store.set('syncCursor', lastPullAt);
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

/** 记录一次本地变更（由 data.commit 调用）。离线也入队并落盘，恢复在线统一推送。
 *  同一条记录的多次修改只保留最新一条（对端只关心最终状态），避免 outbox 无限增长。 */
export function enqueue(domain, op, record) {
  const snapshot = JSON.parse(JSON.stringify(record)); // 深拷贝：meta 后续会被原地修改
  const superseded = outbox.filter(item => item.domain === domain && item.record.id === snapshot.id);
  if (superseded.length) {
    outbox = outbox.filter(item => !superseded.includes(item));
    outboxAck(superseded.map(item => item.seq));
  }
  const entry = { seq: ++seq, domain, op, record: snapshot, at: Date.now() };
  outbox.push(entry);
  outboxAppend(entry);
  if (remote) bus.emit('sync:dirty', outbox.length);
}

/** 偏好同步域：每条偏好一条记录（id = 逻辑 key），避免整块偏好互相覆盖。 */
export const PREFS_DOMAIN = 'sys_settings';

/** 偏好写入即入 outbox；设备身份等本地专属 key 不入队。 */
bus.on('pref', ({ key, value }) => {
  if (!SYNCED_PREF_KEYS.includes(key)) return;
  const all = store.get('prefMeta', {}) || {};
  const prev = all[key];
  const meta = { updatedAt: nextTs(), updatedBy: getDeviceId(), rev: (prev?.rev || 0) + 1, deletedAt: null };
  all[key] = meta;
  store.rawSet('prefMeta', all);
  enqueue(PREFS_DOMAIN, 'upsert', { id: key, value, meta });
});

/** 远端偏好按 key 级 LWW 合并；本地较新时重新入队纠正服务端，不产生回声。 */
export function applyRemotePrefs(records) {
  const all = store.get('prefMeta', {}) || {};
  let changed = 0;
  for (const record of records || []) {
    if (!record || !SYNCED_PREF_KEYS.includes(record.id)) continue;
    observe(record.meta?.updatedAt);
    const localMeta = all[record.id];
    const local = localMeta ? { id: record.id, meta: localMeta } : null;
    const winner = lwwWinner(local, record);
    if (winner === record) {
      if (JSON.stringify(store.get(record.id)) !== JSON.stringify(record.value)) {
        store.rawSet(record.id, record.value);
        changed++;
      }
      all[record.id] = record.meta;
    } else if (localMeta && JSON.stringify(store.get(record.id)) !== JSON.stringify(record.value)) {
      // 仅内容确有差异时才纠正服务端；相同值避免每次拉取都产生回声
      enqueue(PREFS_DOMAIN, 'upsert', { id: record.id, value: store.get(record.id), meta: localMeta });
    }
  }
  store.rawSet('prefMeta', all);
  if (changed) bus.emit('pref:synced', { changed });
  return { changed };
}

/** 启动时补种旧版本存量偏好（无同步 meta 的）入队；全新设备跳过，避免本地默认值覆盖云端。 */
export function bootstrapPrefs() {
  if (resetAppliedThisSession) return 0;
  const all = store.get('prefMeta', {}) || {};
  let added = 0;
  for (const key of SYNCED_PREF_KEYS) {
    if (all[key]) continue;
    const value = store.get(key);
    if (value === undefined) continue;
    const meta = { updatedAt: nextTs(), updatedBy: getDeviceId(), rev: 1, deletedAt: null };
    all[key] = meta;
    enqueue(PREFS_DOMAIN, 'upsert', { id: key, value, meta });
    added++;
  }
  if (added) store.rawSet('prefMeta', all);
  return added;
}

/** 启动时从持久层恢复未推送条目（main.js 在 initStorage 之后调用）。返回恢复条数。 */
export function restoreOutbox() {
  const rows = outboxLoad();
  const known = new Set(outbox.map(item => item.seq));
  for (const row of rows) {
    if (known.has(row.seq)) continue;
    outbox.push(row);
    seq = Math.max(seq, row.seq);
  }
  outbox.sort((a, b) => a.seq - b.seq);
  return rows.length;
}
/** LWW 胜者：updatedAt 大者胜；相等比 rev；再相等按 deviceId 字典序打破平局（确定性，两端结论一致）。 */
export function lwwWinner(local, incoming) {
  if (!local) return incoming;
  if (!incoming) return local;
  const lt = local.meta?.updatedAt ?? 0;
  const it = incoming.meta?.updatedAt ?? 0;
  if (it !== lt) return it > lt ? incoming : local;
  const lr = local.meta?.rev ?? 0;
  const ir = incoming.meta?.rev ?? 0;
  if (ir !== lr) return ir > lr ? incoming : local;
  return (incoming.meta?.updatedBy || '') > (local.meta?.updatedBy || '') ? incoming : local;
}
/** 远端记录按 LWW 合并进本地领域，返回新数组与变更条数。纯合并，不做任何物理删除。 */
export function mergeDomain(localArr, remoteArr) {
  const map = new Map();
  for (const record of localArr || []) map.set(record.id, record);
  let changed = 0;
  for (const record of remoteArr || []) {
    observe(record.meta?.updatedAt);
    const current = map.get(record.id);
    const winner = lwwWinner(current, record);
    if (winner !== current) changed++;
    map.set(record.id, winner);
  }
  return { records: [...map.values()], changed };
}

/* ============================================================
   按扩展可插拔的合并策略（ADR-008）
   策略是域的静态属性：写入/合并时按 domain 取策略，未声明的域默认 lww-record。
   ============================================================ */
const LWW_RECORD = Object.freeze({
  name: 'lww-record',
  transport: 'record',
  encode: change => change,                 // record 形态：载荷即整条变更（深拷贝由 enqueue 负责）
  merge: (local, remote) => mergeDomain(local, remote),
});
const BUILTIN_STRATEGIES = Object.freeze({ 'lww-record': LWW_RECORD });
const domainStrategies = new Map();

/**
 * 为某个域声明同步策略。策略可为内置名（'lww-record'）或自定义策略对象
 * （须含 name / transport / encode / merge）。同域重复声明以最后一次为准，便于未来升级。
 * @param {string} domain 数据域名
 * @param {{strategy: string|object}} options 策略配置
 */
export function declareSync(domain, { strategy } = {}) {
  const resolved = typeof strategy === 'string'
    ? BUILTIN_STRATEGIES[strategy]
    : strategy;
  if (!resolved || typeof resolved.merge !== 'function' || typeof resolved.encode !== 'function')
    throw new Error(`未知同步策略：${String(strategy)}`);
  domainStrategies.set(domain, resolved);
}

/** 取域的同步策略；未声明则回退到默认 lww-record。 */
export function getSyncStrategy(domain) {
  return domainStrategies.get(domain) || LWW_RECORD;
}

/** 按域的 merge 函数执行合并（默认等价于 mergeDomain）。 */
export function mergeForDomain(domain, local, remote) {
  return getSyncStrategy(domain).merge(local, remote);
}

/** 按域的 encode 函数把本地变更编码为同步载荷。 */
export function encodeForDomain(domain, change) {
  return getSyncStrategy(domain).encode(change);
}

export const TOMBSTONE_RETAIN_MS = 30 * 86400000;
/**
 * 清理墓碑。必须同时满足：
 *   1. 删除时间早于保留期（默认 30 天）；
 *   2. 删除时间不晚于 syncedUpTo（已成功与远端同步到的时间点）。
 * 条件 2 防止「墓碑还没传给其他设备就被物理删除」——否则其他设备仍持有该记录，
 * 下次合并时会把已删除的记录重新带回来（复活）。未启用同步（syncedUpTo=0）时不清理。
 */
export function purgeTombstones(records, { now = Date.now(), retainMs = TOMBSTONE_RETAIN_MS, syncedUpTo = 0 } = {}) {
  const limit = Math.min(now - retainMs, syncedUpTo);
  let purged = 0;
  const kept = records.filter(record => {
    const deletedAt = record.meta?.deletedAt;
    if (deletedAt && deletedAt < limit) { purged++; return false; }
    return true;
  });
  return { records: kept, purged };
}
export const getLastPullAt = () => lastPullAt;
/** 推送本地 outbox；无 remote 或离线时返回 0。 */
export async function push() {
  if (!remote || !isOnline() || !outbox.length) return 0;
  setState(SYNC_STATE.SYNCING);
  try {
    const batch = outbox.slice();
    await remote.push(batch);
    outbox = outbox.filter(item => !batch.includes(item));
    outboxAck(batch.map(item => item.seq));
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
    saveCursor();
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
