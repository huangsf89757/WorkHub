/* db.js — 本地持久层 LocalAdapter：sql.js(WASM) + IndexedDB 存档
 *
 * 实现 storage.js 适配器契约；schema 与 docs/database-design.md 同步。
 * 领域整体重写（全表 DELETE + INSERT），个人规模足够；同步列已预埋。
 *
 * 正确性要点（勿回归）：
 *   1. persistDomain 必须区分单表/多表领域：单表领域 toRows 返回纯数据行，
 *      整行绑定，不能像多表领域那样丢弃首字段当表名（否则列全部左移一位）。
 *   2. 每条记录的 meta（含 deletedAt 墓碑）必须落库，否则软删除刷新后复活。
 *   3. 迁移标记 v2_imported：老库缺此键时从 localStorage 镜像重导一次自愈。
 */
import { bus, store, registry } from './core.js';
import { registerAdapter } from './storage.js';
import { getDeviceId, detectPlatform } from './platform.js';
import {
  DEFAULT_USER_ID, DEFAULT_USER_NAME, DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_NAME, ROLES,
} from './identity.js';

let db = null;
let saveTimer = null;
let prefSubscribed = false;

/* ============================================================
   表名规范（v4）：
     sys_  —— 系统内置基座表（用户/设备/设置/扩展机制/变更日志）
     ext_<扩展id>_ —— 扩展功能表，按扩展归属命名空间
   新增扩展只需在 TABLES 登记并建表，不与系统表混淆。
   ============================================================ */
const TABLES = Object.freeze({
  // 系统内置
  schemaVersion: 'sys_schema_version',
  users: 'sys_users',
  households: 'sys_households',
  memberships: 'sys_memberships',
  devices: 'sys_devices',
  settings: 'sys_settings',
  extensions: 'sys_extensions',
  extMounts: 'sys_ext_mounts',
  extKv: 'sys_ext_kv',
  outbox: 'sys_outbox',
  // 扩展功能
  todos: 'ext_todo_items',
  todoGroups: 'ext_todo_groups',
  projects: 'ext_projects',
  tasks: 'ext_project_tasks',
  snippets: 'ext_snippets',
  complaints: 'ext_complaints',
  complaintEvents: 'ext_complaint_events',
  noteNodes: 'ext_notes_nodes',
  noteVersions: 'ext_notes_versions',
  posts: 'ext_blog_posts',
  learning: 'ext_learning',
});

/** 旧表名 → 新表名（v3 及之前是无前缀命名），用于老库平滑迁移 */
const TABLE_RENAMES = Object.freeze({
  schema_version: TABLES.schemaVersion,
  users: TABLES.users,
  devices: TABLES.devices,
  settings: TABLES.settings,
  extensions: TABLES.extensions,
  ext_mounts: TABLES.extMounts,
  ext_kv: TABLES.extKv,
  outbox: TABLES.outbox,
  todos: TABLES.todos,
  todo_groups: TABLES.todoGroups,
  projects: TABLES.projects,
  tasks: TABLES.tasks,
  snippets: TABLES.snippets,
  complaints: TABLES.complaints,
  complaint_events: TABLES.complaintEvents,
  note_nodes: TABLES.noteNodes,
  note_versions: TABLES.noteVersions,
  posts: TABLES.posts,
  learning: TABLES.learning,
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
   Schema（含同步列 + outbox 表）
   ============================================================ */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS ${TABLES.schemaVersion} (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ${TABLES.projects} (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, stack TEXT, icon TEXT, url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER, updated_at INTEGER,
  updated_by TEXT, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.tasks} (
  id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, priority TEXT DEFAULT 'medium',
  created_at INTEGER, updated_at INTEGER, updated_by TEXT,
  deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.snippets} (
  id TEXT PRIMARY KEY, title TEXT, language TEXT, tags TEXT, code TEXT,
  created_at INTEGER, updated_at INTEGER, updated_by TEXT,
  deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.todos} (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
  priority TEXT DEFAULT 'medium', start INTEGER, due INTEGER, note TEXT DEFAULT '',
  group_id TEXT, tags TEXT, created_at INTEGER, updated_at INTEGER,
  updated_by TEXT, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.todoGroups} (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0,
  created_at INTEGER, updated_at INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.complaints} (
  id TEXT PRIMARY KEY, customer TEXT, title TEXT, severity TEXT, status TEXT,
  desc TEXT, created_at INTEGER, resolved_at INTEGER, updated_at INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.complaintEvents} (
  id TEXT PRIMARY KEY, complaint_id TEXT, content TEXT, created_at INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.noteNodes} (
  id TEXT PRIMARY KEY, parent_id TEXT, type TEXT NOT NULL, title TEXT,
  content TEXT, expanded INTEGER, created_at INTEGER, updated_at INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.noteVersions} (
  id TEXT PRIMARY KEY, node_id TEXT, content TEXT, created_at INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.posts} (
  id TEXT PRIMARY KEY, title TEXT, content TEXT, status TEXT DEFAULT 'draft',
  created_at INTEGER, updated_at INTEGER, meta TEXT);
CREATE TABLE IF NOT EXISTS ${TABLES.learning} (
  id TEXT PRIMARY KEY, title TEXT, category TEXT, progress INTEGER DEFAULT 0,
  priority INTEGER DEFAULT 3, created_at INTEGER, updated_at INTEGER, meta TEXT);
/* ---------- 系统内置域（用户 / 设备 / 设置 / 扩展机制 / 变更日志） ---------- */
CREATE TABLE IF NOT EXISTS ${TABLES.users} (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '我', avatar TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
/* households：家庭/协作空间（未来多用户升级的核心容器，单机默认一条 'home'） */
CREATE TABLE IF NOT EXISTS ${TABLES.households} (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '我的家', owner_id TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, rev INTEGER DEFAULT 1, meta TEXT);
/* memberships：用户在家庭中的成员关系（user_id + household_id 唯一，role=owner|member） */
CREATE TABLE IF NOT EXISTS ${TABLES.memberships} (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, household_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', joined_at INTEGER,
  updated_at INTEGER, meta TEXT, UNIQUE(user_id, household_id));
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
/* ext_mounts：扩展在各皮肤挂载点的绑定（skin_id + point_id → ext_id） */
CREATE TABLE IF NOT EXISTS ${TABLES.extMounts} (
  id TEXT PRIMARY KEY, skin_id TEXT NOT NULL, point_id TEXT NOT NULL, ext_id TEXT,
  updated_at INTEGER, meta TEXT, UNIQUE(skin_id, point_id));
CREATE TABLE IF NOT EXISTS ${TABLES.extKv} (
  id TEXT PRIMARY KEY, ext_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
  updated_at INTEGER, UNIQUE(ext_id, key));
CREATE TABLE IF NOT EXISTS ${TABLES.outbox} (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, op TEXT NOT NULL,
  record TEXT NOT NULL, at INTEGER NOT NULL, pushed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_ext_project_tasks_project ON ${TABLES.tasks}(project_id);
CREATE INDEX IF NOT EXISTS idx_ext_todo_items_group ON ${TABLES.todos}(group_id);
CREATE INDEX IF NOT EXISTS idx_sys_outbox_pushed ON ${TABLES.outbox}(pushed);
INSERT OR IGNORE INTO ${TABLES.schemaVersion} (version) VALUES (6);
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

/** 精简 meta：剔除该表已提升为独立列的同步字段，保留归属与其他扩展字段 */
const slimMeta = (meta, promoted = SYNC_ALL) => {
  if (!meta) return {};
  const out = { ...meta };
  for (const key of promoted) delete out[key];
  return out;
};

/** 从行重建 meta：meta JSON 为底，独立列覆盖已提升字段（列为准，杜绝旧实现 meta 覆盖列） */
const fromMeta = (row, promoted = SYNC_ALL) => {
  const meta = { ...(P(row.meta) || {}) };
  for (const key of promoted) {
    const col = SYNC_COL[key];
    if (col in row) meta[key] = row[col];
  }
  return meta;
};

const metaCols = record => [
  record.meta?.updatedAt || null,
  record.meta?.updatedBy || null,
  record.meta?.deletedAt || null,
  record.meta?.rev || 1,
  J(slimMeta(record.meta, SYNC_ALL)), // meta 只存未提升字段（归属/扩展）
];

/* ============================================================
   v6 数据迁移：清理历史 meta JSON 里已提升为独立列的同步字段。
   老库（v5 及之前）meta 里重复存了 updatedAt/updatedBy/deletedAt/rev，
   v6 起独立列为真相源，meta 只存归属与扩展字段。幂等可重复。
   ============================================================ */
const SYNC_TABLE_PROMOTED = Object.freeze({
  [TABLES.projects]: SYNC_ALL,
  [TABLES.tasks]: SYNC_ALL,
  [TABLES.snippets]: SYNC_ALL,
  [TABLES.todos]: SYNC_ALL,
  [TABLES.todoGroups]: PK_ONLY_UPDATED,
  [TABLES.complaints]: PK_ONLY_UPDATED,
  [TABLES.noteNodes]: PK_ONLY_UPDATED,
  [TABLES.posts]: PK_ONLY_UPDATED,
  [TABLES.learning]: PK_ONLY_UPDATED,
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
  projects: {
    tables: [TABLES.projects],
    insert: `INSERT INTO ${TABLES.projects} (id,name,stack,icon,url,is_active,created_at,updated_at,updated_by,deleted_at,rev,meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    toRows: arr => arr.map(p => [p.id, p.name, p.stack || '', p.icon || '', p.url || '', p.isActive ? 1 : 0, p.created || null, ...metaCols(p)]),
    fromRows: rows => rows.map(r => ({ id: r.id, name: r.name, stack: r.stack, icon: r.icon, url: r.url || '', isActive: !!r.is_active, created: r.created_at, meta: fromMeta(r) })),
    load: `SELECT * FROM ${TABLES.projects}`,
  },
  tasks: {
    tables: [TABLES.tasks],
    insert: `INSERT INTO ${TABLES.tasks} (id,project_id,title,done,priority,created_at,updated_at,updated_by,deleted_at,rev,meta) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    toRows: arr => arr.map(t => [t.id, t.projectId, t.title, t.done ? 1 : 0, t.priority || 'medium', t.created || Date.now(), ...metaCols(t)]),
    fromRows: rows => rows.map(r => ({ id: r.id, projectId: r.project_id, title: r.title, done: !!r.done, priority: r.priority, created: r.created_at, meta: fromMeta(r) })),
    load: `SELECT * FROM ${TABLES.tasks}`,
  },
  snippets: {
    tables: [TABLES.snippets],
    insert: `INSERT INTO ${TABLES.snippets} (id,title,language,tags,code,created_at,updated_at,updated_by,deleted_at,rev,meta) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    toRows: arr => arr.map(s => [s.id, s.title || '', s.language || '', J(s.tags || []), s.code || '', s.created || null, ...metaCols(s)]),
    fromRows: rows => rows.map(r => ({ id: r.id, title: r.title, language: r.language, tags: P(r.tags) || [], code: r.code, created: r.created_at, meta: fromMeta(r) })),
    load: `SELECT * FROM ${TABLES.snippets}`,
  },
  todos: {
    tables: [TABLES.todos],
    insert: `INSERT INTO ${TABLES.todos} (id,title,done,priority,start,due,note,group_id,tags,created_at,updated_at,updated_by,deleted_at,rev,meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    toRows: arr => arr.map(t => [t.id, t.title, t.done ? 1 : 0, t.priority || 'medium', t.start || null, t.due || null, t.note || '', t.groupId || null, J(t.tags || []), t.created || Date.now(), ...metaCols(t)]),
    fromRows: rows => rows.map(r => ({ id: r.id, title: r.title, done: !!r.done, priority: r.priority, start: r.start ?? null, due: r.due, note: r.note || '', groupId: r.group_id || '', tags: P(r.tags) || [], created: r.created_at, meta: fromMeta(r) })),
    load: `SELECT * FROM ${TABLES.todos}`,
  },
  todoGroups: {
    tables: [TABLES.todoGroups],
    insert: `INSERT INTO ${TABLES.todoGroups} (id,name,sort,created_at,updated_at,meta) VALUES (?,?,?,?,?,?)`,
    // 本表只有 updated_at 独立列：末列存精简 meta（剔除 updatedAt，保留 deletedAt 墓碑/归属）
    toRows: arr => arr.map((g, i) => [g.id, g.name, i, Date.now(), g.meta?.updatedAt || null, J(slimMeta(g.meta, PK_ONLY_UPDATED))]),
    // 列为准：updatedAt 取独立列，其余（含 deletedAt）取 meta
    fromRows: rows => rows.map(r => ({ id: r.id, name: r.name, meta: { ...(P(r.meta) || {}), updatedAt: r.updated_at } })),
    load: `SELECT * FROM ${TABLES.todoGroups} ORDER BY sort`,
  },
  complaints: {
    tables: [TABLES.complaints, TABLES.complaintEvents],
    inserts: {
      [TABLES.complaints]: `INSERT INTO ${TABLES.complaints} (id,customer,title,severity,status,desc,created_at,resolved_at,updated_at,meta) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [TABLES.complaintEvents]: `INSERT INTO ${TABLES.complaintEvents} (id,complaint_id,content,created_at,meta) VALUES (?,?,?,?,?)`,
    },
    toRows: arr => {
      const rows = [];
      for (const c of arr) {
        rows.push([TABLES.complaints, c.id, c.customer || '', c.title || '', c.severity || 'medium', c.status || 'open', c.desc || '', c.created || Date.now(), c.resolved || null, c.meta?.updatedAt || null, J(slimMeta(c.meta, PK_ONLY_UPDATED))]);
        for (const log of c.logs || []) {
          rows.push([TABLES.complaintEvents, `ce${log.ts}${Math.random().toString(36).slice(2, 6)}`, c.id, log.text, log.ts, null]);
        }
      }
      return rows;
    },
    fromRows: (complaints, events) => {
      const byId = {};
      for (const event of events || []) {
        (byId[event.complaint_id] ||= []).push({ ts: event.created_at, text: event.content });
      }
      return complaints.map(r => ({
        id: r.id, customer: r.customer, title: r.title, severity: r.severity,
        status: r.status, desc: r.desc, created: r.created_at, resolved: r.resolved_at,
        logs: (byId[r.id] || []).sort((a, b) => a.ts - b.ts), meta: fromMeta(r, PK_ONLY_UPDATED),
      }));
    },
    load: `SELECT * FROM ${TABLES.complaints}`,
    loadChild: `SELECT * FROM ${TABLES.complaintEvents}`,
  },
  notes: {
    tables: [TABLES.noteNodes, TABLES.noteVersions],
    inserts: {
      [TABLES.noteNodes]: `INSERT INTO ${TABLES.noteNodes} (id,parent_id,type,title,content,expanded,created_at,updated_at,meta) VALUES (?,?,?,?,?,?,?,?,?)`,
      [TABLES.noteVersions]: `INSERT INTO ${TABLES.noteVersions} (id,node_id,content,created_at,meta) VALUES (?,?,?,?,?)`,
    },
    toRows: arr => {
      const rows = [];
      for (const node of arr) {
        rows.push([TABLES.noteNodes, node.id, node.parentId || null, node.type, node.name, node.content || null, node.type === 'folder' ? (node.expanded ? 1 : 0) : null, node.created || Date.now(), node.meta?.updatedAt || null, J(slimMeta(node.meta, PK_ONLY_UPDATED))]);
        for (const h of node.history || []) {
          rows.push([TABLES.noteVersions, `nv${h.ts}${Math.random().toString(36).slice(2, 6)}`, node.id, h.text, h.ts, null]);
        }
      }
      return rows;
    },
    fromRows: (nodes, versions) => {
      const byId = {};
      for (const version of versions || []) {
        (byId[version.node_id] ||= []).push({ ts: version.created_at, text: version.content });
      }
      return nodes.map(r => {
        const base = { id: r.id, parentId: r.parent_id, type: r.type, name: r.title, created: r.created_at, meta: fromMeta(r, PK_ONLY_UPDATED) };
        if (r.type === 'folder') return { ...base, expanded: !!r.expanded };
        return { ...base, content: r.content || '', updated: r.updated_at || r.created_at, history: (byId[r.id] || []).sort((a, b) => a.ts - b.ts) };
      });
    },
    load: `SELECT * FROM ${TABLES.noteNodes}`,
    loadChild: `SELECT * FROM ${TABLES.noteVersions}`,
  },
  posts: {
    tables: [TABLES.posts],
    insert: `INSERT INTO ${TABLES.posts} (id,title,content,status,created_at,updated_at,meta) VALUES (?,?,?,?,?,?,?)`,
    toRows: arr => arr.map(p => [p.id, p.title || '', p.content || '', p.status || 'draft', p.created || Date.now(), p.meta?.updatedAt || null, J(slimMeta(p.meta, PK_ONLY_UPDATED))]),
    fromRows: rows => rows.map(r => ({ id: r.id, title: r.title, content: r.content, status: r.status, created: r.created_at, meta: fromMeta(r, PK_ONLY_UPDATED) })),
    load: `SELECT * FROM ${TABLES.posts}`,
  },
  learning: {
    tables: [TABLES.learning],
    insert: `INSERT INTO ${TABLES.learning} (id,title,category,progress,priority,created_at,updated_at,meta) VALUES (?,?,?,?,?,?,?)`,
    toRows: arr => arr.map(l => [l.id, l.title || '', l.category || '', l.progress || 0, l.priority || 3, l.created || Date.now(), l.meta?.updatedAt || null, J(slimMeta(l.meta, PK_ONLY_UPDATED))]),
    fromRows: rows => rows.map(r => ({ id: r.id, title: r.title, category: r.category, progress: r.progress, priority: r.priority, created: r.created_at, meta: fromMeta(r, PK_ONLY_UPDATED) })),
    load: `SELECT * FROM ${TABLES.learning}`,
  },
};

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
   扩展新增只需 registerBaseExtension（零改表），第三方可用 ext_kv 沙箱。
   ============================================================ */
/** 确保默认用户、默认家庭、owner 成员关系与当前设备登记在库（幂等） */
function seedBase(userId, deviceId, platform) {
  const now = Date.now();
  run(`INSERT OR IGNORE INTO ${TABLES.users} (id,name,created_at,rev,meta) VALUES (?,?,?,?,?)`,
    [userId, DEFAULT_USER_NAME, now, 1, J({})]);
  // 单机也建一条默认家庭快照：未来升级多用户时，家庭容器已存在，直接加成员即可
  run(`INSERT OR IGNORE INTO ${TABLES.households} (id,name,owner_id,created_at,rev,meta) VALUES (?,?,?,?,?,?)`,
    [DEFAULT_HOUSEHOLD_ID, DEFAULT_HOUSEHOLD_NAME, userId, now, 1, J({})]);
  run(`INSERT OR IGNORE INTO ${TABLES.memberships} (id,user_id,household_id,role,joined_at,meta) VALUES (?,?,?,?,?,?)`,
    [`m_${userId}_${DEFAULT_HOUSEHOLD_ID}`, userId, DEFAULT_HOUSEHOLD_ID, ROLES.OWNER, now, J({})]);
  run(`INSERT OR IGNORE INTO ${TABLES.devices} (id,user_id,platform,label,first_seen,last_seen,meta) VALUES (?,?,?,?,?,?,?)`,
    [deviceId, userId, platform || 'web', platform || 'Web', now, now, J({})]);
  run(`UPDATE ${TABLES.devices} SET last_seen=? WHERE id=?`, [now, deviceId]);
  scheduleSave();
}

/** 镜像 core.store 的一次偏好写入到 settings 表 */
function mirrorPref({ key, value }) {
  if (!db) return;
  run(`INSERT OR REPLACE INTO ${TABLES.settings} (key,value,scope,updated_at,meta) VALUES (?,?,?,?,?)`,
    [key, J(value), 'user', Date.now(), J({})]);
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

/* ---------- 用户 / 家庭 / 成员 API（多用户协作预留，单机只用默认值） ---------- */

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

/** 创建家庭（幂等），owner 自动成为 owner 成员 */
export function upsertHousehold(id, name, ownerId) {
  if (!db) return;
  const now = Date.now();
  run(`INSERT OR IGNORE INTO ${TABLES.households} (id,name,owner_id,created_at,rev,meta) VALUES (?,?,?,?,?,?)`,
    [id, name, ownerId, now, 1, J({})]);
  if (ownerId) addMember(id, ownerId, ROLES.OWNER);
  scheduleSave();
}

/** 添加家庭成员（幂等，user+household 唯一） */
export function addMember(householdId, userId, role = ROLES.MEMBER) {
  if (!db) return;
  run(`INSERT OR IGNORE INTO ${TABLES.memberships} (id,user_id,household_id,role,joined_at,meta) VALUES (?,?,?,?,?,?)`,
    [`m_${userId}_${householdId}`, userId, householdId, role, Date.now(), J({})]);
  scheduleSave();
}

/** 更新成员角色 */
export function setMemberRole(householdId, userId, role) {
  if (!db) return;
  run(`UPDATE ${TABLES.memberships} SET role=?,updated_at=? WHERE household_id=? AND user_id=?`,
    [role, Date.now(), householdId, userId]);
  scheduleSave();
}

/** 列出某家庭的成员（含用户信息） */
export function listMembers(householdId) {
  if (!db) return [];
  return all(`SELECT m.user_id, m.role, m.joined_at, u.name, u.avatar
    FROM ${TABLES.memberships} m LEFT JOIN ${TABLES.users} u ON u.id=m.user_id
    WHERE m.household_id=? ORDER BY m.joined_at`, [householdId])
    .map(r => ({ userId: r.user_id, role: r.role, joinedAt: r.joined_at, name: r.name, avatar: r.avatar }));
}

/** 列出用户所属家庭 */
export function listHouseholdsOf(userId) {
  if (!db) return [];
  return all(`SELECT h.id, h.name, h.owner_id, m.role
    FROM ${TABLES.memberships} m JOIN ${TABLES.households} h ON h.id=m.household_id
    WHERE m.user_id=? ORDER BY h.created_at`, [userId])
    .map(r => ({ id: r.id, name: r.name, ownerId: r.owner_id, role: r.role }));
}

/** 基座域诊断快照 */
export function baseInfo() {
  if (!db) return null;
  const count = table => all(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
  return {
    users: count(TABLES.users), devices: count(TABLES.devices), settings: count(TABLES.settings),
    extensions: count(TABLES.extensions), mounts: count(TABLES.extMounts), extKv: count(TABLES.extKv),
    households: count(TABLES.households), memberships: count(TABLES.memberships),
  };
}

/* ---------- 适配器注册 ---------- */
registerAdapter({
  name: 'local-sqlite-idb',
  init: initDb,
  persistDomain,
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
  db.run(SCHEMA);
  migrateColumns(state); // 老库补列（如 v3 todos.start）并从 localStorage 镜像回填，在回读 state 之前执行

  // v6：清理历史 meta 里重复存的同步字段（独立列现在是真相源）。
  // 版本号由 SCHEMA 的 INSERT OR IGNORE 写入：新库=6 跳过，老库=5 则迁移后升到 6。
  const schemaVer = all(`SELECT MAX(version) AS v FROM ${TABLES.schemaVersion}`)[0]?.v || 0;
  if (schemaVer < 6) {
    migrateSlimMeta();
    run(`UPDATE ${TABLES.schemaVersion} SET version=6 WHERE version<6`);
    scheduleSave();
  }

  // v2_imported 标记：老库缺此键时从 localStorage（正确镜像）重导一次，自愈历史错位数据。
  // 但若刚发生 v4 表名迁移，DB 里是已迁移的真实数据，必须回读而非用 localStorage 覆盖，并补写标记。
  const imported = all(`SELECT value FROM ${TABLES.settings} WHERE key='v2_imported'`).length > 0;
  if (renamed && !imported) {
    run(`INSERT OR REPLACE INTO ${TABLES.settings} (key,value) VALUES ('v2_imported','1')`);
    scheduleSave();
  }
  if ((!imported && !renamed) && state) {
    for (const key of Object.keys(M)) persistDomain(key, state[key]);
    run(`INSERT OR REPLACE INTO ${TABLES.settings} (key,value) VALUES ('v2_imported','1')`);
    scheduleSave();
  } else if (state) {
    for (const key of Object.keys(M)) {
      const mapping = M[key];
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
      enabled: enabledMap[ext.id] !== false, sort: ext.order ?? 99, source: 'builtin',
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
    pendingOutbox: all(`SELECT COUNT(*) AS n FROM ${TABLES.outbox} WHERE pushed=0`)[0].n,
  };
}
