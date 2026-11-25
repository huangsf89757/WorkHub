/* base.js — 基础设施：偏好存储 store / 事件总线 bus / localStorage key 规范
 *
 * 无 DOM、无 UI 依赖，data / sync / db / identity / platform 只依赖本模块，
 * 不再经由 UI 内核（core.js），避免数据层反向依赖界面层。
 * core.js 会 re-export 这里的全部符号，旧的 import 路径保持可用。
 */
/* ============================================================
   事件总线
   ============================================================ */
export const bus = {
  map: new Map(),
  on(event, fn) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) { this.map.get(event)?.delete(fn); },
  emit(event, data) { this.map.get(event)?.forEach(fn => fn(data)); },
};

/* ============================================================
   系统偏好与 localStorage key 规范（v5：与 SQLite 表名对应）
   ------------------------------------------------------------
   逻辑 key（业务代码传入，如 'todos'/'theme'）→ 物理 key（localStorage 实际存储）：
     · 业务域  → wh_<表名>，如 todos → wh_ext_todo_items
     · 偏好/身份 → wh_sys_settings_<key>，如 theme → wh_sys_settings_theme
   映射只在物理存储层发生，bus.emit('pref') 仍发逻辑 key（db.js 依赖）。
   调用方零改动；老 key 由 migrateStorageKeys() 在启动时平滑迁移。
   ============================================================ */
export const PREFIX = 'wh_';

/** 业务域逻辑 key → SQLite 表名（与 db.js TABLES 保持一致；扩展表由扩展自行声明，不入此表） */
const DOMAIN_TABLE = Object.freeze({
  todos: 'ext_todo_items',
  todoGroups: 'ext_todo_groups',
});

/** 偏好/身份逻辑 key（存进 sys_settings 表命名空间） */
const PREF_KEYS = Object.freeze(new Set([
  'theme', 'skin', 'skinMounts', 'skinPoints', 'menuLayout',
  'extEnabled', 'rightCollapsed', 'shortcuts', 'searchRules',
  'links', // 无独立表的通用 KV，归入系统设置命名空间
  'currentUserId', 'currentUserName',
  'deviceId',
]));

/** 逻辑 key → 物理 localStorage key */
export function storageKey(logical) {
  if (DOMAIN_TABLE[logical]) return PREFIX + DOMAIN_TABLE[logical];       // 业务域 → 表名
  if (PREF_KEYS.has(logical)) return PREFIX + 'sys_settings_' + logical; // 偏好/身份 → sys_settings
  return PREFIX + logical; // 未登记的未来扩展域：保持兼容
}

/**
 * 老 key → 新 key 迁移（幂等）：wh_<logical> → storageKey(logical)。
 * 新 key 已存在时不覆盖；迁移成功才删老 key。返回迁移条数。
 */
export function migrateStorageKeys() {
  let n = 0;
  const move = (oldKey, newKey) => {
    if (oldKey === newKey) return;
    let raw = null;
    try { raw = localStorage.getItem(oldKey); } catch { return; }
    if (raw === null) return;
    let newExists = false;
    try { newExists = localStorage.getItem(newKey) !== null; } catch { /* 降级 */ }
    if (!newExists) {
      try { localStorage.setItem(newKey, raw); n++; } catch { return; }
    }
    try { localStorage.removeItem(oldKey); } catch { /* 降级 */ }
  };
  // 业务域：老 wh_todos → 新 wh_ext_todo_items
  for (const logical of Object.keys(DOMAIN_TABLE)) move(PREFIX + logical, storageKey(logical));
  // 偏好/身份：老 wh_theme → 新 wh_sys_settings_theme
  for (const logical of PREF_KEYS) move(PREFIX + logical, storageKey(logical));
  return n;
}

export const store = {
  get(key, def) {
    try {
      const raw = localStorage.getItem(storageKey(key));
      return raw === null ? def : JSON.parse(raw);
    } catch { return def; }
  },
  set(key, value) {
    try { localStorage.setItem(storageKey(key), JSON.stringify(value)); }
    catch (error) {
      // 隐私模式/配额满：不再静默吞掉，通知界面提示（SQLite 仍是持久化主存储，镜像失败不丢数据）
      bus.emit('store:error', { key, error });
    }
    // 基座偏好变更通知存储层镜像落库（db.js 订阅）；事件仍发逻辑 key
    bus.emit('pref', { key, value });
  },
};

/**
 * 一次性重置迁移（v1）：把存量工作台清空为初始空状态。
 * 清除业务域镜像（待办/分组）与扩展启用态，写入标记保证只执行一次。
 * 幂等：标记存在时直接返回 false。返回是否发生了重置。
 */
export const RESET_MARKER = PREFIX + 'sys_settings_reset_v1';
// 本次会话是否真的执行了重置（供 db.js 决定是否同步清 SQLite；只清一次）
export let resetAppliedThisSession = false;
export function migrateResetToEmpty() {
  try {
    if (localStorage.getItem(RESET_MARKER) !== null) return false;
    // 清除所有业务域的 localStorage 镜像（todos / todoGroups 及未来扩展域）
    for (const logical of Object.keys(DOMAIN_TABLE)) localStorage.removeItem(storageKey(logical));
    // 扩展启用态重置为空（默认全关，见 core.extEnabled）
    localStorage.setItem(storageKey('extEnabled'), JSON.stringify({}));
    localStorage.setItem(RESET_MARKER, '1');
    resetAppliedThisSession = true;
    return true;
  } catch { return false; }
}

// 模块加载即迁移老 key —— 必须早于 data.js 的 state 初始化（它在 import 时就 store.get）
try { migrateStorageKeys(); } catch { /* 存储不可用则跳过，静默降级 */ }
try { migrateResetToEmpty(); } catch { /* 存储不可用则跳过，静默降级 */ }

/* ---------- 业务扩展注册表（纯数据结构，db.js 需要读取扩展清单，故放在基础设施层） ---------- */
export const registry = {
  list: [],
  add(ext) {
    this.list.push(ext);
    this.list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  },
  get(id) { return this.list.find(e => e.id === id); },
};
