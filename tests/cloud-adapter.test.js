/* cloud-adapter.test.js — Supabase CloudAdapter / Auth 的纯逻辑测试（mock fetch）
 * 验证：RPC 调用格式、令牌注入、push/pull 映射、错误与 401 处理。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
installLocalStorage(); installFakeBrowser();

const { setCloudConfig, clearCloudConfig } = await import('../js/cloud-config.js');
const cloudAuth = await import('../js/cloud-auth.js');
const { createSupabaseAdapter } = await import('../js/cloud-adapter.js');
const { bus } = await import('../js/base.js');

const URL = 'https://demo.supabase.co';
const ANON = 'public-anon-key';

/** 安装 mock fetch：返回队列里的响应，并捕获每次请求 */
function mockFetch(responses) {
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status ? r.status < 400 : true,
      status: r.status || 200,
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };
  return calls;
}

const json = body => ({ text: async () => JSON.stringify(body), ok: true, status: 200 });

test('未配置时 push 抛明确错误', async () => {
  clearCloudConfig();
  const adapter = createSupabaseAdapter();
  await assert.rejects(() => adapter.push([{ domain: 'todos', op: 'upsert', record: { id: 'x' } }]), /未配置/);
});

test('登录 → token 内存 → push 走 sync_push RPC，注入 apikey 与 Bearer', async () => {
  setCloudConfig(URL, ANON);
  const calls = mockFetch([
    { body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, user: { id: 'u1', email: 'a@b.com' } } },
    { body: { accepted: 2, skipped: 0, serverTime: 9999 } },
  ]);
  await cloudAuth.signIn('a@b.com', 'secret1');
  assert.equal(cloudAuth.isSignedIn(), true);
  assert.equal(cloudAuth.getSession().email, 'a@b.com');

  const adapter = createSupabaseAdapter();
  const changes = [
    { seq: 1, domain: 'todos', op: 'upsert', record: { id: 't1', meta: { updatedAt: 100, rev: 1 } } },
    { seq: 2, domain: 'todoGroups', op: 'delete', record: { id: 'g1', meta: { deletedAt: 120, rev: 2 } } },
  ];
  const result = await adapter.push(changes);
  assert.deepEqual(result, { accepted: 2, skipped: 0, serverTime: 9999 });

  // 第二次调用是 sync_push
  const rpc = calls[1];
  assert.equal(rpc.url, `${URL}/rest/v1/rpc/sync_push`);
  assert.equal(rpc.opts.method, 'POST');
  assert.equal(rpc.opts.headers.apikey, ANON);
  assert.equal(rpc.opts.headers.Authorization, 'Bearer access-1');
  const body = JSON.parse(rpc.opts.body);
  assert.equal(body.p_changes.length, 2);
  assert.equal(body.p_changes[0].domain, 'todos');
  assert.equal(body.p_changes[0].record.id, 't1', 'record 原样透传（含 meta）');
  assert.equal('seq' in body.p_changes[0], false, 'outbox 内部字段 seq 不透传');
});

test('pull 走 sync_pull RPC，返回 domains 与 serverTime', async () => {
  setCloudConfig(URL, ANON);
  const calls = mockFetch([
    { body: { access_token: 'access-2', refresh_token: 'r2', expires_in: 3600, user: { id: 'u1' } } },
    { body: { domains: { todos: [{ id: 't9', title: '远端' }] }, serverTime: 3456 } },
  ]);
  await cloudAuth.signIn('a@b.com', 'secret1');
  const adapter = createSupabaseAdapter();
  const result = await adapter.pull({ since: 1000 });
  assert.deepEqual(result.domains.todos, [{ id: 't9', title: '远端' }]);
  assert.equal(result.serverTime, 3456);
  const rpc = calls[1];
  assert.equal(rpc.url, `${URL}/rest/v1/rpc/sync_pull`);
  assert.deepEqual(JSON.parse(rpc.opts.body), { p_since: 1000 });
});

test('401 触发 sync:auth-error 事件并抛出中文错误', async () => {
  setCloudConfig(URL, ANON);
  mockFetch([
    { body: { access_token: 'access-3', refresh_token: 'r3', expires_in: 3600, user: { id: 'u1' } } },
    { status: 401, body: { message: 'JWT expired' } },
  ]);
  await cloudAuth.signIn('a@b.com', 'secret1');
  let fired = false;
  const off = bus.on('sync:auth-error', () => { fired = true; });
  const adapter = createSupabaseAdapter();
  await assert.rejects(() => adapter.pull({ since: 0 }), /云端同步失败/);
  assert.equal(fired, true, '应发出 sync:auth-error 供 UI 提示重新登录');
  off();
});

test('refresh token 续期：内存 token 过期后自动刷新', async () => {
  setCloudConfig(URL, ANON);
  mockFetch([
    { body: { access_token: 'old', refresh_token: 'rr', expires_in: 3600, user: { id: 'u1' } } },
    { body: { access_token: 'fresh', refresh_token: 'rr2', expires_in: 3600, user: { id: 'u1' } } },
  ]);
  await cloudAuth.signIn('a@b.com', 'secret1');
  // 强制让内存 token 过期
  cloudAuth.getSession().expiresAt = 1;
  const token = await cloudAuth.ensureAccessToken();
  assert.equal(token, 'fresh');
});
