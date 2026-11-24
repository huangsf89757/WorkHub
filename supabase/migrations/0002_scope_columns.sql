-- WorkHub 云端同步 schema（ADR-008 维度 A：归属层预留）
-- 为 sync_records 增加通用归属列 scope_type/scope_id，个人期填 user/<uid>，
-- 团队期填 team/<id> + 成员表与可见性 RLS。存量行一条 UPDATE 回填，不丢数据。
-- 验证脚本：test_scope.sql。

-- ============================================================
-- 1. 加归属列（scope_id 先可空，回填后再置 NOT NULL）
-- ============================================================
alter table public.sync_records
  add column if not exists scope_type text not null default 'user',
  add column if not exists scope_id   text;

-- scope_type 约束：通用归属类型，为团队/组织预留
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sync_records_scope_chk') then
    alter table public.sync_records add constraint sync_records_scope_chk
      check (scope_type in ('user', 'team', 'org'));
  end if;
end $$;

-- ============================================================
-- 2. 存量回填：所有历史行归属到其 user_id
-- ============================================================
update public.sync_records
  set scope_id = user_id::text
  where scope_id is null;

alter table public.sync_records alter column scope_id set not null;

-- ============================================================
-- 3. 放宽 op 约束：为未来 CRDT 域的增量操作（crdt-op）铺路
-- ============================================================
alter table public.sync_records drop constraint if exists sync_records_op_chk;
alter table public.sync_records add constraint sync_records_op_chk
  check (op in ('upsert', 'delete', 'crdt-op'));

-- ============================================================
-- 4. 复合索引：按归属 + 域 + 时间戳拉取
-- ============================================================
create index if not exists sync_records_scope_idx
  on public.sync_records (scope_type, scope_id, domain, updated_at);

-- ============================================================
-- 5. 更新 sync_push：新写入自动填 scope（个人期 = user/<uid>）
--    仅改 insert 的字段列表与 values，LWW/返回结构保持与 0001 完全一致。
-- ============================================================
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
      (user_id, domain, record_id, op, record, updated_at, updated_by, deleted_at, rev, server_time, scope_type, scope_id)
    values
      (v_uid, v_change->>'domain', v_rid, coalesce(v_change->>'op','upsert'), v_record,
       v_updated, v_by, v_deleted, v_rev, now(), 'user', v_uid::text)
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
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'accepted', v_accepted,
    'skipped',  v_skipped,
    'serverTime', (extract(epoch from now()) * 1000)::bigint
  );
end $$;

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
