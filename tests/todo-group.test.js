import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();

const { ensureGroupForNewTask, defaultGroupForNewTask, presetGroupForNewTask, todoIdsInGroup, sortOrdersFromDomIds } = await import('../js/ext-todo.js');
const { storageKey } = await import('../js/base.js');

test('ensureGroupForNewTask：无分组时返回 null（触发自动建默认组）', () => {
  assert.equal(ensureGroupForNewTask([], ''), null);
  assert.equal(ensureGroupForNewTask([], 'g1'), null, '无分组时即使传了无效 id 也返回 null');
});

test('ensureGroupForNewTask：有分组时返回有效选中 id', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }];
  assert.equal(ensureGroupForNewTask(groups, 'g2'), 'g2');
  assert.equal(ensureGroupForNewTask(groups, 'g1'), 'g1');
});

test('ensureGroupForNewTask：选中 id 无效时回退到第一个分组', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }];
  assert.equal(ensureGroupForNewTask(groups, ''), 'g1', '空 id 回退第一个');
  assert.equal(ensureGroupForNewTask(groups, 'missing'), 'g1', '不存在的 id 回退第一个');
});

test('defaultGroupForNewTask：记住上次选择的有效分组 id', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }];
  assert.equal(defaultGroupForNewTask(groups, 'g2'), 'g2');
});

test('defaultGroupForNewTask：上次分组已删除时回退第一个分组', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }];
  assert.equal(defaultGroupForNewTask(groups, 'deleted'), 'g1');
});

test('defaultGroupForNewTask：无分组时返回空串（由 addTodo 自动建默认组）', () => {
  assert.equal(defaultGroupForNewTask([], ''), '');
  assert.equal(defaultGroupForNewTask([], 'g1'), '');
});

test('presetGroupForNewTask：快捷入口预选分组优先于上次偏好', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }];
  assert.equal(presetGroupForNewTask(groups, 'g2', 'g1'), 'g2', '预选 g2 覆盖上次使用的 g1');
});

test('presetGroupForNewTask：预选分组已删除时回退到上次偏好', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }];
  assert.equal(presetGroupForNewTask(groups, 'deleted', 'g2'), 'g2');
});

test('presetGroupForNewTask：无预选时行为等同 defaultGroupForNewTask', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }];
  assert.equal(presetGroupForNewTask(groups, '', 'g2'), 'g2');
  assert.equal(presetGroupForNewTask(groups, '', 'deleted'), 'g1');
});

test('presetGroupForNewTask：无分组时返回空串', () => {
  assert.equal(presetGroupForNewTask([], 'g1', 'g2'), '');
});

test('todoLastGroupId：作为系统偏好键持久化（刷新后仍保留）', () => {
  assert.equal(storageKey('todoLastGroupId'), 'wh_sys_settings_todoLastGroupId');
});

test('todoIdsInGroup：返回组内待办 id', () => {
  const todos = [
    { id: 't1', groupId: 'g1' },
    { id: 't2', groupId: 'g2' },
    { id: 't3', groupId: 'g1' },
    { id: 't4', groupId: '' },
  ];
  assert.deepEqual(todoIdsInGroup(todos, 'g1'), ['t1', 't3']);
  assert.deepEqual(todoIdsInGroup(todos, 'g2'), ['t2']);
  assert.deepEqual(todoIdsInGroup(todos, 'g9'), []);
});

test('sortOrdersFromDomIds：取消虚拟默认组后所有 DOM 分组 id 连续编号', () => {
  const map = sortOrdersFromDomIds(['g1', 'g2', 'g3']);
  assert.deepEqual([...map], [['g1', 0], ['g2', 1], ['g3', 2]]);
});

test('sortOrdersFromDomIds：过滤空 id（无虚拟默认组）', () => {
  const map = sortOrdersFromDomIds(['', 'g1', 'g2']);
  assert.deepEqual([...map], [['g1', 0], ['g2', 1]]);
});
