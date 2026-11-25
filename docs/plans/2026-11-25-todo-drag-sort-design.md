# TODO 分组改名与拖动排序设计

> 日期：2026-11-25 · 状态：设计已确认，待实现
> 目标：① "未分组"改名为"默认"（仅显示文案）；② 分组可拖动排序；③ 任务可跨分组拖动。

## 1. 改名（零数据迁移）

把以下 6 处显示文案"未分组"→"默认"，底层 `groupId=''` 不变：
- `sections()` 虚拟分组标题（id='ungrouped'）
- 新建任务弹窗下拉 option
- 待办详情弹窗下拉 option
- 右栏统计"分组分布"行
- 删除分组确认提示 / toast 文案

## 2. 技术方案：HTML5 原生 Drag & Drop（桌面优先）

选型理由：零依赖、实现快；移动端壳（Sprint 7）尚未开始，届时再升级 Pointer Events/SortableJS。

## 3. 分组拖动排序

- 可拖对象：仅真实自定义分组（`sec.groupId` 存在）。"默认"（虚拟分组）**置顶固定、不参与拖动**。
- 拖动手柄：分组标题行 `.todo-group-head-row`，`draggable=true`。
- 放置判定：`dragover` 在目标分组上/下方显示插入指示；`drop` 后对自定义分组按新顺序重排，把 `sort` 重置为 0..n-1，逐个 `update('todoGroups', id, {sort})`（走 LWW 写路径，自动同步）。
- `groupBy !== 'group'` 时不启用拖动（虚拟分区无拖动语义）。
- 拖动中不重绘，`drop` 后才 `bus.emit('route')`。

## 4. 任务跨分组拖动

- 可拖对象：任务行 `.todo-row`，`draggable=true`。
- 放置目标：任意分组的 body（含"默认"分组）。
- `drop` 后 `update('todos', id, {groupId: 目标组 id 或 ''})`，走 LWW 同步。
- 避免误触：任务行内的复选框/删除按钮等交互元素上不启动拖动（dragstart 判断 target）。
- 同样仅 `groupBy === 'group'` 时启用。

## 5. 边界与取舍

- 只在自定义分组之间排序，默认组固定第一。
- 折叠状态（collapsed Set）不受拖动影响。
- HTML5 DnD 移动端不可用，属已知限制，待移动壳阶段升级。
- 排序持久化用分组已有 `sort` 字段（记录字段，随 LWW 同步），不新增列、不改云端表。

## 6. 测试

- 纯函数部分（重排后 sort 分配）抽成可测函数，TDD 覆盖：顺序正确、sort 连续、默认组不参与。
- 端到端：浏览器 DnD 验证桌面拖动（Playwright drag/drop）。
