import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();
const { lwwWinner, mergeDomain, purgeTombstones, enqueue, restoreOutbox, getOutboxSize, TOMBSTONE_RETAIN_MS } = await import('../js/sync.js');
const { registerAdapter } = await import('../js/storage.js');
const { observe, lastTs, nextTs, _reset } = await import('../js/hlc.js');
beforeEach(_reset);

const rec = (id, updatedAt, extra = {}, metaExtra = {}) => ({ id, ...extra, meta: { updatedAt, updatedBy: 'dev_a', rev: 1, deletedAt: null, ...metaExtra } });
const DAY = 86400000;

test('LWW：updatedAt 大者胜', () => {
  assert.equal(lwwWinner(rec('1', 10), rec('1', 20)).meta.updatedAt, 20);
  assert.equal(lwwWinner(rec('1', 20), rec('1', 10)).meta.updatedAt, 20);
});
test('LWW：时间相同比 rev，再相同比 deviceId，且两端结论一致', () => {
  const a = rec('1', 10, {}, { rev: 2, updatedBy: 'dev_a' });
  const b = rec('1', 10, {}, { rev: 3, updatedBy: 'dev_a' });
  assert.equal(lwwWinner(a, b), b);
  assert.equal(lwwWinner(b, a), b);
  const c = rec('1', 10, {}, { rev: 3, updatedBy: 'dev_z' });
  assert.equal(lwwWinner(b, c), c);
  assert.equal(lwwWinner(c, b), c);
});
test('mergeDomain：幂等、与顺序无关、合并新增记录', () => {
  const local = [rec('1', 10, { t: 'L' }), rec('2', 30, { t: 'L2' })];
  const remote = [rec('1', 20, { t: 'R' }), rec('2', 5, { t: 'R2' }), rec('3', 1, { t: 'R3' })];
  const once = mergeDomain(local, remote);
  const byId = Object.fromEntries(once.records.map(r => [r.id, r.t]));
  assert.deepEqual(byId, { 1: 'R', 2: 'L2', 3: 'R3' });
  assert.equal(once.changed, 2);
  const twice = mergeDomain(once.records, remote);
  assert.equal(twice.changed, 0);
  const swapped = mergeDomain(remote, local);
  assert.deepEqual(Object.fromEntries(swapped.records.map(r => [r.id, r.t])), byId);
});
test('mergeDomain 不再物理删除任何记录（旧实现会在合并时清理 30 天前的墓碑）', () => {
  const old = rec('1', 1, {}, { deletedAt: Date.now() - 90 * DAY });
  assert.equal(mergeDomain([old], []).records.length, 1);
});
test('mergeDomain 吸收远端时间戳：之后本地写入晚于它', () => {
  mergeDomain([], [rec('1', Date.now() + 5000)]);
  assert.ok(nextTs() > Date.now() + 5000);
});
test('mergeDomain 忽略异常超前的远端时钟', () => {
  mergeDomain([], [rec('1', Date.now() + 400 * DAY)]);
  assert.equal(lastTs(), 0);
});
test('purgeTombstones：未同步过不清理；已同步且过期才清理；活记录不动', () => {
  const now = Date.now();
  const tomb = rec('t', 1, {}, { deletedAt: now - 40 * DAY });
  const young = rec('y', 1, {}, { deletedAt: now - 5 * DAY });
  const live = rec('l', 1);
  const all = [tomb, young, live];
  assert.equal(purgeTombstones(all, { now, syncedUpTo: 0 }).purged, 0);
  assert.equal(purgeTombstones(all, { now, syncedUpTo: now - 50 * DAY }).purged, 0, '墓碑晚于同步点：对端可能还没收到');
  const result = purgeTombstones(all, { now, syncedUpTo: now });
  assert.equal(result.purged, 1);
  assert.deepEqual(result.records.map(r => r.id).sort(), ['l', 'y']);
  assert.equal(TOMBSTONE_RETAIN_MS, 30 * DAY);
});

/* ---------- outbox 持久化 ---------- */
function fakeAdapter() {
  const rows = new Map();
  const adapter = {
    name: 'fake', init() {}, persistDomain() {}, flush() {},
    outboxAppend: e => rows.set(e.seq, JSON.parse(JSON.stringify(e))),
    outboxAck: seqs => seqs.forEach(s => rows.delete(s)),
    outboxLoad: () => [...rows.values()].sort((a, b) => a.seq - b.seq),
  };
  registerAdapter(adapter);
  return rows;
}
test('enqueue：写入持久层；同一记录多次修改只保留最新一条', () => {
  const rows = fakeAdapter();
  const base = getOutboxSize();
  const r = rec('x', 1, { t: 'v1' });
  enqueue('todos', 'upsert', r);
  r.t = 'v2'; r.meta.updatedAt = 2;
  enqueue('todos', 'upsert', r);
  assert.equal(getOutboxSize(), base + 1);
  const saved = [...rows.values()].filter(e => e.record.id === 'x');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].record.t, 'v2');
});
test('enqueue 存的是深拷贝：之后原地修改记录不会改动队列里的快照', () => {
  const rows = fakeAdapter();
  const r = rec('snap', 1, { t: 'orig' });
  enqueue('todos', 'upsert', r);
  r.meta.updatedAt = 999; r.t = 'changed';
  const saved = [...rows.values()].find(e => e.record.id === 'snap');
  assert.equal(saved.record.t, 'orig');
  assert.equal(saved.record.meta.updatedAt, 1);
});
test('restoreOutbox：模拟刷新后从持久层恢复未推送条目', () => {
  const rows = fakeAdapter();
  rows.set(900, { seq: 900, domain: 'todos', op: 'upsert', record: rec('persisted', 5), at: 1 });
  const before = getOutboxSize();
  assert.equal(restoreOutbox(), 1);
  assert.equal(getOutboxSize(), before + 1);
  assert.equal(restoreOutbox(), 1);
  assert.equal(getOutboxSize(), before + 1, '重复恢复不产生重复条目');
  enqueue('todos', 'upsert', rec('after', 1));
  assert.ok([...rows.keys()].every((s, i, a) => a.indexOf(s) === i));
  assert.ok(Math.max(...rows.keys()) > 900, '新条目 seq 接在恢复的最大 seq 之后');
});
