# WorkHub 文档索引

## 架构与设计

| 文档 | 说明 |
|---|---|
| [architecture.md](architecture.md) | 架构 v2：五区布局、双扩展维度、分层、数据流、全端策略（ADR-003/004） |
| [database-design.md](database-design.md) | 数据库设计说明书（权威）：21 张表逐列定义、ER 图、命名规范、存储层次、数据流、三类迁移、DAO/同步/多用户、完整建表 SQL |
| [multi-user-design.md](multi-user-design.md) | 多用户协作演进（ADR-005）：身份上下文、家庭/成员模型、归属 meta、单机零变化 |
| [sync-protocol.md](sync-protocol.md) | 多端同步协议：outbox / LWW / 软删除 / push-pull / CloudAdapter 接入 |

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
