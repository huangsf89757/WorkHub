# ADR-008：多端同步技术选型——归属层预留 + 按扩展可插拔合并策略

**状态**：Accepted（架构决策已定；实现待落地，见 Action Items）
**日期**：2026-11-24
**决策人**：hsf
**关联**：ADR-005（已撤销家庭模型）· ADR-007（基座裁剪）· [同步协议](sync-protocol.md) · [设计过程](../docs/plans/2026-11-24-sync-strategy-design.md)

> **落地状态**：本文是架构决策，以下维度 A 的 `scope_type`/`scope_id`、维度 B 的 `declareSync` 策略注册表，以及 `0002_scope_columns.sql` 迁移**均未实现**。当前代码只有单一的记录级 LWW（`lwwWinner`/`mergeDomain`），云端 `0001_sync_schema.sql` 只有 `user_id` 列。勿将本文设计当作现状。

## Context（背景）

WorkHub 当前是个人多设备工作台，同步机制为**记录级 LWW + 中心化 Supabase 判定**（Sprint 8 完成代码落地与 mock 单测；8 项端到端冒烟 + 6 项双端验证为历史人工验收记录，非仓库自动化测试）。未来可能发展为组织/团队工作台，涉及多人协作，但协作形态**尚不确定**：

- 有的扩展（如 TODO）极低频修改，记录级 LWW 足够；
- 有的扩展（如白板、协同文档）高频多人并发编辑，字符/图元级，丢一端不可接受，需 CRDT/OT。

诉求：**在早期确定架构，避免后期返工；不过早锁定具体算法，让每个扩展按需选策略。**

关键判断：返工风险不在"选 LWW 还是 CRDT"，而在数据模型没有预留"归属与可见性"的扩展位。ADR-005 撤销家庭模型时删除了 `userId/ownerId/scope/householdId`——这些正是团队化所需，只是当时"以家庭为单元"的预设错误。本次以**通用版**重建该扩展位。

## Decision（决策）

把同步架构切分为**两个正交维度**，分别定策略：

### 维度 A：归属与可见性——地基，现在预留

云端 `sync_records` 增加通用归属列：

- `scope_type`：`user` | `team` | `org`
- `scope_id`：对应实体 ID
- 个人期填 `user/<uid>`，RLS 退化为现状；团队期填 `team/<id>`，加成员关系表与可见性策略
- 存量行一条 `UPDATE` 回填（`scope_type='user', scope_id=user_id`），不丢数据

这是 ADR-005 撤销时应保留的通用扩展位；本次补全后，团队化 = 填值 + 加表，不改表结构。

### 维度 B：合并策略——可插拔，按扩展选择

同步引擎引入 `declareSync(domain, options)` 与策略注册表 `domain → strategy`。策略是**域的静态属性**，不做用户级运行时检测：

```js
declareSync('todos',      { strategy: 'lww-record' });        // 低频，默认
declareSync('whiteboard', { strategy: 'crdt', crdt: 'yjs' }); // 高频多人
```

策略接口：

```js
{
  encode(change) -> payload,                          // 本地变更 → 同步载荷
  merge(localState, remotePayloads) -> newState,      // 合并
  transport: 'record' | 'op'                          // 传输形态
}
```

三种策略：

| 策略 | 状态 | 合并依据 | transport |
|---|---|---|---|
| `lww-record` | 算法现有（硬编码，未接入 `declareSync`） | 记录级 `updatedAt/rev/deviceId` | record |
| `lww-field` | 设计，未实现 | 字段级时间戳 | record |
| `crdt` | 设计，未实现 | Yjs `applyUpdate` | op |

**关键约束**：可插拔不止换 `merge()`——CRDT 传增量操作，云端不能用 LWW 判定（会丢并发操作）。故 CRDT 更新也装入通用 `sync_records`，用 `op='crdt-op'` + 每次 update 独立 `record_id`（不覆盖），云端退化为"只存不判"，合并全在客户端。云端表结构不变。

零构建约束：CRDT 库（Yjs）到真正需要时再引入，选项为 `vendor/` 本地 ESM 或 ESM CDN，作为权衡项届时决定，现在不引入。

## Options Considered（备选方案）

### 方案 A：全盘 CRDT
| 维度 | 评估 |
|---|---|
| 现在改动 | 大（引入 Yjs，破坏零构建） |
| 个人期负担 | 高（数据膨胀、调试难） |
| 团队化返工 | 无 |
| 适配不确定未来 | 强但过重 |

**Pros**：理论最强，所有域都能并发协同。
**Cons**：个人阶段白背复杂度；CRDT 元数据膨胀；已验证同步层重写；调试困难。

### 方案 B：维持 LWW，团队化时整体重写
| 维度 | 评估 |
|---|---|
| 现在改动 | 无 |
| 个人期负担 | 无 |
| 团队化返工 | 大（推倒重来） |
| 适配不确定未来 | 弱 |

**Pros**：零成本。
**Cons**：归属字段缺失，团队化要改表结构 + RLS + 迁数据；合并策略硬编码，换 CRDT 要改核心。违背"早期定、避免返工"诉求。

### 方案 C：分层解耦 + 按扩展可插拔（采用）
| 维度 | 评估 |
|---|---|
| 现在改动 | 小（策略抽象 + 归属预留） |
| 个人期负担 | 极低（默认仍 LWW） |
| 团队化返工 | 小（注册策略 + 填 scope） |
| 适配不确定未来 | 强且按需 |

**Pros**：默认零成本；按域插拔；地基一次到位；云端表结构稳定。
**Cons**：sync.js 需加策略注册表（一次性小改）；scope 迁移需一条回填 UPDATE。

## Trade-off Analysis

- 选 C 而非 A：CRDT 的价值在高频细粒度并发编辑，个人阶段无此需求；按域插拔让"需要时再上"，避免过早背负。
- 选 C 而非 B：归属位与策略抽象是"地基"，现在做成本极低，团队化时再补是"重构"，成本差一个数量级。
- 传输形态差异是 C 的主要实现复杂度，通过"CRDT 操作也装通用表、云端只存不判"化解，避免为 CRDT 单独建同步系统。

## Consequences（影响）

- **变容易**：新增扩展按域选策略；团队化加成员表与 scope 值；某域升级策略不影响其他域。
- **变难**：sync.js 引入策略注册表（一次性小改）；云端 scope 迁移需回填。
- **需重访**：真正上 CRDT 域时确定 vendor/CDN 方案、操作日志膨胀治理；组织结构明确时定 scope 层级与可见性模型。

## Action Items

1. [x] 写设计过程文档 `docs/plans/2026-11-24-sync-strategy-design.md`
2. [x] 本 ADR-008 定稿
3. [ ] `sync-protocol.md` 补"按扩展可插拔"章节
4. [ ] 实现期：`sync.js` 加 `declareSync` 与策略注册表（默认 `lww-record`，行为不变）
5. [ ] 实现期：云端 `0002_scope_columns.sql` 迁移（scope_type/scope_id + 回填）
6. [ ] 未来：某域需要字段级/CRDT 时注册策略并按需引入 CRDT 库
