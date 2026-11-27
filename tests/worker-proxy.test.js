/* worker-proxy.test.js — Workers 同步代理与前端同源调用 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
import worker from '../worker.js';

installLocalStorage();
installFakeBrowser();

const env = {
  SUPABASE_URL: 'https://demo.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  WORKHUB_EMAIL: 'u@example.com',
  WORKHUB_PASSWORD: 'pw',
  ASSETS: { fetch: async () => new Response('static', { status: 200 }) },
};

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
      json: async () => r.body ?? {},
    };
  };
  return calls;
}

test('非 API 路径交给静态资源', async () => {
  const res = await worker.fetch(new Request('https://x.workers.dev/index.html'), env);
  assert.equal(await res.text(), 'static');
});

test('RPC 由服务端登录 Supabase 并注入 token', async () => {
  const calls = mockFetch([
    { body: { access_token: 'srv-token', expires_in: 3600 } },
    { body: { accepted: 1, skipped: 0 } },
  ]);
  const req = new Request('https://x.workers.dev/api/rpc/sync_push', {
    method: 'POST', body: JSON.stringify({ p_changes: [] }),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(await res.text()), { accepted: 1, skipped: 0 });
  assert.equal(calls[0].url, 'https://demo.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(calls[1].url, 'https://demo.supabase.co/rest/v1/rpc/sync_push');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer srv-token');
  assert.equal(calls[1].opts.headers.apikey, 'anon-key');
});

test('同一 Worker 实例内复用 token，不重复登录', async () => {
  const calls = mockFetch([{ body: { accepted: 2 } }]);
  const req = new Request('https://x.workers.dev/api/rpc/sync_pull', {
    method: 'POST', body: JSON.stringify({ p_since: 0 }),
  });
  await worker.fetch(req, env);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://demo.supabase.co/rest/v1/rpc/sync_pull');
});

test('未知 RPC 直接 404，不打 Supabase', async () => {
  const calls = mockFetch([]);
  const res = await worker.fetch(new Request('https://x.workers.dev/api/rpc/evil'), env);
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});

test('workers.dev 下适配器走同源代理，不注入浏览器凭据', async () => {
  globalThis.location = { hostname: 'workhub.hsf89757.workers.dev' };
  try {
    const calls = mockFetch([{ body: { accepted: 3 } }]);
    const { createSupabaseAdapter } = await import('../js/cloud-adapter.js');
    const adapter = createSupabaseAdapter();
    const result = await adapter.push([{ domain: 'todos', op: 'upsert', record: { id: 'x' } }]);
    assert.equal(result.accepted, 3);
    assert.equal(calls[0].url, '/api/rpc/sync_push');
    assert.equal(calls[0].opts.headers.apikey, undefined);
    assert.equal(calls[0].opts.headers.Authorization, undefined);
  } finally {
    delete globalThis.location;
  }
});
