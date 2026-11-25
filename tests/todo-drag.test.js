import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();

const { sortOrdersFromDomIds } = await import('../js/ext-todo.js');

test('sortOrdersFromDomIds：自定义分组按 DOM 顺序从 0 连续编号', () => {
  const map = sortOrdersFromDomIds(['g1', 'g2', 'g3']);
  assert.deepEqual([...map], [['g1', 0], ['g2', 1], ['g3', 2]]);
});

test('sortOrdersFromDomIds：默认组 __default__ 置顶但不占 sort 位', () => {
  const map = sortOrdersFromDomIds(['__default__', 'g1', 'g2']);
  assert.deepEqual([...map], [['g1', 0], ['g2', 1]]);
  assert.equal(map.has('__default__'), false, '默认组不产生 sort 更新');
});

test('sortOrdersFromDomIds：过滤空 id 与默认组', () => {
  const map = sortOrdersFromDomIds(['__default__', '', 'g1', 'g2']);
  assert.deepEqual([...map], [['g1', 0], ['g2', 1]]);
});

test('sortOrdersFromDomIds：仅默认组时返回空映射', () => {
  assert.deepEqual([...sortOrdersFromDomIds(['__default__'])], []);
});
