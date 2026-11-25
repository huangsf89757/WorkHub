# WorkHub 架构设计 v2

> ADR-003 · 本轮架构优化产物 · 2026-11-23
> 状态：已接受 · 替代 v1 的三区 + 占位扩展模型
> 修订：2026-11-23 增补"主题风格（ThemeStyle）"第二扩展维度（ADR-004）

## 1. 本轮变更摘要

| 项 | v1（旧） | v2（本轮） |
|---|---|---|
| 功能扩展 | 10 个占位扩展 | **全部移除**，内核保持干净；清单沉淀到 FEATURES.md |
| 布局分区 | sidebar / titlebar / inspector / statusbar（语义混杂） | **五区模型**：top / left / center / right / bottom |
| 数据记录 | 普通对象 | **每条带同步元数据 meta** |
| 存储 | core 直连 localStorage + db.js | **storage 适配器抽象** + LocalAdapter |
| 同步 | 无 | **sync 引擎**（outbox 落库 / HLC 时间戳 / LWW / 墓碑清理 / pull 合并）+ 已落地的 Supabase CloudAdapter（无配置时 no-op） |
| 平台 | 浏览器单一 | **platform 适配层**：Web/PWA/Electron/Tauri/Capacitor |
| 系统页面 | 混在 ext-*.js | pages.js 独立，属于内核 |
| **主题风格** | 单一分栏 + 主题色切换 | **主题风格（ThemeStyle）第二扩展维度**：分栏为默认主题风格，3D 工作室等样式以扩展实现，实物挂载扩展 |

## 2. 目标与约束

**目标**：一套零构建代码，跑在 mac / Windows / iPhone / iPad / Android，本地优先、可离线，联网后多端同步。

**约束**：
1. 零构建、原生 ES Modules（浏览器直接跑）
2. 本地优先（local-first）：离线可用，网络是增强项而非依赖
3. 单人为主；组织/协作模型暂不预设（家庭模型已撤销，待通用组织结构设计）
4. 视图层不碰存储；扩展只通过契约接入

## 3. 五区布局模型

```
┌──────────────────────────────────────────────┐
│  top     左/中/右挂载区（brand 与用户入口固定）     │
├──────────┬───────────────────────┬────────────┤
│          │                       │            │
│  left    │      center           │   right    │
│ 上/中/下  │   主内容区             │  上/中/下   │
│ 挂载区    │   home / detail       │  挂载区     │
│          │   统计卡片             │            │
├──────────┴───────────────────────┴────────────┤
│  bottom  左/中/右挂载区                          │
└──────────────────────────────────────────────┘
```

| 区 | 角色 | 用途 | 数据来源 |
|---|---|---|---|
| `top` | nav | 左/中/右三段挂载区 | `themeStyleMounts[styleId]['top:left|mid|right']` |
| `left` | nav | 上/中/下三段挂载区 | `themeStyleMounts[styleId]['left:top|mid|bottom']` |
| `center` | content | 唯一的扩展详情承载区 | 当前扩展 `home(ctx)` / `detail(id,ctx)` + 扩展自带统计 |
| `right` | entry | 上/中/下三段挂载区（可折叠） | `themeStyleMounts[styleId]['right:top|mid|bottom']` |
| `bottom` | entry | 左/中/右三段挂载区 | `themeStyleMounts[styleId]['bottom:left|mid|right']` |

**设计意图**：center 独占扩展详情；四边侧栏只挂扩展入口（launcher），不渲染详情内容。窄屏（<900px）自动隐藏 right，<760px 时 left 变抽屉。

## 3.5 主题风格（ThemeStyle）——第二扩展维度

> ADR-004 · UI 样式本身也是扩展，与业务功能扩展正交。

**动机**：五区布局是"信息密度优先"的默认样式，但某些场景需要完全不同的界面隐喻（如 3D 爱好者想要一间工作室，把功能挂到场景实物上）。与其在内核里写一堆 `if (style === '3d')`，不如把"主舞台怎么渲染"抽象成第二个扩展点。

**主题风格契约**（`registerThemeStyle`，与业务 `registry` 分离）：

| 字段 | 说明 |
|---|---|
| `id / name / icon / desc` | 元数据，用于设置页卡片展示 |
| `layout` | `'panels'`（默认五区）或 `'stage'`（主题风格完全接管 center 舞台） |
| `renderStage(ctx)` | stage 主题风格提供，返回主舞台 DOM 节点 |
| `mountPoints` | 挂载点列表 `[{id,name,desc,role?,icon?,defaultExt?,slots?}]`；panels 为 `left`/`top`/`right`/`bottom` 四区（`center` 是内容区），各带三段 `slots`；stage 为场景实物；`resolveMount()` 按「用户配置 → `defaultExt`」解析，`resolveSlotMount()` 按「用户配置 → `slotDefaults`」解析 |
| `configureMounts()` | 可选，主题风格的挂载配置入口；未提供时走主题风格详情页的挂载点配置 |
| `settingsPanel()` | 可选，主题风格专属设置面板，嵌入设置页 |

**已实现主题风格**：
- `theme-style-classic.js`（layout=panels）：经典分栏，内核默认 baseline；声明五区为挂载点
- `theme-style-studio3d.js`（layout=stage）：3D 工作室——纯 CSS 3D 房间，桌子/电脑/宠物/小人/书架/工具箱是挂载点

**实物挂载机制**：
- 挂载配置 `themeStyleMounts[themeStyleId][pointId] = extId`，存系统偏好（localStorage），数据驱动、可视化配置
- `resolveMount()` 解析：优先用户配置，回落主题风格 `defaultExt`
- 点击实物 → `router.go(extId)`：已安装扩展/系统页真实打开；规划中扩展显示友好占位；stage 主题风格下所有子视图带统一"返回舞台"条（`router.back()`）
- 配置入口：设置页 → 主题风格 → 挂载点配置（panels 四区各三段槽位，stage 走 `configureMounts()`）
- **扩展中心随主题风格联动**：`getThemeStyleMountPoints()` 提供当前主题风格挂载点，`mountLabelOfExt()` 解析每个扩展位于哪个挂载点——经典分栏显示「左侧栏 · 上部」这类槽位文案，3D 工作室显示「电脑 · 3D 工作室」；底部挂载点卡片列表也来自当前主题风格声明，不再写死五区

**隔离保证**：主题风格只影响 center 舞台与五区显隐（`body[data-theme-style-layout="stage"]` CSS 隐藏 left/right），不碰数据层、同步、路由语义。切换主题风格不改任何业务数据。

## 4. 分层架构

```
┌─────────────────────────────────────────────────────┐
│ index.html · 五区 DOM 外壳                              │
├─────────────────────────────────────────────────────┤
│ main.js  装配入口（注册适配器 / 页面 / 扩展 → boot）       │
├──────────┬──────────┬──────────┬──────────┬──────────┤
│ core.js  │ data.js  │ storage.js│ platform.js│ sync.js  │
│ 内核      │ 数据层    │ 存储抽象  │ 平台适配   │ 同步引擎  │
│ registry │ state    │ register │ detect    │ outbox   │
│ router   │ DAO      │ Adapter  │ deviceId  │ LWW      │
│ bus      │ commit   │ persist  │ network   │ push/pull│
│ 五区渲染  │ meta     │ flush    │ fs/caps   │ merge    │
├──────────┴──────────┴──────────┴──────────┴──────────┤
│ pages.js 系统页面(扩展中心/设置)   │ ext-*.js 业务扩展    │
├─────────────────────────────────────────────────────┤
│ db.js  LocalAdapter → SQLite(WASM) → IndexedDB          │
└─────────────────────────────────────────────────────┘
```

### 4.1 core.js（内核）

- `registry`：扩展注册表，按 order 排序
- `router`：内存路由 `{extId, mode: home|detail, id}` + hash 映射（见 4.3）
- `bus`：事件总线（`route` / `data` / `tick` / `sync:*`）
- `store`：系统偏好（主题色、布局、启用开关），key 前缀 `wh_`
- `el()`：DOM 构建器，杜绝 innerHTML 注入
- 五区渲染：`renderLeft / renderTop / renderCenter / renderRight / renderBottom`
- 扩展契约（钩子全部可选）：

| 钩子 | 渲染到 | 说明 |
|---|---|---|
| `home(ctx)` | center | 主列表页（统计等详情内容一并在此） |
| `detail(id, ctx)` | center | 详情页 |
| `badge()` | left/top 导航项 | 角标数字 |

> `panel(ctx)` / `status(ctx)` 已废弃：侧栏只挂扩展入口，详情内容统一在 center。`entryExts(zone)` 负责收集挂载到 right/bottom 的入口扩展。

### 4.3 URL 路由与独立窗口

- hash 格式：`#/ext/<id>`（主页）、`#/ext/<id>/detail/<记录id>`（单条详情）、`#/sys/<页id>`、`#/sys/<页id>/<参数>`。
- `parseRoute(hash)` / `buildRoute(route)` 为纯函数；`router.go/open/home/back` 用 `history.replaceState` 同步 hash（不污染历史）；`boot()` 解析初始 hash 直达，`hashchange` 响应外部 URL 变更。
- `openExtensionWindow(extId)` 导出给所有扩展：以 `window.open(<url>#/ext/<id>, '_blank')` 打开浏览器独立窗口，各窗口独立运行、共享本地存储；被拦截时 toast 提示。
- center 的扩展视图（home/detail）统一带"独立窗口打开"工具条按钮。

### 4.2 data.js（数据层）

- `state`：全局真相源
- `declareDomain(name, seed, opts)`：扩展声明数据域；`opts.table`（形如 `ext_<id>_<名称>`）让适配器自动建表，省略则只存 localStorage 镜像
- `commit(key, op, record)`：统一写路径 → 镜像 + adapter + outbox + `bus.emit('data')`
- 通用 CRUD：`insert / update / remove / alive / byId`
- 每条记录带 `meta`：`{updatedAt, updatedBy, deletedAt, rev}`（见 §5）
- `applyRemote()`：接收远端合并结果，不入队（避免回环）

### 4.3 storage.js（存储抽象）

适配器契约（storage.js）：`init / persistDomain / flush / info`，另有 `registerDomain / exportBytes / outboxAppend / outboxAck / outboxLoad`。业务层只认持久化动作。LocalAdapter（db.js）已注册；云端走独立的 Supabase CloudAdapter（REST/Auth/RPC），由 `cloud-sync.js` 注入 sync.js。**换后端不改业务代码**。

### 4.4 platform.js（平台适配）

- `detectPlatform()`：web / pwa / electron / tauri / capacitor-ios / capacitor-android
- `getDeviceId()`：持久化设备 ID（同步冲突打破平局用）
- `isOnline / onNetworkChange / appDataDir / supportsFs`
- 上层不写 `if (isIOS)`，新增端只在适配层加分支

### 4.5 sync.js（同步引擎）

管线已实现：`enqueue / restoreOutbox / push / pull / syncNow / startAutoSync / stopAutoSync`，合并与时钟为 `lwwWinner / mergeDomain / purgeTombstones` + `hlc.js` 单调时间戳。无 CloudAdapter 时 push/pull 安全 no-op，应用完全离线可用。云端适配器由 `cloud-sync.js` 在会话就绪后通过 `setRemoteAdapter()` 注入并启动自动同步（30s 轮询）。详细协议见 `docs/sync-protocol.md`。

## 5. 数据模型与同步元数据

每条业务记录统一结构：

```js
{
  id: "uuid",              // 全局唯一（crypto.randomUUID）
  ...业务字段,
  meta: {
    updatedAt: 1732348800000,  // LWW 时间戳（ms）
    updatedBy: "dev_xxx",      // 最后写入设备
    deletedAt: null,           // 软删除墓碑
    rev: 3                     // 版本号
  }
}
```

- 删除 = 打墓碑（不物理删），保留 30 天后清理
- DB schema 每张表预埋 `updated_at / updated_by / deleted_at / rev / meta` 列
- `outbox` 表记录待推送变更（见 database-design.md）

## 6. 全端策略（零构建 Web + 壳）

| 目标端 | 方案 | 状态 |
|---|---|---|
| 浏览器 | 直接打开 / 静态托管 | ✅ 当前 |
| PWA | manifest.json + Service Worker（待加 SW） | 🟡 部分 |
| macOS / Windows | Tauri（首选，体积小）或 Electron 包壳 | ⬜ 规划 |
| iPhone / iPad / Android | Capacitor 包壳 | ⬜ 规划 |

**核心原则**：业务代码 100% 复用，端差异只在 platform.js。壳只提供 WebView 容器 + 原生能力桥接（文件系统、通知、后台同步）。

## 7. 数据流

```
用户操作 → 扩展事件处理器 → data.insert/update/remove
  → state 更新 → store 镜像 → storage.persist(→SQLite→IndexedDB)
  → sync.enqueue(outbox) → bus.emit('data') → 五区重绘

联网时：sync.syncNow()
  → push(outbox) → pull(since) → mergeDomain(LWW) → data.applyRemote
  → bus.emit('data') → 五区重绘
```

## 8. 已知取舍与后续

- **领域整体重写**：persistDomain 每次全表 DELETE+INSERT。个人规模够用；多端高频同步时应改行级 upsert（v2）。
- **LWW 粒度**：按记录级，两端同时编辑同一条会丢一端。笔记类未来可升级字段级合并 / CRDT。
- **路由内存态**：刷新回到默认页；同步落地后可把 `{ext,mode,id}` 编入 URL 便于分享。
- **自动同步**：由 `cloud-sync.js` 的 `refreshCloudSync()` 在检测到有效会话时注入 adapter 并调用 `startAutoSync()`；`main.js` 只调非阻塞的 `initCloudSync()`。

## 9. 架构评估后的优化（ADR-006）
> 2026-11-23 · 针对代码评审中发现的问题，逐项落地并配测试（`npm test`，Node 内置 test runner，无依赖）

| 问题 | 处理 | 位置 |
|---|---|---|
| `core.js` 过大，数据层反向依赖 UI 内核 | 抽出无 DOM 的基础设施层 `base.js`（`store` / `bus` / `registry` / key 规范）。`data / sync / db / identity / platform / storage` 不再 import `core.js`；`core.js` re-export 全部符号，旧 import 不受影响 | `js/base.js` |
| outbox 只在内存，刷新即丢 | `enqueue` 同步写 `sys_outbox`；启动 `restoreOutbox()` 恢复；push 成功后 ack 出队；同一记录多次修改合并为最新一条；入队存深拷贝 | `sync.js` `storage.js` `db.js` |
| LWW 依赖设备时钟 | `hlc.js` 单调时间戳：本地写入取 `max(now, 已见最大值+1)`；合并时吸收远端时间戳；远端超前 24h 以上视为异常不吸收；同时刻比 `rev` 再比 deviceId | `js/hlc.js` |
| 合并时清墓碑导致记录复活 | `mergeDomain` 只做合并。`purgeTombstones` 要求「超过 30 天」且「早于已成功同步的时间点」才清理；未启用同步不清理 | `sync.js` |
| `applyRemote` 直接替换整域 | 改为内部与本地 LWW 合并，调用方只传远端原始记录 | `data.js` |
| 无备份，浏览器清理即丢数据 | 设置 → 数据与备份：导出 JSON；导入支持合并 / 替换（替换时本地多出的记录打墓碑而非丢弃，被改动记录提升版本，保证多端同步正确）；导入前校验格式、域名、重复 id | `js/backup.js` |
| localStorage 镜像写失败被静默吞掉 | `store.set` 失败发出 `store:error`，界面提示一次并引导去备份 | `base.js` `core.js` |
| 数据重绘丢光标 / 滚动 | `data` 事件重绘前记录焦点控件位置、光标选区与各容器 `scrollTop`，重绘后恢复 | `core.js` |
| 内核硬编码未实现的业务域；新扩展必须改 `db.js` | `state` 初始为空，仅 `declareDomain` 声明的域存在。`declareDomain(name, seed, { table: 'ext_<id>_<名称>' })` 让适配器自动建表读写（记录存 JSON 文档列 + 同步元数据独立列）；表名正则校验防注入；装进已有数据库时用本地镜像填充新表 | `data.js` `storage.js` `db.js` |

**测试覆盖**（`tests/`）：基础设施、HLC、LWW / 合并 / 墓碑清理、outbox 持久化、备份导入导出与校验、`db.js` 真实 sql.js 集成（落盘、刷新恢复、墓碑不复活、v3 旧库迁移、扩展自带表）。

**仍未解决（有意保留）**
- `persistDomain` 仍为整域重写；多端高频同步前需改行级 upsert。
- 重绘仍是整区重建。扩展可声明 `domains: [...]`（可选）：无关域变更时只刷新 left / top / bottom，center / right 不重建；未声明的扩展保持整体重绘。目前仅 todo 声明。
- 内置域（todos 等）的手写映射仍在 `db.js`，尚未迁到各扩展；新扩展请用 `table` 选项。
- CloudAdapter 已实现并通过 mock 单测覆盖请求格式；真实 Supabase 端到端与双端同步为历史人工验证记录，不在仓库自动化测试中（`tests/` 无真实网络/双会话用例）。

## 10. ADR-007：数据库基座裁剪（schema v7，2026-11-24）

**决策**：内核数据库只保留系统基座，业务与组织形态不预设。

| 变更 | 原因 |
|---|---|
| 删除 9 张未实现的扩展表（projects/tasks/snippets/complaints/notes/posts/learning） | 建了表却无扩展读写，属空壳；扩展需要时用 `declareDomain(table)` 自带表 |
| 删除 `sys_ext_mounts` / `sys_ext_kv` | 挂载配置已归 `store.themeStyleMounts`（偏好）；扩展数据归扩展自有表 |
| 删除 `sys_households` / `sys_memberships` 与 meta 归属字段 | 组织结构未定，家庭模型过度预设；待通用组织结构设计（ADR-005 撤销） |
| `sys_schema_version` 改单行约束；`sys_outbox` 去 `pushed` | 修复版本行累积缺陷；删除恒为 0 的死列 |

**保留**：`ext_todo_items` / `ext_todo_groups`（任务扩展在用）。详见 [database-design.md](database-design.md)。

