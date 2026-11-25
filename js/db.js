/* db.js — 本地持久层 LocalAdapter：sql.js(WASM) + IndexedDB 存档
 *
 * 实现 storage.js 适配器契约；schema 与 docs/database-design.md 同步（系统基座 v8）。
 * 领域整体重写（全表 DELETE + INSERT），个人规模足够；同步列已预埋。
 *
 * 范围（v7 起）：只维护系统基座表（sys_）+ 先行保留的 任务扩展表。
 * 其余业务扩展表、家庭/组织模型表已从基座移除，扩展将来用 declareDomain(table) 自带表接入。
 *
 * 正确性要点（勿回归）：
 *   1. persistDomain 必须区分单表/多表领域：单表领域 toRows 返回纯数据行，
 *      整行绑定，不能像多表领域那样丢弃首字段当表名（否则列全部左移一位）。
 *   2. 每条记录的 meta（含 deletedAt 墓碑）必须落库，否则软删除刷新后复活。
 *   3. 迁移标记 v2_imported：老库缺此键时从 localStorage 镜像重导一次自愈。
 *   4. 版本读取与表名迁移都必须在 SCHEMA 之前（SCHEMA 会建表/写版本，顺序错则迁移跳过）。
 */
import { bus, store, registry, resetAppliedThisSession } from './base.js';
import { registerAdapter } from './storage.js';
import { getDeviceId, detectPlatform } from './platform.js';
import { DEFAULT_USER_ID, DEFAULT_USER_NAME } from './identity.js';

let db = null;
let saveTimer = null;
let prefSubscribed = false;
let resetConsumed = false; // 本次会话是否已执行过重置清库（防止测试多次 initStorage 时重复清）

/* ============================================================
   表名规范（v4 起）：
     sys_  —— 系统基座表（用户/设备/设置/扩展机制/变更日志/版本）
     ext_<扩展id>_ —— 扩展功能表，按扩展归属命名空间（由扩展自带，不纳入基座）
   当前基座只登记系统表与先行保留的 任务表；其余扩展表由扩展在需要时自行声明。
   ============================================================ */
const TABLES = Object.freeze({
  // 系统基座
  schemaVersion: 'sys_schema_version',
  users: 'sys_users',
  devices: 'sys_devices',
  settings: 'sys_settings',
  extensions: 'sys_extensions',
  outbox: 'sys_outbox',
  // 任务扩展自有表（用户要求先行保留，不随其余扩展表删除）
  todos: 'ext_todo_items',
  todoGroups: 'ext_todo_groups',
});

/** 旧表名 → 新表名（v3 及之前是无前缀命名），用于老库平滑迁移 */
const TABLE_RENAMES = Object.freeze({
  schema_version: TABLES.schemaVersion,
  users: TABLES.users,
  devices: TABLES.devices,
  settings: TABLES.settings,
  extensions: TABLES.extensions,
  outbox: TABLES.outbox,
  todos: TABLES.todos,
  todo_groups: TABLES.todoGroups,
});

/* ============================================================
   IndexedDB 存档（整个 SQLite 数据库导出为字节 blob）
   ============================================================ */
const idbOpen = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('workhub_db', 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('db')) {
      request.result.createObjectStore('db');
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const saveIdb = async bytes => {
  const conn = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction('db', 'readwrite');
    tx.objectStore('db').put(bytes, 'sqlite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const loadIdb = async () => {
  const conn = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = conn.transaction('db', 'readonly');
    const query = tx.objectStore('db').get('sqlite');
    query.onsuccess = () => resolve(query.result || null);
    query.onerror = () => reject(query.error);
  });
};

/* ============================================================
   Schema（系统基座 v7 + 先行保留的 任务表 v8 结构）
   ============================================================ */
const SCHEMA_VERSION = 8;
const SCHEMA = `
/* ---------- 系统基座 ---------- */
/* schema_version：单行版本标记。id 恒为 1（CHECK 约束），INSERT OR IGNORE 真正幂等，
   不再像旧版那样因 version 无唯一约束而每次启动累积新行。 */
CREATE TABLE IF NOT EXISTS ${TABLES.schemaVersion} (
  id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS ${TABLES.users} (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '我', avatar TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.devices} (
  id TEXT PRIMARY KEY, user_id TEXT, platform TEXT, label TEXT,
  first_seen INTEGER, last_seen INTEGER, meta TEXT);
/* settings：基座偏好 KV，value 为 JSON；scope 区分 user/device/global */
CREATE TABLE IF NOT EXISTS ${TABLES.settings} (
  key TEXT PRIMARY KEY, value TEXT, scope TEXT NOT NULL DEFAULT 'user',
  updated_at INTEGER, updated_by TEXT, meta TEXT);
/* extensions：已注册扩展的安装态与排序（声明式，新增扩展零改表） */
CREATE TABLE IF NOT EXISTS ${TABLES.extensions} (
  id TEXT PRIMARY KEY, name TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER DEFAULT 0, source TEXT DEFAULT 'builtin',
  created_at INTEGER, updated_at INTEGER, meta TEXT);
/* outbox：本地变更队列。ack 即删除行，故不再保留恒为 0 的 pushed 列 */
CREATE TABLE IF NOT EXISTS ${TABLES.outbox} (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, op TEXT NOT NULL,
  record TEXT NOT NULL, at INTEGER NOT NULL);
/* ---------- 任务扩展表（先行保留；v8 补齐同步列与完成时间） ---------- */
CREATE TABLE IF NOT EXISTS ${TABLES.todos} (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
  priority TEXT DEFAULT 'medium', start INTEGER, due INTEGER, note TEXT DEFAULT '',
  group_id TEXT, tags TEXT, created_at INTEGER, completed_at INTEGER, updated_at INTEGER,
  updated_by TEXT, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
/* v8：分组表升级为完整同步表（补齐 updated_by/deleted_at/rev），与待办表对齐 */
CREATE TABLE IF NOT EXISTS ${TABLES.todoGroups} (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0,
  created_at INTEGER, updated_at INTEGER, updated_by TEXT,
  deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
CREATE INDEX IF NOT EXISTS idx_ext_todo_items_group ON ${TABLES.todos}(group_id);
INSERT OR IGNORE INTO ${TABLES.schemaVersion} (id, version, updated_at) VALUES (1, ${SCHEMA_VERSION}, ${Date.now()});
`;

/* ============================================================
   表名迁移：老库（v3 及之前）用无前缀表名，RENAME 到规范名。
   必须在 SCHEMA 之前执行——否则 SCHEMA 会先建出空的新表占位，
   使 "新表不存在" 判断失效而跳过迁移、丢失老数据。幂等可重复执行。
   ============================================================ */
function migrateTableNames() {
  const exists = name => all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]).length > 0;
  let migrated = false;
  for (const [oldName, newName] of Object.entries(TABLE_RENAMES)) {
    if (oldName === newName) continue;
    if (exists(oldName) && !exists(newName)) {
      db.run(`ALTER TABLE ${oldName} RENAME TO ${newName}`);
      migrated = true;
    }
  }
  if (migrated) scheduleSave();
  return migrated;
}

/* ============================================================
   v7 迁移：裁剪到系统基座
     · 删除全部未实现的扩展表（projects/tasks/snippets/complaints/notes/posts/learning 等）
     · 删除家庭/组织模型表（households/memberships）与未接入的扩展机制表（ext_mounts/ext_kv）
     · outbox 去掉恒为 0 的 pushed 列
     · 剥离所有记录 meta 中的归属字段（家庭模型已撤销）
     · 版本表交给 SCHEMA 重建为单行（DROP 前已读取 prevVer）
   幂等：DROP IF EXISTS / 列判断，可重复执行。
   ============================================================ */
const REMOVED_TABLES = [
  // 未实现的扩展功能表（v7 前的预留空壳）
  'ext_projects', 'ext_project_tasks', 'ext_snippets', 'ext_complaints', 'ext_complaint_events',
  'ext_notes_nodes', 'ext_notes_versions', 'ext_blog_posts', 'ext_learning',
  // 家庭 / 组织模型
  'sys_households', 'sys_memberships',
  // 未接入的扩展机制表
  'sys_ext_mounts', 'sys_ext_kv',
  // v3 及之前的无前缀旧名（若存在一并清除）
  'projects', 'tasks', 'snippets', 'complaints', 'complaint_events',
  'note_nodes', 'note_versions', 'posts', 'learning', 'households', 'memberships',
  'ext_mounts', 'ext_kv',
];

/** 已撤销的家庭/组织归属字段，写入记录 meta 时会一并剔除 */
const OWNERSHIP_META_KEYS = ['userId', 'ownerId', 'scope', 'householdId'];

/** 遍历所有带 meta 列的表，剔除归属字段（幂等；用 rowid 定位，兼容无 id 列的表如 settings） */
function stripOwnershipMeta() {
  const tables = all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).map(r => r.name);
  for (const table of tables) {
    const cols = all(`PRAGMA table_info(${table})`).map(r => r.name);
    if (!cols.includes('meta')) continue;
    for (const row of all(`SELECT rowid AS rid, meta FROM ${table} WHERE meta IS NOT NULL`)) {
      const meta = P(row.meta);
      if (!meta || typeof meta !== 'object') continue;
      let changed = false;
      for (const key of OWNERSHIP_META_KEYS) if (key in meta) { delete meta[key]; changed = true; }
      if (changed) run(`UPDATE ${table} SET meta=? WHERE rowid=?`, [J(meta), row.rid]);
    }
  }
}

function migrateV7() {
  for (const table of REMOVED_TABLES) db.run(`DROP TABLE IF EXISTS ${table}`);
  // outbox：旧结构含 pushed 列，ack 直接删行使其恒为 0 → 重建去掉该列，保留未推送条目
  const hasOutbox = all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [TABLES.outbox]).length > 0;
  if (hasOutbox) {
    const cols = all(`PRAGMA table_info(${TABLES.outbox})`).map(r => r.name);
    if (cols.includes('pushed')) {
      db.run('CREATE TABLE tmp_outbox (seq INTEGER PRIMARY KEY, domain TEXT NOT NULL, op TEXT NOT NULL, record TEXT NOT NULL, at INTEGER NOT NULL)');
      db.run(`INSERT INTO tmp_outbox (seq,domain,op,record,at) SELECT seq,domain,op,record,at FROM ${TABLES.outbox}`);
      db.run(`DROP TABLE ${TABLES.outbox}`);
      db.run(`ALTER TABLE tmp_outbox RENAME TO ${TABLES.outbox}`);
    }
  }
  stripOwnershipMeta();
  // 版本表结构升级：交给 SCHEMA 重建为单行（prevVer 已在调用前读取）
  db.run(`DROP TABLE IF EXISTS ${TABLES.schemaVersion}`);
  scheduleSave();
}

/* ============================================================
   v8 迁移：任务表补齐同步列与完成时间（分组表升级为完整同步表）
     · todos 加 completed_at；已完成的用 updated_at 近似回填（无历史完成时间可考）
     · todoGroups 加 updated_by/deleted_at/rev，从 meta 回填后剔除精简
     · 分组 created_at 稳定化：用组内最早待办的创建时间，之后不再被每次写入覆盖
     · 版本表单行升到 8
   幂等：先判列再加列；SCHEMA 对已存在的旧表不改结构，故加列必须在此完成。
   ============================================================ */
function migrateV8() {
  const colsOf = table => all(`PRAGMA table_info(${table})`).map(r => r.name);

  // 1. 待办表：完成时间列
  const todoCols = colsOf(TABLES.todos);
  if (!todoCols.includes('completed_at')) {
    db.run(`ALTER TABLE ${TABLES.todos} ADD COLUMN completed_at INTEGER`);
    // 历史已完成记录没有完成时间可考，用最后更新时间近似（文档已标注为近似值）
    db.run(`UPDATE ${TABLES.todos} SET completed_at = updated_at WHERE done = 1`);
  }

  // 2. 分组表：补齐完整同步列
  const groupCols = colsOf(TABLES.todoGroups);
  if (!groupCols.includes('updated_by')) db.run(`ALTER TABLE ${TABLES.todoGroups} ADD COLUMN updated_by TEXT`);
  if (!groupCols.includes('deleted_at')) db.run(`ALTER TABLE ${TABLES.todoGroups} ADD COLUMN deleted_at INTEGER`);
  if (!groupCols.includes('rev')) db.run(`ALTER TABLE ${TABLES.todoGroups} ADD COLUMN rev INTEGER DEFAULT 1`);

  // 3. 从 meta 回填同步列（v7 及更早分组表只提升 updatedAt，其余同步字段留 meta）
  for (const row of all(`SELECT id, meta FROM ${TABLES.todoGroups}`)) {
    const meta = P(row.meta) || {};
    db.run(`UPDATE ${TABLES.todoGroups} SET updated_by=?, deleted_at=?, rev=? WHERE id=?`,
      [meta.updatedBy ?? null, meta.deletedAt ?? null, meta.rev ?? 1, row.id]);
    let changed = false;
    for (const key of ['updatedAt', 'updatedBy', 'deletedAt', 'rev']) {
      if (key in meta) { delete meta[key]; changed = true; }
    }
    if (changed) db.run(`UPDATE ${TABLES.todoGroups} SET meta=? WHERE id=?`, [J(meta), row.id]);
  }
  // 4. created_at 稳定化：取组内最早待办创建时间（老库该列每次写入都被覆盖为 now）
  db.run(`UPDATE ${TABLES.todoGroups} SET created_at = COALESCE(
    (SELECT MIN(created_at) FROM ${TABLES.todos} WHERE group_id = ${TABLES.todoGroups}.id), created_at)`);

  // 5. 版本表升 8（v7 库版本表已存在，SCHEMA 的 INSERT OR IGNORE 不会改它）
  db.run(`UPDATE ${TABLES.schemaVersion} SET version=8, updated_at=? WHERE id=1`, [Date.now()]);
  scheduleSave();
}

/* ============================================================
   幂等列迁移：老库缺列时补列，不重建表、不丢数据。
   新增高频字段时在此登记即可（CREATE TABLE IF NOT EXISTS 不会补列）。
   ============================================================ */
const COLUMN_MIGRATIONS = [
  [TABLES.todos, 'start', 'INTEGER', 'todos'], // v3：开始时间，UI 先落地、后补库列；第 4 项为 localStorage 域名
];
function migrateColumns(state) {
  for (const [table, column, ddl, domainKey] of COLUMN_MIGRATIONS) {
    const cols = all(`PRAGMA table_info(${table})`).map(r => r.name);
    if (cols.includes(column)) continue;
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    // 老库的该列从未落库，但 localStorage 镜像里有值 → 按 id 回填，避免历史数据丢失
    const mirror = state?.[domainKey || table];
    if (mirror?.length) {
      const stmt = db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`);
      for (const record of mirror) {
        if (record[column] == null) continue;
        stmt.bind([record[column], record.id]);
        stmt.step();
        stmt.reset();
      }
      stmt.free();
      scheduleSave();
    }
  }
}

/* ============================================================
   sql.js 基础 API
   ============================================================ */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
}

const J = value => (value == null ? null : JSON.stringify(value));
const P = value => {
  try { return value == null ? null : JSON.parse(value); }
  catch { return null; }
};

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveIdb(db.export()), 400);
}

async function flush() {
  if (!db) return;
  clearTimeout(saveTimer);
  await saveIdb(db.export());
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && db && saveTimer) {
    clearTimeout(saveTimer);
    saveIdb(db.export());
  }
});
window.addEventListener('beforeunload', () => { if (db) saveIdb(db.export()); });

/* ============================================================
   领域映射：state[key] ⇄ 表
   通用模式：高频字段进列，meta JSON 存完整同步字段（含墓碑）。
   ============================================================ */
/* 同步四字段：逻辑名 → 独立列名。仅部分表拥有全部四列，其余表只提升 updatedAt。
   v6：独立列是同步字段的真相源，meta JSON 不再重复存已提升的字段。 */
const SYNC_COL = Object.freeze({
  updatedAt: 'updated_at',
  updatedBy: 'updated_by',
  deletedAt: 'deleted_at',
  rev: 'rev',
});
const SYNC_ALL = Object.freeze(['updatedAt', 'updatedBy', 'deletedAt', 'rev']);
const PK_ONLY_UPDATED = Object.freeze(['updatedAt']); // 仅 updated_at 独立列的表

/** 精简 meta：剔除已提升为独立列的同步字段与已撤销的归属字段，只保留扩展字段 */
const slimMeta = (meta, promoted = SYNC_ALL) => {
  if (!meta) return {};
  const out = { ...meta };
  for (const key of promoted) delete out[key];
  for (const key of OWNERSHIP_META_KEYS) delete out[key];
  return out;
};

/** 从行重建 meta：meta JSON 为底，独立列覆盖已提升字段（列为准，杜绝旧实现 meta 覆盖列） */
const fromMeta = (row, promoted = SYNC_ALL) => {
  const meta = { ...(P(row.meta) || {}) };
  for (const key of promoted) {
    const col = SYNC_COL[key];
    if (col in row) meta[key] = row[col];
  }
  for (const key of OWNERSHIP_META_KEYS) delete meta[key];
  return meta;
};

const metaCols = record => [
  record.meta?.updatedAt || null,
  record.meta?.updatedBy || null,
  record.meta?.deletedAt || null,
  record.meta?.rev || 1,
  J(slimMeta(record.meta, SYNC_ALL)), // meta 只存未提升字段（扩展）
];

/* ============================================================
   v6 数据迁移：清理历史 meta JSON 里已提升为独立列的同步字段。
   老库（v5 及之前）meta 里重复存了 updatedAt/updatedBy/deletedAt/rev，
   v6 起独立列为真相源，meta 只存扩展字段。幂等可重复。
   ============================================================ */
const SYNC_TABLE_PROMOTED = Object.freeze({
  [TABLES.todos]: SYNC_ALL,
  [TABLES.todoGroups]: SYNC_ALL, // v8：分组表补齐四列，升为完整同步表
});

function migrateSlimMeta() {
  for (const [table, promoted] of Object.entries(SYNC_TABLE_PROMOTED)) {
    const exists = all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table]).length > 0;
    if (!exists) continue;
    for (const row of all(`SELECT id, meta FROM ${table}`)) {
      const meta = P(row.meta);
      if (!meta || typeof meta !== 'object') continue;
      let changed = false;
      for (const key of promoted) {
        if (key in meta) { delete meta[key]; changed = true; }
      }
      if (changed) run(`UPDATE ${table} SET meta=? WHERE id=?`, [J(meta), row.id]);
    }
  }
  scheduleSave();
}

const M = {
  todos: {
    tables: [TABLES.todos],
    insert: `INSERT INTO ${TABLES.todos} (id,title,done,priority,start,due,note,group_id,tags,created_at,completed_at,updated_at,updated_by,deleted_at,rev,meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    toRows: arr => arr.map(t => [t.id, t.title, t.done ? 1 : 0, t.priority || 'medium', t.start || null, t.due || null, t.note || '', t.groupId || null, J(t.tags || []), t.created || Date.now(), t.completedAt ?? null, ...metaCols(t)]),
    fromRows: rows => rows.map(r => ({ id: r.id, title: r.title, done: !!r.done, priority: r.priority, start: r.start ?? null, due: r.due, note: r.note || '', groupId: r.group_id || '', tags: P(r.tags) || [], created: r.created_at, completedAt: r.completed_at ?? null, meta: fromMeta(r) })),
    load: `SELECT * FROM ${TABLES.todos}`,
  },
  todoGroups: {
    tables: [TABLES.todoGroups],
    insert: `INSERT INTO ${TABLES.todoGroups} (id,name,sort,created_at,updated_at,updated_by,deleted_at,rev,meta) VALUES (?,?,?,?,?,?,?,?,?)`,
    // v8：created 来自记录（稳定），sort 提升为记录字段（可随 LWW 同步）；四同步列走 metaCols
    toRows: arr => arr.map((g, i) => [g.id, g.name, g.sort ?? i, g.created || Date.now(), ...metaCols(g)]),
    fromRows: rows => rows.map(r => ({ id: r.id, name: r.name, sort: r.sort ?? 0, created: r.created_at ?? null, meta: fromMeta(r) })),
    load: `SELECT * FROM ${TABLES.todoGroups} ORDER BY sort, created_at`,
  },
};

/* ============================================================
   扩展自带表（通用文档映射）
   扩展 declareDomain(name, seed, { table: 'ext_<id>_<name>' }) 后，本层自动：
     建表 → 读写 → 同步元数据列落独立列。记录除 id/meta 外的字段存成一列 JSON（doc）。
   适合新扩展快速落地；需要按列查询/索引的域，再手写专用映射（如 todos）。
   ============================================================ */
const TABLE_NAME = /^ext_[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
const newTables = new Set(); // 本次启动新建出来的通用表：state 里的镜像数据要写入，而不是被空表覆盖
export function registerDomain(key, { table }) {
  if (M[key]) return; // 内置手写映射优先，不被覆盖
  if (!TABLE_NAME.test(table || '')) throw new Error(`非法的扩展表名：${table}（须形如 ext_<扩展id>_<名称>）`);
  const ddl = `CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY, doc TEXT, updated_at INTEGER, updated_by TEXT,
    deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT)`;
  M[key] = {
    tables: [table],
    ddl,
    generic: true,
    insert: `INSERT INTO ${table} (id,doc,updated_at,updated_by,deleted_at,rev,meta) VALUES (?,?,?,?,?,?,?)`,
    toRows: arr => arr.map(({ id, meta, ...doc }) => [id, J(doc), ...metaCols({ meta })]),
    fromRows: rows => rows.map(r => ({ ...(P(r.doc) || {}), id: r.id, meta: fromMeta(r) })),
    load: `SELECT * FROM ${table}`,
  };
  if (db) { // 适配器已打开：立即建表（晚注册的扩展）
    const existed = all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table]).length > 0;
    db.run(ddl);
    if (!existed) newTables.add(key);
    scheduleSave();
  }
}
/** 领域整体重写：清空表后逐行插入。 */
function persistDomain(key, arr) {
  const mapping = M[key];
  if (!mapping || !db) return;
  db.run('BEGIN');
  for (const table of mapping.tables) db.run(`DELETE FROM ${table}`);
  for (const rowData of mapping.toRows(arr || [])) {
    if (mapping.inserts) {
      // 多表领域（complaints/notes）：toRows 首元素是目标表名
      const [table, ...values] = rowData;
      run(mapping.inserts[table], values);
    } else {
      // 单表领域：toRows 是纯数据行，整行绑定，不能丢首字段
      run(mapping.insert, rowData);
    }
  }
  db.run('COMMIT');
  scheduleSave();
}

/* ============================================================
   基座域读写 API（用户 / 设备 / 设置 / 扩展中心）
   与业务域同构：SQLite 为持久化镜像，localStorage 仍为同步真相源。
   扩展新增只需 registerBaseExtension（零改表）；数据用 declareDomain(table) 自带表。
   ============================================================ */
/** 确保默认用户与当前设备登记在库（幂等） */
function seedBase(userId, deviceId, platform) {
  const now = Date.now();
  run(`INSERT OR IGNORE INTO ${TABLES.users} (id,name,created_at,rev,meta) VALUES (?,?,?,?,?)`,
    [userId, DEFAULT_USER_NAME, now, 1, J({})]);
  run(`INSERT OR IGNORE INTO ${TABLES.devices} (id,user_id,platform,label,first_seen,last_seen,meta) VALUES (?,?,?,?,?,?,?)`,
    [deviceId, userId, platform || 'web', platform || 'Web', now, now, J({})]);
  run(`UPDATE ${TABLES.devices} SET last_seen=? WHERE id=?`, [now, deviceId]);
  scheduleSave();
}

/** 镜像 core.store 的一次偏好写入到 settings 表 */
function mirrorPref({ key, value }) {
  if (!db) return;
  run(`INSERT OR REPLACE INTO ${TABLES.settings} (key,value,scope,updated_at,updated_by,meta) VALUES (?,?,?,?,?,?)`,
    [key, J(value), 'user', Date.now(), getDeviceId(), J({})]);
  // 扩展启用态：sys_extensions.enabled 是 store.extEnabled 的投影，必须同步，
  // 否则它永远停在 registerBaseExtension 首次 INSERT 时的值，与真相源漂移。
  if (key === 'extEnabled' && value && typeof value === 'object') {
    for (const ext of registry.list) {
      if (ext.group === 'system') continue;
      run(`UPDATE ${TABLES.extensions} SET enabled=?,updated_at=? WHERE id=?`,
        [value[ext.id] === false ? 0 : 1, Date.now(), ext.id]);
    }
  }
  scheduleSave();
}

/** 启动时把 settings 表回灌到 store（DB 有值且本地缺失时用 DB 补本地） */
function hydratePrefs(state) {
  if (!state) return;
  for (const row of all(`SELECT key,value FROM ${TABLES.settings}`)) {
    const key = row.key;
    // 只回灌已知的基座偏好 key，避免污染业务域（业务域由 state 恢复）
    if (BASE_PREF_KEYS.has(key) && store.get(key) === undefined) {
      store.set(key, P(row.value)); // 会再次触发 mirrorPref，幂等写回
    }
  }
}

const BASE_PREF_KEYS = new Set([
  'theme', 'skin', 'skinMounts', 'skinPoints', 'menuLayout',
  'extEnabled', 'rightCollapsed', 'shortcuts', 'searchRules',
]);

/** 声明式登记扩展（新增扩展零改表）；重复调用幂等 */
export function registerBaseExtension(id, name, { enabled = true, sort = 0, source = 'builtin' } = {}) {
  if (!db) return;
  run(`INSERT OR IGNORE INTO ${TABLES.extensions} (id,name,enabled,sort,source,created_at,meta) VALUES (?,?,?,?,?,?,?)`,
    [id, name || id, enabled ? 1 : 0, sort, source, Date.now(), J({})]);
  scheduleSave();
}

/** 设置扩展启用态：统一走 store 真相源，由 pref→mirrorPref 同步 settings 与 extensions */
export function setBaseExtensionEnabled(id, enabled) {
  const map = { ...store.get('extEnabled', {}) };
  map[id] = enabled;
  store.set('extEnabled', map);
}

/** 读取扩展清单（含启用态、排序） */
export function listBaseExtensions() {
  if (!db) return [];
  return all(`SELECT id,name,enabled,sort,source FROM ${TABLES.extensions} ORDER BY sort,id`)
    .map(r => ({ id: r.id, name: r.name, enabled: !!r.enabled, sort: r.sort, source: r.source }));
}

/* ---------- 用户 API（组织/家庭模型已撤销，仅保留本地用户） ---------- */

/** 登记或更新用户（幂等） */
export function upsertUser(id, name, avatar = null) {
  if (!db) return;
  const now = Date.now();
  const exists = all(`SELECT id FROM ${TABLES.users} WHERE id=?`, [id]).length > 0;
  if (exists) run(`UPDATE ${TABLES.users} SET name=?,avatar=?,updated_at=? WHERE id=?`, [name, avatar, now, id]);
  else run(`INSERT INTO ${TABLES.users} (id,name,avatar,created_at,updated_at,rev,meta) VALUES (?,?,?,?,?,?,?)`,
    [id, name, avatar, now, now, 1, J({})]);
  scheduleSave();
}

/** 基座域诊断快照 */
export function baseInfo() {
  if (!db) return null;
  const count = table => all(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
  return {
    users: count(TABLES.users), devices: count(TABLES.devices), settings: count(TABLES.settings),
    extensions: count(TABLES.extensions), outbox: count(TABLES.outbox),
    schemaVersion: all(`SELECT version FROM ${TABLES.schemaVersion} WHERE id=1`)[0]?.version ?? null,
  };
}

/* ---------- 适配器注册 ---------- */
/* ---------- 同步 outbox 持久化（sys_outbox）：刷新/关闭后未推送的变更不丢 ---------- */
function outboxAppend(entry) {
  if (!db) return;
  run(`INSERT OR REPLACE INTO ${TABLES.outbox} (seq,domain,op,record,at) VALUES (?,?,?,?,?)`,
    [entry.seq, entry.domain, entry.op, J(entry.record), entry.at]);
  scheduleSave();
}
function outboxAck(seqs) {
  if (!db || !seqs?.length) return;
  run(`DELETE FROM ${TABLES.outbox} WHERE seq IN (${seqs.map(() => '?').join(',')})`, seqs);
  scheduleSave();
}
function outboxLoad() {
  if (!db) return [];
  return all(`SELECT seq,domain,op,record,at FROM ${TABLES.outbox} ORDER BY seq`)
    .map(r => ({ seq: r.seq, domain: r.domain, op: r.op, record: P(r.record), at: r.at }));
}
registerAdapter({
  name: 'local-sqlite-idb',
  init: initDb,
  persistDomain,
  registerDomain,
  exportBytes: () => (db ? db.export() : null),
  outboxAppend,
  outboxAck,
  outboxLoad,
  flush,
  info: () => dbInfo(),
});

/* ---------- 启动：打开 DB，空库导入 localStorage；否则恢复 ---------- */
export async function initDb(state) {
  const SQL = await window.initSqlJs({ locateFile: file => `vendor/sqljs/${file}` });
  const saved = await loadIdb();
  db = saved ? new SQL.Database(saved) : new SQL.Database();
  // v4：先重命名老库的无前缀表名（此时新表尚未被 SCHEMA 建出，避免新建空表占位导致迁移跳过）
  const renamed = migrateTableNames();

  // 版本必须在 SCHEMA 之前读取：SCHEMA 内含版本写入，晚读会被新值顶成当前版本，导致迁移判定失效。
  // 兼容旧版单列版本表（version INTEGER）与 v7 单行表（id=1, version）。
  const verTableExists = all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [TABLES.schemaVersion]).length > 0;
  const prevVer = verTableExists ? (all(`SELECT MAX(version) AS v FROM ${TABLES.schemaVersion}`)[0]?.v || 0) : 0;

  // 分版本迁移，均须早于 SCHEMA 判定（SCHEMA 内会写版本）。
  //  v7：裁剪到系统基座（删扩展/家庭表、重建 outbox、剥离归属 meta、版本表重建）——仅 prevVer<7
  //  v8：任务表补齐同步列与完成时间——prevVer<8（含 v7→v8；v6→v8 时两个都跑）
  const needV7 = !!saved && prevVer < 7;
  const needV8 = !!saved && prevVer < 8;
  if (needV7) migrateV7();

  db.run(SCHEMA);
  // v8 加列必须在 SCHEMA 之后：SCHEMA 的 CREATE TABLE IF NOT EXISTS 不会改已存在的旧表结构
  if (needV8) migrateV8();

  // 一次性重置到空工作台：base.js 的 migrateResetToEmpty 本次会话已清 localStorage 镜像，
  // 这里同步清空 SQLite 业务表，避免启动时从 DB 回读把旧数据带回。只在本会话首次初始化时清一次。
  try {
    if (resetAppliedThisSession && !resetConsumed) {
      for (const key of ['todos', 'todoGroups']) {
        if (M[key]) db.run(`DELETE FROM ${M[key].tables[0]}`);
      }
      resetConsumed = true;
      scheduleSave();
    }
  } catch { /* 清库失败不阻塞启动 */ }

  // 扩展自带表：扩展在 init 之前已声明，这里统一建表；新建的表用 state 镜像填充，而不是回读空表
  newTables.clear();
  for (const [key, mapping] of Object.entries(M)) {
    if (!mapping.ddl) continue;
    const table = mapping.tables[0];
    const existed = all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table]).length > 0;
    db.run(mapping.ddl);
    if (!existed) newTables.add(key);
  }
  migrateColumns(state); // 老库补列（如 v3 todos.start）并从 localStorage 镜像回填，在回读 state 之前执行

  // v6：清理历史 meta 里重复存的同步字段（独立列现在是真相源）。v7 迁移已顺带处理归属字段。
  if (prevVer > 0 && prevVer < 6) migrateSlimMeta();

  // v2_imported 标记：老库缺此键时从 localStorage（正确镜像）重导一次，自愈历史错位数据。
  // 但若刚发生表名迁移或 v7/v8 迁移，DB 里是已处理过的真实数据，必须回读而非用 localStorage 覆盖，并补写标记。
  const rebuilt = renamed || needV7 || needV8;
  const imported = all(`SELECT value FROM ${TABLES.settings} WHERE key='v2_imported'`).length > 0;
  if (rebuilt && !imported) {
    run(`INSERT OR REPLACE INTO ${TABLES.settings} (key,value) VALUES ('v2_imported','1')`);
    scheduleSave();
  }
  if ((!imported && !rebuilt) && state) {
    // state 不再预置业务域：未声明的域直接从 localStorage 镜像导入，避免首次导入时清空老数据
    for (const key of Object.keys(M)) persistDomain(key, state[key] ?? store.get(key, []));
    run(`INSERT OR REPLACE INTO ${TABLES.settings} (key,value) VALUES ('v2_imported','1')`);
    scheduleSave();
  } else if (state) {
    for (const key of Object.keys(M)) {
      const mapping = M[key];
      if (newTables.has(key)) { // 新建的空表：把本地镜像里已有的数据写进去，避免被空结果覆盖
        persistDomain(key, state[key] ?? store.get(key, []));
        state[key] ??= store.get(key, []);
        continue;
      }
      const main = all(mapping.load);
      const child = mapping.loadChild ? all(mapping.loadChild) : null;
      state[key] = mapping.fromRows(main, child);
    }
  }

  // 基座域：默认用户 + 当前设备登记；DB 偏好回灌本地；订阅偏好变更持续镜像
  seedBase(DEFAULT_USER_ID, getDeviceId(), detectPlatform());
  // 声明式登记已注册扩展（新增扩展零改表）；启用态与 localStorage 偏好对齐
  const enabledMap = store.get('extEnabled', {});
  for (const ext of registry.list) {
    if (ext.group === 'system') continue;
    registerBaseExtension(ext.id, ext.name, {
      enabled: enabledMap[ext.id] === true, sort: ext.order ?? 99, source: 'builtin',
    });
  }
  hydratePrefs(state);
  if (!prefSubscribed) { bus.on('pref', mirrorPref); prefSubscribed = true; }
  for (const key of BASE_PREF_KEYS) {
    const value = store.get(key);
    if (value !== undefined) mirrorPref({ key, value });
  }

  bus.emit('data');
  return state;
}

/** 从 IndexedDB 重新载入最新 SQLite 快照并回读所有领域到 state（手动刷新用）。
 * 先 flush 当前窗口未落盘变更，避免回读覆盖本窗口数据；失败不抛出，由调用方 toast。 */
export async function reloadFromDb(state) {
  if (!db) return false;
  await flush(); // 本窗口尚未落盘的写入先保存，防止被其它窗口快照覆盖
  const saved = await loadIdb();
  if (!saved) return false;
  const SQL = await window.initSqlJs({ locateFile: file => `vendor/sqljs/${file}` });
  db = new SQL.Database(saved);
  for (const key of Object.keys(M)) {
    const mapping = M[key];
    if (!mapping.load) continue;
    const main = all(mapping.load);
    const child = mapping.loadChild ? all(mapping.loadChild) : null;
    state[key] = mapping.fromRows(main, child);
    store.set(key, state[key]); // 同步 localStorage 镜像，保持一致
  }
  bus.emit('data', { key: '*', op: 'reload' });
  return true;
}

/** 诊断快照 */
export function dbInfo() {
  if (!db) return null;
  const tables = all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).map(r => r.name);
  const counts = Object.fromEntries(Object.keys(M).map(key => {
    const mapping = M[key];
    return [key, all(`SELECT COUNT(*) AS n FROM ${mapping.tables[0]}`)[0].n];
  }));
  return {
    adapter: 'local-sqlite-idb',
    tables,
    counts,
    base: baseInfo(),
    pendingOutbox: all(`SELECT COUNT(*) AS n FROM ${TABLES.outbox}`)[0].n,
  };
}
