# 界面样式：3D 工作室（studio3d）

> 状态：✅ 已实现 · "UI 样式作为扩展"的示范实现
> 实现文件：`js/skin-studio3d.js` · 注册：`main.js` 顶部 import 一次

## 1. 定位

把主界面变成一间等距 3D 工作室：地面 + 两面墙 + 地毯 + 桌子 + 电脑 + 宠物 + 小人 + 书架 + 工具箱。每个"实物"是一个扩展挂载点，点击实物打开它挂载的扩展。用纯 CSS 3D + SVG 实现，零依赖、零构建、跟随主题 token。

## 2. 契约实现

```js
registerSkin({
  id: 'studio3d',
  name: '3D 工作室',
  layout: 'stage',        // 完全接管 center 舞台
  mountPoints: OBJECTS.map(...),
  configureMounts: openStudioSettings, // 扩展中心点击挂载标签时调用
  renderStage,            // 返回主舞台 DOM
  settingsPanel,          // 嵌入设置页
});
```

`layout: 'stage'` + `renderStage()`：当 `router.extId` 为空时，`core.js` 的 `renderCenter()` 调用 `renderStage(ctx)` 渲染舞台。CSS 通过 `body[data-skin-layout="stage"]` 隐藏 left/right/top-mounts，center 撑满。

## 3. 实物挂载点

| 实物 ID | 名称 | 默认挂载扩展 | 说明 |
|---|---|---|---|
| `computer` | 电脑 | `todo` | 编码与任务的主战场 |
| `desk` | 书桌 | `projects` | 项目与文档（规划中） |
| `pet` | 宠物 | `notes` | 知识伙伴（规划中） |
| `person` | 小人 | `settings` | 个人设置（系统页） |
| `shelf` | 书架 | `learning` | 学习计划（规划中） |
| `toolbox` | 工具箱 | `tool-time` | 工具集合（规划中） |

点击实物 → `router.go(extId)`：
- 已安装扩展/系统页 → 真实打开
- 规划中扩展 → 内核显示"规划中 / 优先级"友好占位
- stage 界面样式下所有子视图带统一"返回3D 工作室"条（`router.back()`）

## 4. 挂载配置

配置模型：`skinMounts['studio3d'][pointId] = extId`，存 `localStorage['wh_skinMounts']`（系统偏好，与业务数据分离）。

解析顺序（`core.js` 的 `resolveMount` / 界面样式内读取）：用户配置优先 → 回落 `defaultExt`。

**三个配置入口：**
1. 舞台工具栏「配置挂载」按钮 → 弹窗逐项下拉选择
2. 设置页 → 界面样式 → 当前界面样式专属设置面板（`settingsPanel()`）→「配置」
3. 扩展中心 → 已安装扩展的挂载标签（如「电脑 · 3D 工作室」）→ 调用 `configureMounts()` 打开同一弹窗

扩展中心的挂载点卡片也来自 `mountPoints`：6 个实物 + 各自当前挂载的扩展名，随本界面样式切换而显示。

弹窗三个动作：取消 / 重置默认（清空所有配置回落 defaultExt）/ 保存（逐项写 `setSkinMount`）。

可选目标 = 已安装扩展 + 规划扩展（带优先级）+ 系统页（扩展中心、设置）。

## 5. 舞台 DOM 结构

```
.studio-stage
  .studio-toolbar        标题 + 配置挂载 + 扩展中心
  .studio-viewport       perspective:1100px
    .studio-room         rotateX(56deg) rotateZ(-42deg)
      .studio-floor      网格地面
      .studio-wall-left / .studio-wall-right
      .studio-rug
      .studio-object ×6  实物挂载点
        .obj-shadow / .obj-body(3面) / .obj-badge(图标) / .obj-label(名称+目标)
  .studio-hint           底部提示
```

每个实物用 `el('button', ...)` 构建，`node.dataset.point = obj.id`，悬浮 `translateZ(26px)` 抬起。

## 6. 样式约束

- 地面网格线用 `linear-gradient` 绘制（功能图案，非装饰渐变）
- 不使用 `backdrop-filter` 玻璃拟态
- 阴影 blur 保留（阴影效果，非玻璃）
- 颜色走 `--accent-soft / --danger-soft` 等主题 token
- 窄屏（<760px）房间缩放 `.86`、实物缩至 56px

## 7. 依赖

- `core.js`：`registerSkin / getSkinMounts / setSkinMount / getPlannedFeatures / registry / router / icons / el / openModal / toast / bus / field`
- 无数据域（不调用 `declareDomain`，纯 UI 层）
- 切换界面样式不改任何业务数据（隔离保证）

## 8. 已知取舍

- 纯 CSS 3D 等距投影，非真实 3D 引擎；实物为几何拟物，无复杂模型
- 挂载点固定 6 个（写死在 `OBJECTS`），新增需改代码；未来可配置化
- 规划扩展的挂载点击后显示占位，待对应扩展实现后自动变真实页
