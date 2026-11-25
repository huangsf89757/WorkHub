# TODO 分组模型清理：取消虚拟默认组 + 表头行

> 日期：2026-11-25 · 状态：设计已确认，待实现
> 目标：取消"虚拟默认/未分组"概念，所有分组都是真实可拖动记录；新增任务自动建组；删除分组连带删待办；列表加表头行。

## 1. 背景

截图暴露两个问题：
- "默认"分组行左侧缺拖动手柄、比其他分组缩进约 15px（间距不对），且无 `⋯` 菜单、不能拖——因为它是 `sections()` 里 unshift 出来的**虚拟分组**（`groupId:''`），不是真实记录。
- 列表缺列标题，时间列（开始/截止/创建）难以辨认。

用户决策：取消虚拟默认组；无分组时新建任务自动创建真实"默认"分组；删除分组连带删除组内待办（二次确认）；加表头行。

## 2. 模型变更

### 2.1 取消虚拟默认组
- `sections('group')` 去掉 `list.unshift({id:'ungrouped', name:'默认', groupId:''})`，只返回真实 `todoGroups`（按 sort 升序）。
- 初始状态：0 个分组、0 条待办。

### 2.2 新建任务自动建"默认"组
- 纯函数 `ensureGroupForNewTask(groups)`：若无真实分组返回 `null`（表示需建组）；否则返回已选/第一个组 id。
- `addTodo()` 在 `groupId` 无效（空或不存在）且无分组时：先 `insert('todoGroups', {name:'默认', sort:0, created:now})`，任务归属该新组。
- 新建弹窗/详情弹窗的分组下拉移除 `<option value="">默认</option>`；无分组时下拉禁用或隐藏，由 addTodo 自动建组。

### 2.3 删除分组连带删待办
- `deleteGroup(id, name)`：二次确认弹窗提示"将同时删除组内 N 条待办，不可撤销"；确认后 `remove('todos', t.id)` 遍历组内待办，再 `remove('todoGroups', id)`。
- 纯函数 `todoIdsInGroup(todos, groupId)` 供测试。

## 3. 默认组支持拖动

- 变成真实分组后，`sectionNode` 的 `isReal` 判断对所有分组为 true，自然获得左侧手柄与 SortableJS handle。
- `sortOrdersFromDomIds()` 简化：不再过滤 `__default__`，所有 DOM 分组 id 从 0 连续编号。
- 间距修复：手柄列宽统一（18px），分组标题行手柄占位与任务行手柄对齐。

## 4. 表头行

- 在 tabs 与 `.todo-body` 之间插入 `.todo-header-row`，用与 `gridStyle()` 相同的 `grid-template-columns`。
- 列：手柄/复选框/优先级列留空；标题列显示"标题"；`visibleCols()` 的时间列显示各自 label（开始时间/截止时间/创建时间）；删除列留空。
- 窄屏跟随 `visibleCols()` 只保留截止列。
- 仅在 `groupBy === 'group'` 时显示（其他视图无列语义）。

## 5. 同步与数据

- 自动创建的"默认"分组是普通 `todoGroups` 记录，走 LWW 同步（与手动建的分组一致）。
- 连带删除的待办走软删除墓碑，跨端同步删除语义不变。

## 6. 测试（TDD）

- `ensureGroupForNewTask()`：无组返回 null；有组返回选定/第一个。
- `todoIdsInGroup()`：正确筛选组内待办 id。
- `sortOrdersFromDomIds()`：更新为所有 id 连续编号（去掉 __default__ 过滤）。
- 端到端：Playwright 验证自动建组、默认组可拖、删除连带、表头对齐。

## 7. 影响

- 文档 `docs/extensions/todo.md`：更新默认组/删除语义。
- 已知取舍：无分组时新建任务首次会额外写一条分组记录（可接受）。
