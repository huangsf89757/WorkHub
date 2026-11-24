# 多端同步技术选型设计（可插拔合并策略）

> 日期：2026-11-24 · 状态：设计已确认，待落成 ADR-008
> 目标：在个人工作台早期确定同步架构，使未来团队化/多人协作时按扩展插拔策略，不推倒重来。

## 1. 背景与诉求

- 当前：个人多设备，记录级 LWW + 中心化 Supabase 判定（Sprint 8 已验证）。
- 未来：可能发展为组织/团队工作台，协作形态不确定——有的扩展极低频修改（TODO），有的高频多人并发（白板/协同文档）。
- 核心诉求：**早期定架构、避免后期返工**；**不过早锁定具体算法**，让每个扩展按需选策略。

## 2. 核心判断

返工风险不在"选 LWW 还是 CRDT"，而在数据模型没预留"归属与可见性"的扩展位。ADR-005 撤销家庭模型时删掉了 `userId/ownerId/scope/householdId`——正是团队化所需，只是当时的"以家庭为单元"预设错了。

因此把架构切成**两个正交维度**，分别定策略：

| 维度 | 决策 | 演进方式 |
|---|---|---|
| A. 归属与可见性 | 地基，现在预留通用扩展位 | 团队化 = 填 scope 值 + 加成员表，不改表结构 |
| B. 合并策略 | 可插拔，按域选择 | 按扩展注册策略，不动其他域、不动云端表 |

## 3. 方案对比

| 维度 | A 全盘 CRDT | B 维持 LWW 未来重写 | C 分层解耦 + 按域可插拔（采用） |
|---|---|---|---|
| 现在改动 | 大（引入 Yjs，破零构建） | 无 | 小（加策略抽象 + 归属预留） |
| 团队化返工 | 无但个人期背负复杂度 | 大（推倒重来） | 小（注册策略 + 填 scope） |
| 个人期负担 | 高 | 无 | 极低（默认仍 LWW） |
| 适配不确定未来 | 强但过重 | 弱 | 强且按需 |

## 4. 维度 A：归属与可见性（地基预留）

云端 `sync_records` 把 `user_id` 抽象为通用归属：新增 `scope_type`（`user`/`team`/`org`）+ `scope_id`。

- 个人期：填 `user/<uid>`，RLS 退化为现状 `user_id = auth.uid()`（`user_id` 保留为冗余兼容列或由 scope 派生）
- 团队期：填 `team/<id>`，加成员关系表 + 可见性 RLS 策略
- 迁数据：现有行 `scope_type='user', scope_id=user_id`，一条 UPDATE 回填，不丢数据

## 5. 维度 B：按扩展可插拔的合并策略

### 5.1 注册 API

```js
declareSync(domain, {
  strategy: 'lww-record' | 'lww-field' | 'crdt',
  crdt?: 'yjs' | ...      // strategy=crdt 时指定实现
});
```

策略是**域的静态属性**，不是用户级、不做运行时检测：用户从 TODO 切到白板，按当前写入域自动走对应策略。

### 5.2 策略接口

```js
{
  // 序列化：本地变更 → 同步载荷
  encode(change) -> payload,
  // 合并：本地状态 + 远端载荷 → 新状态
  merge(localState, remotePayloads) -> newState,
  // 传输形态：'record'（整条记录）| 'op'（增量操作）
  transport: 'record' | 'op'
}
```

- `lww-record`：现有 `lwwWinner` + `mergeDomain`，transport=record
- `lww-field`：字段级时间戳合并，transport=record（未来）
- `crdt`：Yjs `applyUpdate`，transport=op（未来，按需给特定域）

### 5.3 关键：传输形态差异

"可插拔"不能只是换 `merge()` 函数——CRDT 与 LWW 的传输形态不同：

- LWW：传整条记录，云端用 `updated_at` 判胜负
- CRDT：传增量操作（Yjs update），云端**不能**用 LWW 判定（会丢并发操作），只做存储转发

推荐路径：CRDT 操作更新也装进通用 `sync_records`，用专用 `op='crdt-op'` + 每次 update 独立 `record_id`（不覆盖），云端退化为"只存不判"，合并在客户端用 CRDT 库完成。云端表结构不变。

### 5.4 零构建约束的处理

引入 Yjs 会触碰"零构建"约束。选项：放 `vendor/`（本地 ESM 单文件）或 ESM CDN。 admit 为权衡项，到真正需要 CRDT 域时再决定，不在现在引入。

## 6. 影响

- 变容易：新增扩展按域选策略；团队化加成员表与 scope 值；某域升级策略不影响其他域
- 变难：sync.js 需引入策略注册表（一次性小改）；云端 scope 迁移需一条回填 UPDATE
- 需重访：真正上 CRDT 域时确定 vendor/CDN 方案与操作日志膨胀治理

## 7. 行动项

1. 写 ADR-008（本文档落成正式决策记录）
2. `sync-protocol.md` 补"按扩展可插拔"章节
3. 实现期：`sync.js` 加 `declareSync` 与策略注册表（默认 lww-record，行为不变）
4. 实现期：云端 `0002_scope_columns.sql` 迁移（scope_type/scope_id + 回填）
5. 未来：某域需要字段级/CRDT 时，注册对应策略并按需引入 CRDT 库
