/* core.js — WorkHub 内核
 *
 * 职责：系统偏好、事件总线、DOM 构建、扩展注册表、皮肤注册表、路由、五区渲染、启动。
 * 约束：零构建 / 原生 ES Modules；视图不碰存储；扩展只通过契约接入。
 *
 * 对外 API（供扩展与系统页使用，保持稳定）：
 *   store, bus, el, toast, openModal, field, input, pageHeader, fmtTime
 *   registry, setPlannedFeatures, getPlannedFeatures, registerSystemPage, hasSystemPage
 *   skinRegistry, registerSkin, getAllSkins, getActiveSkin, setActiveSkin,
 *     getSkinMounts, setSkinMount, resolveMount, getSkinMountPoints, mountLabelOfExt,
 *     getCustomSkinPoints, addCustomSkinPoint, updateCustomSkinPoint, deleteCustomSkinPoint
 *   openPopMenu
 *   ZONES, NAV_ZONES, PANEL_ZONES, placementOf, navExts, placementPicker,
 *   getMenuLayout, setPlacement, addGroup, updateGroup, deleteGroup
 *   extEnabled, setExtEnabled, themeNames, applyTheme, setDefaultStatus
 *   SHORTCUT_ACTIONS, getShortcuts, setShortcut, resetShortcuts,
 *     matchShortcut, comboFromEvent, formatShortcut, isModifierKey
 *   rightPanelOpen, toggleRightPanel, router, openUserPanel, boot, icons
 */
import icons from './icons.js';
export { icons };

/* ============================================================
   1. 系统偏好与 localStorage key 规范（v5：与 SQLite 表名对应）
   ------------------------------------------------------------
   逻辑 key（业务代码传入，如 'todos'/'theme'）→ 物理 key（localStorage 实际存储）：
     · 业务域  → wh_<表名>，如 todos → wh_ext_todo_items
     · 偏好/身份 → wh_sys_settings_<key>，如 theme → wh_sys_settings_theme
   映射只在物理存储层发生，bus.emit('pref') 仍发逻辑 key（db.js 依赖）。
   调用方零改动；老 key 由 migrateStorageKeys() 在启动时平滑迁移。
   ============================================================ */
export const PREFIX = 'wh_';

/** 业务域逻辑 key → SQLite 表名（与 db.js TABLES 保持一致） */
const DOMAIN_TABLE = Object.freeze({
  todos: 'ext_todo_items',
  todoGroups: 'ext_todo_groups',
  projects: 'ext_projects',
  tasks: 'ext_project_tasks',
  snippets: 'ext_snippets',
  complaints: 'ext_complaints',
  notes: 'ext_notes_nodes',
  posts: 'ext_blog_posts',
  learning: 'ext_learning',
});

/** 偏好/身份逻辑 key（存进 sys_settings 表命名空间） */
const PREF_KEYS = Object.freeze(new Set([
  'theme', 'skin', 'skinMounts', 'skinPoints', 'menuLayout',
  'extEnabled', 'rightCollapsed', 'shortcuts', 'searchRules',
  'links', // 无独立表的通用 KV，归入系统设置命名空间
  'currentUserId', 'currentUserName', 'currentHouseholdId', 'currentHouseholdName', 'defaultScope',
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
    try { localStorage.setItem(storageKey(key), JSON.stringify(value)); } catch { /* 隐私模式/配额满：静默降级 */ }
    // 基座偏好变更通知存储层镜像落库（db.js 订阅）；事件仍发逻辑 key
    bus.emit('pref', { key, value });
  },
};

// 模块加载即迁移老 key —— 必须早于 data.js 的 state 初始化（它在 import 时就 store.get）
try { migrateStorageKeys(); } catch { /* 存储不可用则跳过，静默降级 */ }

/* ============================================================
   1b. 快捷键配置（可自定义，存 wh_shortcuts）
   combo 语法：修饰键(mod|ctrl|meta|alt|shift) + 主键，用 + 连接。
   mod 表示 Mac 上 meta、其它平台 ctrl；数字 1-9 用占位键 '1-9'。
   ============================================================ */
export const SHORTCUT_ACTIONS = [
  { id: 'switchExt', label: '切换扩展', default: 'mod+1-9', keyLabel: '1-9', kind: 'range' },
  { id: 'settings', label: '打开设置', default: 'mod+,', keyLabel: ',', kind: 'key' },
  { id: 'back', label: '返回 / 关闭浮层', default: 'esc', keyLabel: 'Esc', kind: 'key' },
];
const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUT_ACTIONS.map(a => [a.id, a.default]));
const actionOf = id => SHORTCUT_ACTIONS.find(a => a.id === id);

export function getShortcuts() {
  const saved = store.get('shortcuts', {});
  return { ...DEFAULT_SHORTCUTS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

/** 键盘事件 → combo 字符串；纯修饰键返回 null */
export const isModifierKey = key => /^(Meta|Ctrl|Control|Alt|Shift|CapsLock)$/i.test(key || '');
export function comboFromEvent(event) {
  if (isModifierKey(event.key)) return null;
  const mods = [];
  if (event.metaKey) mods.push('meta');
  if (event.ctrlKey) mods.push('ctrl');
  if (event.altKey) mods.push('alt');
  if (event.shiftKey) mods.push('shift');
  let key = event.key;
  if (key === ' ') key = 'space';
  else if (key === 'Escape') key = 'esc';
  else key = key.toLowerCase();
  return [...mods, key].join('+');
}

/** 判断按键事件是否命中某个 combo。range 类支持 mod+数字 1-9。 */
export function matchShortcut(event, combo) {
  if (!combo) return false;
  const parts = combo.split('+');
  const key = parts.pop();
  const mods = new Set(parts);
  const hasMod = event.metaKey || event.ctrlKey;
  // 修饰键需精确匹配（mod = meta 或 ctrl）
  if (mods.has('mod') ? !hasMod
    : (mods.has('meta') !== !!event.metaKey || mods.has('ctrl') !== !!event.ctrlKey)) return false;
  if (mods.has('alt') !== !!event.altKey) return false;
  if (mods.has('shift') !== !!event.shiftKey) return false;
  const pressed = event.key === ' ' ? 'space'
    : event.key === 'Escape' ? 'esc' : event.key.toLowerCase();
  return key === '1-9' ? /^[1-9]$/.test(pressed) : pressed === key;
}

/** combo → 可读标签（跨平台） */
export function formatShortcut(combo) {
  const parts = combo.split('+');
  const key = parts.pop();
  const modName = { mod: '⌘ / Ctrl', ctrl: 'Ctrl', meta: '⌘', alt: 'Alt', shift: 'Shift' };
  const keyName = { esc: 'Esc', space: 'Space', ',': ',', '1-9': '1-9' };
  const label = k => modName[k] || keyName[k] || (k.length === 1 ? k.toUpperCase() : k);
  return [...parts.map(label), label(key)].join(' + ');
}

/** 保存单个快捷键；校验冲突（range 展开为 9 个槽位比对）。返回 {ok, error} */
export function setShortcut(id, combo) {
  const action = actionOf(id);
  if (!action || !combo) return { ok: false, error: '无效的快捷键' };
  const slotsOf = c => {
    const parts = c.split('+'), key = parts.pop();
    return key === '1-9' ? Array.from({ length: 9 }, (_, i) => [...parts, String(i + 1)].join('+'))
      : [[...parts, key].join('+')];
  };
  const mine = new Set(slotsOf(combo));
  const all = getShortcuts();
  for (const a of SHORTCUT_ACTIONS) {
    if (a.id === id) continue;
    if (slotsOf(all[a.id]).some(s => mine.has(s)))
      return { ok: false, error: `与「${a.label}」冲突` };
  }
  const next = { ...all, [id]: combo };
  store.set('shortcuts', next);
  bus.emit('shortcuts');
  return { ok: true };
}

export function resetShortcuts() {
  store.set('shortcuts', { ...DEFAULT_SHORTCUTS });
  bus.emit('shortcuts');
}

/* ============================================================
   2. 事件总线
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
   3. DOM 构建器（不用 innerHTML 拼接用户数据）
   ============================================================ */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;            // 仅受信静态图标
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child?.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const field = (label, ...controls) =>
  el('div', { class: 'field' }, el('label', { class: 'field-label' }, label), ...controls);

export const input = (attrs = {}) => el('input', { class: 'input', ...attrs });

let toastTimer = null;
export function toast(message) {
  let box = document.querySelector('.toast');
  // role=status + polite：不打断当前朗读，但屏幕阅读器会播报操作反馈
  if (!box) {
    box = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    document.body.append(box);
  }
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 2000);
}

let modalSeq = 0;
/** 可聚焦元素选择器：Tab 环绕与初始聚焦共用，避免焦点逃出弹窗 */
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function openModal(title, body, buttons) {
  const prevFocus = document.activeElement;   // 关闭后把焦点还给触发者
  const titleId = 'modal-title-' + (++modalSeq);
  let onKeydown;
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
  };
  const actions = el('div', { class: 'sheet-actions' },
    (buttons || [{ label: '好', primary: true }]).map(btn => el('button', {
      class: 'btn' + (btn.primary ? ' primary' : '') + (btn.danger ? ' danger' : ''),
      onclick: () => btn.onClick ? btn.onClick(close) : close(),
    }, btn.label)));
  const sheet = el('div', {
    class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
  }, el('div', { class: 'sheet-title', id: titleId }, title), body, actions);
  const overlay = el('div', { class: 'overlay' }, sheet);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  // 焦点陷阱：Tab / Shift+Tab 在弹窗内环绕；Esc 关闭（capture 前的全局处理器对 overlay 直接 return）
  onKeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = [...sheet.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKeydown);
  document.body.append(overlay);
  const firstField = sheet.querySelector('input:not([type="hidden"]), textarea, select');
  (firstField || sheet.querySelector(FOCUSABLE) || sheet).focus?.();
  if (firstField) setTimeout(() => firstField.focus(), 30);
  return close;
}

export function pageHeader({ title, back = false, backLabel = '返回', backAction, actions = [] }) {
  return el('div', { class: 'page-header' },
    back ? el('button', { class: 'back-btn', onclick: backAction || (() => router.home()) },
      el('span', { class: 'icon', html: icons.back }), backLabel) : null,
    el('div', { class: 'page-title' }, title),
    el('div', { class: 'header-actions' }, ...actions));
}

export const fmtTime = ts => {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ============================================================
   4. 五区模型定义
   ============================================================ */
export const ZONES = {
  left:   { label: '左侧栏', role: 'nav', collapsible: true },
  top:    { label: '顶部栏', role: 'nav' },
  center: { label: '中间区', role: 'content' },
  right:  { label: '右侧栏', role: 'panel', collapsible: true },
  bottom: { label: '底部栏', role: 'panel' },
};
export const NAV_ZONES = ['left', 'top'];
export const PANEL_ZONES = ['right', 'bottom'];

/* ============================================================
   5. 业务扩展注册表 + 规划中清单
   ============================================================ */
export const registry = {
  list: [],
  add(ext) {
    this.list.push(ext);
    this.list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  },
  get(id) { return this.list.find(e => e.id === id); },
};

let plannedFeatures = [];
export function setPlannedFeatures(list) { plannedFeatures = list; }
export const getPlannedFeatures = () => plannedFeatures;

/* 系统页面（内核自带：扩展中心 / 设置 / 详情），不可停用
 * meta: { title: string|ctx=>string, backLabel: string|ctx=>string, back: fn(ctx) }
 * 顶栏「返回 + 标题」统一由 meta 驱动，内容区不再重复渲染。 */
const systemPages = {};
const systemMeta = {};
export function registerSystemPage(id, render, meta = {}) {
  systemPages[id] = render;
  systemMeta[id] = meta;
}
export const hasSystemPage = id => !!systemPages[id];
export const getSystemMeta = id => systemMeta[id] || null;

/* 扩展启用开关 */
export function extEnabled(id) {
  const ext = registry.get(id);
  if (!ext || ext.group === 'system') return true;
  return store.get('extEnabled', {})[id] !== false;
}
export function setExtEnabled(id, on) {
  const map = store.get('extEnabled', {});
  map[id] = on;
  store.set('extEnabled', map);
  if (!on && router.extId === id) {
    const first = navExts()[0];
    router.go(first ? first.id : 'ext-center');
  } else {
    bus.emit('route');
  }
}

/* ============================================================
   6. 皮肤注册表（第二扩展维度）
   ============================================================ */
export const skinRegistry = {
  list: [],
  add(skin) { this.list.push(skin); },
  get(id) { return this.list.find(s => s.id === id); },
};
export function registerSkin(skin) { skinRegistry.add(skin); }
export const getAllSkins = () => skinRegistry.list.slice();

const DEFAULT_SKIN = 'classic';
export function getActiveSkin() {
  const id = store.get('skin', DEFAULT_SKIN);
  return skinRegistry.get(id)
    || skinRegistry.get(DEFAULT_SKIN)
    || skinRegistry.list[0]
    || null;
}
export function setActiveSkin(id) {
  if (!skinRegistry.get(id)) return;
  store.set('skin', id);
  document.body.dataset.skin = id;
  bus.emit('skin', id);
  bus.emit('route');
}

/** 挂载配置：skinMounts[skinId][pointId] = extId（存系统偏好） */
export function getSkinMounts(skinId) { return store.get('skinMounts', {})[skinId] || {}; }
export function setSkinMount(skinId, pointId, extId) {
  const all = store.get('skinMounts', {});
  all[skinId] = all[skinId] || {};
  if (extId) all[skinId][pointId] = extId;
  else delete all[skinId][pointId];
  store.set('skinMounts', all);
  bus.emit('route');
}
/** 解析挂载点：用户配置优先，回落皮肤 defaultExt */
export function resolveMount(skin, point) {
  return getSkinMounts(skin.id)[point.id] || point.defaultExt || null;
}

/** 皮肤声明的挂载点 + 用户自定义挂载点；panels 皮肤未声明时回落到五区（兼容第三方皮肤）
 *  自定义点存 skinPoints[skinId]，供皮肤详情页增删；stage 皮肤渲染时据此新增实物。 */
export function getSkinMountPoints(skin) {
  if (!skin) return [];
  const base = Array.isArray(skin.mountPoints) ? skin.mountPoints.slice()
    : skin.layout === 'stage' ? []
    : Object.entries(ZONES).map(([id, zone]) => ({
        id,
        name: zone.label,
        desc: zone.role === 'nav' ? '主菜单 · 一级入口'
          : zone.role === 'content' ? '主内容区' : '扩展功能菜单',
        role: zone.role,
      }));
  const extra = store.get('skinPoints', {})[skin.id] || [];
  return base.concat(extra);
}
/** 自定义挂载点：仅能增删皮肤声明之外的点，内建点（defaultExt 声明）不可删 */
export function getCustomSkinPoints(skinId) { return store.get('skinPoints', {})[skinId] || []; }
export function addCustomSkinPoint(skinId, point) {
  const all = store.get('skinPoints', {});
  all[skinId] = all[skinId] || [];
  if (all[skinId].some(p => p.id === point.id)) return false;
  all[skinId].push(point);
  store.set('skinPoints', all);
  bus.emit('route');
  return true;
}
export function updateCustomSkinPoint(skinId, pointId, patch) {
  const all = store.get('skinPoints', {});
  const point = (all[skinId] || []).find(p => p.id === pointId);
  if (!point) return false;
  Object.assign(point, patch);
  store.set('skinPoints', all);
  bus.emit('route');
  return true;
}
export function deleteCustomSkinPoint(skinId, pointId) {
  const all = store.get('skinPoints', {});
  if (!all[skinId]) return false;
  all[skinId] = all[skinId].filter(p => p.id !== pointId);
  store.set('skinPoints', all);
  const mounts = store.get('skinMounts', {});
  if (mounts[skinId]) { delete mounts[skinId][pointId]; store.set('skinMounts', mounts); }
  bus.emit('route');
  return true;
}
/** 浮层菜单（锚在按钮下方，自动夹紧到视口）— 供系统页复用
 *  支持 { sep:true } 分隔线；role=menu + 方向键导航 + Esc 关闭。 */
export function openPopMenu(anchor, items) {
  document.querySelector('.pop-menu')?.remove();
  const menu = el('div', { class: 'pop-menu', role: 'menu' });
  const buttons = [];
  items.forEach(item => {
    if (item.sep) { menu.append(el('div', { class: 'pop-menu-sep', role: 'separator' })); return; }
    const btn = el('button', {
      class: 'pop-menu-item' + (item.active ? ' active' : '') + (item.danger ? ' danger' : ''),
      role: 'menuitem',
      onclick: () => { close(); item.onClick?.(); },
    }, item.label);
    buttons.push(btn);
    menu.append(btn);
  });
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  let top = rect.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menu.offsetHeight - 6);
  menu.style.top = top + 'px';
  const onKeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); anchor.focus?.(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const i = buttons.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown'
        ? (i + 1) % buttons.length
        : (i <= 0 ? buttons.length - 1 : i - 1);
      buttons[next]?.focus();
    }
  };
  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', onKeydown);
  };
  const outside = event => { if (!menu.contains(event.target) && !anchor.contains(event.target)) close(); };
  document.addEventListener('keydown', onKeydown);
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  buttons[0]?.focus();
}

/** 扩展在当前皮肤下的挂载位置文案：stage 按实物反查，panels 沿用五区编排 */
export function mountLabelOfExt(skin, ext) {
  const points = getSkinMountPoints(skin);
  // skinMount 型挂载点（stage 实物 / classic 左栏底部）优先按用户配置反查
  const skinMountPoint = points.find(p => p.via === 'skinMount' && resolveMount(skin, p) === ext.id);
  if (skin?.layout === 'stage' || skinMountPoint) {
    const point = skin?.layout === 'stage'
      ? points.find(p => resolveMount(skin, p) === ext.id)
      : skinMountPoint;
    return point
      ? { label: `${point.name} · ${skin.name}`, pointId: point.id }
      : { label: '未挂载', pointId: null };
  }
  const place = placementOf(ext);
  if (place.zone === 'top') return { label: '顶部栏', pointId: 'top' };
  if (place.zone === 'left') {
    return {
      label: place.slot === 'main' || !place.slot ? '左侧 · 主菜单' : '左侧 · 文件夹',
      pointId: 'left',
    };
  }
  return { label: ZONES[place.zone]?.label || place.zone, pointId: place.zone };
}

/* ============================================================
   7. 菜单布局（nav 区：left / top 的位置编排）
   ============================================================ */
const defaultMenuLayout = () => ({
  groups: [
    { id: 'g-work', name: '工作', zone: 'left', collapsed: false },
    { id: 'g-knowledge', name: '知识', zone: 'left', collapsed: false },
    { id: 'g-tools', name: '工具', zone: 'left', collapsed: false },
  ],
  placement: {},
});
export function getMenuLayout() {
  const layout = store.get('menuLayout', { groups: [], placement: {} });
  for (const group of layout.groups) if (!group.zone) group.zone = 'left'; // 迁移旧数据
  if (!layout.groups.length && !Object.keys(layout.placement).length) return defaultMenuLayout();
  return layout;
}
function saveMenuLayout(layout) { store.set('menuLayout', layout); bus.emit('route'); }

/** place: null(左侧主菜单) | {zone:'top'} | {zone:'left'|'top', slot:'group:<gid>'} */
export function setPlacement(extId, place) {
  const layout = getMenuLayout();
  if (place) layout.placement[extId] = place;
  else delete layout.placement[extId];
  saveMenuLayout(layout);
}
export function addGroup(name, zone = 'left') {
  const layout = getMenuLayout();
  const group = { id: 'g' + Date.now().toString(36), name, zone, collapsed: false };
  layout.groups.push(group);
  saveMenuLayout(layout);
  return group;
}
export function updateGroup(gid, patch) {
  const layout = getMenuLayout();
  const group = layout.groups.find(g => g.id === gid);
  if (group) Object.assign(group, patch);
  saveMenuLayout(layout);
}
export function deleteGroup(gid) {
  const layout = getMenuLayout();
  layout.groups = layout.groups.filter(g => g.id !== gid);
  for (const [extId, place] of Object.entries(layout.placement)) {
    if (place?.slot === 'group:' + gid) delete layout.placement[extId];
  }
  saveMenuLayout(layout);
}
export function placementOf(ext) {
  if ((ext.group ?? 'main') !== 'main') return { zone: 'left', slot: ext.group };
  const place = getMenuLayout().placement[ext.id];
  if (!place) return { zone: 'left', slot: 'main' };
  if (place.slot?.startsWith('group:')) {
    const group = getMenuLayout().groups.find(g => 'group:' + g.id === place.slot);
    if (!group || group.zone !== place.zone) {
      return place.zone === 'left' ? { zone: 'left', slot: 'main' } : { zone: place.zone };
    }
  }
  return place;
}
/** 侧栏可视顺序：left 主菜单 → left 分组 → top */
export const navExts = () => {
  const layout = getMenuLayout();
  const enabled = registry.list.filter(e => extEnabled(e.id) && (e.group ?? 'main') !== 'soon');
  const ordered = enabled.filter(e => {
    const p = placementOf(e);
    return p.zone === 'left' && p.slot === 'main';
  });
  for (const group of layout.groups.filter(g => g.zone === 'left')) {
    ordered.push(...enabled.filter(e => {
      const p = placementOf(e);
      return p.zone === 'left' && p.slot === 'group:' + group.id;
    }));
  }
  ordered.push(...enabled.filter(e => placementOf(e).zone === 'top'));
  return ordered;
};

/** 位置选择弹窗（加入 left/top 的某处） */
export function placementPicker(ext, onDone) {
  const layout = getMenuLayout();
  const current = placementOf(ext);
  let picked = current.slot === 'main' || !current.slot
    ? (current.zone === 'left' ? 'main' : current.zone)
    : current.slot;
  let newGroupName = '';

  const rows = [];
  const head = text => rows.push(el('div', { class: 'pick-zone-label' }, text));
  const radio = (value, label) => {
    const control = el('input', { type: 'radio', name: 'place', value });
    control.checked = picked === value;
    control.addEventListener('change', () => { picked = value; });
    rows.push(el('label', { class: 'pick-row' }, control, el('span', {}, label)));
  };

  head(ZONES.left.label);
  radio('main', '左侧 · 主菜单（一级）');
  for (const group of layout.groups.filter(g => g.zone === 'left')) {
    radio('group:' + group.id, '左侧 · 文件夹：' + group.name);
  }
  head(ZONES.top.label);
  radio('top', '顶部 · 主菜单（一级）');

  const newInput = input({ placeholder: '新文件夹名称' });
  newInput.addEventListener('focus', () => { picked = '__new__'; });
  newInput.addEventListener('input', () => { picked = '__new__'; newGroupName = newInput.value.trim(); });
  rows.push(el('div', { class: 'pick-new' },
    el('span', { class: 'pick-zone-label', style: 'margin:0' }, '＋ 新建左侧文件夹'), newInput));

  openModal(`添加「${ext.name}」到`, el('div', { class: 'pick-list' }, rows), [
    { label: '取消' },
    { label: '确定', primary: true, onClick: close => {
      if (picked === '__new__' && newGroupName) {
        const group = addGroup(newGroupName, 'left');
        setPlacement(ext.id, { zone: 'left', slot: 'group:' + group.id });
      } else if (picked === 'main') {
        setPlacement(ext.id, null);
      } else if (picked === 'top') {
        setPlacement(ext.id, { zone: 'top' });
      } else if (picked?.startsWith('group:')) {
        const group = layout.groups.find(g => 'group:' + g.id === picked);
        setPlacement(ext.id, { zone: group?.zone || 'left', slot: picked });
      }
      close();
      onDone?.();
    } },
  ]);
}

/* ============================================================
   8. 主题
   ============================================================ */
export const themeNames = { dark: '深色', light: '浅色', terminal: '终端', oled: 'OLED' };
export function applyTheme(theme) {
  document.body.dataset.theme = theme;
  store.set('theme', theme);
}

/* ============================================================
   9. 路由（内存态；同步落地后可编码进 URL 便于分享）
   ============================================================ */
export const router = {
  extId: null, mode: 'home', id: null,
  go(extId) {
    if (!extEnabled(extId) && !hasSystemPage(extId)) return;
    this.extId = extId;
    this.mode = 'home';
    this.id = null;
    document.body.classList.remove('nav-open');
    bus.emit('route');
  },
  open(extId, detailId) {
    this.extId = extId;
    this.mode = 'detail';
    this.id = detailId;
    bus.emit('route');
  },
  home() { this.mode = 'home'; this.id = null; bus.emit('route'); },
  /** 回到皮肤主舞台（stage 皮肤专用） */
  back() { this.extId = null; this.mode = 'home'; this.id = null; bus.emit('route'); },
};

/* ============================================================
   10. 壳层渲染（五区）
   ============================================================ */
const $ = id => document.getElementById(id);

function navItem(ext, index) {
  const badge = ext.badge?.();
  return el('button', {
    class: 'nav-item' + (router.extId === ext.id ? ' active' : ''),
    title: ext.desc || ext.name,
    onclick: () => router.go(ext.id),
  },
    el('span', { class: 'icon', html: ext.icon }),
    el('span', { class: 'nav-name' }, ext.name),
    badge ? el('span', { class: 'nav-badge' }, badge) : null,
    index != null && index < 9 ? el('span', { class: 'kbd nav-kbd' }, `⌘${index + 1}`) : null);
}

function renderLeft() {
  const box = $('zoneLeft');
  if (!box) return;
  box.innerHTML = '';
  const layout = getMenuLayout();
  const ordered = navExts();

  const main = ordered.filter(e => {
    const p = placementOf(e);
    return p.zone === 'left' && p.slot === 'main';
  });
  main.forEach((ext, i) => box.append(navItem(ext, i)));

  for (const group of layout.groups.filter(g => g.zone === 'left')) {
    const items = ordered.filter(e => {
      const p = placementOf(e);
      return p.zone === 'left' && p.slot === 'group:' + group.id;
    });
    if (!items.length && !group.persist) continue;
    box.append(el('button', {
      class: 'nav-group-head',
      onclick: () => updateGroup(group.id, { collapsed: !group.collapsed }),
    },
      el('span', { class: 'icon chev' + (group.collapsed ? '' : ' open'), html: icons.chevronDown }),
      el('span', { class: 'nav-group-name' }, group.name),
      el('span', { class: 'nav-group-count' }, String(items.length))));
    if (!group.collapsed) items.forEach(ext => box.append(navItem(ext)));
  }

  box.append(el('div', { class: 'nav-spacer' }));
  // 左侧栏底部挂载点：展示其绑定的扩展（走 getSkinMounts/resolveMount，与皮肤详情配置同源）
  const skin = getActiveSkin();
  const slot = getSkinMountPoints(skin).find(p => p.id === 'left-bottom');
  const slotExtId = slot ? resolveMount(skin, slot) : null;
  if (slotExtId) {
    const ext = registry.get(slotExtId);
    const planned = getPlannedFeatures().find(f => f.id === slotExtId);
    const sys = slotExtId === 'ext-center' ? '扩展中心' : slotExtId === 'settings' ? '设置' : null;
    box.append(el('button', {
      class: 'nav-item nav-sys',
      title: `${slot.name} · ${ext?.name || planned?.name || sys || slotExtId}`,
      onclick: () => router.go(slotExtId),
    },
      el('span', { class: 'icon', html: ext?.icon || planned?.icon || icons.puzzle }),
      el('span', { class: 'nav-name' }, ext?.name || planned?.name || sys || slotExtId)));
  }
}

function renderTop() {
  const box = $('zoneTopMounts');
  if (!box) return;
  box.innerHTML = '';
  const items = navExts().filter(e => placementOf(e).zone === 'top');
  items.forEach(ext => box.append(el('button', {
    class: 'top-item' + (router.extId === ext.id ? ' active' : ''),
    onclick: () => router.go(ext.id),
  }, el('span', { class: 'icon', html: ext.icon }), el('span', {}, ext.name))));
}

function renderCenter() {
  const box = $('zoneCenter');
  if (!box) return;
  box.innerHTML = '';
  const ctx = { ext: router.extId, mode: router.mode, id: router.id };
  const skin = getActiveSkin();

  // 未选中扩展：stage 皮肤接管舞台
  if (!router.extId && skin?.renderStage) {
    box.append(skin.renderStage(ctx));
    box.scrollTop = 0;
    return;
  }
  // 系统页
  if (hasSystemPage(router.extId)) {
    box.append(systemPages[router.extId](ctx));
    box.scrollTop = 0;
    return;
  }

  const ext = registry.get(router.extId);
  if (!ext) {
    const planned = getPlannedFeatures().find(f => f.id === router.extId);
    if (skin?.renderStage) {
      box.append(el('button', { class: 'stage-back', onclick: () => router.back() },
        el('span', { class: 'icon', html: icons.back }), `返回${skin.name}`));
      box.append(el('div', { class: 'empty-shell' },
        el('div', { class: 'empty-shell-mark', html: icons.puzzle }),
        el('h2', {}, planned ? `「${planned.name}」规划中` : '未知视图'),
        el('p', {}, planned
          ? `${planned.desc || '该能力尚未实现。'} 优先级 ${planned.priority}。`
          : '该挂载点尚未配置扩展。'),
        el('button', { class: 'btn', onclick: () => router.go('ext-center') }, '查看扩展中心')));
    } else {
      box.append(el('div', { class: 'empty-shell' },
        el('div', { class: 'empty-shell-mark', html: icons.puzzle }),
        el('h2', {}, 'WorkHub 已就绪'),
        el('p', {}, '内核启动完成，当前没有已安装的扩展。'),
        el('p', {}, '前往扩展中心查看规划中的能力，或从 FEATURES.md 选择下一个要实现的功能。'),
        el('button', { class: 'btn primary', onclick: () => router.go('ext-center') }, '打开扩展中心')));
    }
    return;
  }

  const view = router.mode === 'detail' && ext.detail
    ? ext.detail(router.id, ctx)
    : ext.home ? ext.home(ctx)
    : el('div', { class: 'empty' }, '该扩展尚未提供内容视图');

  // stage 皮肤下：扩展视图统一带"返回舞台"条
  if (skin?.renderStage && skin.stageBack !== false) {
    box.append(el('button', { class: 'stage-back', onclick: () => router.back() },
      el('span', { class: 'icon', html: icons.back }), `返回${skin.name}`));
  }
  box.append(view);
  box.scrollTop = 0;
}

/** 当前扩展右侧面板是否展开（不含详情页/无面板内容） */
export function rightPanelOpen() {
  if (router.mode === 'detail') return false;
  const ext = registry.get(router.extId);
  return !!(ext?.panel && !store.get('rightCollapsed', false));
}

/** 切换当前扩展的右侧功能面板（由扩展页内控件调用，如 TODO 的「N 待完成」标签） */
export function toggleRightPanel() {
  store.set('rightCollapsed', !store.get('rightCollapsed', false));
  bus.emit('route');
}

function renderRight() {
  const panel = $('zoneRight');
  const body = $('zoneRightBody');
  if (!panel || !body) return;
  const ext = registry.get(router.extId);
  // 详情页聚焦内容：不显示功能面板
  const node = router.mode === 'detail'
    ? null
    : ext?.panel?.({ ext: router.extId, mode: router.mode, id: router.id });
  const collapsed = store.get('rightCollapsed', false);
  panel.hidden = !node || collapsed;
  if (node) { body.innerHTML = ''; body.append(node); }
}

let defaultStatus = null;
export function setDefaultStatus(fn) { defaultStatus = fn; }
/** 底部窄提示：去掉平台前缀里的空格，保留紧凑符号 */
const hintOf = combo => {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return combo.split('+').map(p => ({
    mod: isMac ? '⌘' : 'Ctrl', ctrl: 'Ctrl', meta: '⌘', alt: 'Alt', shift: '⇧',
    esc: 'Esc', space: 'Space',
  })[p] || (p === '1-9' ? '1-9' : p.toUpperCase())).join('');
};

function renderBottom() {
  const label = $('zoneBottomLabel');
  if (!label) return;
  const ext = registry.get(router.extId);
  label.textContent = ext?.status?.({ ext: router.extId, mode: router.mode, id: router.id })
    ?? defaultStatus?.() ?? '';
  const sc = getShortcuts();
  const hints = { hintSwitchExt: sc.switchExt, hintBack: sc.back, hintSettings: sc.settings };
  for (const [id, combo] of Object.entries(hints)) {
    const node = $(id);
    if (node) node.textContent = hintOf(combo);
  }
}

/** 把皮肤布局模式 + 页面类型写到 body（CSS 据此切换五区显隐/尺寸）
 *  data-page=system：设置/扩展中心/皮肤详情等系统页，隐藏一级工作台元素（左栏导航/顶部挂载/底部状态条/顶栏用户入口）
 */
/**
 * 顶栏二级页导航：系统页时用「返回 + 标题」替换 brand。
 * 标题/返回文案/返回动作取自 registerSystemPage 的 meta；缺省回工作台。
 */
function syncSystemTopBar(isSystem) {
  const bar = $('topSystem');
  if (!bar) return;
  bar.setAttribute('aria-hidden', String(!isSystem));
  if (!isSystem) return;
  const ctx = { ext: router.extId, mode: router.mode, id: router.id };
  const meta = getSystemMeta(router.extId) || {};
  const title = typeof meta.title === 'function' ? meta.title(ctx) : (meta.title || '');
  const label = typeof meta.backLabel === 'function' ? meta.backLabel(ctx) : (meta.backLabel || '返回');
  const titleEl = $('topSystemTitle');
  const labelEl = bar.querySelector('.top-back-label');
  const backBtn = $('btnTopBack');
  if (titleEl) titleEl.textContent = title;
  if (labelEl) labelEl.textContent = label;
  if (backBtn) {
    backBtn.title = label;
    backBtn.setAttribute('aria-label', label);
    backBtn.onclick = () => (typeof meta.back === 'function' ? meta.back(ctx) : leaveSystem());
  }
}

export function applySkinLayout() {
  const skin = getActiveSkin();
  document.body.dataset.skin = skin?.id || DEFAULT_SKIN;
  document.body.dataset.skinLayout = skin?.layout || 'panels';
  const isSystem = hasSystemPage(router.extId);
  document.body.dataset.page = isSystem ? 'system' : 'work';
  // 系统页隐藏了用户头像入口；若面板仍开着（如用 ⌘, 进入），一并关闭避免浮层残留
  if (isSystem) closeUserPop();
  syncSystemTopBar(isSystem);
}

/** 退出系统页回工作台：stage 回舞台，panels 进首个导航扩展 */
export function leaveSystem() {
  const skin = getActiveSkin();
  if (skin?.renderStage) { router.back(); return; }
  const first = navExts()[0];
  if (first) router.go(first.id);
  else { router.extId = null; router.mode = 'home'; router.id = null; bus.emit('route'); }
}

function renderAll() {
  applySkinLayout();
  renderLeft();
  renderTop();
  renderCenter();
  renderRight();
  renderBottom();
}

/* ---------- 用户面板（右上角） ---------- */
let userPopOutside = null;
function closeUserPop() {
  document.getElementById('userPop')?.remove();
  if (userPopOutside) {
    document.removeEventListener('mousedown', userPopOutside);
    userPopOutside = null;
  }
}
export function openUserPanel() {
  if (document.getElementById('userPop')) { closeUserPop(); return; }
  const anchor = $('btnUser');
  const rect = anchor.getBoundingClientRect();
  const order = ['dark', 'light', 'terminal', 'oled'];
  const current = document.body.dataset.theme || 'dark';
  const themeRow = el('button', { class: 'user-pop-row', onclick: () => {
    // 每次点击都读取当前主题，不能用打开面板时捕获的 current（否则只能切换一次）
    const active = document.body.dataset.theme || current;
    const next = order[(order.indexOf(active) + 1) % order.length];
    applyTheme(next);
    themeRow.querySelector('.user-pop-value').textContent = themeNames[next];
  } },
    el('span', { class: 'icon', html: icons.info }),
    el('span', { class: 'user-pop-label' }, '主题'),
    el('span', { class: 'user-pop-value' }, themeNames[current]),
    el('span', { class: 'user-pop-arrow' }, '›'));

  const pop = el('div', { class: 'user-pop', id: 'userPop' },
    el('div', { class: 'user-pop-head' },
      el('div', { class: 'user-avatar' }, 'HSF'),
      el('div', { style: 'flex:1' },
        el('div', { class: 'user-name' }, 'WorkHub'),
        el('div', { class: 'user-sub' }, '全端 · 本地优先'))),
    el('div', { class: 'user-pop-sep' }),
    el('button', { class: 'user-pop-row', onclick: () => { closeUserPop(); router.go('ext-center'); } },
      el('span', { class: 'icon', html: icons.puzzle }),
      el('span', { class: 'user-pop-label' }, '扩展中心'),
      el('span', { class: 'user-pop-arrow' }, '›')),
    themeRow,
    el('button', { class: 'user-pop-row', onclick: () => { closeUserPop(); router.go('settings'); } },
      el('span', { class: 'icon', html: icons.settings }),
      el('span', { class: 'user-pop-label' }, '设置'),
      el('span', { class: 'user-pop-value' }, hintOf(getShortcuts().settings)),
      el('span', { class: 'user-pop-arrow' }, '›')));
  document.body.append(pop);
  // 右对齐到按钮，再夹在视口内：窄屏下按钮靠右，左对齐会让面板右侧被裁切
  const margin = 8;
  const popW = pop.offsetWidth, popH = pop.offsetHeight;
  let left = rect.right - popW;
  left = Math.max(margin, Math.min(left, window.innerWidth - popW - margin));
  let top = rect.bottom + 6;
  const maxTop = window.innerHeight - popH - margin;
  if (top > maxTop) top = Math.max(margin, rect.top - popH - 6); // 下方放不下则翻到按钮上方
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  setTimeout(() => {
    if (!document.getElementById('userPop')) return; // 面板在定时器触发前已关闭
    userPopOutside = event => {
      if (!pop.contains(event.target) && !anchor.contains(event.target)) closeUserPop();
    };
    document.addEventListener('mousedown', userPopOutside);
  }, 0);
}

/* ============================================================
   11. 启动
   ============================================================ */
export function boot() {
  applyTheme(store.get('theme', 'dark'));
  applySkinLayout();

  $('btnUser')?.addEventListener('click', openUserPanel);
  $('zoneRightClose')?.addEventListener('click', () => toggleRightPanel());
  const navToggle = $('navToggle'), backdrop = $('backdrop');
  if (navToggle && backdrop) {
    navToggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
    backdrop.addEventListener('click', () => document.body.classList.remove('nav-open'));
  }

  bus.on('route', renderAll);
  bus.on('data', renderAll);

  document.addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    // 快捷键录制中：让位给设置页的录制监听器（capture 阶段已阻止冒泡）
    if (document.querySelector('[data-recording="1"]')) return;
    const sc = getShortcuts();

    // 返回：Esc 先让位给弹窗 / 浮层 / 用户面板各自的关闭逻辑
    if (matchShortcut(event, sc.back)) {
      if (document.querySelector('.overlay')) return;
      if (document.querySelector('.pop-menu') || document.querySelector('.todo-menu')) return;
      if (document.getElementById('userPop')) { closeUserPop(); return; }
      event.preventDefault();
      const skin = getActiveSkin();
      if (skin?.renderStage && router.extId) { router.back(); return; }
      if (router.mode === 'detail') router.home();
      return;
    }
    if (matchShortcut(event, sc.settings)) {
      event.preventDefault();
      router.go('settings');
      return;
    }
    if (!typing && matchShortcut(event, sc.switchExt)) {
      event.preventDefault();
      const ext = navExts()[Number(event.key) - 1];
      if (ext) router.go(ext.id);
    }
  });

  const skin = getActiveSkin();
  if (skin?.renderStage) {
    router.back(); // stage 皮肤：启动即展示主舞台
  } else {
    const first = navExts()[0];
    if (first) router.go(first.id);
    else renderAll();
  }
}
