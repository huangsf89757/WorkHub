import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';

installLocalStorage();
installFakeBrowser();

/** 最小 DOM：只实现 el / extToolButton 构建按钮所需的能力，监听器类型严格校验。 */
function makeNode(tag = '') {
  return {
    nodeType: 1, tagName: String(tag).toUpperCase(), children: [], className: '', innerHTML: '',
    style: { cssText: '' }, listeners: {}, attrs: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) {
      assert.equal(typeof fn, 'function', `${type} 监听器必须是函数，实际为 ${typeof fn}`);
      this.listeners[type] = fn;
    },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return key in this.attrs ? this.attrs[key] : null; },
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
const { state } = await import('../js/data.js');

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

test('任务首页头部收进 sticky 容器，列表作为后续兄弟节点', () => {
  const page = core.registry.get('todo').home();
  const hasClass = (node, cls) => node.nodeType === 1 && String(node.className || '').split(/\s+/).includes(cls);
  const head = page.children.find(node => hasClass(node, 'todo-sticky-head'));
  assert.ok(head, '应存在 .todo-sticky-head 固定头部容器');
  assert.equal(page.children[0], head, '固定头部应为页面首个子节点');
  for (const cls of ['page-header', 'ext-toolbar', 'ext-tabs']) {
    assert.ok(head.children.some(node => hasClass(node, cls)), `固定头部应包含 .${cls}`);
  }
  assert.ok(page.children.some(node => hasClass(node, 'todo-body')), '.todo-body 应为页面直接子节点');
  assert.ok(!head.children.some(node => hasClass(node, 'todo-body')), '.todo-body 不应被收进固定头部');
});

test('自定义分组标题行提供快捷新建入口，点击打开预选该组的任务弹窗', () => {
  const prevGroups = state.todoGroups;
  state.todoGroups = [{ id: 'g-quick', name: '微蒙', sort: 0, created: 1, meta: {} }];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    document.body.children = [];
    const page = core.registry.get('todo').home();
    let quickBtn = null;
    walkNodes(page, node => {
      if (!quickBtn && node.nodeType === 1 &&
          String(node.className || '').split(/\s+/).includes('todo-group-quick-add')) quickBtn = node;
    });
    assert.ok(quickBtn, '真实自定义分组标题行应含 .todo-group-quick-add 快捷新建入口');
    assert.equal(typeof quickBtn.listeners.click, 'function', '快捷入口应绑定点击回调');
    assert.equal(quickBtn.getAttribute('aria-label'), '在分组「微蒙」中新建任务');

    quickBtn.listeners.click();
    const overlay = findByClass('overlay');
    assert.ok(overlay, '点击快捷入口应打开新建任务弹窗');
    let selectedOption = null;
    walkNodes(overlay, node => {
      if (node.nodeType === 1 && node.tagName === 'OPTION' && node.getAttribute('selected') === '') selectedOption = node;
    });
    assert.ok(selectedOption, '弹窗分组下拉应有一个预选选项');
    assert.equal(selectedOption.getAttribute('value'), 'g-quick', '预选分组应为被点击的分组');
  } finally {
    globalThis.setTimeout = realSetTimeout;
    state.todoGroups = prevGroups;
    document.body.children = [];
  }
});
