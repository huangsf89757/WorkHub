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
  updatedAt: Number,    // 最后修改时间（Unix ms），LWW 依据
  updatedBy: String,    // 设备 ID（platform.getDeviceId）——平局判定仍用设备
  deletedAt: Number|null, // 删除墓碑时间
  rev: Number,          // 单调递增版本（诊断/乐观锁预留）
  // ↓ 多用户协作预留（单机默认 me/private/home，见 ADR-005）
  userId: String,       // 创建/最后修改者（审计/展示）
  ownerId: String,      // 数据归属用户
  scope: String,        // private | family | shared
  householdId: String   // 所属家庭/协作空间
}
```

归属字段随 meta 整包 JSON 落库，不改业务表列；未来按用户/家庭高频过滤时提升为正式列。

时钟：客户端时间可能漂移。v1 用客户端时间戳；服务端接入后应以 `serverTime` 校准（见 §6）。

## 3. 变更日志（outbox）

- 每次 `commit()` 生成一条：`{seq, domain, op: 'upsert'|'delete', record, at}`
- 本地 DB `outbox` 表持久化，页重载不丢
- `push()` 成功后标记 `pushed=1` / 出队
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

## 8. 服务端职责（待实现）

- 鉴权：识别 user / device；单机默认 user=me，多用户升级后识别真实身份
- 数据可见性：按 `meta.ownerId` + `meta.scope` + `meta.householdId` 决定推给谁（private 仅 owner、family 同家庭成员；见 ADR-005）
- 存储：schema 与客户端同构（见 database-design.md）
- LWW 合并：与服务端的权威 `serverTime` 对齐
- 墓碑清理：定期清理超过保留期且已同步到所有端的删除记录
- 可选：同步前 E2E 加密（v3）

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
