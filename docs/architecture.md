# WorkHub 架构设计 v2

> ADR-003 · 本轮架构优化产物 · 2026-11-23
> 状态：已接受 · 替代 v1 的三区 + 占位扩展模型
> 修订：2026-11-23 增补"界面样式（Skin）"第二扩展维度（ADR-004）

## 1. 本轮变更摘要

| 项 | v1（旧） | v2（本轮） |
|---|---|---|
| 功能扩展 | 10 个占位扩展 | **全部移除**，内核保持干净；清单沉淀到 FEATURES.md |
| 布局分区 | sidebar / titlebar / inspector / statusbar（语义混杂） | **五区模型**：top / left / center / right / bottom |
| 数据记录 | 普通对象 | **每条带同步元数据 meta** |
| 存储 | core 直连 localStorage + db.js | **storage 适配器抽象** + LocalAdapter |
| 同步 | 无 | **sync 引擎骨架**（outbox / LWW / pull 合并），v1 no-op |
| 平台 | 浏览器单一 | **platform 适配层**：Web/PWA/Electron/Tauri/Capacitor |
| 系统页面 | 混在 ext-*.js | pages.js 独立，属于内核 |
| **界面样式** | 单一分栏 + 主题色切换 | **界面样式（Skin）第二扩展维度**：分栏为默认界面样式，3D 工作室等样式以扩展实现，实物挂载扩展 |

## 2. 目标与约束

**目标**：一套零构建代码，跑在 mac / Windows / iPhone / iPad / Android，本地优先、可离线，联网后多端同步。

**约束**：
1. 零构建、原生 ES Modules（浏览器直接跑）
2. 本地优先（local-first）：离线可用，网络是增强项而非依赖
3. 单人为主，schema 预留多用户
4. 视图层不碰存储；扩展只通过契约接入

## 3. 五区布局模型

```
┌──────────────────────────────────────────────┐
│  top     主菜单 · 一级入口（横向扩展快捷入口）      │
├──────────┬───────────────────────┬────────────┤
│          │                       │            │
│  left    │      center           │   right    │
│ 主菜单    │   主内容区             │  功能菜单    │
│ 一级入口  │   home / detail       │  panel(ctx) │
│          │                       │            │
├──────────┴───────────────────────┴────────────┤
│  bottom  功能菜单 · 状态条  status(ctx)          │
└──────────────────────────────────────────────┘
```

| 区 | 角色 | 用途 | 数据来源 |
|---|---|---|---|
| `top` | nav | 主菜单一级入口（横向） | placement.zone=top 的扩展 |
| `left` | nav | 主菜单一级入口（纵向 + 分组） | placement.zone=left 的扩展 |
| `center` | content | 主内容 | 当前扩展 `home(ctx)` / `detail(id,ctx)` |
| `right` | panel | 当前扩展的功能菜单 / 属性面板 | 当前扩展 `panel(ctx)` |
| `bottom` | panel | 当前扩展的功能状态条 | 当前扩展 `status(ctx)`，缺省内核状态 |

**设计意图**：区分"导航入口"（top/left）与"上下文功能"（right/bottom）。后者随当前扩展变化，避免把状态栏和属性面板混为一谈。窄屏（<900px）自动隐藏 right，<760px 时 left 变抽屉。

## 3.5 界面样式（Skin）——第二扩展维度

> ADR-004 · UI 样式本身也是扩展，与业务功能扩展正交。

**动机**：五区布局是"信息密度优先"的默认样式，但某些场景需要完全不同的界面隐喻（如 3D 爱好者想要一间工作室，把功能挂到场景实物上）。与其在内核里写一堆 `if (style === '3d')`，不如把"主舞台怎么渲染"抽象成第二个扩展点。

**界面样式契约**（`registerSkin`，与业务 `registry` 分离）：

| 字段 | 说明 |
|---|---|
| `id / name / icon / desc` | 元数据，用于设置页卡片展示 |
| `layout` | `'panels'`（默认五区）或 `'stage'`（界面样式完全接管 center 舞台） |
| `renderStage(ctx)` | stage 界面样式提供，返回主舞台 DOM 节点 |
| `mountPoints` | **所有界面样式必须声明**的挂载点列表 `[{id,name,desc,role?,icon?,defaultExt?}]`；panels 为五区，stage 为场景实物；未声明时 panels 回落五区 |
| `configureMounts()` | 可选，界面样式的挂载配置入口；扩展中心点击扩展的挂载标签时调用（未提供则走经典五区 picker） |
| `settingsPanel()` | 可选，界面样式专属设置面板，嵌入设置页 |

**已实现界面样式**：
- `skin-classic.js`（layout=panels）：经典分栏，内核默认 baseline；声明五区为挂载点
- `skin-studio3d.js`（layout=stage）：3D 工作室——纯 CSS 3D 房间，桌子/电脑/宠物/小人/书架/工具箱是挂载点

**实物挂载机制**：
- 挂载配置 `skinMounts[skinId][pointId] = extId`，存系统偏好（localStorage），数据驱动、可视化配置
- `resolveMount()` 解析：优先用户配置，回落界面样式 `defaultExt`
- 点击实物 → `router.go(extId)`：已安装扩展/系统页真实打开；规划中扩展显示友好占位；stage 界面样式下所有子视图带统一"返回舞台"条（`router.back()`）
- 配置入口：设置页 → 界面样式 → 当前界面样式专属设置面板；扩展中心点击扩展的挂载标签（stage 走 `configureMounts()`，panels 走 `placementPicker()`）
- **扩展中心随界面样式联动**：`getSkinMountPoints()` 提供当前界面样式挂载点，`mountLabelOfExt()` 解析每个扩展位于哪个挂载点——经典分栏显示「左侧 · 主菜单」，3D 工作室显示「电脑 · 3D 工作室」；底部挂载点卡片列表也来自当前界面样式声明，不再写死五区

**隔离保证**：界面样式只影响 center 舞台与五区显隐（`body[data-skin-layout="stage"]` CSS 隐藏 left/right），不碰数据层、同步、路由语义。切换界面样式不改任何业务数据。

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
- `router`：内存路由 `{extId, mode: home|detail, id}`
- `bus`：事件总线（`route` / `data` / `tick` / `sync:*`）
- `store`：系统偏好（主题、布局、启用开关），key 前缀 `wh_`
- `el()`：DOM 构建器，杜绝 innerHTML 注入
- 五区渲染：`renderLeft / renderTop / renderCenter / renderRight / renderBottom`
- 扩展契约（钩子全部可选）：

| 钩子 | 渲染到 | 说明 |
|---|---|---|
| `home(ctx)` | center | 主列表页 |
| `detail(id, ctx)` | center | 详情页 |
| `panel(ctx)` | right | 功能/属性面板 |
| `status(ctx)` | bottom | 状态条文案 |
| `badge()` | left/top 导航项 | 角标数字 |

### 4.2 data.js（数据层）

- `state`：全局真相源
- `declareDomain(name, seed)`：扩展声明数据域
- `commit(key, op, record)`：统一写路径 → 镜像 + adapter + outbox + `bus.emit('data')`
- 通用 CRUD：`insert / update / remove / alive / byId`
- 每条记录带 `meta`：`{updatedAt, updatedBy, deletedAt, rev}`（见 §5）
- `applyRemote()`：接收远端合并结果，不入队（避免回环）

### 4.3 storage.js（存储抽象）

适配器契约：`init / persistDomain / flush / info`。业务层只认这三个动作。LocalAdapter（db.js）已注册；未来 CloudAdapter 由 sync.js 注入。**换后端不改业务代码**。

### 4.4 platform.js（平台适配）

- `detectPlatform()`：web / pwa / electron / tauri / capacitor-ios / capacitor-android
- `getDeviceId()`：持久化设备 ID（同步冲突打破平局用）
- `isOnline / onNetworkChange / appDataDir / supportsFs`
- 上层不写 `if (isIOS)`，新增端只在适配层加分支

### 4.5 sync.js（同步引擎）

v1 为 no-op 骨架，API 已冻结：`setRemoteAdapter / enqueue / push / pull / syncNow / startAutoSync`。详细协议见 `docs/sync-protocol.md`。

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
- **自动同步**：startAutoSync 已提供，但需在 CloudAdapter 注入后由 main.js 调用。
