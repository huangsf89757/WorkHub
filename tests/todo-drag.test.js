import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();

const { reorderGroupIds } = await import('../js/ext-todo.js');

test('reorderGroupIds：把分组插到目标之后，返回新顺序', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorderGroupIds(ids, 'a', 'c', true), ['b', 'c', 'a', 'd']);
});

test('reorderGroupIds：把分组插到目标之前', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorderGroupIds(ids, 'd', 'b', false), ['a', 'd', 'b', 'c']);
});

test('reorderGroupIds：拖到末尾之后', () => {
  assert.deepEqual(reorderGroupIds(['a', 'b', 'c'], 'a', 'c', true), ['b', 'c', 'a']);
});

test('reorderGroupIds：拖到开头之前', () => {
  assert.deepEqual(reorderGroupIds(['a', 'b', 'c'], 'c', 'a', false), ['c', 'a', 'b']);
});

test('reorderGroupIds：source===target 时不变', () => {
  assert.deepEqual(reorderGroupIds(['a', 'b', 'c'], 'b', 'b', true), ['a', 'b', 'c']);
});

test('reorderGroupIds：不修改原数组', () => {
  const ids = ['a', 'b', 'c'];
  const result = reorderGroupIds(ids, 'a', 'c', true);
  assert.deepEqual(ids, ['a', 'b', 'c'], '原数组保持不变');
  assert.notEqual(result, ids);
});
