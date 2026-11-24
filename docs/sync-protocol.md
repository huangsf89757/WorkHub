# 多端同步协议 v1（设计稿）

> 配套 `js/sync.js` 骨架 · 2026-11-23
> 状态：协议已定义，云端适配器待接入。目标场景：手机加 todo → Mac 同步出现。

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

> schema v7 起 meta 只含同步四字段。家庭/组织归属字段（`userId`/`ownerId`/`scope`/`householdId`）已随 ADR-005 撤销移除。

> 物理存储说明（schema v6）：上表是**内存/协议层**的完整 meta。落库时同步四字段以独立列为真相源（`meta` JSON 剔除已提升字段），读回由 `fromMeta()` 用独立列覆盖恢复。详见 [数据库设计说明书 §7](database-design.md#7-通用字段与-meta)。

时钟：客户端时间可能漂移。v1 用客户端时间戳；服务端接入后应以 `serverTime` 校准（见 §6）。

## 3. 变更日志（outbox）

- 每次 `commit()` 生成一条：`{seq, domain, op: 'upsert'|'delete', record, at}`
- 本地 DB `sys_outbox` 表持久化，页重载不丢
- `push()` 成功后 ack 出队（直接删除队列行；v7 已移除恒为 0 的 `pushed` 列）
- 离线时照常入队，恢复在线统一推送

## 4. 推送协议 push

```
POST /sync/push
Body: { deviceId, changes: [{ domain, op, record }] }
Resp: { accepted: [seq...], serverTime }
```

服务端按 LWW 合并，返回已接受变更。客户端据此清理 outbox。幂等：同一 `record.id + rev` 重复推送不产生重复。

## 5. 拉取协议 pull

```
GET /sync/pull?since=<lastPullAt>&deviceId=<id>
Resp: { domains: { todos: [...], notes: [...] }, serverTime }
```

- 只返回 `updatedAt > since` 的记录（含墓碑）
- 客户端 `mergeDomain(localArr, remoteArr)` 按 LWW 合并
- 墓碑超过 30 天物理清理
- 更新 `lastPullAt = serverTime`

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
- LWW 合并：RPC `sync_push` 服务端判定，算法与客户端一致；`serverTime` 用客户端 HLC 毫秒
- 墓碑清理：手动调用 `sync_purge_tombstones`，不开放给客户端
- 端到端加密：待 v3（当前明文传输，依赖 HTTPS + RLS）

## 9. 接入步骤（CloudAdapter 就绪后）

1. 实现适配器：`{ push(changes), pull({since}) }`
2. `main.js` 中 `setRemoteAdapter(cloudAdapter)` 注入
3. `startAutoSync((domain, records) => applyRemote(domain, records))`
4. 设置页的"同步引擎"状态自动变为"已接入"
5. 无后端时以上均不调用，应用完全离线可用

## 10. 风险

- 客户端时钟漂移导致 LWW 误判 → 服务端校准（接入时解决）
- 全量领域重写与增量同步的写放大 → v2 改行级 upsert
- 删除墓碑膨胀 → 30 天清理策略
- 离线队列无限增长 → 未来加容量上限与压缩
