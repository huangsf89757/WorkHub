# 多用户协作演进设计（ADR-005）· 已撤销

> **状态：已撤销（2026-11-24）**
> 撤销原因：组织结构尚未确定，家庭模型（`sys_households` / `sys_memberships` + 记录归属 meta）过度预设了"以家庭为协作单元"的形态。
> 后续计划：待明确更通用的组织结构（组织 / 团队 / 项目组 / 个人空间等可配置层级）后，另立 ADR 重新设计，届时再引入用户—组织关系表与可见性模型。

## 撤销时同步执行的变更（schema v7）

- 删除系统表 `sys_households`、`sys_memberships`
- 删除记录 `meta` 中的归属字段：`userId`、`ownerId`、`scope`、`householdId`（迁移时从历史记录剥离）
- `identity.js` 只保留"当前用户"（默认 `me`），移除家庭上下文、可见范围与角色

## 保留的部分

- `sys_users`：本地用户表（单行 `me`）保留，作为将来引入组织模型时的用户主体
- `sys_devices.user_id`：设备归属用户的逻辑外键保留
- 同步机制（outbox / LWW / 墓碑）与组织模型无关，继续沿用

## 参考

- 数据库现状：[database-design.md](database-design.md)
- 原设计内容可在 Git 历史（v7 提交之前）中查阅
