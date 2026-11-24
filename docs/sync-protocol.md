# 多端同步协议 v1

> 配套 `js/sync.js` + `js/cloud-*.js` · 2026-11-23 定稿，2026-11-24 更新落地状态
> 状态：协议已定义，云端适配器（Supabase CloudAdapter）已实现并由 `cloud-sync.js` 注入；无配置时保持离线 no-op。目标场景：手机加 todo → Mac 同步出现。
> 本文 §4/§5 的 `{...}` 为**协议语义示意**，真实 HTTP 形态见 §8.1（PostgREST RPC）。

## 1. 原则

1. **本地优先**：所有写先落本地，立即可见；同步在后台进行，失败不阻塞使用
2. **全局唯一 ID**：记录用 `crypto.randomUUID()`，跨端不会碰撞
3. **LWW 冲突解决**：以 `meta.updatedAt` 判定胜者，相等时按 `updatedBy`(deviceId) 字典序打破平局
4. **软删除**：删除是墓碑而非物理删除，才能传播到其他端
5. **增量同步**：按 `since` 拉取变更，不全量传输

## 2. 记录元数据（每条记录必带）

```js
meta: {
  updatedAt: Number,      // 最后修改时间（Unix ms），LWW 依据
  updatedBy: String,      // 设备 ID（platform.getDeviceId）——平局判定
  deletedAt: Number|null, // 删除墓碑时间
  rev: Number             // 单调递增版本（诊断/乐观锁预留）
}
```

> schema v6 起同步四字段以**独立列为真相源**，`meta` JSON 只保留未提升的扩展字段（读回由 `fromMeta()` 用独立列覆盖恢复）。家庭/组织归属字段（`userId`/`ownerId`/`scope`/`householdId`）已随 ADR-005 撤销移除。详见 [数据库设计说明书 §7](database-design.md#7-通用字段与-meta)。

时钟：客户端时间可能漂移。当前用 `hlc.js` 单调时间戳（本地取 `max(now, last+1)`，合并时吸收远端时间戳，超前 24h 以上的异常值忽略），不再单纯依赖系统时钟；两端同时刻依次比 `rev`、`deviceId` 收敛。

## 3. 变更日志（outbox）

- 每次 `commit()` 生成一条：`{seq, domain, op: 'upsert'|'delete', record, at}`
- 本地 DB `sys_outbox` 表持久化，页重载不丢；`restoreOutbox()` 启动时恢复
- 同一 `(domain, record.id)` 多次修改合并为最新一条（旧 seq 被 ack）；`push()` 成功后 ack 出队（直接删除队列行；v7 已移除恒为 0 的 `pushed` 列）
- 离线时照常入队，恢复在线统一推送

## 4. 推送协议 push（语义示意）

```text
push(changes)  # changes: [{ seq, domain, op, record }]
→ accepted     # 服务端按 LWW 合并后回执
```

服务端按 LWW 合并，返回已接受变更。客户端据此 ack 出队。幂等：同一 `(user_id, domain, record_id)` 由云端唯一键 + LWW 收敛，重复推送不产生重复。真实 HTTP 形态见 §8.1。

## 5. 拉取协议 pull（语义示意）

```text
pull({ since: lastPullAt })
→ { domains: { todos: [...], ... }, serverTime }
```

- 只返回 `updated_at > since` 的记录（含墓碑）
- 客户端 `mergeDomain(localArr, remoteArr)` 按 LWW 合并
- 墓碑超过 30 天且早于「已成功同步时间点」才物理清理（未启用同步不清理，防复活）
- 更新 `lastPullAt = serverTime`；真实 HTTP 形态见 §8.1

## 6. 一次完整同步

```
syncNow():
  1. push()             — 本地变更上行
  2. pull(applyFn)      — 远端变更下行并合并
  3. bus.emit('data')   — 五区重绘
```

调度：在线 + 有 remote 时，默认 30s 轮询；离线不空转。移动端壳可改为系统后台同步触发。

## 7. 冲突处理细则

| 场景 | 处理 |
|---|---|
| 两端改不同记录 | 各自保留，无冲突 |
| 两端改同一记录不同字段 | v1 记录级 LWW，后写覆盖（丢一端）；笔记类 v2 升级字段级 / CRDT |
| 一端删除、一端编辑 | `deletedAt` 参与 LWW，时间戳大者胜；编辑较新则复活 |
| 时间戳相等 | 按 `updatedBy` 字典序打破平局，保证各端收敛到同一结果 |

## 8. 服务端职责（Supabase 实现）

- 鉴权：Supabase Auth 邮箱登录；`auth.uid()` 标识用户，单机未登录时不启用同步
- 数据可见性：RLS 策略 `user_id = auth.uid()`，数据库层强制隔离（组织架构未定，暂无团队共享）
- 存储：通用表 `sync_records`（见 `supabase/migrations/0001_sync_schema.sql`），domain 由记录自报
- LWW 合并：RPC `sync_push` 服务端判定，算法与客户端一致
- 墓碑清理：手动调用 `sync_purge_tombstones`，不开放给客户端
- 端到端加密：待 v3（当前明文传输，依赖 HTTPS + RLS）

### 8.1 真实 HTTP 形态（PostgREST RPC，零 SDK）

前端 `cloud-adapter.js` 用 `fetch` 直连 Supabase，`apikey` + `Authorization: Bearer <access_token>` 随请求发送：

| 操作 | 请求 | 说明 |
|---|---|---|
| push | `POST /rest/v1/rpc/sync_push`，Body `{ p_changes: [...] }` | 批量 upsert，服务端 LWW，返回 `{ accepted, skipped, serverTime }`；`serverTime` 为数据库 `now()` |
| pull | `POST /rest/v1/rpc/sync_pull`，Body `{ p_since: <HLC 毫秒> }` | 返回 `{ domains, serverTime }`；`serverTime` 为本批最大 `updated_at`（HLC 水位），用于更新 `lastPullAt` |

> 注意区分两个 `serverTime`：`sync_push` 返回的是数据库 `now()`（仅作参考），`sync_pull` 返回的是增量游标水位（用于本地持久化 `lastPullAt`）。二者语义不同。

## 9. 接入方式（已实现）

1. 适配器 `createSupabaseAdapter()` 已实现：`{ push(changes), pull({since}) }`，走 PostgREST RPC
2. `cloud-sync.js` 的 `refreshCloudSync()` 在有配置且有有效会话时调用 `setRemoteAdapter(adapter)` 并 `startAutoSync((domain, records) => applyRemote(domain, records))`
3. `main.js` 只调用非阻塞的 `initCloudSync()`（续期会话 / 注入 adapter）
4. 设置页填 URL 与 anon key 并点「保存配置」后，状态显示「已连接 · 自动同步中」
5. 无配置或无会话时以上均不生效，应用完全离线可用

## 10. 风险

- 客户端时钟漂移导致 LWW 误判 → 服务端校准（接入时解决）
- 全量领域重写与增量同步的写放大 → v2 改行级 upsert
- 删除墓碑膨胀 → 30 天清理策略
- 离线队列无限增长 → 未来加容量上限与压缩

## 11. 通用表 `sync_records` 的设计理由与扩展演进路径

### 11.1 为什么云端用一张通用表

云端与本地职责不同：本地 SQLite 是**真相源 + 查询引擎**，按业务拆表以便建列、排序、索引；云端 Supabase 只是**同步总线**，只负责"存变更、按用户分发、判定 LWW"。

因此云端不解析业务字段，只认五个通用维度：`user_id`（谁）、`domain`（哪个业务域）、`record_id`（哪条）、`updated_at`（LWW 依据）、`record jsonb`（业务记录原样透传）。无论将来是 todos、notes 还是 projects，云端代码无需改动。已兑现的收益：

1. 新增扩展零改云端：本地 `declareDomain()` 即可，云端不建表、不改 RPC/RLS、不跑迁移。
2. 统一 LWW：所有域共用 `sync_push` / `sync_pull`，冲突算法只有一份。
3. 统一权限：一张表一条 `user_id = auth.uid()` RLS 策略，安全面收敛。
4. 协议解耦：push/pull 契约与业务结构无关（协议 v1 冻结）。

若云端也按业务拆表，每加一个扩展都要改建表、该表 RPC、该表 RLS、迁移与同步分支——ADR-007 正是为避免"空壳表/过度预设"而裁剪。

### 11.2 扩展增多、业务复杂时的分层演进

通用表不是永远够用，但有明确的分级应对，按触发条件逐级做，不必提前重构：

| 触发条件 | 应对 | 影响层 |
|---|---|---|
| 高频同步写放大 | `persistDomain` 从整域 DELETE+INSERT 改为行级 `INSERT … ON CONFLICT DO UPDATE` | 本地 db.js，不动云端通用表 |
| 想在云端直接 SQL 报表 | 从 `record` JSON 用 generated 列或表达式索引投影常用字段（如 `record->>'due'`），不改表结构 | 云端索引/视图 |
| 单用户记录上万 / 团队共享 | 引入复合游标 `(updated_at, record_id)` 分页替代 `p_since`；按 domain 分区 | 云端 RPC |
| 两端同改一条不同字段丢数据 | LWW 从记录级升到字段级 / CRDT | 合并算法，与表结构无关 |
| 某域成为性能黑户（如笔记全文搜索） | 仅该域拆专用表，其余继续用通用表（混合模式） | 该域特例 |
| 重启组织结构 / 多租户 | 改 `user_id` 语义为 org/team scope，加关系表与可见性策略 | 权限层，通用表仍承载 |

**结论**：复杂度增长时，绝大多数情况改的是算法（LWW 粒度）、索引（查询）、分页（规模），而非推翻表结构。只有明确的单个热点域才开专用表特例——这是渐进演进，不是一次性重构。

## 12. 按扩展可插拔的合并策略（ADR-008）

> 决策记录：[ADR-008](adr-008-sync-strategy.md) · 设计过程：[docs/plans/2026-11-24-sync-strategy-design.md](../docs/plans/2026-11-24-sync-strategy-design.md)

同步架构分两个正交维度，均为早期定架构、避免团队化返工：

> ⚠️ 本节为 ADR-008 的**架构设计决策**，尚未落地到代码：`declareSync`、`scope_type`/`scope_id` 归属列、`0002_scope_columns.sql` 迁移目前均不存在（`supabase/migrations/` 仅有 `0001_sync_schema.sql` 与 `test_rls.sql`）；Action Items 仍为待办。当前实际生效的是单一的记录级 LWW（§7、§8）。

- **维度 A 归属与可见性（地基，待落地）**：设计为云端 `sync_records` 预留 `scope_type`(user/team/org) + `scope_id`；个人期填 `user/<uid>`，团队期填 `team/<id>` + 成员表与可见性 RLS。存量行一条 UPDATE 回填。这是 ADR-005 撤销家庭模型时应保留的通用扩展位。
- **维度 B 合并策略（按扩展插拔，待落地）**：设计 `declareSync(domain, { strategy })` 注册，策略是**域的静态属性**（非用户级运行时检测）。接口 `{ encode, merge, transport }`：

| 策略 | 状态 | 合并依据 | transport |
|---|---|---|---|
| `lww-record` | 当前唯一生效（硬编码于 `lwwWinner`/`mergeDomain`，非经 `declareSync` 注册） | 记录级 `updatedAt/rev/deviceId` | record |
| `lww-field` | 设计，未实现 | 字段级时间戳 | record |
| `crdt` | 设计，未实现 | Yjs `applyUpdate` | op |

设计目标：将来 `declareSync` 落地后，用户从 TODO（lww-record）切到白板（crdt）时，同步引擎按当前写入域自动走对应策略。当前所有域统一走记录级 LWW。

**关键约束**：CRDT 传增量操作，云端不能用 LWW 判定（会丢并发操作）。设计上 CRDT 更新同样装入通用 `sync_records`，用 `op='crdt-op'` + 每次 update 独立 `record_id`，云端只存不判、合并全在客户端——云端表结构不变。注意当前 `sync_records.op` 的 CHECK 仅允许 `upsert`/`delete`，落地 `crdt-op` 时需放宽该约束。CRDT 库（Yjs）到真正需要时再引入（vendor ESM 或 CDN），现在不引入以守住零构建约束。
