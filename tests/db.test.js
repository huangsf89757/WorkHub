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

test('导出 SQLite 原始字节：是合法的 SQLite 文件，且能读到已写入的数据', async () => {
  const keep = data.insert('todos', { title: '导出验证', done: false, priority: 'low', tags: [] });
  const bytes = storage.exportDatabase();
  assert.equal(new TextDecoder().decode(bytes.slice(0, 15)), 'SQLite format 3');
  const SQL = await initSqlJs({ wasmBinary });
  const copy = new SQL.Database(bytes);
  const rows = copy.exec(`SELECT title FROM ext_todo_items WHERE id='${keep.id}'`);
  assert.equal(rows[0].values[0][0], '导出验证');
  const { databaseFileName } = await import('../js/backup.js');
  assert.match(databaseFileName(new Date(2026, 10, 23, 9, 5)), /^workhub-db-20261123-0905\.sqlite$/);
});

test('v6→最新迁移：删除扩展表/家庭表、剥离归属 meta、outbox 去 pushed、TODO 数据保留、版本收敛到 8', async () => {
  const SQL = await initSqlJs({ wasmBinary });
  const old = new SQL.Database();
  // 模拟 v6 库：版本表无约束（可多行）、家庭/扩展表、带归属字段的 todo、含 pushed 的 outbox
  old.run(`CREATE TABLE sys_schema_version (version INTEGER NOT NULL)`);
  old.run(`INSERT INTO sys_schema_version (version) VALUES (6)`);
  old.run(`INSERT INTO sys_schema_version (version) VALUES (6)`); // 旧实现每次启动累积的行
  old.run(`CREATE TABLE sys_users (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '我', avatar TEXT,
    created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT)`);
  old.run(`CREATE TABLE sys_households (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, meta TEXT)`);
  old.run(`CREATE TABLE sys_memberships (id TEXT PRIMARY KEY, user_id TEXT, household_id TEXT, role TEXT, meta TEXT)`);
  old.run(`CREATE TABLE sys_devices (id TEXT PRIMARY KEY, user_id TEXT, platform TEXT, label TEXT, first_seen INTEGER, last_seen INTEGER, meta TEXT)`);
  old.run(`CREATE TABLE sys_settings (key TEXT PRIMARY KEY, value TEXT, scope TEXT DEFAULT 'user', updated_at INTEGER, updated_by TEXT, meta TEXT)`);
  old.run(`CREATE TABLE sys_extensions (id TEXT PRIMARY KEY, name TEXT, enabled INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, source TEXT DEFAULT 'builtin', created_at INTEGER, updated_at INTEGER, meta TEXT)`);
  old.run(`CREATE TABLE sys_ext_mounts (id TEXT PRIMARY KEY, skin_id TEXT, point_id TEXT, ext_id TEXT, meta TEXT)`);
  old.run(`CREATE TABLE sys_ext_kv (id TEXT PRIMARY KEY, ext_id TEXT, key TEXT, value TEXT)`);
  old.run(`CREATE TABLE sys_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, op TEXT NOT NULL, record TEXT NOT NULL, at INTEGER NOT NULL, pushed INTEGER NOT NULL DEFAULT 0)`);
  old.run(`CREATE TABLE ext_projects (id TEXT PRIMARY KEY, name TEXT)`);
  old.run(`CREATE TABLE ext_notes_nodes (id TEXT PRIMARY KEY, title TEXT)`);
  old.run(`CREATE TABLE ext_todo_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
    priority TEXT DEFAULT 'medium', start INTEGER, due INTEGER, note TEXT DEFAULT '', group_id TEXT, tags TEXT,
    created_at INTEGER, updated_at INTEGER, updated_by TEXT, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT)`);
  old.run(`CREATE TABLE ext_todo_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, meta TEXT)`);
  old.run(`INSERT INTO sys_outbox (domain,op,record,at,pushed) VALUES ('todos','upsert','{"id":"o1"}',123,0)`);
  old.run(`INSERT INTO ext_todo_items (id,title,done,created_at,updated_at,updated_by,rev,meta)
    VALUES ('t1','保留的待办',0,10,11,'dev_x',3,
    '{"updatedAt":11,"updatedBy":"dev_x","deletedAt":null,"rev":3,"userId":"me","ownerId":"me","scope":"private","householdId":"home","someExtField":"keep"}')`);
  stores.db.set('sqlite', old.export());

  const fresh = { todos: [], todoGroups: [] };
  await storage.initStorage(fresh);

  // TODO 数据保留，meta 剥离归属字段、保留扩展字段与同步字段
  const todo = fresh.todos.find(t => t.id === 't1');
  assert.equal(todo.title, '保留的待办');
  assert.equal(todo.meta.rev, 3);
  assert.equal(todo.meta.userId, undefined);
  assert.equal(todo.meta.ownerId, undefined);
  assert.equal(todo.meta.scope, undefined);
  assert.equal(todo.meta.householdId, undefined);
  assert.equal(todo.meta.someExtField, 'keep', '非归属扩展字段保留');

  await storage.flush();
  const copy = new SQL.Database(storage.exportDatabase());
  const tables = copy.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)[0].values.flat();
  for (const gone of ['sys_households', 'sys_memberships', 'sys_ext_mounts', 'sys_ext_kv', 'ext_projects', 'ext_notes_nodes']) {
    assert.equal(tables.includes(gone), false, `${gone} 已被删除`);
  }
  assert.ok(tables.includes('ext_todo_items') && tables.includes('ext_todo_groups'), 'TODO 表保留');

  // 版本表单行、版本为 8（v6 库会连续跑 v7 裁剪 + v8 补齐）
  const ver = copy.exec('SELECT COUNT(*) AS n, MAX(version) AS v FROM sys_schema_version')[0].values[0];
  assert.deepEqual(ver, [1, 8]);
  // v8 列已补齐
  assert.ok(copy.exec('PRAGMA table_info(ext_todo_items)')[0].values.map(r => r[1]).includes('completed_at'));
  assert.ok(copy.exec('PRAGMA table_info(ext_todo_groups)')[0].values.map(r => r[1]).includes('deleted_at'));

  // outbox 保留未推送条目且已无 pushed 列
  const outboxCols = copy.exec('PRAGMA table_info(sys_outbox)')[0].values.map(r => r[1]);
  assert.equal(outboxCols.includes('pushed'), false);
  assert.equal(copy.exec('SELECT COUNT(*) FROM sys_outbox')[0].values[0][0], 1);
});

test('v7→v8 迁移：分组补齐同步列并从 meta 回填、created_at 稳定化、待办补 completed_at', async () => {
  const SQL = await initSqlJs({ wasmBinary });
  const old = new SQL.Database();
  // 模拟 v7 库：版本 7、分组表仅 updated_at 列（同步字段留 meta）、待办表无 completed_at
  old.run(`CREATE TABLE sys_schema_version (id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL, updated_at INTEGER)`);
  old.run(`INSERT INTO sys_schema_version (id,version) VALUES (1,7)`);
  old.run(`CREATE TABLE sys_users (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, rev INTEGER, meta TEXT)`);
  old.run(`CREATE TABLE sys_devices (id TEXT PRIMARY KEY, user_id TEXT, platform TEXT, label TEXT, first_seen INTEGER, last_seen INTEGER, meta TEXT)`);
  old.run(`CREATE TABLE sys_settings (key TEXT PRIMARY KEY, value TEXT, scope TEXT, updated_at INTEGER, updated_by TEXT, meta TEXT)`);
  old.run(`CREATE TABLE sys_extensions (id TEXT PRIMARY KEY, name TEXT, enabled INTEGER, sort INTEGER, source TEXT, created_at INTEGER, updated_at INTEGER, meta TEXT)`);
  old.run(`CREATE TABLE sys_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, op TEXT, record TEXT, at INTEGER)`);
  old.run(`INSERT INTO sys_settings (key,value) VALUES ('v2_imported','1')`);
  old.run(`CREATE TABLE ext_todo_items (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
    priority TEXT, start INTEGER, due INTEGER, note TEXT, group_id TEXT, tags TEXT,
    created_at INTEGER, updated_at INTEGER, updated_by TEXT, deleted_at INTEGER, rev INTEGER, meta TEXT)`);
  old.run(`CREATE TABLE ext_todo_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0,
    created_at INTEGER, updated_at INTEGER, meta TEXT)`);
  // 分组：meta 里带 v7 的 updatedBy/deletedAt/rev；created_at 是被覆盖过的错误值（now）
  old.run(`INSERT INTO ext_todo_groups (id,name,sort,created_at,updated_at,meta)
    VALUES ('g1','工作',0,999999,1500,'{}')`);
  // 带上 v7 的归属清理残留之外的同步字段
  old.run(`UPDATE ext_todo_groups SET meta='{"updatedBy":"dev_old","deletedAt":null,"rev":7,"userId":"x"}' WHERE id='g1'`);
  // 组内两条待办，最早创建时间 1000；一条已完成（updated_at=2000）用于回填 completed_at
  old.run(`INSERT INTO ext_todo_items (id,title,done,group_id,created_at,updated_at,rev)
    VALUES ('t1','老待办',0,'g1',1000,1500,1)`);
  old.run(`INSERT INTO ext_todo_items (id,title,done,group_id,created_at,updated_at,rev)
    VALUES ('t2','已完成',1,'g1',1200,2000,2)`);
  stores.db.set('sqlite', old.export());

  const fresh = { todos: [], todoGroups: [] };
  await storage.initStorage(fresh);

  const group = fresh.todoGroups.find(g => g.id === 'g1');
  assert.equal(group.name, '工作', '分组数据保留');
  assert.equal(group.sort, 0, 'sort 提升为记录字段');
  assert.equal(group.created, 1000, 'created_at 稳定化为组内最早待办创建时间（不再是被覆盖的 999999）');
  assert.equal(group.meta.updatedBy, 'dev_old', 'meta 回填到独立列后，读回由列覆盖');
  assert.equal(group.meta.rev, 7);
  assert.equal(group.meta.userId, undefined, '归属字段仍被剔除');
  const t1 = fresh.todos.find(t => t.id === 't1');
  const t2 = fresh.todos.find(t => t.id === 't2');
  assert.equal(t1.completedAt, null);
  assert.equal(t2.completedAt, 2000, '历史已完成记录用 updated_at 近似回填');

  await storage.flush();
  const copy = new SQL.Database(storage.exportDatabase());
  const gcols = copy.exec('PRAGMA table_info(ext_todo_groups)')[0].values.map(r => r[1]);
  assert.ok(['updated_by', 'deleted_at', 'rev'].every(c => gcols.includes(c)), '分组同步列已补齐');
  assert.equal(copy.exec('SELECT created_at FROM ext_todo_groups WHERE id="g1"')[0].values[0][0], 1000);
  assert.deepEqual(copy.exec('SELECT MAX(version) FROM sys_schema_version')[0].values[0], [8]);
});

test('新库写入：完成态切换维护 completedAt，分组 sort 持久化且刷新后稳定', async () => {
  // 使用干净的 IndexedDB 存档，避免受前面用例状态影响
  stores.db.delete('sqlite');
  const fresh = { todos: [], todoGroups: [] };
  await storage.initStorage(fresh);
  const g = data.insert('todoGroups', { name: '临时', sort: 5, created: 777 });
  const t = data.insert('todos', { title: '完成时间测试', done: false, created: 888, completedAt: null });
  assert.equal(t.completedAt, null);

  // 模拟 toggleTodo 的写入：完成写时间、取消清空
  data.update('todos', t.id, { done: true, completedAt: 12345 });
  assert.equal(data.byId('todos', t.id).completedAt, 12345);
  data.update('todos', t.id, { done: false, completedAt: null });
  assert.equal(data.byId('todos', t.id).completedAt, null);
  data.update('todos', t.id, { done: true, completedAt: 99999 });

  await storage.flush();
  const revived = { todos: [], todoGroups: [] };
  await storage.initStorage(revived);
  assert.equal(revived.todos.find(x => x.id === t.id).completedAt, 99999, 'completedAt 刷新后保留');
  const rg = revived.todoGroups.find(x => x.id === g.id);
  assert.equal(rg.sort, 5, '分组 sort 刷新后保留（不被数组下标覆盖）');
  assert.equal(rg.created, 777, '分组 created 刷新后稳定（不被 now 覆盖）');
});
