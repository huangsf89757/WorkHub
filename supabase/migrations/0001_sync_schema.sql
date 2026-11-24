-- WorkHub 云端同步 schema（Supabase / Postgres）
-- 设计原则：一张通用变更表承载所有扩展域；服务端 LWW 合并；RLS 按 auth.uid() 隔离。
-- 客户端契约见 docs/sync-protocol.md；本地表见 docs/database-design.md。
-- 时间戳统一用 bigint（Unix 毫秒），与客户端 HLC 对齐，避免 timestamptz 与毫秒互转误差。

-- ============================================================
-- 1. 同步记录表
-- ============================================================
create table if not exists public.sync_records (
  id            bigint generated always as identity primary key,  -- 单库顺序主键，索引局部性好
  user_id       uuid        not null references auth.users(id) on delete cascade,
  domain        text        not null,
  record_id     text        not null,
  op            text        not null default 'upsert',
  record        jsonb       not null,
  updated_at    bigint      not null,   -- 客户端 HLC 时间戳（LWW 依据）
  updated_by    text        not null,   -- deviceId（LWW 平局判定）
  deleted_at    bigint,                 -- 墓碑；null=存活
  rev           integer     not null default 1,
  server_time   timestamptz not null default now(),
  constraint sync_records_domain_chk   check (domain ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  constraint sync_records_op_chk       check (op in ('upsert','delete')),
  constraint sync_records_record_id_chk check (char_length(record_id) between 1 and 128),
  constraint sync_records_payload_chk  check (pg_column_size(record) <= 1048576),  -- 单记录上限 1MB
  constraint sync_records_uid_domain_rid_key unique (user_id, domain, record_id)
);

-- 拉取按 updated_at 增量、推送按唯一键 upsert：复合索引覆盖 (user_id, domain, updated_at)
create index if not exists sync_records_user_domain_updated_idx
  on public.sync_records (user_id, domain, updated_at);
-- 墓碑清理按 deleted_at 扫描
create index if not exists sync_records_deleted_idx
  on public.sync_records (deleted_at) where deleted_at is not null;

-- ============================================================
-- 2. RLS：用户只能读写自己的记录（数据库层强制，不靠应用过滤）
-- ============================================================
alter table public.sync_records enable row level security;
alter table public.sync_records force row level security;

-- 幂等建 policy（Postgres 无 CREATE POLICY IF NOT EXISTS）
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sync_records'
      and policyname = 'sync_records_user_isolation'
  ) then
    create policy sync_records_user_isolation on public.sync_records
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- ============================================================
-- 3. 服务端 LWW 判定（内联在 RPC 中，避免额外函数依赖）
--    胜者：updated_at 大者；相等比 rev；再相等按 updated_by 字典序。
--    与客户端 sync.js 的 lwwWinner 完全一致，保证两端收敛。
-- ============================================================

-- 推送：批量 upsert，仅当传入版本胜出才覆盖；返回服务端时间与接受条数。
-- p_changes 元素：{ domain, op, record } —— record 为完整记录（含 id/meta）。
create or replace function public.sync_push(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_change   jsonb;
  v_record   jsonb;
  v_rid      text;
  v_updated  bigint;
  v_rev      integer;
  v_by       text;
  v_deleted  bigint;
  v_accepted integer := 0;
  v_skipped  integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a json array' using errcode = '22023';
  end if;

  for v_change in select * from jsonb_array_elements(p_changes)
  loop
    v_record := v_change->'record';
    v_rid    := v_record->>'id';
    if v_rid is null or char_length(v_rid) = 0 or char_length(v_rid) > 128 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_updated := coalesce((v_change->>'updatedAt')::bigint, (v_record->'meta'->>'updatedAt')::bigint, 0);
    v_rev     := coalesce((v_change->>'rev')::integer, (v_record->'meta'->>'rev')::integer, 1);
    v_by      := coalesce(v_change->>'updatedBy', v_record->'meta'->>'updatedBy', '');
    v_deleted := nullif(v_change->>'deletedAt', '')::bigint;
    if v_deleted is null then
      v_deleted := nullif(v_record->'meta'->>'deletedAt', '')::bigint;
    end if;

    insert into public.sync_records
      (user_id, domain, record_id, op, record, updated_at, updated_by, deleted_at, rev, server_time)
    values
      (v_uid, v_change->>'domain', v_rid, coalesce(v_change->>'op','upsert'), v_record,
       v_updated, v_by, v_deleted, v_rev, now())
    on conflict (user_id, domain, record_id) do update
      set op          = excluded.op,
          record      = excluded.record,
          updated_at  = excluded.updated_at,
          updated_by  = excluded.updated_by,
          deleted_at  = excluded.deleted_at,
          rev         = excluded.rev,
          server_time = now()
      where
        excluded.updated_at > public.sync_records.updated_at
        or (excluded.updated_at = public.sync_records.updated_at and excluded.rev > public.sync_records.rev)
        or (excluded.updated_at = public.sync_records.updated_at
            and excluded.rev = public.sync_records.rev
            and excluded.updated_by > public.sync_records.updated_by);

    if found then
      v_accepted := v_accepted + 1;
    else
      v_skipped := v_skipped + 1;  -- 本地版本较旧，服务端保留胜者
    end if;
  end loop;

  return jsonb_build_object(
    'accepted', v_accepted,
    'skipped',  v_skipped,
    'serverTime', (extract(epoch from now()) * 1000)::bigint
  );
end $$;

-- 拉取：返回 updated_at > since 的全部记录（含墓碑），按 domain 分组；游标 = 本批最大 updated_at。
-- 不分页：单人数据规模小；分页会让"同 updated_at 的多条记录"卡在边界丢失，需复合游标才能正确，不值得。
create or replace function public.sync_pull(p_since bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_domains   jsonb := '{}'::jsonb;
  v_server_ts bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_since is null or p_since < 0 then
    raise exception 'p_since must be a non-negative bigint' using errcode = '22023';
  end if;

  -- CTE 只在单条 SQL 内有效：changed 必须被同一条语句消费两次，
  -- 不能拆成两条 select ... into，否则第二条引用 changed 会报 relation does not exist。
  with changed as (
    select domain, record, updated_at
    from public.sync_records
    where user_id = v_uid and updated_at > p_since
  ), grouped as (
    select domain as d, jsonb_agg(record order by updated_at, record->>'id') as recs
    from changed
    group by domain
  ), aggregated as (
    select
      (select coalesce(jsonb_object_agg(d, recs), '{}'::jsonb) from grouped) as domains,
      (select coalesce(max(updated_at), p_since) from changed) as server_ts
  )
  select domains, server_ts
    into v_domains, v_server_ts
  from aggregated;

  return jsonb_build_object(
    'domains', v_domains,
    'serverTime', v_server_ts
  );
end $$;

-- 权限：只授权 authenticated 走 RPC；service_role 默认全权，不额外授予 anon。
revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
revoke all on function public.sync_pull(bigint) from public, anon;
grant execute on function public.sync_pull(bigint) to authenticated;

-- 墓碑清理（可选，手动执行）：删除超过 30 天且 deleted_at < 已同步水位的记录。
-- 由运维/定时任务调用，不在客户端 RPC 中开放，避免误删未同步墓碑。
create or replace function public.sync_purge_tombstones(p_before bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.sync_records
  where deleted_at is not null and deleted_at < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function public.sync_purge_tombstones(bigint) from public, anon, authenticated;
