import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage, installFakeBrowser } from './helpers.js';
const ls = installLocalStorage(); installFakeBrowser();
const data = await import('../js/data.js');
const backup = await import('../js/backup.js');
const { _reset } = await import('../js/hlc.js');
const { store } = await import('../js/base.js');
data.declareDomain('todos', []);
data.declareDomain('notes', []);

beforeEach(() => { _reset(); data.state.todos.length = 0; data.state.notes.length = 0; });

test('state 不再硬编码业务域，只有 declareDomain 声明的域存在', () => {
  assert.deepEqual(Object.keys(data.state).sort(), ['notes', 'todos']);
});
test('declareDomain 优先从本地镜像恢复，而不是用种子覆盖', () => {
  store.set('mirrorDemo', [{ id: 'a' }]);
  data.declareDomain('mirrorDemo', [{ id: 'seed' }]);
  assert.deepEqual(data.state.mirrorDemo, [{ id: 'a' }]);
});
test('写入的 updatedAt 严格递增；删除会递增 rev 并打墓碑', () => {
  const a = data.insert('todos', { title: 'a' });
  const b = data.insert('todos', { title: 'b' });
  assert.ok(b.meta.updatedAt > a.meta.updatedAt);
  data.remove('todos', a.id);
  assert.equal(a.meta.rev, 2);
  assert.ok(a.meta.deletedAt);
  assert.equal(data.alive('todos').length, 1);
});
test('applyRemote 与本地合并：不会覆盖本地较新的记录和未出现在远端的记录', () => {
  const local = data.insert('todos', { title: 'local-new' });
  const only = data.insert('todos', { title: 'only-local' });
  const remote = [
    { id: local.id, title: 'remote-old', meta: { updatedAt: 1, updatedBy: 'dev_r', rev: 1, deletedAt: null } },
    { id: 'r1', title: 'remote-only', meta: { updatedAt: 5, updatedBy: 'dev_r', rev: 1, deletedAt: null } },
  ];
  data.applyRemote('todos', remote);
  const titles = Object.fromEntries(data.state.todos.map(t => [t.id, t.title]));
  assert.equal(titles[local.id], 'local-new');
  assert.equal(titles[only.id], 'only-local');
  assert.equal(titles.r1, 'remote-only');
});

/* ---------- 备份 ---------- */
test('导出 → 清空 → merge 导入，数据完整恢复且进入 outbox', async () => {
  const t1 = data.insert('todos', { title: 'one' });
  data.insert('todos', { title: 'two' });
  const file = JSON.parse(JSON.stringify(backup.buildBackup()));
  assert.equal(file.format, 'workhub-backup');
  assert.equal(file.counts.todos, 2);
  data.state.todos.length = 0;
  const { report } = backup.applyBackup(file, { mode: 'merge' });
  assert.equal(report.todos.added, 2);
  assert.deepEqual(data.state.todos.map(t => t.title).sort(), ['one', 'two']);
  assert.ok(data.byId('todos', t1.id));
});
test('merge 导入不会覆盖本地较新的修改', () => {
  const t = data.insert('todos', { title: 'v1' });
  const file = JSON.parse(JSON.stringify(backup.buildBackup()));
  data.update('todos', t.id, { title: 'v2-newer' });
  backup.applyBackup(file, { mode: 'merge' });
  assert.equal(data.byId('todos', t.id).title, 'v2-newer');
});
test('replace 导入：备份为准，本地多出的记录变墓碑（可同步删除），不是被直接丢弃', () => {
  const keep = data.insert('todos', { title: 'keep' });
  const file = JSON.parse(JSON.stringify(backup.buildBackup()));
  const extra = data.insert('todos', { title: 'extra' });
  data.update('todos', keep.id, { title: 'edited-after-backup' });
  const { report } = backup.applyBackup(file, { mode: 'replace' });
  assert.equal(report.todos.removed, 1);
  assert.equal(data.byId('todos', keep.id).title, 'keep');
  assert.equal(data.byId('todos', extra.id), undefined);
  const tomb = data.state.todos.find(t => t.id === extra.id);
  assert.ok(tomb.meta.deletedAt, '墓碑仍保留，对端才能收到删除');
});
test('replace 提升被改动记录的版本，使其在多端同步时不被对端旧版本覆盖', () => {
  const t = data.insert('todos', { title: 'orig' });
  const file = JSON.parse(JSON.stringify(backup.buildBackup()));
  data.update('todos', t.id, { title: 'changed' });
  const before = data.state.todos.find(x => x.id === t.id).meta.updatedAt;
  backup.applyBackup(file, { mode: 'replace' });
  const after = data.state.todos.find(x => x.id === t.id);
  assert.equal(after.title, 'orig');
  assert.ok(after.meta.updatedAt > before);
});
test('校验：拒绝非法文件、非法域名、重复 id、过高版本；跳过未声明的域', () => {
  const ok = { format: 'workhub-backup', version: 1, domains: { todos: [{ id: 'a' }], ghost: [{ id: 'g' }] } };
  const checked = backup.validateBackup(ok);
  assert.ok(checked.ok);
  assert.deepEqual(checked.skipped, ['ghost']);
  assert.equal(backup.validateBackup(null).ok, false);
  assert.equal(backup.validateBackup({ format: 'x' }).ok, false);
  assert.equal(backup.validateBackup({ ...ok, version: 99 }).ok, false);
  assert.equal(backup.validateBackup({ ...ok, domains: { todos: [{ id: 'a' }, { id: 'a' }] } }).ok, false);
  assert.equal(backup.validateBackup({ ...ok, domains: { todos: [{ title: 'no id' }] } }).ok, false);
  const evil = JSON.parse('{"format":"workhub-backup","version":1,"domains":{"__proto__":[{"id":"x"}]}}');
  assert.equal(backup.validateBackup(evil).ok, false);
  assert.equal(backup.validateBackup({ ...ok, domains: { todos: 'oops' } }).ok, false);
  assert.throws(() => backup.applyBackup({ format: 'x' }), /不是 WorkHub 备份/);
});
test('备份对象是深拷贝，之后改 state 不影响已导出的内容', () => {
  const t = data.insert('todos', { title: 'snap' });
  const file = backup.buildBackup();
  data.update('todos', t.id, { title: 'later' });
  assert.equal(file.domains.todos.find(x => x.id === t.id).title, 'snap');
});
