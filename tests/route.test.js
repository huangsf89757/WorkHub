import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();
const { parseRoute, buildRoute, registerSystemPage } = await import('../js/core.js');
registerSystemPage('settings', () => null);
registerSystemPage('ext-detail', () => null);

test('parseRoute：扩展主页 hash 解析为 home 模式', () => {
  assert.deepEqual(parseRoute('#/ext/todo'), { extId: 'todo', mode: 'home', id: null });
});

test('parseRoute：扩展单条详情 hash 解析为 detail 模式', () => {
  assert.deepEqual(parseRoute('#/ext/todo/detail/t-123'), { extId: 'todo', mode: 'detail', id: 't-123' });
});

test('parseRoute：系统页 hash 解析为 home 模式', () => {
  assert.deepEqual(parseRoute('#/sys/settings'), { extId: 'settings', mode: 'home', id: null });
});

test('parseRoute：带参系统页 hash 解析为 detail 模式', () => {
  assert.deepEqual(parseRoute('#/sys/ext-detail/todo'), { extId: 'ext-detail', mode: 'detail', id: 'todo' });
});

test('parseRoute：对空 hash 与非法 hash 返回 null', () => {
  for (const h of ['', '#', '#/', '#/bogus/todo', '#/ext/', '#/sys/', '#/ext/todo/detail/']) {
    assert.equal(parseRoute(h), null, `hash: ${h}`);
  }
});

test('parseRoute：对 id 做 URI 解码', () => {
  assert.deepEqual(parseRoute('#/ext/todo/detail/%E4%BB%BB%E5%8A%A1%201'), {
    extId: 'todo', mode: 'detail', id: '任务 1',
  });
});

test('buildRoute：生成扩展主页 hash', () => {
  assert.equal(buildRoute({ extId: 'todo', mode: 'home' }), '#/ext/todo');
});

test('buildRoute：生成扩展详情 hash', () => {
  assert.equal(buildRoute({ extId: 'todo', mode: 'detail', id: 't-123' }), '#/ext/todo/detail/t-123');
});

test('buildRoute：生成系统页 hash', () => {
  assert.equal(buildRoute({ extId: 'settings', mode: 'home' }), '#/sys/settings');
});

test('buildRoute：生成带参系统页 hash', () => {
  assert.equal(buildRoute({ extId: 'ext-detail', mode: 'detail', id: 'todo' }), '#/sys/ext-detail/todo');
});

test('buildRoute：无 extId 生成空路由', () => {
  assert.equal(buildRoute({ extId: null, mode: 'home' }), '#/');
});

test('parseRoute 与 buildRoute 往返一致', () => {
  for (const route of [
    { extId: 'todo', mode: 'home', id: null },
    { extId: 'todo', mode: 'detail', id: 't-1' },
    { extId: 'ext-detail', mode: 'detail', id: 'todo' },
  ]) {
    assert.deepEqual(parseRoute(buildRoute(route)), route);
  }
});
