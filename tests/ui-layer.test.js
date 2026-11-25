import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

/** 读取简单类选择器的首个 z-index 声明（本项目浮层均为单类选择器）。 */
function zIndexOf(className) {
  const rule = new RegExp(`\\.${className}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css);
  assert.ok(rule, `.${className} 缺少 z-index 声明`);
  return Number(rule[1]);
}

test('弹窗内浮层菜单必须高于遮罩，否则点击被遮罩拦截', () => {
  const menuZ = zIndexOf('pop-menu');
  const overlayZ = zIndexOf('overlay');
  assert.ok(menuZ > overlayZ,
    `.pop-menu(${menuZ}) 必须高于 .overlay(${overlayZ})`);
});
