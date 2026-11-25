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
| P1 | `planning` | 规划 | Work | left + right | 个人规划管理：每日规划、学习计划等，支持任务拆解与进度追踪 | ⬜ |
| P1 | `schedule` | 日程 | Work | left + right | 个人日程安排：按日期 / 时间记录事件（如某日打疫苗、某日某点上课），支持重复与提醒 | ⬜ |
| P1 | `anniversary` | 纪念日 | Work | left + right | 年度纪念节点管理：纪念日、生日等，自动计算下一次日期与倒计时 | ⬜ |
| P1 | `contacts` | 通讯录 | Work | left + right | 个人联系人管理：姓名 / 电话 / 邮箱 / 分组标签，支持检索、vCard 导入导出与生日联动 | ⬜ |
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

### `planning` 计划要点

- **能力**：创建多类个人规划（每日规划、学习计划、自定义类型）；按日期组织每日待办与目标，支持每日模板复用；学习计划支持目标拆解、里程碑与进度追踪；每项支持优先级、截止日与状态流转，并提供跨规划的汇总视图
- **与现有扩展的关系**：现有 `learning`（学习计划，Knowledge 组）可被本扩展的「学习计划」类型覆盖，未来实现时可评估合并，避免重复建设
- **前置依赖**：无特殊依赖，纯 Web 可用；到期提醒通知可选接入桌面壳（见「跨端能力」P2）
- **权限与隐私**：规划内容默认仅本地存储，遵循 `meta` / `outbox` 写路径；是否随同步上传由用户配置决定
- **钩子规划**：`home` 规划列表（按类型 / 日期筛选） · `detail` 规划详情（任务项与进度） · `panel` 类型管理与偏好设置 · `status` 今日完成度与进行中规划数 · `badge` 今日未完成项数 / 到期提醒
- **数据域**：`plans`（规划）、`planItems`（规划项）、`planCategories`（类型），遵循 `meta` / `outbox` 写路径

### `schedule` 计划要点

- **能力**：创建带日期 / 时间的日程事件（如「6 月 1 日去打疫苗」「6 月 2 日 14:00 上课」）；支持全天事件与定时事件、重复规则（每天 / 每周 / 每月）、分类（工作 / 生活 / 健康 / 学习）、提醒与冲突提示；提供月 / 周 / 日视图切换
- **与现有规划的区别**：本扩展聚焦「何时何事」的时间点安排；`planning` 聚焦任务 / 目标的拆解与进度追踪。二者互补，未来可让 `dashboard` 聚合两者形成今日视图
- **前置依赖**：无特殊依赖，纯 Web 可用；系统级通知提醒可选接入桌面壳（见「跨端能力」P2），纯 Web 环境下用站内提示降级
- **权限与隐私**：日程内容默认仅本地存储，遵循 `meta` / `outbox` 写路径；是否随同步上传由用户配置决定
- **钩子规划**：`home` 日历视图（月 / 周 / 日）+ 当日日程列表 · `detail` 事件详情（时间 / 地点 / 备注 / 提醒） · `panel` 分类管理与提醒偏好 · `status` 今日日程数与下一项倒计时 · `badge` 即将开始 / 已逾期项数
- **数据域**：`schedules`（日程事件）、`scheduleCategories`（分类）、`scheduleSettings`（偏好），遵循 `meta` / `outbox` 写路径

### `anniversary` 计划要点

- **能力**：记录年度纪念节点（纪念日、生日、结婚纪念日、宠物生日等）；日期支持带年份（用于计算周年数）与仅月日（不关心起始年）；自动推算下一次发生日期与倒计时天数，按临近程度排序；支持分类、置顶、备注与提前 N 天提醒
- **与现有扩展的区别**：`schedule` 管理「某一次」具体时间的安排；本扩展管理「每年重复」的长期纪念节点，不产生一次性日程。二者互补，`dashboard` 可聚合纪念日倒计时与今日日程
- **前置依赖**：无特殊依赖，纯 Web 可用；系统级通知提醒可选接入桌面壳（见「跨端能力」P2），纯 Web 环境下用站内提示降级；农历日期支持依赖日历库，可作为后续增强项
- **权限与隐私**：纪念日内容默认仅本地存储，遵循 `meta` / `outbox` 写路径；生日等敏感信息是否随同步上传由用户配置决定
- **钩子规划**：`home` 倒计时列表（按类型筛选） · `detail` 详情（日期 / 周年数 / 备注） · `panel` 分类管理与提醒偏好 · `status` 最近一个纪念日与剩余天数 · `badge` 临近 N 天内的数量
- **数据域**：`anniversaries`（纪念节点）、`anniversaryCategories`（分类）、`anniversarySettings`（偏好），遵循 `meta` / `outbox` 写路径

### `contacts` 计划要点

- **能力**：记录联系人（姓名、电话、邮箱、公司 / 职位、地址、生日、分组标签、备注）；支持按姓名 / 电话 / 标签检索、分组筛选、收藏置顶、一键复制联系方式；支持 vCard（`.vcf`）与 CSV 的导入导出
- **与其它扩展的联动**：联系人的生日可一键生成 `anniversary` 纪念节点；`schedule` 日程、`projects` 项目、`complaints` 客诉可关联联系人作为参与方 / 负责人
- **前置依赖**：无特殊依赖，纯 Web 可用；读取系统原生通讯录需桌面壳 / 移动壳（见「跨端能力」P2），纯 Web 环境降级为手动录入与文件导入
- **权限与隐私**：联系人信息属敏感个人数据，默认仅本地存储，遵循 `meta` / `outbox` 写路径；是否随同步上传由用户配置决定（可叠加端到端加密 P3）
- **钩子规划**：`home` 联系人列表 + 搜索 / 分组筛选 · `detail` 联系人详情与快捷操作 · `panel` 分组标签管理与导入导出 · `status` 联系人总数与分组数 · `badge` 临近生日联系人数量
- **数据域**：`contacts`（联系人）、`contactGroups`（分组标签）、`contactSettings`（偏好），遵循 `meta` / `outbox` 写路径

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

## 主题风格扩展（第二扩展维度）

> UI 样式本身也是扩展。主题风格注册表见 `core.js` 的 `themeStyleRegistry`；新增主题风格新建 `js/theme-style-<id>.js` 并在 `main.js` import。

| 主题风格 ID | 名称 | 布局 | 状态 | 说明 | 文档 |
|---|---|---|---|---|---|
| `classic` | 经典分栏 | panels | ✅ 已实现 | 默认 baseline，五区布局 | [themeStyles/classic.md](docs/themeStyles/classic.md) |
| `studio3d` | 3D 工作室 | stage | ✅ 已实现 | 纯 CSS 3D 房间，6 个实物挂载点（桌子/电脑/宠物/小人/书架/工具箱），可配置每个实物绑定的扩展 | [themeStyles/studio3d.md](docs/themeStyles/studio3d.md) |
| `kanban` | 看板视图 | stage | ⬜ 规划 | 以看板列为主舞台，列即扩展挂载位 |
| `terminal` | 终端视图 | stage | ⬜ 规划 | 命令行风格主舞台，命令映射扩展 |
| `focus` | 专注模式 | stage | ⬜ 规划 | 极简单任务舞台，适合手机窄屏 |

## 已实现扩展

| ID | 名称 | 分组 | 挂载区 | 实现文件 | 说明 | 文档 |
|---|---|---|---|---|---|---|
| `todo` | 任务 | Work | left | `js/ext-todo.js` | 分组待办、优先级、截止日、标签、软删除；五个扩展钩子齐全；写入带 `meta` 并入 outbox | [extensions/todo.md](docs/extensions/todo.md) |

## 新增扩展的约定

1. 新建 `js/ext-<id>.js`，从 `core.js` 引入所需能力
2. 用 `registry.add({ id, name, icon, order, ... })` 自注册
3. 实现钩子：`home(ctx)` / `detail(id, ctx)`（→ center）、`panel(ctx)`（→ right）、`status(ctx)`（→ bottom）、`badge()`
4. 若需持久化，用 `declareDomain()` + `insert/update/remove/alive`
5. 在 `js/main.js` 顶部 import 一次即完成接入
6. 更新本文件状态为 ✅，并从 `js/features.js` 移除或标记

## 新增主题风格的约定

1. 新建 `js/theme-style-<id>.js`，从 `core.js` 引入 `registerThemeStyle` 等
2. 用 `registerThemeStyle({ id, name, icon, desc, layout, ... })` 自注册
3. `layout:'panels'` 不接管舞台；`layout:'stage'` 需实现 `renderStage(ctx)` 返回主舞台 DOM
4. 若舞台含挂载点，声明 `mountPoints`（每个点给 `id/name/defaultExt`），点击时 `router.go(resolveMount(...))`
5. 可选 `settingsPanel()` 返回专属设置面板 DOM，自动嵌入设置页
6. 在 `js/main.js` 顶部 import 一次即完成接入；更新上表状态
