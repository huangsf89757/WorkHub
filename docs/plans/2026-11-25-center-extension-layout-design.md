# 中间分栏扩展详情与独立窗口设计

> 日期：2026-11-25 · 状态：设计已确认，待实现
> 目标：① center 独占扩展详情；② 上下左右侧边栏只挂扩展入口，不出现详情内容；③ 所有扩展功能支持浏览器独立窗口打开。

## 1. 背景与现状

- 五区布局中 `left`/`top` 已是纯入口（`renderLeft`/`renderTop` 生成 launcher），`right` 承载 任务的 `panel()` 统计，`bottom` 承载 `status()` 计数与 `setDefaultStatus()`。
- center 同时承担扩展主页/单条详情（业务视图）与系统页（扩展中心、设置、扩展详情）。
- `router` 为纯内存态（`extId`/`mode`/`id`），无 URL 映射；全仓无 `window.open`，仅有应用内 `openModal`。
- 因此 任务把统计放 right 属于"扩展详情内容入侵侧边栏"，需纠正；独立窗口能力需新建。

## 2. 总体方案（已确认：方案 A）

URL(hash) 路由 + 统计聚合进 center + 四边侧栏只放入口 + 扩展详情标题栏独立窗口按钮。
现有 `router.go/open/home/back` 调用点保持兼容，改动集中在内核与 任务扩展。

## 3. URL 路由层（`js/core.js`）

- hash 格式：
  - `#/ext/<extId>` 扩展主页
  - `#/ext/<extId>/detail/<id>` 单条详情
  - `#/sys/<pageId>` 系统页（如 `#/sys/settings`）
  - `#/sys/<pageId>/<id>` 带参系统页（如 `#/sys/ext-detail/todo`）
- 写入：在 `go/open/home/back` 内用 `history.replaceState` 同步 hash，不新增历史记录；`replaceState` 不触发 `hashchange`，避免循环。
- 读取：`boot()` 启动先解析初始 hash（校验扩展存在且启用、系统页存在），非法值回落到现有默认逻辑（stage 舞台或首个导航扩展）；监听 `hashchange` 处理外部直达与用户手改 URL，解析后更新内存态并 `bus.emit('route')`。
- 解析器抽成纯函数便于单测：`parseRoute(hash) → { extId, mode, id } | null`、`buildRoute(route) → hash`。

## 4. 五区职责收敛与统计聚合

- `ZONES` 中 `right`/`bottom` 的 `role` 由 `panel` 改为 `entry`（入口）；`js/theme-style-classic.js` 的挂载点描述同步。
- `renderRight()/renderBottom()` 不再调用 `ext.panel()/ext.status()`，改为渲染挂载到该区的扩展**入口按钮**（点击 `router.go(extId)` 进 center），来源仍是 `mounts` + `themeStyleMounts`。任务只挂 `left`，故 right 默认隐藏；bottom 只保留系统级状态（平台标签 + 快捷键），`setDefaultStatus` 里的 任务计数移走。
- 任务删除 `panel()/status()`，把"待完成/已完成/已逾期/完成率 + 分组分布"做成 center 主页顶部统计卡片；"N 待办未完成 · M 逾期"作为卡片摘要；移除原"N 待完成"右栏开关按钮。
- `docs/architecture.md` 契约表、`js/page-ext-detail.js` 钩子表、`docs/extensions/todo.md` 同步更新。

结果：center 是唯一的扩展详情承载区，四边只留入口。

## 5. 独立窗口

- 内核新增 `openExtensionWindow(extId)`：以 `window.open(buildRouteURL({ extId, mode: 'home' }), '_blank')` 打开浏览器新窗口，URL 形如 `index.html#/ext/todo`；弹窗被拦截时 `toast` 提示。该函数导出给所有扩展复用。
- `renderCenter()` 在扩展视图（home/detail）外层统一注入轻量工具条，含"独立窗口打开"按钮；扩展自身无需改动即可获得该能力。扩展中心行也可调用同一 API 加按钮。
- 新窗口凭 hash 直达扩展主页；窗口内 `router.open()` 切单条详情、Esc 返回等逻辑照常，各窗口独立运行。数据以共享存储为准，跨窗口实时同步不在本期范围。

## 6. 验证与文档

- `tests/route.test.js` 单测覆盖 `parseRoute/buildRoute`：home、detail、系统页、非法值回落。测试沿用 `tests/helpers.js` 注入 fake browser 后导入 `core.js` 的方式。
- 手工验证清单：center 有独立窗口按钮、四边无详情内容、右栏统计与底栏计数已并入 center、新窗口直达扩展主页。
- 文档更新：`docs/architecture.md` 增路由与独立窗口章节、改五区职责表；`docs/extensions/todo.md` 去右栏描述；`FEATURES.md`/`README.md` 同步。

## 7. 边界与不做的事

- 不做应用内多标签页、浮层大窗、原生桌面窗口。
- 不做跨窗口数据实时同步（各窗口共享本地存储，刷新后各自读取最新状态）。
- 不改扩展注册契约中 `home/detail/badge` 的既有签名。
