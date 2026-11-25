import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();

const { extEnabled, setExtEnabled, registry } = await import('../js/core.js');

test('全新状态下业务扩展默认关闭（extEnabled 默认 false）', () => {
  registry.add({ id: 'todo', name: 'TODO', group: 'main', order: 1 });
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

test('TODO 扩展加载后不自动注入示例数据（全新状态为空）', async () => {
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
