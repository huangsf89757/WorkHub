/* pref-sync.test.js — 系统偏好跨端同步（sys_settings 域） */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';

installLocalStorage();
// 模拟老设备：重置标记已存在，base.js 加载时不会执行一次性重置
localStorage.setItem('wh_sys_settings_reset_v1', '1');
installFakeBrowser();

const { bus, store, SYNCED_PREF_KEYS } = await import('../js/base.js');
const { PREFS_DOMAIN, applyRemotePrefs, bootstrapPrefs, setRemoteAdapter, push, syncSnapshot } = await import('../js/sync.js');
const { getDeviceId } = await import('../js/platform.js');
const { nextTs, _reset } = await import('../js/hlc.js');

/** 注入捕获型远端，返回最近一次 push 的变更列表读取器 */
function captureRemote() {
  let changes = [];
  setRemoteAdapter({
    push: async list => { changes = list; return { accepted: list.length, skipped: 0 }; },
    pull: async () => ({ domains: {}, serverTime: 0 }),
  });
  return () => changes;
}

test('白名单偏好写入生成 sys_settings 同步记录', async () => {
  _reset();
  const captured = captureRemote();
  store.set('themeStyleMounts', { classic: { 'left:top': 'todo' } });
  await push();
  const pref = captured().find(c => c.domain === PREFS_DOMAIN && c.record.id === 'themeStyleMounts');
  assert.ok(pref, '偏好应进入 outbox');
  assert.equal(pref.record.value.classic['left:top'], 'todo');
  assert.ok(pref.record.meta.updatedAt > 0);
  assert.equal(pref.record.meta.updatedBy, getDeviceId());
  setRemoteAdapter(null);
});

test('设备身份等本地专属偏好不入同步队列', async () => {
  const captured = captureRemote();
  assert.equal(SYNCED_PREF_KEYS.includes('deviceId'), false);
  store.set('deviceId', 'dev_should_not_sync');
  await push();
  assert.equal(captured().some(c => c.record.id === 'deviceId'), false);
  setRemoteAdapter(null);
});

test('远端较新偏好覆盖本地并广播重绘', () => {
  _reset();
  store.set('extEnabled', { todo: false });
  const ts = nextTs() + 1000;
  let events = 0;
  const off = bus.on('pref:synced', () => { events++; });
  const { changed } = applyRemotePrefs([{
    id: 'extEnabled', value: { todo: true },
    meta: { updatedAt: ts, updatedBy: 'dev_remote', rev: 1, deletedAt: null },
  }]);
  off();
  assert.equal(changed, 1);
  assert.deepEqual(store.get('extEnabled'), { todo: true });
  assert.equal(events, 1);
});

test('本地较新偏好不被远端旧值覆盖', () => {
  _reset();
  store.set('mountEnabled', { classic: { 'left:top': true } });
  const { changed } = applyRemotePrefs([{
    id: 'mountEnabled', value: {},
    meta: { updatedAt: 0, updatedBy: 'dev_old', rev: 1, deletedAt: null },
  }]);
  assert.equal(changed, 0);
  assert.deepEqual(store.get('mountEnabled'), { classic: { 'left:top': true } });
});

test('远端偏好重复应用不产生同步回声', async () => {
  const captured = captureRemote();
  const record = {
    id: 'themeColor', value: 'light',
    meta: { updatedAt: nextTs() + 5000, updatedBy: 'dev_remote', rev: 1, deletedAt: null },
  };
  applyRemotePrefs([record]);
  const pendingAfterFirst = syncSnapshot().pending;
  applyRemotePrefs([record]);
  assert.equal(syncSnapshot().pending, pendingAfterFirst);
  await push();
  assert.equal(captured().some(c => c.record.id === 'themeColor'), false);
  setRemoteAdapter(null);
});

test('旧版本存量偏好启动时补种入队，且不重复补种', async () => {
  const captured = captureRemote();
  store.rawSet('searchRules', { enabled: true });
  assert.ok(bootstrapPrefs() >= 1);
  assert.equal(bootstrapPrefs(), 0, '已有 meta 的偏好不重复补种');
  await push();
  assert.equal(captured().filter(c => c.record.id === 'searchRules').length, 1);
  setRemoteAdapter(null);
});
