import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';

installLocalStorage();
installFakeBrowser();

/** 最小 DOM：只实现 el / extToolButton 构建按钮所需的能力，监听器类型严格校验。 */
function makeNode() {
  return {
    nodeType: 1, children: [], className: '', innerHTML: '', style: { cssText: '' }, listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) {
      assert.equal(typeof fn, 'function', `${type} 监听器必须是函数，实际为 ${typeof fn}`);
      this.listeners[type] = fn;
    },
    setAttribute() {},
    append(...items) {
      for (const item of items.flat(Infinity)) {
        if (item == null) continue;
        const child = item?.nodeType ? item : String(item);
        if (child.nodeType) child.parent = this;
        this.children.push(child);
      }
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter(child => child !== this);
      this.parent = null;
    },
    contains(target) { return target === this || (this.children || []).some(child => child?.contains?.(target)); },
    replaceChildren(...items) { this.children = items; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
}

function walkNodes(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const child of node.children || []) walkNodes(child, visit);
}

function findByClass(cls) {
  let hit = null;
  walkNodes(document.body, node => {
    if (!hit && String(node.className || '').split(/\s+/).includes(cls)) hit = node;
  });
  return hit;
}

document.createElement = makeNode;
document.createTextNode = text => ({ nodeType: 3, text });
document.body = makeNode();
document.removeEventListener = () => {};
document.querySelector = selector => selector.startsWith('.') ? findByClass(selector.slice(1)) : null;
document.querySelectorAll = () => [];
document.getElementById = () => null;
window.innerWidth = 1200;
window.innerHeight = 800;

const core = await import('../js/core.js');
const todo = await import('../js/ext-todo.js');

test('新建任务标题为空时返回必填提示', () => {
  assert.equal(todo.validateNewTask?.({ title: '   ' }), '请填写标题');
});

test('新建任务标题已填写时校验通过', () => {
  assert.equal(todo.validateNewTask?.({ title: '写周报' }), null);
});

test('新建任务标题为空时点击创建会提示并保留弹窗', () => {
  assert.equal(typeof todo.askNewTask, 'function', '新建任务弹窗入口应可调用');
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    todo.askNewTask();
    const overlay = findByClass('overlay');
    assert.ok(overlay, '应打开新建任务弹窗');
    let createBtn = null;
    walkNodes(overlay, node => {
      if (node.nodeType === 1 && node.listeners?.click && node.children?.some(c => c?.text === '创建')) {
        createBtn = node;
      }
    });
    assert.ok(createBtn, '应找到创建按钮');
    createBtn.listeners.click();
    assert.equal(findByClass('toast')?.textContent, '请填写标题');
    assert.ok(findByClass('overlay'), '校验失败时弹窗应保持打开');
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('日期统一显示为年/月/日格式', () => {
  assert.equal(todo.formatDate?.(new Date(2026, 10, 25, 9, 5).getTime()), '2026/11/25');
  assert.equal(todo.formatDate?.(null), '—');
});

test('任务列表不显示创建时间列', () => {
  const page = core.registry.get('todo').home();
  const texts = [];
  walkNodes(page, node => { if (node.nodeType === 3) texts.push(node.text); });
  assert.ok(!texts.includes('创建时间'), '列表表头与单元格不应出现创建时间');
});

test('预览页面同样不显示创建时间列', () => {
  const preview = core.registry.get('todo').preview();
  const texts = [];
  walkNodes(preview, node => { if (node.nodeType === 3) texts.push(node.text); });
  assert.ok(!texts.includes('创建时间'));
});

test('任务首页可渲染，工具栏按钮均带可用点击回调', () => {
  const page = core.registry.get('todo').home();
  const buttons = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.nodeType === 1 && String(node.className).includes('ext-tbtn')) buttons.push(node);
    (node.children || []).forEach(walk);
  };
  walk(page);
  assert.equal(buttons.length, 2, '工具栏应有两个次级按钮');
  for (const button of buttons) {
    assert.equal(typeof button.listeners.click, 'function');
  }
});
