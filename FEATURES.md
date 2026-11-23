# FEATURES — WorkHub 扩展清单

> 记录后续**可能添加**的扩展。本轮已移除全部占位扩展，内核保持干净。
> 机器可读版本见 `js/features.js`（扩展中心读取它展示 roadmap）。
> 状态图例：⬜ 待实现 · 🔨 进行中 · ✅ 已完成（实现后从本表移到"已实现"区）

## 规划中的扩展

| 优先级 | ID | 名称 | 分组 | 挂载区建议 | 一句话描述 | 状态 |
|---|---|---|---|---|---|---|
| P1 | `dashboard` | 概览 | Work | left | 跨扩展的今日视图：待办、进度、统计聚合 | ⬜ |
| P1 | `projects` | 项目管理 | Work | left | 项目 / 子任务 / 里程碑，支持状态与标签 | ⬜ |
| P1 | `notes` | 知识库 | Knowledge | left + right | 多级目录笔记，右栏属性面板 + 变更历史 | ⬜ |
| P2 | `complaints` | 客诉管理 | Work | left | 工单状态流转 + 处理记录时间线 | ⬜ |
| P2 | `learning` | 学习计划 | Knowledge | left | 学习项进度追踪与优先级排序 | ⬜ |
| P2 | `blog` | 个人博客 | Knowledge | left | 草稿 / 发布状态的内容管理 | ⬜ |
| P2 | `tool-time` | 时间转换 | Tools | top | Unix 时间戳与日期互转 | ⬜ |
| P2 | `tool-json` | JSON 工具 | Tools | top | 格式化 / 压缩 / 校验 | ⬜ |
| P2 | `tool-regex` | 正则工具 | Tools | top | 实时匹配与高亮 | ⬜ |
| P2 | `tool-codec` | 编解码 | Tools | top | Base64 与 URL 编解码 | ⬜ |
| P2 | `tool-crypto` | 加解密 | Tools | top | RSA-OAEP / AES-GCM，WebCrypto 本地运算 | ⬜ |
| P2 | `daily-hotspots` | 每日热点 | Info | left | 多类别热点聚合：AI、文娱、科技、财经、体育等，可订阅类别与来源 | ⬜ |

### `daily-hotspots` 计划要点

- **类别（初始）**：AI、文娱、科技/数码、财经、体育、游戏、社会、国际；类别支持增删改与订阅
- **数据源**：RSS / 热榜聚合 API，需服务端代理规避浏览器跨域（外部条件；未就位前用内置样例数据）
- **钩子规划**：`home` 类别 Tab + 热点列表 · `detail` 摘要与跳转原文 · `panel` 类别/来源管理 · `status` 更新时间与条数 · `badge` 未读数
- **数据域**：`hotspots`（条目）、`hotspotCategories`（类别）、`hotspotSources`（来源），遵循 `meta` / `outbox` 写路径

## 跨端能力（非扩展，属于内核路线图）

| 优先级 | 能力 | 描述 | 状态 |
|---|---|---|---|
| P1 | 数据域声明 | 扩展用 `declareDomain()` 注册自己的数据域 | ✅ 已就绪 |
| P1 | 同步元数据 | 每条记录携带 `meta{updatedAt,updatedBy,deletedAt,rev}` | ✅ 已就绪 |
| P1 | 变更日志 outbox | 本地写操作入队，供 push 消费 | ✅ 内存队列已就绪；DB `outbox` 表已建，落库待 CloudAdapter 接入 |
| P1 | LWW 冲突合并 | `lwwWinner` / `mergeDomain` 已实现 | ✅ 已就绪 |
| P1 | 存储适配器 | `registerAdapter` 抽象，LocalAdapter 已接 | ✅ 已就绪 |
| P2 | CloudAdapter | 云端适配器（Supabase / 自建网关） | ⬜ |
| P2 | 真实 push/pull | `setRemoteAdapter()` 注入后启用 | ⬜ |
| P2 | 桌面壳 | Tauri / Electron 打包（macOS + Windows） | ⬜ |
| P2 | 移动壳 | Capacitor 打包（iOS / iPadOS / Android） | ⬜ |
| P3 | 同步冲突可视化 | 冲突记录的手动解决 UI | ⬜ |
| P3 | 端到端加密 | 同步前对记录正文加密 | ⬜ |
| P1 | 多用户身份抽象 | `identity.js` 当前用户/家庭上下文（默认 me/home） | ✅ 已就绪 |
| P2 | 家庭与成员模型 | `sys_households`/`sys_memberships` 表 + owner/member 角色 | ✅ 预留就绪 |
| P2 | 记录归属 meta | 每条记录带 userId/ownerId/scope/householdId | ✅ 已就绪 |
| P2 | 家庭成员管理 UI | 邀请/角色分配界面（单机暂不需要） | ⬜ |
| P2 | 可见范围控制 | private/family/shared 过滤与权限 | ⬜ |

## 界面样式扩展（第二扩展维度）

> UI 样式本身也是扩展。界面样式注册表见 `core.js` 的 `skinRegistry`；新增界面样式新建 `js/skin-<id>.js` 并在 `main.js` import。

| 界面样式 ID | 名称 | 布局 | 状态 | 说明 | 文档 |
|---|---|---|---|---|---|
| `classic` | 经典分栏 | panels | ✅ 已实现 | 默认 baseline，五区布局 | [skins/classic.md](docs/skins/classic.md) |
| `studio3d` | 3D 工作室 | stage | ✅ 已实现 | 纯 CSS 3D 房间，6 个实物挂载点（桌子/电脑/宠物/小人/书架/工具箱），可配置每个实物绑定的扩展 | [skins/studio3d.md](docs/skins/studio3d.md) |
| `kanban` | 看板视图 | stage | ⬜ 规划 | 以看板列为主舞台，列即扩展挂载位 |
| `terminal` | 终端视图 | stage | ⬜ 规划 | 命令行风格主舞台，命令映射扩展 |
| `focus` | 专注模式 | stage | ⬜ 规划 | 极简单任务舞台，适合手机窄屏 |

## 已实现扩展

| ID | 名称 | 分组 | 挂载区 | 实现文件 | 说明 | 文档 |
|---|---|---|---|---|---|---|
| `todo` | TODO | Work | left | `js/ext-todo.js` | 分组待办、优先级、截止日、标签、软删除；五个扩展钩子齐全；写入带 `meta` 并入 outbox | [extensions/todo.md](docs/extensions/todo.md) |

## 新增扩展的约定

1. 新建 `js/ext-<id>.js`，从 `core.js` 引入所需能力
2. 用 `registry.add({ id, name, icon, order, ... })` 自注册
3. 实现钩子：`home(ctx)` / `detail(id, ctx)`（→ center）、`panel(ctx)`（→ right）、`status(ctx)`（→ bottom）、`badge()`
4. 若需持久化，用 `declareDomain()` + `insert/update/remove/alive`
5. 在 `js/main.js` 顶部 import 一次即完成接入
6. 更新本文件状态为 ✅，并从 `js/features.js` 移除或标记

## 新增界面样式的约定

1. 新建 `js/skin-<id>.js`，从 `core.js` 引入 `registerSkin` 等
2. 用 `registerSkin({ id, name, icon, desc, layout, ... })` 自注册
3. `layout:'panels'` 不接管舞台；`layout:'stage'` 需实现 `renderStage(ctx)` 返回主舞台 DOM
4. 若舞台含挂载点，声明 `mountPoints`（每个点给 `id/name/defaultExt`），点击时 `router.go(resolveMount(...))`
5. 可选 `settingsPanel()` 返回专属设置面板 DOM，自动嵌入设置页
6. 在 `js/main.js` 顶部 import 一次即完成接入；更新上表状态
