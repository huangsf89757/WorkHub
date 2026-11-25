# 任务扩展固定头部设计（2026-11-25）

## 背景

设计稿用红蓝两色标注了扩展页面的两层结构：红色外框是所有扩展共用的页面模板（`.page.ext-page`，由 `core.js` 的 `extHomePage()` 产出），蓝色区域是任务扩展特有的头部，包含页头、工具栏、视图选项卡与列标题。要求：当下方任务内容过多而滚动时，蓝色头部固定在顶部，不随内容滑走。

当前实现中，中心区 `.zone-center` 是唯一滚动容器（`overflow-y: auto`），`.page-header`、`.ext-toolbar`、`.ext-tabs`、`.todo-header-row` 都是 `.page` 的直接子节点，会一起滚出视口。

## 范围

只改任务扩展（`js/ext-todo.js` 与 `style.css` 的任务区段），不动 `core.js` 的扩展通用模板。其他扩展不受影响。

## 决策

### 1. 自行组装固定头部容器

`extHomePage()` 会把 `toolbar` / `tabs` 和它自己产出的 `.page-header` 都放在 `.page` 的直接子节点上，无法整体 sticky；若在 `body` 里再放一个自制页头，则会出现两个页头。因此任务扩展 `home()` 不调用 `extHomePage()`，改为直接组装与通用模板同构的 `.page.ext-page`：复用 `pageHeader()` / `extToolbar()` / `extTabs()` 等通用组件，把页头、工具栏、选项卡、列标题装进 `.todo-sticky-head`，任务列表 `.todo-body` 作为其后续兄弟节点。

```js
const head = el('div', { class: 'todo-sticky-head' },
  pageHeader({ title: el('span', { class: 'todo-title-row' }, '任务', refreshBtn) }),
  toolbar(),
  tabs,
  groupBy === 'group' ? headerRow() : null);

const page = el('div', { class: 'page ext-page todo-page' }, head, body);
```

产出的 DOM 仍符合通用模板约定：`.page.ext-page` 内含 `.page-header`、`.ext-toolbar`、`.ext-tabs`、`.todo-body`，只是前三者被包进了 sticky 容器。核心层用后代选择器注入「独立窗口打开」按钮，包装后仍能命中。

### 2. 固定范围包含页头

用户确认：页头（「任务」标题 + 刷新按钮 + 核心层注入的「独立窗口打开」按钮）也纳入固定区，滚动时始终可见。核心层注入用后代选择器 `view.querySelector('.page-header .header-actions')`，包装后仍能命中，注入逻辑无需改动。

### 3. CSS 策略

在任务扩展样式段新增一条规则：

```css
.todo-sticky-head {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg-panel);
  display: flow-root;
}
```

- `top: 0`：滚动后整体贴紧 `.zone-center` 顶边，不留空白。
- `z-index: 10`：高于普通内容，低于拖拽手柄（30）与浮层菜单（300），不遮挡交互。
- `background: var(--bg-panel)`：与中心区同色，防止下方内容从头部后面透视。
- `display: flow-root`：形成新的块格式化上下文，避免子元素 `margin-bottom` 与容器外边距塌陷。
- 左右各 32px 的 `.page` 内边距区本来就没有内容经过，无需负 margin 铺满。

### 4. 兼容性

- `SortableJS` 的分组与任务拖拽容器是 `.todo-body`，列标题移入 sticky 容器后不影响拖拽。
- 现有测试对任务首页使用递归遍历，不依赖 `.page` 的直接子节点结构。
- `extHomePage()` 本身不变，`tests/ext-template.test.js` 的结构断言继续有效。

## 验证

- `node --check` 校验 `js/ext-todo.js` 语法。
- `npm test` 全量通过，重点确认 `tests/ext-template.test.js` 与 `tests/todo-home.test.js`。
- 手动检查：任务内容滚动时头部保持固定；分组视图下列标题与头部一起固定；浮层菜单与拖拽手柄不被头部遮挡。
