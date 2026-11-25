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

## 2. 技术方案：SortableJS（vendor 本地单文件）

原 HTML5 原生 DnD 实现存在多个 bug（拖动手感/落点判定/误触），已弃用。改用 SortableJS 1.15.6（MIT，44KB，放 `vendor/sortablejs/Sortable.min.js`，UMD 全局引入）。理由：成熟稳定、原生支持拖动手柄（handle）与跨组拖动（group），bug 少；守住零构建（本地文件、不联网）。代价：引入一个第三方库文件。

### 拖动手柄（用户要求）

任务行与自定义分组标题行最左侧新增六点手柄图标，**hover 才显示**，按住手柄才能拖——避免误触复选框/标题/删除按钮。SortableJS 通过 `handle` 选项限定只有手柄可发起拖动。

## 3. 分组拖动排序

- 可拖对象：仅真实自定义分组（`data-group-id` 存在且非 `__default__`）。"默认"（虚拟分组）**置顶固定、不参与拖动**。
- 拖动手柄：自定义分组标题行最左侧六点图标（`.todo-group-drag-handle`），hover 显示；SortableJS `handle` 选项限定。
- 放置：SortableJS `onEnd` 读 DOM 新顺序，`sortOrdersFromDomIds()` 过滤默认组后从 0 连续编号，逐个 `update('todoGroups', id, {sort})`（走 LWW 写路径，自动同步）。
- `groupBy !== 'group'` 时不初始化 SortableJS（虚拟分区无拖动语义）。
- 重绘前 `destroy()` 旧实例，避免重复绑定。

## 4. 任务跨分组拖动

- 可拖对象：任务行 `.todo-row` 左侧手柄（`.todo-drag-handle`），hover 显示。
- 放置目标：任意分组的 body（含"默认"分组，其 `data-group-id=''`）。
- SortableJS `group: 'workhub-todos'` 让各分组 body 互通；`onEnd` 读 `evt.to.dataset.groupId`，`update('todos', id, {groupId})`，走 LWW 同步。
- `handle` 限定只有手柄能发起拖动，彻底避免误触复选框/标题/删除按钮。
- 同样仅 `groupBy === 'group'` 时启用。

## 5. 边界与取舍

- 只在自定义分组之间排序，默认组固定第一。
- 折叠状态（collapsed Set）不受拖动影响。
- HTML5 DnD 移动端不可用，属已知限制，待移动壳阶段升级。
- 排序持久化用分组已有 `sort` 字段（记录字段，随 LWW 同步），不新增列、不改云端表。

## 6. 测试

- 纯函数部分（重排后 sort 分配）抽成可测函数，TDD 覆盖：顺序正确、sort 连续、默认组不参与。
- 端到端：浏览器 DnD 验证桌面拖动（Playwright drag/drop）。
