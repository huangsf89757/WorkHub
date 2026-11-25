import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();

const { sortOrdersFromDomIds } = await import('../js/ext-todo.js');

test('sortOrdersFromDomIds：分组按 DOM 顺序从 0 连续编号', () => {
  const map = sortOrdersFromDomIds(['g1', 'g2', 'g3']);
  assert.deepEqual([...map], [['g1', 0], ['g2', 1], ['g3', 2]]);
});

test('sortOrdersFromDomIds：过滤空 id（无虚拟默认组概念）', () => {
  const map = sortOrdersFromDomIds(['', 'g1', 'g2']);
  assert.deepEqual([...map], [['g1', 0], ['g2', 1]]);
});

test('sortOrdersFromDomIds：仅空 id 时返回空映射', () => {
  assert.deepEqual([...sortOrdersFromDomIds([''])], []);
});
