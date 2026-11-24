-- RLS 与同步 RPC 验证脚本（在 Supabase SQL Editor 中以 postgres 角色运行）
-- 用途：确认 RLS 用户隔离按预期工作（两用户互不可见对方记录）。全部断言通过则输出 "ALL RLS TESTS PASSED"。
-- 注意：本脚本只验证 RLS 隔离，不调用 sync_push、不验证 LWW 合并；LWW 由 tests/sync.test.js 覆盖。
-- 注意：本脚本会创建临时测试用户，测试后自动删除；仅用于验证，不影响业务数据。

do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_token  text;
  v_count_a integer;
  v_count_b integer;
begin
  -- 建两个临时用户
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
  values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'rls_test_a@workhub.local', '', now(), now(), now(), 'authenticated', 'authenticated'),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'rls_test_b@workhub.local', '', now(), now(), now(), 'authenticated', 'authenticated');

  -- 以 user A 身份插入两条记录（用 set local 模拟 JWT claim）
  perform set_config('request.jwt.claim.sub', v_user_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.sync_records (user_id, domain, record_id, record, updated_at, updated_by)
  values
    (v_user_a, 'todos', 'r1', '{"id":"r1","title":"A 的记录"}'::jsonb, 1000, 'dev_a'),
    (v_user_a, 'todos', 'r2', '{"id":"r2","title":"A 的记录 2"}'::jsonb, 1100, 'dev_a');

  -- A 只能看到自己的 2 条
  select count(*) into v_count_a from public.sync_records;
  if v_count_a <> 2 then
    raise exception 'RLS 失败：用户 A 可见 % 条，期望 2 条', v_count_a;
  end if;

  -- 切到 user B：看不到 A 的记录
  perform set_config('request.jwt.claim.sub', v_user_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);
  insert into public.sync_records (user_id, domain, record_id, record, updated_at, updated_by)
  values (v_user_b, 'todos', 'r3', '{"id":"r3","title":"B 的记录"}'::jsonb, 1200, 'dev_b');

  select count(*) into v_count_b from public.sync_records;
  if v_count_b <> 1 then
    raise exception 'RLS 失败：用户 B 可见 % 条，期望 1 条（不应看到 A 的数据）', v_count_b;
  end if;

  -- 清理
  reset role;
  delete from public.sync_records where user_id in (v_user_a, v_user_b);
  delete from auth.users where id in (v_user_a, v_user_b);

  raise notice 'ALL RLS TESTS PASSED';
end $$;
