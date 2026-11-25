import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();
const core = await import('../js/core.js');
await import('../js/skin-classic.js');
const { registry, entryExts, setPlacement, setExtEnabled, setSkinMount, getActiveSkin, store, parseRoute } = core;

function setup() {
  store.set('menuLayout', { groups: [], placement: {} });
  store.set('extEnabled', {});
  store.set('skinMounts', {});
  registry.add({ id: 'entry-a', name: 'A', group: 'main', mounts: ['right'] });
  setExtEnabled('entry-a', true);
}

test('entryExts：按菜单编排返回挂载到 right 的扩展', () => {
  setup();
  setPlacement('entry-a', { zone: 'right' });
  assert.deepEqual(entryExts('right').map(e => e.id), ['entry-a']);
  assert.deepEqual(entryExts('bottom').map(e => e.id), []);
});

test('entryExts：按皮肤挂载点返回挂载到 bottom 的扩展', () => {
  setup();
  const skin = getActiveSkin();
  setSkinMount(skin.id, 'bottom', 'entry-a');
  assert.deepEqual(entryExts('bottom').map(e => e.id), ['entry-a']);
});

test('entryExts：停用的扩展不进入入口区', () => {
  setup();
  setPlacement('entry-a', { zone: 'right' });
  setExtEnabled('entry-a', false);
  assert.deepEqual(entryExts('right').map(e => e.id), []);
});

test('entryExts：扩展详情路由可通过 hash 还原', () => {
  assert.deepEqual(parseRoute('#/ext/todo/detail/t-9'), {
    extId: 'todo', mode: 'detail', id: 't-9',
  });
});
