import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();

const { extEnabled, setExtEnabled, registry, store, resolveSlotMount, getConfigSnapshot, applyConfigSnapshot,
  setPlannedFeatures, extStageOf, isExtInstalled, applyDefaultInstalledExts, installExt, uninstallExt, extNeedsUpdate, updateExt } = await import('../js/core.js');
const { storageKey } = await import('../js/base.js');

test('全新状态下业务扩展默认关闭（extEnabled 默认 false）', () => {
  registry.add({ id: 'todo', name: '任务', group: 'main', order: 1 });
  assert.equal(extEnabled('todo'), false, '未显式启用时默认关闭');
  setExtEnabled('todo', true);
  assert.equal(extEnabled('todo'), true, '显式启用后生效');
  setExtEnabled('todo', false);
  assert.equal(extEnabled('todo'), false);
});

test('系统扩展/页面不受默认关闭影响，始终可用', () => {
  registry.add({ id: 'ext-center', name: '扩展中心', group: 'system', order: 0 });
  assert.equal(extEnabled('ext-center'), true);
  assert.equal(extEnabled('nonexistent'), true, '未注册的 id 保持原行为（不误伤）');
});

test('任务扩展加载后不自动注入示例数据（全新状态为空）', async () => {
  const data = await import('../js/data.js');
  await import('../js/ext-todo.js');
  assert.equal(data.state.todos.length, 0, '不应有种子待办');
  assert.equal(data.state.todoGroups.length, 0, '不应有种子分组');
});

test('一次性重置迁移：清除存量业务数据与扩展启用态，且幂等', async () => {
  const base = await import('../js/base.js');
  // 模拟存量数据
  localStorage.setItem('wh_ext_todo_items', JSON.stringify([{ id: 'old', title: '旧数据' }]));
  localStorage.setItem('wh_ext_todo_groups', JSON.stringify([{ id: 'g', name: '旧分组' }]));
  localStorage.setItem('wh_sys_settings_extEnabled', JSON.stringify({ todo: true }));
  localStorage.removeItem('wh_sys_settings_reset_v1');

  const first = base.migrateResetToEmpty();
  assert.equal(first, true, '首次执行返回 true 表示发生了重置');
  assert.equal(localStorage.getItem('wh_ext_todo_items'), null, '旧待办已清除');
  assert.equal(localStorage.getItem('wh_ext_todo_groups'), null, '旧分组已清除');
  assert.deepEqual(JSON.parse(localStorage.getItem('wh_sys_settings_extEnabled')), {}, '扩展启用态已清空');
  assert.ok(localStorage.getItem('wh_sys_settings_reset_v1'), '已写入重置标记');

  // 再次写入数据后调用：因标记存在，不再重置
  localStorage.setItem('wh_ext_todo_items', JSON.stringify([{ id: 'new', title: '新数据' }]));
  const second = base.migrateResetToEmpty();
  assert.equal(second, false, '已有标记时不再重置');
  assert.ok(localStorage.getItem('wh_ext_todo_items'), '新数据保留');
});

test('全新工作台不预置任何槽位挂载', () => {
  store.set('themeStyleMounts', {});
  assert.deepEqual(getConfigSnapshot('classic').themeStyleMounts, {});
});

test('空配置下 classic 的 left:top 回落到扩展中心', async () => {
  await import('../js/theme-style-classic.js');
  store.set('themeStyleMounts', {});
  assert.equal(resolveSlotMount('left', 'top'), 'ext-center');
});

test('配置快照：草稿改动不影响 store，应用后才写回', () => {
  store.set('themeStyleMounts', {});
  const snap = getConfigSnapshot('classic');
  snap.themeStyleMounts['left:top'] = 'todo';
  assert.deepEqual(store.get('themeStyleMounts', {}), {}, '草稿改动未写回前 store 不变');
  applyConfigSnapshot('classic', snap);
  assert.equal(store.get('themeStyleMounts', {}).classic['left:top'], 'todo', '应用后写回 store');
  store.set('themeStyleMounts', {});
});

test('扩展阶段：registry 视为已上架，清单项按声明，未知回落计划中', () => {
  registry.add({ id: 'todo', name: '任务', group: 'main', order: 1 });
  setPlannedFeatures([
    { id: 'dev-ext', stage: 'developing' },
    { id: 'live-ext', stage: 'published', version: '1.2.0' },
  ]);
  assert.equal(extStageOf('todo'), 'published');
  assert.equal(extStageOf('dev-ext'), 'developing');
  assert.equal(extStageOf('unknown'), 'planning');
  setPlannedFeatures([]);
});

test('清单扩展：默认未安装 → 安装 → 待更新 → 更新 → 卸载', () => {
  setPlannedFeatures([{ id: 'tool-json', name: 'JSON 工具', group: 'Tools', stage: 'published', version: '1.0.0' }]);
  localStorage.removeItem(storageKey('extInstallState'));
  assert.equal(isExtInstalled('tool-json'), false, '清单条目默认未安装');
  installExt('tool-json');
  assert.equal(isExtInstalled('tool-json'), true);
  assert.equal(extNeedsUpdate('tool-json'), true, '新装版本未确认，视为可更新');
  updateExt('tool-json');
  assert.equal(extNeedsUpdate('tool-json'), false, '更新后版本对齐');
  uninstallExt('tool-json');
  assert.equal(isExtInstalled('tool-json'), false);
  localStorage.removeItem(storageKey('extInstallState'));
  setPlannedFeatures([]);
});

test('默认安装初始化：全新不预装，配置种子化，存量选择不被覆盖', () => {
  localStorage.setItem(storageKey('extEnabled'), JSON.stringify({}));
  localStorage.removeItem(storageKey('extInstallState'));

  // 仅被 import 注册不等于已安装
  assert.equal(isExtInstalled('todo'), false, 'registry 注册不再隐含已安装');

  // 空配置：写下空清单即锁定初始化，后续配置变更不影响该用户
  assert.equal(applyDefaultInstalledExts([]), true, '首次应写入');
  assert.equal(isExtInstalled('todo'), false);
  assert.equal(applyDefaultInstalledExts(['todo']), false, '已有记录后不再覆盖');

  // 全新状态按配置预装
  localStorage.removeItem(storageKey('extInstallState'));
  assert.equal(applyDefaultInstalledExts(['todo']), true);
  assert.equal(isExtInstalled('todo'), true, '配置列出的扩展应已安装');

  // 显式卸载状态优先于任何默认值
  localStorage.setItem(storageKey('extInstallState'), JSON.stringify({ todo: { installed: false } }));
  assert.equal(isExtInstalled('todo'), false, '显式卸载优先');

  localStorage.removeItem(storageKey('extInstallState'));
});
