# ROADMAP — WorkHub 实现排期

> 基于架构 v2（ADR-003）+ 界面样式第二维度（ADR-004）制定 · 2026-11-23
> 排期口径：W1 自 2026-11-24 起算，按单人投入约 10–15 小时/周估算；**周次为相对量，可按实际投入伸缩**。
> 状态图例：✅ 已完成 · 🔨 进行中 · ⬜ 待开始 · ⏸ 需外部条件

## 1. 现状盘点（排期基线）

| 层 | 已完成 | 未完成 |
|---|---|---|
| 内核 core.js | 五区渲染、registry/router/bus/store、el、4 主题、**界面样式注册表 + stage 舞台** | URL 路由（刷新定位） |
| 数据层（schema v7） | 通用 DAO、`meta` 同步元数据、outbox、LWW 合并、storage 适配器；内核只保留系统基座 6 表 + TODO 2 表 | 行级 upsert（当前整域重写） |
| 平台层 | Web/PWA/Electron/Tauri/Capacitor 探测、deviceId、网络状态 | Tauri/Capacitor 真机桥接 |
| 同步层 | push/pull 骨架、冲突合并算法、Supabase CloudAdapter 代码（REST/Auth/RPC） | 真实云端往返验证（需建项目填凭据） |
| 界面样式 | classic（分栏）、studio3d（3D 工作室，6 实物挂载点） | kanban / terminal / focus |
| 业务扩展 | **1 个**（`todo`） | FEATURES.md 中其余 11 个 |
| 系统页 | 扩展中心、设置（含界面样式切换与挂载配置） | — |

**关键结论**：骨架全部就位，缺的是"真实业务扩展"与"端壳/云端落地"。因此排期顺序为：**先用 1 个扩展打通范式 → 批量铺功能 → 补端壳 → 最后接通同步**。

## 2. 排期原则

1. **垂直切片优先**：每个 Sprint 交付"用户可见可用的功能"，不堆砌无 UI 的基础设施
2. **样板驱动**：Sprint 1 的 TODO 扩展是后续所有扩展的参考实现（钩子/DAO/测试/文档）
3. **依赖顺序**：数据域 → 业务扩展 → 依赖数据的聚合视图 → 界面样式 → 端壳 → 云端同步
4. **可回退**：每 Sprint 结束状态可独立运行、可验收；不引入阻断主干的中间态
5. **外部条件单列**：需要后端/证书/原生工具链的项标注 ⏸，不阻塞主线

## 3. Sprint 排期

### Sprint 0 · 架构基线 ✅（已完成）
- 五区布局 + 双扩展维度 + 数据/同步/平台骨架 + 2 个界面样式 + 文档

### Sprint 1 · P0 TODO 扩展（首个真实扩展，打通全链路）✅
**目标**：证明"扩展契约 + 通用 DAO + 同步元数据 + 五区 + 界面样式挂载"端到端可用。

| 任务 | 产出 | 依赖 |
|---|---|---|
| `ext-todo.js`：home/detail/panel/status/badge 五钩子 | 可用 TODO 模块 | 数据层 DAO |
| 分组 / 优先级 / 截止日 / 标签 / 软删除 | 完整 CRUD | — |
| 写入自动带 `meta` 并入 outbox | 同步就绪的写路径 | sync 骨架 |
| 注册进 main.js；FEATURES 状态更新 | 扩展中心可见 TODO | — |
| 3D 工作室"电脑"挂载点指向真实 TODO | 界面样式挂载闭环 | studio3d |
| 修复 `persistDomain` 单表领域列错位（P0） | SQLite 写入不再错位 | — |
| 修复 todoGroups 软删墓碑未持久化（P1） | 分组软删刷新后不复活 | — |

**验收（CDP 实测通过）**：五区 CRUD 正常；写入带完整 `meta` 且内存 outbox +1；刷新后 SQLite 数据正确恢复（标题/分组/软删墓碑全对）；3D 点电脑进入真实 TODO 页；无运行时错误。
**遗留（已解决）**：outbox 早期仅在内存；ADR-006 已改为 `sys_outbox` 落库与刷新恢复，CloudAdapter 接入时无需再补。

### Sprint 2 · P1 核心三件套（W2–W3）⬜
**目标**：覆盖"项目—笔记—概览"主工作流，dashboard 依赖前两者数据。

| 任务 | 产出 | 依赖 |
|---|---|---|
| `ext-projects.js`：项目/子任务/里程碑 | 项目模块 | Sprint 1 DAO 范式 |
| `ext-notes.js`：多级目录 + 右栏属性 + 变更历史 | 知识库模块 | panel 钩子 |
| `ext-dashboard.js`：跨模块聚合今日视图 | 概览模块 | projects/todos/notes 数据 |
| 通用列表/表单组件抽取（可选） | js/ui-kit.js | — |

**验收**：三模块可联动（概览数字随待办/项目变化）；笔记详情右栏显示属性与历史。

### Sprint 3 · P2 内容扩展（W4）⬜
- `ext-learning.js` 学习计划、`ext-blog.js` 个人博客、`ext-complaints.js` 客诉管理（工单 + 时间线）
- 验收：三模块 CRUD 正常，遵循统一 meta/outbox 写路径

### Sprint 4 · 工具扩展批量（W5）⬜
- `ext-tool-*.js` ×5：时间转换 / JSON / 正则 / 编解码 / WebCrypto 加解密
- 全部 `mounts: top`，无状态、可并行开发
- 验收：5 个工具出现在顶部分栏，纯本地运算、无网络请求

### Sprint 5 · PWA 离线与数据可携（W6）⬜
- Service Worker（静态资源缓存 + 离线可用）、安装提示、图标完善
- 数据导入/导出（JSON 备份与恢复），补齐 `manifest` 的 `display` 行为
- 验收：断网可打开并使用；导出后清空再导入数据一致

### Sprint 6 · 桌面端壳（W7–W8）⏸
- Tauri 壳（macOS + Windows）：本地文件存储适配（可选切 `supportsFs`）、窗口/菜单、自动更新占位
- 验收：同一套 `js/` 代码打包为桌面 App，数据本地持久化

### Sprint 7 · 移动端壳（W9–W10）⏸
- Capacitor 壳（iOS / iPadOS / Android）：安全区、返回键、后台同步触发点
- 验收：真机/模拟器可运行，窄屏降级布局可用

### Sprint 8 · 多端同步闭环（W11–W12）🔨
- 选定后端（Supabase）→ 实现 CloudAdapter（REST/Auth/RPC 直连，零构建）→ `setRemoteAdapter()` 注入 → 设置页配置 UI ✅
- 待用户提供 Supabase 项目 URL/anon key 后做端到端双端验证
- 端到端验证：手机加 todo → Mac 出现；冲突按 LWW 收敛
- 验收：双端真实同步成功、离线写入恢复在线后自动推送

### Sprint 9 · 增强与打磨（W13+）⬜
- 新界面样式：kanban（看板列挂载）/ terminal（命令映射）/ focus（极简窄屏）
- 同步冲突可视化、E2E 加密、行级 upsert 重构、URL 路由

## 4. 依赖关系

```
Sprint 0 架构基线
   │
   ├──► Sprint 1 TODO 样板 ──┬──► Sprint 2 核心三件套 ──► Sprint 3 内容扩展
   │                        └──► Sprint 4 工具扩展（可并行）
   │
   ├──► Sprint 5 PWA 离线 ──────► (端壳前置)
   │
   ├──► Sprint 6 桌面壳 ⏸ ──┐
   └──► Sprint 7 移动壳 ⏸ ──┼──► Sprint 8 真实同步 🔨 ──► Sprint 9 增强
                            └──► (需后端/凭据)
```

- 硬依赖：Sprint 2 的 dashboard 依赖 projects/todos/notes 的数据域
- 软依赖：Sprint 4 与 Sprint 2/3 可并行（工具无状态）
- 外部条件：Sprint 6/7 需原生工具链；Sprint 8 需后端服务与账号

## 5. 外部条件与风险缓冲

| 项 | 条件/风险 | 应对 |
|---|---|---|
| CloudAdapter | 代码就绪；需 Supabase 项目与凭据 | 未填配置前 sync 保持 no-op，主线不受阻 |
| 桌面/移动壳 | 需 Tauri / Capacitor + Xcode / Android Studio | 放 W7 之后，纯 Web 功能不受影响 |
| LWW 字段级冲突 | 记录级 LWW 会丢一端编辑 | 笔记类 v2 升级字段级/CRDT（Sprint 9） |
| 写放大 | `persistDomain` 整域重写 | 高频同步时改行级 upsert（Sprint 9） |
| 光标丢失 | `bus.emit('data')` → 全量重绘会打断输入 | 扩展内用 blur/防抖提交，避免 input 实时重绘 |
| 界面样式扩展 | stage 界面样式隐藏 left/right，需保证返回路径 | 统一 `router.back()` + 返回条，已实现 |

## 6. 当前进度

- Sprint 0 ✅ 完成
- Sprint 1 ✅ 完成（CDP 端到端验证通过；含 2 个持久化 bug 修复）
- **v7 基座裁剪（2026-11-24）**：删除 9 张空壳扩展表、家庭/成员表、未接入的 `ext_mounts`/`ext_kv`；版本表改单行；outbox 去 `pushed`；归属字段从 meta 移除（见 ADR-007）
- Sprint 2–9 ⬜ 待开始（其中 6/7/8 需外部条件）

每完成一个 Sprint，更新本节状态与 FEATURES.md 对应条目标记。
