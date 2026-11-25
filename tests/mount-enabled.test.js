/* mount-enabled.test.js — 挂载点启用态独立性与快照往返 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';

installLocalStorage();
installFakeBrowser();

const {
  store, registry, setExtEnabled, setThemeStyleMount,
  setMountEnabled, mountEnabledOf, getConfigSnapshot, applyConfigSnapshot,
} = await import('../js/core.js');
await import('../js/theme-style-classic.js');

function setup() {
  store.set('menuLayout', { groups: [], placement: {} });
  store.set('extEnabled', {});
  store.set('themeStyleMounts', {});
  store.set('mountEnabled', {});
  registry.add({ id: 'todo', name: '任务', group: 'main', order: 1 });
  setExtEnabled('todo', true);
  setThemeStyleMount('classic', 'left:top', 'todo');
  setThemeStyleMount('classic', 'left:bottom', 'todo');
}

test('同一扩展挂到两个挂载点，启停互不影响', () => {
  setup();
  assert.equal(mountEnabledOf('classic', 'left:top'), true);
  assert.equal(mountEnabledOf('classic', 'left:bottom'), true);

  setMountEnabled('classic', 'left:top', false);
  assert.equal(mountEnabledOf('classic', 'left:top'), false);
  assert.equal(mountEnabledOf('classic', 'left:bottom'), true, '停用一个点不得影响另一个点');

  setMountEnabled('classic', 'left:bottom', false);
  setMountEnabled('classic', 'left:top', true);
  assert.equal(mountEnabledOf('classic', 'left:top'), true);
  assert.equal(mountEnabledOf('classic', 'left:bottom'), false, '启用一个点不得影响另一个点');
});

test('挂载点启用态纳入配置快照并可应用', () => {
  setup();
  setMountEnabled('classic', 'left:top', false);
  const snap = getConfigSnapshot('classic');
  assert.equal(snap.mountEnabled.classic['left:top'], false);

  setMountEnabled('classic', 'left:top', true);
  applyConfigSnapshot('classic', snap);
  assert.equal(mountEnabledOf('classic', 'left:top'), false, '应用快照后恢复已停用的挂载点');
});
