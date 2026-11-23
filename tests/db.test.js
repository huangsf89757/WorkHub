import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { installLocalStorage, installFakeBrowser, installFakeIndexedDB } from './helpers.js';
installLocalStorage(); installFakeBrowser();
const stores = installFakeIndexedDB();
const require = createRequire(import.meta.url);
// package.json 声明了 type:module，直接 require 会把 UMD 脚本当 ESM 加载导致导出为空；这里手动按 CommonJS 求值
const sqlSource = readFileSync(new URL('../vendor/sqljs/sql-wasm.js', import.meta.url), 'utf8');
const sqlModule = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', '__filename', sqlSource)(sqlModule, sqlModule.exports, require, '.', 'sql-wasm.js');
const initSqlJs = sqlModule.exports;
const wasmBinary = readFileSync(new URL('../vendor/sqljs/sql-wasm.wasm', import.meta.url));
globalThis.window.initSqlJs = () => initSqlJs({ wasmBinary });
globalThis.window.addEventListener = () => {};

const data = await import('../js/data.js');
const storage = await import('../js/storage.js');
await import('../js/db.js'); // 副作用：注册 LocalAdapter
data.declareDomain('todos', []);
data.declareDomain('todoGroups', []);
const idbBytes = () => stores.db?.get('sqlite');

test('首次启动：建库、写入、flush 后落到 IndexedDB 存档', async () => {
  assert.equal(await storage.initStorage(data.state), true);
  const todo = data.insert('todos', { title: '写测试', done: false, priority: 'high', tags: ['t'] });
  data.insert('todoGroups', { name: '工作' });
  await storage.flush();
  assert.ok(idbBytes()?.length > 1000, '存档已写入');
  assert.equal(data.byId('todos', todo.id).title, '写测试');
});
test('模拟刷新：重新打开存档后，记录、墓碑、meta 都完整恢复', async () => {
  const [first] = data.alive('todos');
  data.update('todos', first.id, { title: '改过的标题' });
  const gone = data.insert('todos', { title: '会被删除' });
  data.remove('todos', gone.id);
  await storage.flush();
  const rev = data.state.todos.find(t => t.id === first.id).meta.rev;
  // 用全新的 state 对象重走一遍启动流程，等价于刷新页面
  const fresh = { todos: [], todoGroups: [] };
  await storage.initStorage(fresh);
  const restored = fresh.todos.find(t => t.id === first.id);
  assert.equal(restored.title, '改过的标题');
  assert.deepEqual(restored.tags, ['t']);
  assert.equal(restored.meta.rev, rev);
  const tomb = fresh.todos.find(t => t.id === gone.id);
  assert.ok(tomb?.meta.deletedAt, '软删除墓碑刷新后不复活');
  assert.equal(fresh.todoGroups[0].name, '工作');
});
test('outbox 持久化：入队 → 刷新 → 恢复 → ack 后不再出现', async () => {
  const { enqueue, restoreOutbox, getOutboxSize } = await import('../js/sync.js');
  const rec = { id: 'ob1', title: 'x', meta: { updatedAt: 1, rev: 1 } };
  enqueue('todos', 'upsert', rec);
  await storage.flush();
  assert.equal(storage.outboxLoad().some(e => e.record.id === 'ob1'), true);
  const fresh = { todos: [], todoGroups: [] };
  await storage.initStorage(fresh); // 刷新后从存档重开
  const rows = storage.outboxLoad();
  const entry = rows.find(e => e.record.id === 'ob1');
  assert.ok(entry, '刷新后未推送的变更仍在');
  assert.deepEqual(entry.record, rec);
  storage.outboxAck([entry.seq]);
  assert.equal(storage.outboxLoad().some(e => e.record.id === 'ob1'), false);
  assert.ok(restoreOutbox() >= 0 && getOutboxSize() >= 0);
});
test('旧库迁移（v3 无前缀表名）：表被重命名、补列、数据保留', async () => {
  const SQL = await initSqlJs({ wasmBinary });
  const old = new SQL.Database();
  old.run(`CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
    priority TEXT DEFAULT 'medium', due INTEGER, note TEXT DEFAULT '', group_id TEXT, tags TEXT,
    created_at INTEGER, updated_at INTEGER, updated_by TEXT, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT)`);
  old.run(`INSERT INTO todos (id,title,done,created_at,updated_at,updated_by,rev,meta) VALUES ('legacy1','老数据',1,5,6,'dev_old',2,'{}')`);
  stores.db.set('sqlite', old.export());
  const fresh = { todos: [], todoGroups: [] };
  await storage.initStorage(fresh);
  const legacy = fresh.todos.find(t => t.id === 'legacy1');
  assert.equal(legacy?.title, '老数据');
  assert.equal(legacy.done, true);
  assert.equal(legacy.meta.updatedBy, 'dev_old');
  assert.equal(legacy.meta.rev, 2);
  assert.equal(legacy.start, null, 'v3 新增的 start 列被补上');
});

test('扩展自带表：declareDomain 带 table 后无需改 db.js 即可持久化，刷新后恢复（含墓碑）', async () => {
  data.declareDomain('demoNotes', [], { table: 'ext_demo_notes' });
  await storage.initStorage(data.state); // 晚于声明：init 时统一建表
  const a = data.insert('demoNotes', { title: '第一条', tags: ['x'] });
  const b = data.insert('demoNotes', { title: '第二条' });
  data.remove('demoNotes', b.id);
  await storage.flush();
  const fresh = { todos: [], todoGroups: [], demoNotes: [] };
  await storage.initStorage(fresh);
  const restored = fresh.demoNotes.find(n => n.id === a.id);
  assert.equal(restored.title, '第一条');
  assert.deepEqual(restored.tags, ['x']);
  assert.equal(restored.meta.rev, a.meta.rev);
  assert.ok(fresh.demoNotes.find(n => n.id === b.id).meta.deletedAt);
});
test('新扩展装进已有数据库：表是新建的，本地镜像里的数据被写入而不是被空表覆盖', async () => {
  globalThis.localStorage.setItem('wh_lateDomain', JSON.stringify([{ id: 'm1', title: '镜像里的数据', meta: { updatedAt: 1, rev: 1 } }]));
  data.declareDomain('lateDomain', [], { table: 'ext_late_items' });
  assert.equal(data.state.lateDomain[0].id, 'm1');
  await storage.initStorage(data.state);
  assert.equal(data.state.lateDomain[0].title, '镜像里的数据');
  await storage.flush();
  const fresh = { todos: [], todoGroups: [], demoNotes: [], lateDomain: [] };
  await storage.initStorage(fresh);
  assert.equal(fresh.lateDomain[0]?.title, '镜像里的数据', '已落库');
});
test('扩展表名不合法时拒绝（防止标识符注入）', async () => {
  const { registerDomainStorage } = storage;
  const warn = console.warn; let warned = false; console.warn = () => { warned = true; };
  registerDomainStorage('evil', { table: 'todos; DROP TABLE sys_users' });
  console.warn = warn;
  assert.ok(warned);
});
