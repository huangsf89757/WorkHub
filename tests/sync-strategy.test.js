import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();
const sync = await import('../js/sync.js');
const { _reset } = await import('../js/hlc.js');
beforeEach(_reset);

const rec = (id, updatedAt, extra = {}) => ({ id, ...extra, meta: { updatedAt, updatedBy: 'dev_a', rev: 1, deletedAt: null } });

test('同步策略 API 已导出：declareSync / getSyncStrategy / mergeForDomain / encodeForDomain', () => {
  assert.equal(typeof sync.declareSync, 'function');
  assert.equal(typeof sync.getSyncStrategy, 'function');
  assert.equal(typeof sync.mergeForDomain, 'function');
  assert.equal(typeof sync.encodeForDomain, 'function');
});

test('未声明的域默认走 lww-record：transport=record，合并结果与 mergeDomain 一致', () => {
  const domain = 'never-declared-domain';
  const strategy = sync.getSyncStrategy(domain);
  assert.equal(strategy.name, 'lww-record');
  assert.equal(strategy.transport, 'record');

  const local = [rec('1', 10, { v: 'L' }), rec('2', 30, { v: 'L2' })];
  const remote = [rec('1', 20, { v: 'R' }), rec('3', 5, { v: 'R3' })];
  assert.deepEqual(sync.mergeForDomain(domain, local, remote), sync.mergeDomain(local, remote));
  const encoded = sync.encodeForDomain(domain, { record: rec('x', 1) });
  assert.equal(encoded.record.meta.updatedAt, 1, 'lww-record 的 encode 原样透传整个 change');
});

test('declareSync 注册 lww-record 后按域解析策略', () => {
  sync.declareSync('todos', { strategy: 'lww-record' });
  assert.equal(sync.getSyncStrategy('todos').name, 'lww-record');
});

test('declareSync 拒绝未知策略名', () => {
  assert.throws(() => sync.declareSync('x', { strategy: 'nonexistent' }), /未知同步策略/);
});

test('自定义策略对象可插拔：transport=op，encode/merge 按策略执行', () => {
  const custom = {
    name: 'crdt-test',
    transport: 'op',
    encode: change => 'OP:' + change.record.id,
    merge: (local, remote) => ({ records: [...(local || []), ...remote], changed: remote.length }),
  };
  sync.declareSync('whiteboard', { strategy: custom });

  assert.equal(sync.getSyncStrategy('whiteboard').transport, 'op');
  assert.equal(sync.encodeForDomain('whiteboard', { record: { id: 'w1' } }), 'OP:w1');
  const merged = sync.mergeForDomain('whiteboard', [], [{ id: 'w1' }]);
  assert.equal(merged.records.length, 1);
  assert.equal(merged.changed, 1);
});

test('declareSync 可覆盖同域策略（未来策略升级场景）', () => {
  sync.declareSync('notes', { strategy: 'lww-record' });
  sync.declareSync('notes', { strategy: { name: 'upgraded', transport: 'op', encode: c => c, merge: () => ({ records: [], changed: 0 }) } });
  assert.equal(sync.getSyncStrategy('notes').name, 'upgraded');
});
