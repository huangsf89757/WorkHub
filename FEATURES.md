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
| P2 | `clipboard` | 剪贴板历史 | Tools | top | 系统级剪贴板历史：全局监听并留存复制记录，支持检索与快捷粘贴（类 PasteNow，依赖桌面壳） | ⬜ |
| P2 | `shortcuts` | 快捷键 | Tools | 全局浮层（overlay） | 全局快捷键呼出软键盘，按键一键启动绑定的本机 App（依赖桌面壳） | ⬜ |

### `daily-hotspots` 计划要点

- **类别（初始）**：AI、文娱、科技/数码、财经、体育、游戏、社会、国际；类别支持增删改与订阅
- **数据源**：RSS / 热榜聚合 API，需服务端代理规避浏览器跨域（外部条件；未就位前用内置样例数据）
- **钩子规划**：`home` 类别 Tab + 热点列表 · `detail` 摘要与跳转原文 · `panel` 类别/来源管理 · `status` 更新时间与条数 · `badge` 未读数
- **数据域**：`hotspots`（条目）、`hotspotCategories`（类别）、`hotspotSources`（来源），遵循 `meta` / `outbox` 写路径

### `clipboard` 计划要点

- **能力**：全局监听剪贴板变更（文本 / 图片 / 文件路径），留存历史；支持关键字检索、置顶收藏、一键回写粘贴
- **前置依赖**：桌面壳（Tauri / Electron，见「跨端能力」P2）；纯 Web 环境降级为仅记录应用内复制或展示引导
- **权限与隐私**：首次启用需声明系统剪贴板读取权限；敏感内容可配忽略规则（可选叠加端到端加密 P3）
- **钩子规划**：`home` 历史列表 + 搜索 · `detail` 内容预览 · `panel` 类型筛选与保留策略 · `status` 条目数与监听状态 · `badge` 新条目提示
- **数据域**：`clipboardItems`、`clipboardSettings`，遵循 `meta` / `outbox` 写路径

### `shortcuts` 计划要点

- **能力**：配置面板把本机 App（应用路径 / Bundle ID）绑定到软键盘按键；注册全局快捷键（如 `⌥ + Space`）呼出浮层；按下对应键即可直接启动所绑定 App（类启动台，依赖桌面壳）
- **软键盘**：以网格展示按键，每格显示 App 图标与名称；支持分组、改名、拖拽排序；空位可现场绑定或解绑
- **前置依赖**：桌面壳（Tauri / Electron，见「跨端能力」P2）提供系统级全局热键注册与启动本地应用能力；纯 Web 环境无法注册全局热键/拉起本地 App，降级为仅展示配置界面与引导
- **权限与隐私**：首次启用需声明全局热键监听与应用启动权限；绑定数据（App 标识 + 键位）仅本地存储，不随同步上传
- **钩子规划**：因属全局浮层，标准五钩子仅部分适用——`panel` 绑定配置 · `status` 监听状态与绑定数量 · `badge` 呼出键冲突提示；`home` / `detail` 可留空或做简化入口
- **数据域**：`shortcutBindings`（按键 → App 映射）、`shortcutSettings`（呼出键、浮层偏好），遵循 `meta` / `outbox` 写路径

## 跨端能力（非扩展，属于内核路线图）

| 优先级 | 能力 | 描述 | 状态 |
|---|---|---|---|
| P1 | 数据域声明 | 扩展用 `declareDomain()` 注册自己的数据域 | ✅ 已就绪 |
| P1 | 同步元数据 | 每条记录携带 `meta{updatedAt,updatedBy,deletedAt,rev}` | ✅ 已就绪 |
| P1 | 变更日志 outbox | 本地写操作入队，供 push 消费 | ✅ 内存队列 + `sys_outbox` 落库与恢复均已就绪 |
| P1 | LWW 冲突合并 | `lwwWinner` / `mergeDomain` 已实现 | ✅ 已就绪 |
| P1 | 存储适配器 | `registerAdapter` 抽象，LocalAdapter 已接 | ✅ 已就绪 |
| P2 | CloudAdapter | Supabase 云端适配器（REST/Auth/RPC 直连，零构建） | ✅ 已实现（设置页预填 URL/key，仍需点「保存配置」生效） |
| P2 | 真实 push/pull | 有配置与有效会话时由 `cloud-sync.js` 注入 adapter 后启用 | ✅ 代码已实现并有 mock 单测；真实端到端/双端验证为历史人工验收记录（非仓库自动化测试） |
| P2 | 桌面壳 | Tauri / Electron 打包（macOS + Windows） | ⬜ |
| P2 | 移动壳 | Capacitor 打包（iOS / iPadOS / Android） | ⬜ |
| P3 | 同步冲突可视化 | 冲突记录的手动解决 UI | ⬜ |
| P3 | 端到端加密 | 同步前对记录正文加密 | ⬜ |
| P1 | 本地用户身份 | `identity.js` 当前用户（默认 me） | ✅ 已就绪 |
| P3 | 通用组织结构 | 组织/团队/空间层级 + 可见性模型（家庭模型已撤销，待重新设计，ADR-005） | ⬜ |

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
