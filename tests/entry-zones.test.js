import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();
const core = await import('../js/core.js');
await import('../js/theme-style-classic.js');
const { registry, entryExts, setExtEnabled, setThemeStyleMount, getActiveThemeStyle, store, parseRoute } = core;

function setup() {
  store.set('extEnabled', {});
  store.set('themeStyleMounts', {});
  registry.add({ id: 'entry-a', name: 'A', group: 'main', mounts: ['right'] });
  setExtEnabled('entry-a', true);
}

test('entryExts：按槽位挂载返回 right 区的扩展', () => {
  setup();
  const themeStyle = getActiveThemeStyle();
  setThemeStyleMount(themeStyle.id, 'right:top', 'entry-a');
  assert.deepEqual(entryExts('right').map(e => e.id), ['entry-a']);
  assert.deepEqual(entryExts('bottom').map(e => e.id), []);
});

test('entryExts：按槽位挂载返回 bottom 区的扩展', () => {
  setup();
  const themeStyle = getActiveThemeStyle();
  setThemeStyleMount(themeStyle.id, 'bottom:mid', 'entry-a');
  assert.deepEqual(entryExts('bottom').map(e => e.id), ['entry-a']);
});

test('entryExts：停用的扩展不进入入口区', () => {
  setup();
  const themeStyle = getActiveThemeStyle();
  setThemeStyleMount(themeStyle.id, 'right:top', 'entry-a');
  setExtEnabled('entry-a', false);
  assert.deepEqual(entryExts('right').map(e => e.id), []);
});

test('entryExts：扩展详情路由可通过 hash 还原', () => {
  assert.deepEqual(parseRoute('#/ext/todo/detail/t-9'), {
    extId: 'todo', mode: 'detail', id: 't-9',
  });
});
