# WorkHub 文档索引

## 架构与设计

| 文档 | 说明 |
|---|---|
| [architecture.md](architecture.md) | 架构 v2：五区布局、双扩展维度、分层、数据流、全端策略（ADR-003/004） |
| [database-design.md](database-design.md) | 数据库设计说明书（权威，v7 系统基座）：8 张表逐列定义、ER 图、命名规范、存储层次、数据流、迁移机制、DAO/同步、完整建表 SQL |
| [multi-user-design.md](multi-user-design.md) | 多用户协作演进（ADR-005）· **已撤销**：家庭模型移除，待通用组织结构重新设计 |
| [sync-protocol.md](sync-protocol.md) | 多端同步协议：outbox / LWW / 软删除 / push-pull / CloudAdapter 接入 |
| [supabase-setup.md](supabase-setup.md) | Supabase 云端后端接入：建项目/跑迁移/RLS 验证/配置/多端验证 |

## 扩展（业务功能）

> 仅收录**已实现**扩展的规格文档。规划中扩展见 [`FEATURES.md`](../FEATURES.md)。

| 扩展 | 状态 | 文档 |
|---|---|---|
| `todo` | ✅ 已实现 | [extensions/todo.md](extensions/todo.md) |

## 界面样式

| 界面样式 | 状态 | 文档 |
|---|---|---|
| `classic`（经典分栏） | ✅ 已实现 · 默认 | [skins/classic.md](skins/classic.md) |
| `studio3d`（3D 工作室） | ✅ 已实现 | [skins/studio3d.md](skins/studio3d.md) |

## 项目根文档

| 文档 | 说明 |
|---|---|
| [`PRODUCT.md`](../PRODUCT.md) | 产品定位与功能事实 |
| [`FEATURES.md`](../FEATURES.md) | 扩展与界面样式清单、跨端能力状态、新增约定 |
| [`ROADMAP.md`](../ROADMAP.md) | 分阶段实现排期（Sprint 0–9） |
