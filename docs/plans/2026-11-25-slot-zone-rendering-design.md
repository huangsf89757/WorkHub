# 四区槽位渲染改造设计

日期：2026-11-25  
状态：已确认，待实现

## 1. 背景与问题

主题风格详情页的「挂载点配置」已经声明了四区槽位：左右栏按 `上/中/下`，顶底栏按 `左/中/右`，配置写入 `themeStyleMounts[styleId][zone:slot]`。但运行端只有右/底入口区的 `entryExts()` 读这份数据；左侧栏与顶栏仍走旧的 `menuLayout.placement` 扁平导航体系。结果是配置页显示「左侧栏·上部 1 / 中部 1」，主界面却只出现一枚「任务」入口——它实际来自 todo 的默认 `left/main` 位置，与槽位配置无关。

## 2. 目标与决策

目标：让运行端四区完全按挂载点配置渲染，两套数据体系统一。

已确认决策：

1. **范围**：全部四区。左/右栏上中下，顶/底栏左中右。
2. **数据策略**：完全替换。丢弃 `menuLayout.placement` 与分组树，只认 `themeStyleMounts` 槽位配置；现有编排需重新配置。
3. **顶栏**：左侧 brand/菜单按钮、右侧页面操作/刷新/用户为固定模块，不参与挂载；在现有 `.top-mounts` 内拆左中右三槽。
4. **底栏**：清空现有 `bottom-label` / `bottom-hint` 及其更新逻辑，改为左中右三槽；尺寸拖拽手柄保留。
5. **空配置兜底**：`classic` 增加 `slotDefaults`（`left:top → ext-center`），仅在用户未配置该槽位时生效，保证首启可进入扩展中心。

## 3. 架构与数据流

唯一取数路径：

```
slotPointId(zone, slot)
  → themeStyleMounts[themeStyleId][pointId]
  → extEnabled(id) && mountEnabledOf(styleId, pointId)
  → 入口按钮（router.go(id)）
```

改动要点：

- 新增 `resolveSlotMount(zone, slot)`：用户配置优先，回落 `slotDefaults`，再回落空。
- 四个渲染函数统一遍历 `ZONE_SLOTS`；删除 `navExts()`、`placementOf()`、`placementPicker()` 及 `menuLayout` 读写。
- `entryExts()`、`shortcutExtCandidates()`、`mountLabelOfExt()` 改为槽位取数。
- `getConfigSnapshot()` / `applyConfigSnapshot()` 移除 `menuLayout` 字段。
- 配置页移除分组树 UI 与 `dMenu()` / `dPlacementOf()`，保留 `themeStyleMounts` / `mountEnabled` 草稿编辑。
- 同一扩展可挂多个槽位，各槽位启停独立（沿用 `mountEnabledOf(styleId, slotId)`）。

## 4. DOM 与样式

- `#zoneLeft`、`#zoneRightBody`：三段 `.zone-slot`，`data-slot=top|mid|bottom`；中段 `flex:1`，空槽位保留结构。
- `#zoneTopMounts`：三段 `.top-slot`，`data-slot=left|mid|right`；外围固定模块不动。
- `#zoneBottom`：移除 `bottom-label` / `bottom-hint`，三段 `.bottom-slot`，`data-slot=left|mid|right`。
- 入口按钮复用 `.nav-item` / `.top-item` / `.entry-item` 样式。
- 系统页、独立窗口、窄屏抽屉的现有隐藏规则保持不变。

## 5. 测试

- 单元测试：槽位 key 生成；挂载解析优先级（用户配置 > `slotDefaults` > 空）；启用/停用过滤；同一扩展多槽位互不干扰。
- 手工回归：左栏上中下各挂一项均渲染；顶栏三槽可用且固定模块不变；底栏三槽、原提示文字消失；系统页与独立窗口布局不受影响。

## 6. 不做的事

- 不保留 `menuLayout` 兼容层或迁移逻辑。
- 不引入文件夹/分组作为槽位子项。
- 不改中心区（center）的挂载语义。
- 不改 stage 主题风格的实物挂载机制。
