# Supabase 云端同步接入指南

> 面向：WorkHub 本地优先架构的云端后端（schema v7/v8 之后的同步闭环）
> 状态：代码已就绪，需用户在 Supabase 建项目并执行迁移后即可使用。

## 0. 架构概览

```
本地 SQLite（真相源） → outbox 落库 → CloudAdapter → Supabase RPC(sync_push)
                                              ← RPC(sync_pull) ← 远端变更 → LWW 合并 → 本地
```

- **一张通用表** `sync_records` 承载所有扩展域（domain 由记录自报），新增扩展零改云端表
- **RLS** 用 `auth.uid()` 做用户隔离，数据库层强制，不靠应用过滤
- **LWW** 服务端与客户端算法一致：`updated_at` 大者胜 → `rev` 大者胜 → `updated_by` 字典序
- **零构建**：前端直连 Supabase REST / Auth / RPC，无 npm 依赖、无 SDK、无打包器

## 1. 建项目并执行迁移

1. 在 https://supabase.com 新建项目（记住 Region，选离你近的）
2. 进入 **SQL Editor → New query**
3. 粘贴执行 `supabase/migrations/0001_sync_schema.sql`（整段一次执行）
4. 验证 RLS：同目录执行 `test_rls.sql`，输出 `ALL RLS TESTS PASSED` 即通过（会建/删两个临时测试用户）
5. 在 **Authentication → Providers → Email** 开启邮箱登录；若希望注册即用无需邮件确认，关闭 **Confirm email**

## 2. 取连接信息

在 **Project Settings → API** 取两项：

| 项 | 用在哪 |
|---|---|
| Project URL | 设置页「Project URL」 |
| anon / publishable key | 设置页「anon / publishable key」 |

> ⚠️ **不要**把 service_role / secret key 填进前端。anon key 是公开标识，安全由 RLS 保证。

## 3. 应用内配置

1. 打开 WorkHub → 设置 → 账户 → **云端同步（Supabase）**
2. 填 URL 与 anon key → 保存配置
3. 用邮箱注册 / 登录（同一邮箱即同一云端账号，多端数据互通）
4. 状态显示「已连接 · 自动同步中」即成功；可点「立即同步」手动触发一次

启动流程：有配置且有有效 refresh token 时静默续期并注入 adapter；否则保持纯本地模式，离线可用不受影响。

## 4. 同步行为与数据映射

| 环节 | 说明 |
|---|---|
| 推送 | 本地 outbox 条目 `{seq,domain,op,record}` 映射到 `sync_push(p_changes)`；`record` 原样透传（含 `meta`） |
| 拉取 | `sync_pull(p_since)` 返回 `{domains, serverTime}`；`applyRemote` 按 LWW 合并并落本地 |
| 游标 | `lastPullAt` 为本批最大 `updated_at`（客户端 HLC 毫秒），持久化，重启不重拉 |
| 删除 | 软删墓碑（`meta.deletedAt`）随同步传播；本地 30 天后才物理清理 |
| 上报 | 服务端按唯一键 `(user_id, domain, record_id)` upsert；本地版本较旧时跳过（保留服务端胜者） |

## 5. 令牌策略（纯前端权衡）

- `access_token`：仅内存，页面刷新即失效，靠 `refresh_token` 静默续期
- `refresh_token`：存 localStorage（`wh_sys_settings_cloudRefreshToken`）。这是无 BFF / 零构建纯前端的 Supabase 官方模式；若将来引入 httpOnly cookie 网关，可平滑改为服务端持有
- 401 事件 `sync:auth-error` 会停用 adapter 并提示重新登录

## 6. 验证多端同步

1. A 端（如 Mac 浏览器）：登录并新增一条待办
2. 点「立即同步」，确认 outbox 待推送数归零
3. B 端（如 iPhone 浏览器）：同一邮箱登录，点「立即同步」
4. B 端应出现 A 端新增的待办；反向操作同理

## 7. 运维（可选）

- **墓碑清理**：定期用 service_role 调用 `public.sync_purge_tombstones(p_before)`，`p_before` 传 30 天前的 HLC 毫秒时间戳。函数未授权给 authenticated，客户端无法调用，避免误删未同步墓碑
- **存储上限**：单记录 `record` 上限 1MB（CHECK 约束）；超出请拆记录或走对象存储

## 8. 已知限制

- 记录级 LWW，两端同改一条记录的不同字段会丢一端（笔记类未来升级 CRDT）
- 客户端 HLC 时间戳可被篡改，服务端未做时钟校准（v2 待做）
- 拉取不分页：单人规模足够；数据量大时需引入复合游标 `(updated_at, record_id)` 才能安全分页
- 组织架构未定，当前所有记录归属单个 `auth.uid()`，无团队/家庭共享

## 9. 关键文件

| 文件 | 作用 |
|---|---|
| `supabase/migrations/0001_sync_schema.sql` | 云端表、RLS、RPC |
| `supabase/migrations/test_rls.sql` | RLS 验证脚本 |
| `js/cloud-config.js` / `cloud-auth.js` | 配置与 Auth |
| `js/cloud-adapter.js` / `cloud-sync.js` | CloudAdapter 与同步引导 |
| `js/page-settings.js` | 设置页云端同步 UI |
| `docs/sync-protocol.md` | 同步协议契约 |
