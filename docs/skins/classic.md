# 界面样式：经典分栏（classic）

> 状态：✅ 已实现 · 默认 baseline 界面样式
> 实现文件：`js/skin-classic.js` · 注册：`main.js` 顶部 import 一次

## 1. 定位

WorkHub 的默认 UI 样式。以信息密度优先的五区布局作为主界面，不接管 center 舞台。作为界面样式注册表里的一个选项，让"UI 样式"与业务扩展一样可枚举、可切换。

## 2. 契约实现

```js
registerSkin({
  id: 'classic',
  name: '经典分栏',
  icon: icons.dashboard,
  desc: '...',
  layout: 'panels',
  mountPoints: [ /* left / top / center / right / bottom，见下表 */ ],
  // 无 renderStage：走内核默认五区渲染
});
```

关键点：`layout: 'panels'` 且不提供 `renderStage`，因此 `core.js` 的 `renderCenter()` 不把舞台交给界面样式，而是走默认渲染路径（系统页 / 扩展 `home()`/`detail()` / 空壳欢迎页）。

## 3. 五区布局

```
┌──────────────────────────────────────────────┐
│  top     主菜单 · 一级入口（横向扩展快捷入口）      │
├──────────┬───────────────────────┬────────────┤
│  left    │      center           │   right    │
│ 主菜单    │   主内容区             │  功能面板    │
│ 一级入口  │   home / detail       │  panel(ctx) │
├──────────┴───────────────────────┴────────────┤
│  bottom  功能状态条  status(ctx)                │
└──────────────────────────────────────────────┘
```

| 区 | 角色 | 数据来源 |
|---|---|---|
| `top` | nav | placement.zone=top 的扩展 |
| `left` | nav | placement.zone=left 的扩展 + 自定义分组 |
| `center` | content | 当前扩展 `home()` / `detail()` / 系统页 |
| `right` | panel | 当前扩展 `panel(ctx)`，无则隐藏 |
| `bottom` | panel | 当前扩展 `status(ctx)`，缺省用内核状态 |

窄屏（<900px）自动隐藏 right，<760px 时 left 变抽屉（通过 `navToggle` + backdrop 唤出）。

## 4. 主题

经典分栏支持 4 套主题 token，由 `body[data-theme]` 驱动：

| 主题 ID | 名称 | 基调 |
|---|---|---|
| `dark` | 深色 | VS Code 暗色系（默认） |
| `light` | 浅色 | 白底蓝强调 |
| `terminal` | 终端 | 黑底荧光绿等宽 |
| `oled` | OLED | 纯黑省电 |

切换入口：右上角用户面板 → 主题；或设置页 → 外观 · 主题。偏好存 `localStorage['wh_theme']`。

## 5. 样式约束

- 无玻璃拟态（不使用 `backdrop-filter`）
- 等宽字体只用于 code/data（`.mono`、时间戳、数字）
- 数字用 `font-variant-numeric: tabular-nums`
- 所有颜色走主题 token，不硬编码

## 6. 依赖与配置

- 依赖 `core.js` 五区渲染（`renderLeft/Top/Center/Right/Bottom`）+ `applySkinLayout()`
- 无专属 `settingsPanel()`（设置页界面样式卡只做切换）
- 显式声明 5 个 `mountPoints`（上表五区），供扩展中心展示；扩展挂载位置用 `placementOf()` 解析，点击标签走 `placementPicker()`
- 扩展中心中 TODO 显示为「左侧 · 主菜单」；切到其他界面样式后该文案会随界面样式变化

## 7. 切换行为

从其他界面样式切回 classic：
1. `setActiveSkin('classic')` 写 `wh_skin='classic'`，发 `skin` 与 `route` 事件
2. `applySkinLayout()` 设 `data-skin=classic`、`data-skin-layout=panels`
3. CSS 恢复五区显隐；`boot()` 下次启动进入第一个导航扩展（非舞台态）
