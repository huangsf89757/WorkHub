import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();
const { dataRenderScope, registry, registerSystemPage } = await import('../js/core.js');

registry.add({ id: 'scoped', name: 's', domains: ['todos'] });
registry.add({ id: 'unscoped', name: 'u' });
registerSystemPage('sys', () => null);
const at = extId => ({ extId, mode: 'home', id: null });

test('声明了 domains 的扩展：无关域的变更只刷新外壳，不重绘主内容', () => {
  assert.equal(dataRenderScope({ key: 'notes' }, at('scoped')), 'chrome');
});
test('声明的域变更：整体重绘', () => {
  assert.equal(dataRenderScope({ key: 'todos' }, at('scoped')), 'all');
});
test('未声明 domains、系统页、未选中扩展、批量事件：一律整体重绘（与旧行为一致）', () => {
  assert.equal(dataRenderScope({ key: 'notes' }, at('unscoped')), 'all');
  assert.equal(dataRenderScope({ key: 'notes' }, at('sys')), 'all');
  assert.equal(dataRenderScope({ key: 'notes' }, at(null)), 'all');
  assert.equal(dataRenderScope({ key: '*' }, at('scoped')), 'all');
  assert.equal(dataRenderScope(undefined, at('scoped')), 'all');
});
