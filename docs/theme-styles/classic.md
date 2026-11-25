# 主题风格：经典分栏（classic）

> 状态：✅ 已实现 · 默认 baseline 主题风格
> 实现文件：`js/theme-style-classic.js` · 注册：`main.js` 顶部 import 一次

## 1. 定位

WorkHub 的默认 UI 样式。以信息密度优先的五区布局作为主界面，不接管 center 舞台。作为主题风格注册表里的一个选项，让"UI 样式"与业务扩展一样可枚举、可切换。

## 2. 契约实现

```js
registerThemeStyle({
  id: 'classic',
  name: '经典分栏',
  icon: icons.dashboard,
  desc: '...',
  layout: 'panels',
  mountPoints: [ /* left / top / right / bottom，见下表 */ ],
  // 无 renderStage：走内核默认五区渲染
});
```

关键点：`layout: 'panels'` 且不提供 `renderStage`，因此 `core.js` 的 `renderCenter()` 不把舞台交给主题风格，而是走默认渲染路径（系统页 / 扩展 `home()`/`detail()` / 空壳欢迎页）。

## 3. 五区布局

```
┌──────────────────────────────────────────────┐
│  top     左/中/右挂载区（brand 与用户入口固定）     │
├──────────┬───────────────────────┬────────────┤
│  left    │      center           │   right    │
│ 上/中/下  │   主内容区             │  上/中/下   │
│ 挂载区    │   home / detail       │  挂载区     │
├──────────┴───────────────────────┴────────────┤
│  bottom  左/中/右挂载区                          │
└──────────────────────────────────────────────┘
```

| 区 | 角色 | 数据来源 |
|---|---|---|
| `top` | nav | `themeStyleMounts[classic]['top:left\|mid\|right']` |
| `left` | nav | `themeStyleMounts[classic]['left:top\|mid\|bottom']` |
| `center` | content | 当前扩展 `home()` / `detail()` / 系统页 |
| `right` | panel | `themeStyleMounts[classic]['right:top\|mid\|bottom']`，无入口则隐藏 |
| `bottom` | panel | `themeStyleMounts[classic]['bottom:left\|mid\|right']` |

窄屏（<900px）自动隐藏 right，<760px 时 left 变抽屉（通过 `navToggle` + backdrop 唤出）。

## 4. 主题色

经典分栏支持 4 套主题色 token，由 `body[data-theme-color]` 驱动：

| 主题色 ID | 名称 | 基调 |
|---|---|---|
| `dark` | 深色 | VS Code 暗色系（默认） |
| `light` | 浅色 | 白底蓝强调 |
| `terminal` | 终端 | 黑底荧光绿等宽 |
| `oled` | OLED | 纯黑省电 |

切换入口：右上角用户面板 → 主题色；或设置页 → 外观 · 主题色。偏好存 `localStorage['wh_sys_settings_themeColor']`（`wh_themeColor` 等旧键启动时自动迁移）。

## 5. 样式约束

- 无玻璃拟态（不使用 `backdrop-filter`）
- 等宽字体只用于 code/data（`.mono`、时间戳、数字）
- 数字用 `font-variant-numeric: tabular-nums`
- 所有颜色走主题色 token，不硬编码

## 6. 依赖与配置

- 依赖 `core.js` 五区渲染（`renderLeft/Top/Center/Right/Bottom`）+ `applyThemeStyleLayout()`
- 无专属 `settingsPanel()`（设置页主题风格卡只做切换）
- 声明 4 个 `mountPoints`（`left` / `top` / `right` / `bottom`；`center` 是内容区不作挂载点）及三段 `slots`，供扩展中心展示；扩展挂载位置用 `resolveSlotMount()` 解析
- `slotDefaults: { 'left:top': 'ext-center' }` 在用户未配置该槽位时兜底，保证空配置也能进入扩展中心
- 扩展中心中 任务显示为「左侧栏 · 上部」这类槽位文案；切到其他主题风格后该文案会随主题风格变化

## 7. 切换行为

从其他主题风格切回 classic：
1. `setActiveThemeStyle('classic')` 写偏好 `themeStyle='classic'`（物理键 `wh_sys_settings_themeStyle`），发 `themeStyle` 与 `route` 事件
2. `applyThemeStyleLayout()` 设 `data-theme-style=classic`、`data-theme-style-layout=panels`
3. CSS 恢复五区显隐；`boot()` 下次启动进入第一个已挂载且启用的扩展（非舞台态）
