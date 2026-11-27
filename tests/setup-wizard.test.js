/* setup-wizard.test.js — 首次初始化向导：判定、配置落盘与跳过 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';

installLocalStorage();
installFakeBrowser();
document.body = { dataset: {} }; // applyThemeColor 会写 dataset

const { store, registry, isExtInstalled } = await import('../js/core.js');
await import('../js/theme-style-classic.js');
const { isSetupDone, maybeRunSetup, commitSetup, skipSetup } = await import('../js/setup-wizard.js');

test('首次访问未标记初始化；完成向导写入全部配置', () => {
  localStorage.clear();
  registry.add({ id: 'todo', name: '任务', group: 'main', order: 1 });
  assert.equal(isSetupDone(), false, '无标记时视为未初始化');

  commitSetup({
    name: '小林',
    themeColor: 'light',
    themeStyle: 'classic',
    selectedExts: new Set(['todo']),
  });

  assert.equal(isSetupDone(), true, '完成后标记已写入');
  assert.equal(store.get('currentUserName'), '小林');
  assert.equal(store.get('themeColor'), 'light');
  assert.equal(store.get('themeStyle'), 'classic');
  assert.equal(isExtInstalled('todo'), true, '勾选的扩展已安装');
});

test('跳过向导只写初始化标记，保留现有偏好', async () => {
  localStorage.clear();
  store.set('themeColor', 'terminal');
  store.set('currentUserName', '老用户');

  skipSetup();

  assert.equal(isSetupDone(), true);
  assert.equal(store.get('themeColor'), 'terminal', '跳过不改主题色');
  assert.equal(store.get('currentUserName'), '老用户', '跳过不改称呼');
  assert.equal(await maybeRunSetup(), false, '已标记后不再展示向导');
});

test('完成向导未勾选扩展时锁定为空安装态，后续配置不再覆盖', () => {
  localStorage.clear();
  registry.add({ id: 'todo', name: '任务', group: 'main', order: 1 });
  commitSetup({ name: '', themeColor: 'dark', themeStyle: 'classic', selectedExts: new Set() });

  assert.equal(isExtInstalled('todo'), false, '未勾选的扩展不安装');
  assert.equal(store.get('currentUserName'), undefined, '空称呼不写入，保留默认「我」');
});
