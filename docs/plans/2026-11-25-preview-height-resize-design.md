# 扩展预览框高度可拖拽调整 — 设计

- 日期：2026-11-25
- 状态：已确认
- 范围：扩展详情页「预览」Tab 中的任务预览框（`.ed-ui-preview`）

## 背景

扩展详情页「预览」Tab 中，`.ed-ui-preview` 承载可交互的任务预览面板。当前样式仅通过 `max-height: 460px; overflow: auto` 限制高度上限，用户无法调整预览框高度。用户希望如截图箭头所示，在框的右下角通过鼠标拖动改变高度。

## 目标

- 仅允许垂直方向拖动调整高度，宽度保持跟随容器。
- 改动最小，与项目现有 `resize: vertical` 用法一致（如 `.textarea`、`.setg-source-editor`）。

## 方案

采用 CSS 原生 `resize: vertical`，修改 `style.css` 中 `.ed-ui-preview` 规则：

```css
.ed-ui-preview {
  height: 460px; min-height: 200px; max-height: 80vh;
  overflow: auto; resize: vertical;
  border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--bg);
}
```

## 决策说明

- `resize: vertical`：浏览器在元素右下角渲染原生拖拽手柄，上下拖动修改高度；`overflow: auto` 是其生效前提，同时保留内容滚动条。
- `height: 460px`：固定初始高度，与现状观感一致，避免内容不足时高度塌陷、resize 起点不稳定。
- `min-height: 200px`：防止拖得过小导致内容不可读。
- `max-height: 80vh`：放宽原 460px 上限，允许用户拖大，同时不超出视口。
- 宽度不变：`.ed-ui-preview` 为块级元素，仍占满 `.sd-pad` 内容宽度。

## 验证

1. 打开扩展详情页 →「预览」Tab，确认预览框右下角出现拖拽手柄。
2. 上下拖动，确认高度随之变化、宽度不变。
3. 确认高度被限制在 200px ~ 80vh 之间。
4. 确认内容超出时滚动条正常。

## 排除方案

- 自定义手柄 + JS（Pointer Events + localStorage）：样式可定制、可持久化，但需改 JS+CSS 约 40–60 行，且要避开 Sortable 拖拽事件，超出当前需求。
- 封装通用缩放工具：目前仅一处使用，属过度设计。
