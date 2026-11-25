# 扩展页面通用模板设计（2026-11-25）

## 背景

- 核心层 `renderCenter()` 把「独立窗口打开」按钮注入到扩展的 home 与 detail 两种视图，
  但需求是「只有扩展功能的 1 级页面才有该按钮」。
- 当前实际实现的业务扩展只有「任务」(`ext-todo.js`)，其页面结构（页头 + 工具栏 + tabs + 列表）
  应作为后续所有扩展的统一模板。

## 决策

### 1. 独立窗口按钮仅出现在 1 级页面

在 `core.js` 的注入条件上叠加 `router.mode === 'home'`：

```js
if (!isFocusMode() && router.mode === 'home') { /* 注入按钮 */ }
```

系统页与独立窗口（focus）本来就不走此分支，不受影响。

### 2. 通用扩展页面模板

在 `core.js` 新增四个导出组件，所有扩展统一使用：

| 组件 | 产出 | 说明 |
|---|---|---|
| `extHomePage({title, actions, toolbar, tabs, body})` | `.page.ext-page` | 外壳，保留 `.page-header .header-actions` 供核心层注入按钮；`body` 支持数组 |
| `extToolbar(...items)` | `.ext-toolbar` | 工具栏容器 |
| `extToolButton(content, onclick, {active})` | `.ext-tbtn` | 次级操作按钮 |
| `extTabs(items, active, onChange, label)` | `.ext-tabs` / `.ext-tab` | 选项卡条 |

CSS 中把工具栏、tabs 样式提升为通用 `.ext-*` 类，旧 `.todo-*` 保留为别名兼容现有代码。

任务扩展首页改用上述组件；详情表单页仍是 `.page.narrow`（表单结构不属于列表模板），但按决策 1
不再出现独立窗口按钮。

## 验证

- `node --check` 校验 `core.js` / `ext-todo.js` 语法。
- 新增 `tests/ext-template.test.js`，以最小 DOM stub 断言模板产出的结构：
  `ext-page` 外壳、可注入按钮的 `header-actions`、工具栏、选项卡（含 active 态）、数组内容展开。
- `npm test` 全量通过（82 项）。
