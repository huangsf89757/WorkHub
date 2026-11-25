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
 *   setRefreshHandler, refreshAllData
 */
import icons from './icons.js';
export { icons };

import { PREFIX, storageKey, migrateStorageKeys, store, bus, registry } from './base.js';
export { PREFIX, storageKey, migrateStorageKeys, store, bus, registry };

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

/* 手动刷新：由 main.js 注入具体实现，避免内核直接依赖数据层造成循环引用。
 * 顶栏与扩展视图共用 refreshAllData()，未注入时静默降级。 */
let refreshHandler = null;
/** 注入刷新实现（main.js 装配时调用一次）。 */
export function setRefreshHandler(fn) { refreshHandler = fn; }
/** 执行完整刷新（云端同步 + 本地回读），结果 toast 提示。 */
export async function refreshAllData() {
  if (!refreshHandler) return;
  try {
    const r = await refreshHandler();
    if (r?.message) toast(r.message);
  } catch (e) {
    toast(`刷新失败：${e.message}`);
  }
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
  right:  { label: '右侧栏', role: 'entry', collapsible: true },
  bottom: { label: '底部栏', role: 'entry' },
};
export const NAV_ZONES = ['left', 'top'];
export const PANEL_ZONES = ['right', 'bottom'];

/* ============================================================
   5. 业务扩展注册表 + 规划中清单
   ============================================================ */

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

/* 扩展启用开关：默认关闭，需用户在扩展中心显式启用（初始为空工作台） */
export function extEnabled(id) {
  const ext = registry.get(id);
  if (!ext || ext.group === 'system') return true;
  return store.get('extEnabled', {})[id] === true;
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
    }, item.node || item.label);
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
   9. 路由（内存态 + hash 映射，支持新窗口直达与分享）
   ============================================================ */
/** 解析 hash 为路由对象；空 hash / 非法格式返回 null。系统页 detail 用两段式 `#/sys/<id>/<detailId>`。 */
export function parseRoute(hash) {
  const m = /^#\/(ext|sys)\/([^/]+)(?:\/(?:detail\/)?([^/]+))?$/.exec(hash || '');
  if (!m) return null;
  const [, kind, rawId, rawDetail] = m;
  const extId = decodeURIComponent(rawId);
  if (!extId) return null;
  if (kind === 'ext' && rawDetail && !hash.includes('/detail/')) return null;
  if (!rawDetail) return { extId, mode: 'home', id: null };
  try {
    return { extId, mode: 'detail', id: decodeURIComponent(rawDetail) };
  } catch { return null; }
}

/** 由路由对象生成 hash；无 extId 返回 `#/`。系统页按注册表判定格式。 */
export function buildRoute({ extId, mode = 'home', id = null } = {}) {
  if (!extId) return '#/';
  const kind = hasSystemPage(extId) ? 'sys' : 'ext';
  const head = `#/${kind}/${encodeURIComponent(extId)}`;
  if (mode !== 'detail' || !id) return head;
  const tail = encodeURIComponent(id);
  return kind === 'sys' ? `${head}/${tail}` : `${head}/detail/${tail}`;
}

/** 同步当前路由到 URL（不新增历史记录，replaceState 不触发 hashchange）。 */
function syncHash() {
  try {
    const next = buildRoute(router);
    const current = location.hash || '';
    if (current !== next) history.replaceState(null, '', `${location.pathname}${location.search}${next}`);
  } catch { /* 非浏览器环境忽略 */ }
}

/** 用 hashchange 事件更新内存态并触发重绘；非法路由回落到首个可用入口。 */
function applyHash() {
  const route = parseRoute(location.hash);
  if (!route) return false;
  const valid = hasSystemPage(route.extId)
    || (extEnabled(route.extId) && !!registry.get(route.extId));
  if (!valid) return false;
  router.extId = route.extId;
  router.mode = route.mode;
  router.id = route.id;
  bus.emit('route');
  return true;
}

export const router = {
  extId: null, mode: 'home', id: null,
  go(extId) {
    if (!extEnabled(extId) && !hasSystemPage(extId)) return;
    this.extId = extId;
    this.mode = 'home';
    this.id = null;
    document.body.classList.remove('nav-open');
    syncHash();
    bus.emit('route');
  },
  open(extId, detailId) {
    this.extId = extId;
    this.mode = 'detail';
    this.id = detailId;
    syncHash();
    bus.emit('route');
  },
  home() { this.mode = 'home'; this.id = null; syncHash(); bus.emit('route'); },
  /** 回到皮肤主舞台（stage 皮肤专用） */
  back() { this.extId = null; this.mode = 'home'; this.id = null; syncHash(); bus.emit('route'); },
};

/** 当前是否为扩展独立窗口（专注模式）：URL 带 focus=1。 */
export const isFocusMode = () => typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('focus') === '1';

/** 打开扩展主页的浏览器独立窗口（专注模式：仅显示 center 扩展视图）；被拦截时提示。 */
export function openExtensionWindow(extId) {
  if (!extId) return;
  const url = new URL(location.href);
  url.searchParams.set('focus', '1');
  url.hash = buildRoute({ extId, mode: 'home' });
  const win = window.open(url.href, '_blank');
  if (!win) { toast('独立窗口被浏览器拦截，请允许弹窗后重试'); return; }
  win.opener = null;
}

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

  // stage 皮肤下：扩展视图统一带"返回舞台"条（独立窗口无舞台，不显示）
  if (!isFocusMode() && skin?.renderStage && skin.stageBack !== false) {
    box.append(el('button', { class: 'stage-back', onclick: () => router.back() },
      el('span', { class: 'icon', html: icons.back }), `返回${skin.name}`));
  }
  // 统一工具条：非独立窗口时提供"独立窗口打开"入口。
  // 独立窗口内自身已是目标视图，不再重复注入该按钮。
  if (!isFocusMode()) {
    const windowBtn = el('button', {
      class: 'ext-window-btn',
      title: '在独立浏览器窗口打开该扩展',
      'aria-label': `在独立窗口打开「${ext.name}」`,
      onclick: () => openExtensionWindow(ext.id),
    }, el('span', { class: 'icon', html: icons.external }), '独立窗口打开');
    const headerActions = view.querySelector?.('.page-header .header-actions');
    if (headerActions) headerActions.append(windowBtn);
    else box.append(el('div', { class: 'ext-view-tools' }, windowBtn));
  }
  box.append(view);
  box.scrollTop = 0;
}

/** 返回挂载到某个 entry 区（right/bottom）的已启用扩展，去重。来源：菜单编排 + 皮肤挂载点。 */
export function entryExts(zone) {
  const skin = getActiveSkin();
  const ids = new Set();
  registry.list.forEach(ext => {
    if (!extEnabled(ext.id)) return;
    if (placementOf(ext).zone === zone) ids.add(ext.id);
  });
  getSkinMountPoints(skin)
    .filter(p => p.id === zone)
    .forEach(p => {
      const id = resolveMount(skin, p);
      if (id && extEnabled(id) && registry.get(id)) ids.add(id);
    });
  return [...ids].map(id => registry.get(id));
}

/** entry 区入口按钮：只挂载 launcher，点击进 center 显示该扩展详情。 */
function entryItem(ext) {
  return el('button', {
    class: 'entry-item' + (router.extId === ext.id ? ' active' : ''),
    title: ext.desc || ext.name,
    onclick: () => router.go(ext.id),
  },
    el('span', { class: 'icon', html: ext.icon }),
    el('span', { class: 'entry-name' }, ext.name),
    ext.badge?.() ? el('span', { class: 'nav-badge' }, ext.badge()) : null);
}

/** 当前扩展右侧入口区是否展开（由用户折叠偏好决定） */
export function rightPanelOpen() {
  return !store.get('rightCollapsed', false);
}

/** 切换右侧入口区（由 zoneRightClose 调用） */
export function toggleRightPanel() {
  store.set('rightCollapsed', !store.get('rightCollapsed', false));
  bus.emit('route');
}

function renderRight() {
  const panel = $('zoneRight');
  const body = $('zoneRightBody');
  if (!panel || !body) return;
  const items = entryExts('right');
  panel.hidden = !items.length || store.get('rightCollapsed', false);
  if (items.length) {
    body.innerHTML = '';
    items.forEach(ext => body.append(entryItem(ext)));
  }
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
  // 底栏只显示系统级状态；扩展详情（含统计）统一在 center
  label.textContent = defaultStatus?.() ?? '';
  const bar = $('zoneBottom');
  bar?.querySelectorAll('.bottom-entry').forEach(n => n.remove());
  entryExts('bottom').forEach(ext => {
    const btn = el('button', {
      class: 'bottom-entry' + (router.extId === ext.id ? ' active' : ''),
      title: `打开「${ext.name}」`,
      onclick: () => router.go(ext.id),
    }, el('span', { class: 'icon', html: ext.icon }), ext.name);
    label.before(btn);
  });
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

/* ---------- 数据变更重绘：保留焦点、光标位置与滚动位置 ----------
   五区重绘是整体重建 DOM。若不处理，输入中的光标/滚动会被重置。
   重绘前记录「容器 + 第 N 个可输入控件 + 选区」与各滚动容器的 scrollTop，
   重绘后按相同位置恢复。结构变化导致位置对不上时放弃恢复（退化为旧行为）。 */
const EDITABLE = 'input,textarea,select,[contenteditable="true"]';
const RESTORE_ZONES = ['zoneCenter', 'zoneRight', 'zoneLeft', 'zoneTop'];
function captureUiState() {
  const state = { focus: null, scrolls: [] };
  const active = document.activeElement;
  for (const id of RESTORE_ZONES) {
    const zone = document.getElementById(id);
    if (!zone) continue;
    if (active && zone.contains(active) && active.matches?.(EDITABLE)) {
      const index = [...zone.querySelectorAll(EDITABLE)].indexOf(active);
      if (index >= 0) {
        state.focus = {
          id, index, tag: active.tagName,
          start: active.selectionStart ?? null, end: active.selectionEnd ?? null,
        };
      }
    }
    if (zone.scrollTop > 0) state.scrolls.push({ id, index: -1, top: zone.scrollTop });
    [...zone.querySelectorAll('*')].forEach((node, index) => {
      if (node.scrollTop > 0) state.scrolls.push({ id, index, tag: node.tagName, top: node.scrollTop });
    });
  }
  return state;
}
function restoreUiState(state) {
  for (const s of state.scrolls) {
    const zone = document.getElementById(s.id);
    const node = s.index < 0 ? zone : zone?.querySelectorAll('*')[s.index];
    if (node && (s.index < 0 || node.tagName === s.tag)) node.scrollTop = s.top;
  }
  const f = state.focus;
  if (!f) return;
  const node = document.getElementById(f.id)?.querySelectorAll(EDITABLE)[f.index];
  if (!node || node.tagName !== f.tag || node.disabled) return;
  node.focus({ preventScroll: true });
  if (f.start != null) { try { node.setSelectionRange(f.start, f.end); } catch { /* 非文本类型无选区 */ } }
}
function renderPreservingUi() {
  const saved = captureUiState();
  renderAll();
  restoreUiState(saved);
}
/**
 * 按领域精确重绘（可选优化）：扩展声明 `domains: ['todos', ...]` 表示 center / right 只依赖这些域。
 * 当前是该扩展的 home / detail 页，且本次变更的域不在声明里，则只刷新 left / top / bottom
 * （角标与状态条可能依赖任意域），center / right 保持原样，不打断输入。
 * 未声明 domains、系统页、stage 皮肤、批量事件（hydrate / 无 key）一律整体重绘，行为与以前一致。
 */
export function dataRenderScope(event, route = router) {
  const key = event?.key;
  if (!key || key === '*') return 'all';
  if (hasSystemPage(route.extId)) return 'all';
  const ext = registry.get(route.extId);
  if (!ext || !Array.isArray(ext.domains)) return 'all';
  return ext.domains.includes(key) ? 'all' : 'chrome';
}
function onData(event) {
  if (dataRenderScope(event) === 'all') { renderPreservingUi(); return; }
  applySkinLayout();
  renderLeft();
  renderTop();
  renderBottom();
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
  if (isFocusMode()) document.body.dataset.focus = '1';
  // localStorage 镜像写入失败（配额满等）：SQLite 仍可保存，仅提示一次，避免用户无感知
  let warned = false;
  bus.on('store:error', () => {
    if (warned) return;
    warned = true;
    toast('本地缓存写入失败（空间不足？）。请到 设置 → 数据与备份 导出备份');
  });
  applySkinLayout();

  $('btnUser')?.addEventListener('click', openUserPanel);
  $('btnRefresh')?.addEventListener('click', refreshAllData);
  $('zoneRightClose')?.addEventListener('click', () => toggleRightPanel());
  const navToggle = $('navToggle'), backdrop = $('backdrop');
  if (navToggle && backdrop) {
    navToggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
    backdrop.addEventListener('click', () => document.body.classList.remove('nav-open'));
  }

  bus.on('route', renderAll);
  bus.on('data', onData);
  window.addEventListener('hashchange', applyHash);

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
      // 独立窗口没有舞台，Esc 只在扩展内 detail→home，不回舞台留下空白
      if (isFocusMode()) { if (router.mode === 'detail') router.home(); return; }
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
  // 优先按 URL 直达；stage 皮肤下 hash 无效时才回舞台
  if (applyHash()) return;
  if (skin?.renderStage) {
    router.back(); // stage 皮肤：启动即展示主舞台
  } else {
    const first = navExts()[0];
    if (first) router.go(first.id);
    else renderAll();
  }
}
