import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './helpers.js';
installLocalStorage({ quota: 200 });
const { store, bus, storageKey } = await import('../js/base.js');

test('storageKey：业务域映射到表名，偏好进 sys_settings，未知域保持兼容', () => {
  assert.equal(storageKey('todos'), 'wh_ext_todo_items');
  assert.equal(storageKey('themeColor'), 'wh_sys_settings_themeColor');
  assert.equal(storageKey('futureDomain'), 'wh_futureDomain');
});
test('store 读写 JSON，缺省值生效', () => {
  store.set('themeColor', 'dark');
  assert.equal(store.get('themeColor'), 'dark');
  assert.equal(store.get('nope', 42), 42);
});
test('localStorage 配额满时发出 store:error，而不是静默吞掉', () => {
  const errors = [];
  bus.on('store:error', e => errors.push(e.key));
  store.set('todos', 'x'.repeat(1000));
  assert.deepEqual(errors, ['todos']);
});
