-- ADR-008 维度 A（归属层预留）验证脚本（以 postgres 角色运行）
-- 用途：确认 scope_type/scope_id 列、约束、回填与 RPC 新写入填充正确。
-- 全部断言通过则输出 "ALL SCOPE TESTS PASSED"。会建/删一个临时用户，不影响业务数据。

do $$
declare
  v_user uuid := gen_random_uuid();
  v_cols integer;
  v_scope_chk text;
  v_op_chk text;
  v_scope_type text;
  v_scope_id text;
  v_idx integer;
  v_result jsonb;
begin
  -- 1. 两列存在
  select count(*) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'sync_records'
    and column_name in ('scope_type', 'scope_id');
  if v_cols <> 2 then
    raise exception 'scope 列缺失：找到 % 列，期望 2', v_cols;
  end if;

  -- 2. scope_type CHECK 含 team/org（通用扩展位）
  select pg_get_constraintdef(oid) into v_scope_chk
  from pg_constraint
  where conname = 'sync_records_scope_chk';
  if v_scope_chk is null or v_scope_chk not like '%team%' or v_scope_chk not like '%org%' then
    raise exception 'scope_type 约束未覆盖 team/org：%', v_scope_chk;
  end if;

  -- 3. op CHECK 已放宽到 crdt-op（为未来 CRDT 域铺路）
  select pg_get_constraintdef(oid) into v_op_chk
  from pg_constraint
  where conname = 'sync_records_op_chk';
  if v_op_chk is null or v_op_chk not like '%crdt-op%' then
    raise exception 'op 约束未包含 crdt-op：%', v_op_chk;
  end if;

  -- 4. 复合索引存在
  select count(*) into v_idx
  from pg_indexes
  where schemaname = 'public' and tablename = 'sync_records'
    and indexname = 'sync_records_scope_idx';
  if v_idx <> 1 then
    raise exception 'scope 复合索引缺失';
  end if;

  -- 建临时用户并模拟登录（供 RPC 使用）
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'scope_test@workhub.local', '', now(), now(), now(), 'authenticated', 'authenticated');
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 5. RPC 新写入：scope 自动填 user/<uid>
  v_result := public.sync_push(jsonb_build_array(jsonb_build_object(
    'domain', 'todos', 'op', 'upsert', 'updatedAt', 1000, 'rev', 1, 'updatedBy', 'dev_scope',
    'record', jsonb_build_object('id', 'scope-r1', 'meta', jsonb_build_object('updatedAt', 1000, 'rev', 1, 'updatedBy', 'dev_scope'))
  )));
  if (v_result->>'accepted')::integer <> 1 then
    raise exception 'sync_push 未接受测试记录：%', v_result;
  end if;

  reset role;
  select scope_type, scope_id into v_scope_type, v_scope_id
  from public.sync_records where record_id = 'scope-r1' and user_id = v_user;

  if v_scope_type <> 'user' then
    raise exception 'scope_type 期望 user，实际 %', v_scope_type;
  end if;
  if v_scope_id <> v_user::text then
    raise exception 'scope_id 期望 %，实际 %', v_user::text, v_scope_id;
  end if;

  -- 6. crdt-op 可写入（约束已放宽）
  insert into public.sync_records (user_id, domain, record_id, op, record, updated_at, updated_by, scope_type, scope_id)
  values (v_user, 'whiteboard', 'op-1', 'crdt-op', '{"update":"base64"}'::jsonb, 2000, 'dev_scope', 'user', v_user::text);

  -- 清理
  delete from public.sync_records where user_id = v_user;
  delete from auth.users where id = v_user;

  raise notice 'ALL SCOPE TESTS PASSED';
end $$;
