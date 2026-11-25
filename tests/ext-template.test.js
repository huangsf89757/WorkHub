import { installLocalStorage, installFakeBrowser } from './helpers.js';

class FakeNode {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.className = '';
    this.attrs = {};
    this.listeners = {};
    this.classList = {
      add: c => { this.className = (this.className + ' ' + c).trim(); },
      contains: c => this.className.split(/\s+/).includes(c),
    };
  }
  append(child) { this.children.push(child); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
}

installLocalStorage();
installFakeBrowser();
globalThis.document = {
  createElement: tag => new FakeNode(tag),
  createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
  getElementById: () => null,
  body: new FakeNode('body'),
  addEventListener() {},
};

const core = await import('../js/core.js');
const cls = n => (n.className || '').split(/\s+/);
const byClass = (n, name) => (n.children || []).find(c => c.nodeType === 1 && cls(c).includes(name));

const page = core.extHomePage({
  title: '任务',
  toolbar: core.extToolbar(core.extToolButton('排序', () => {})),
  tabs: core.extTabs([['all', '全部'], ['done', '已完成']], 'all', () => {}),
  body: [new FakeNode('div'), new FakeNode('div')],
});

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
assert(cls(page).includes('ext-page'), '主页外壳缺少 ext-page 类');
const header = byClass(page, 'page-header');
assert(header, '缺少通用页头');
assert(byClass(header, 'header-actions'), '缺少可供注入按钮的 header-actions');
assert(byClass(page, 'ext-toolbar'), '缺少通用工具栏');
const tabs = byClass(page, 'ext-tabs');
assert(tabs, '缺少通用选项卡');
assert(tabs.children.length === 2, '选项卡数量错误');
assert(cls(tabs.children[0]).includes('active'), '首个选项卡未激活');
assert(page.children.filter(c => c.nodeType === 1 && !c.className).length === 2, '内容体未正确展开为两个节点');

console.log('扩展模板结构断言全部通过');
