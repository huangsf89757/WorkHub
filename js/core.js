/* core.js — WorkHub 内核
 *
 * 职责：系统偏好、事件总线、DOM 构建、扩展注册表、主题风格注册表、路由、五区渲染、启动。
 * 约束：零构建 / 原生 ES Modules；视图不碰存储；扩展只通过契约接入。
 *
 * 对外 API（供扩展与系统页使用，保持稳定）：
 *   store, bus, el, toast, openModal, field, input, pageHeader, fmtTime
 *   registry, setPlannedFeatures, getPlannedFeatures, registerSystemPage, hasSystemPage
 *   themeStyleRegistry, registerThemeStyle, getAllThemeStyles, getActiveThemeStyle, setActiveThemeStyle,
 *     getThemeStyleMounts, setThemeStyleMount, resolveMount, getThemeStyleMountPoints, mountLabelOfExt,
 *     getMountEnabled, mountEnabledOf, setMountEnabled,
 *     getCustomThemeStylePoints, addCustomThemeStylePoint, updateCustomThemeStylePoint, deleteCustomThemeStylePoint
 *   openPopMenu
 *   ZONES, NAV_ZONES, PANEL_ZONES, ZONE_SLOTS, slotPointId, slotsOfZone,
 *     resolveSlotMount, firstMountedExtId, entryExts, shortcutExtCandidates,
 *     getConfigSnapshot, applyConfigSnapshot
 *   extEnabled, setExtEnabled, EXT_STAGES, extStageLabel, extStageOf,
 *     isExtInstalled, installExt, uninstallExt, extNeedsUpdate, updateExt, isExtMounted
 *   themeColorNames, applyThemeColor
 *   SHORTCUT_ACTIONS, getShortcuts, setShortcut, resetShortcuts,
 *     getExtShortcuts, setExtShortcut, removeExtShortcut, shortcutExtCandidates,
 *     matchShortcut, comboFromEvent, formatShortcut, isModifierKey
 *   rightPanelOpen, toggleRightPanel, router, openUserPanel, boot, icons
 *   setRefreshHandler, refreshAllData
 */
import icons from './icons.js';
export { icons };

import { PREFIX, storageKey, migrateStorageKeys, store, bus, registry } from './base.js';
export { PREFIX, storageKey, migrateStorageKeys, store, bus, registry };

/* ============================================================
   1b. 快捷键配置（可自定义，存 wh_sys_settings_shortcuts）
   combo 语法：修饰键(mod|ctrl|meta|alt|shift) + 主键，用 + 连接。
   mod 表示 Mac 上 meta、其它平台 ctrl；扩展快捷键以 'ext:' 为键前缀。
   内置动作只有打开设置 / 返回；扩展快捷键由用户按扩展逐个添加。
   ============================================================ */
export const SHORTCUT_ACTIONS = [
  { id: 'settings', label: '打开设置', default: 'mod+,', keyLabel: ',', kind: 'key' },
  { id: 'back', label: '返回 / 关闭浮层', default: 'esc', keyLabel: 'Esc', kind: 'key' },
];
const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUT_ACTIONS.map(a => [a.id, a.default]));
const EXT_PREFIX = 'ext:';
const actionOf = id => SHORTCUT_ACTIONS.find(a => a.id === id);

export function getShortcuts() {
  const saved = store.get('shortcuts', {});
  const all = { ...DEFAULT_SHORTCUTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  delete all.switchExt; // 旧版「切换扩展」已移除，清理历史配置
  return all;
}

/** 已绑定的扩展快捷键：{ extId: combo } */
export function getExtShortcuts() {
  const out = {};
  for (const [id, combo] of Object.entries(getShortcuts())) {
    if (id.startsWith(EXT_PREFIX) && typeof combo === 'string' && combo) out[id.slice(EXT_PREFIX.length)] = combo;
  }
  return out;
}

/** 四区槽位中已挂载且可用的扩展，作为添加快捷键的候选 */
export function shortcutExtCandidates() {
  const usable = id => !!registry.get(id) && extEnabled(id);
  const ids = new Set();
  for (const zone of Object.keys(ZONE_SLOTS)) {
    for (const slot of slotsOfZone(zone)) {
      const id = resolveSlotMount(zone, slot.id);
      if (id) ids.add(id);
    }
  }
  return [...ids].filter(usable).map(id => registry.get(id));
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
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const modName = { mod: isMac ? '⌘' : 'Ctrl', ctrl: 'Ctrl', meta: '⌘', alt: 'Alt', shift: 'Shift' };
  const keyName = { esc: 'Esc', space: 'Space', ',': ',', '1-9': '1-9' };
  const label = k => modName[k] || keyName[k] || (k.length === 1 ? k.toUpperCase() : k);
  return [...parts.map(label), label(key)].join('');
}

/** combo → 槽位集合；range（1-9）展开为 9 个键 */
const slotsOf = c => {
  const parts = c.split('+'), key = parts.pop();
  return key === '1-9' ? Array.from({ length: 9 }, (_, i) => [...parts, String(i + 1)].join('+'))
    : [[...parts, key].join('+')];
};
/** 冲突检测：返回冲突方的可读名称，无冲突返回 null */
function conflictOf(id, combo, shortcuts) {
  const mine = new Set(slotsOf(combo));
  for (const [otherId, otherCombo] of Object.entries(shortcuts)) {
    if (otherId === id || !otherCombo) continue;
    if (!slotsOf(otherCombo).some(s => mine.has(s))) continue;
    if (otherId.startsWith(EXT_PREFIX)) {
      const extId = otherId.slice(EXT_PREFIX.length);
      return `扩展「${registry.get(extId)?.name || extId}」`;
    }
    return actionOf(otherId)?.label || otherId;
  }
  return null;
}
function commitShortcut(id, combo) {
  if (!combo) return { ok: false, error: '无效的快捷键' };
  const all = getShortcuts();
  const conflict = conflictOf(id, combo, all);
  if (conflict) return { ok: false, error: `与${conflict}冲突` };
  all[id] = combo;
  store.set('shortcuts', all);
  bus.emit('shortcuts');
  return { ok: true };
}
/** 保存内置动作的快捷键。返回 {ok, error} */
export function setShortcut(id, combo) {
  if (!actionOf(id)) return { ok: false, error: '无效的快捷键' };
  return commitShortcut(id, combo);
}
/** 为扩展绑定快捷键。返回 {ok, error} */
export function setExtShortcut(extId, combo) {
  if (!registry.get(extId)) return { ok: false, error: '扩展不存在' };
  return commitShortcut(EXT_PREFIX + extId, combo);
}
/** 移除某个扩展的快捷键 */
export function removeExtShortcut(extId) {
  const all = getShortcuts();
  delete all[EXT_PREFIX + extId];
  store.set('shortcuts', all);
  bus.emit('shortcuts');
}

/** 恢复默认快捷键；keepExt 为 true 时保留用户添加的扩展快捷键 */
export function resetShortcuts({ keepExt = false } = {}) {
  const all = getShortcuts();
  const ext = keepExt
    ? Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(EXT_PREFIX)))
    : {};
  store.set('shortcuts', { ...DEFAULT_SHORTCUTS, ...ext });
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
export function openModal(title, body, buttons, onClose) {
  const prevFocus = document.activeElement;   // 关闭后把焦点还给触发者
  const titleId = 'modal-title-' + (++modalSeq);
  let onKeydown;
  const close = () => {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    onClose?.();
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

/* ============================================================
   扩展页面通用模板（所有扩展的 1 级主页统一套用）
   ============================================================ */

/**
 * 扩展 1 级主页外壳：页头 + 工具栏 + 选项卡 + 内容体。
 * 保留 .page-header .header-actions，供核心层注入「独立窗口打开」按钮。
 */
export function extHomePage({ title, actions = [], toolbar = null, tabs = null, body }) {
  return el('div', { class: 'page ext-page' },
    pageHeader({ title, actions }),
    toolbar, tabs, ...[body].flat(Infinity));
}

/** 通用工具栏容器：左对齐、可换行的一组操作按钮。 */
export function extToolbar(...items) {
  return el('div', { class: 'ext-toolbar' }, ...items);
}

/** 工具栏次级按钮：排序、分组等非主操作。 */
export function extToolButton(content, onclick, { active = false } = {}) {
  return el('button', {
    type: 'button', class: 'ext-tbtn' + (active ? ' active' : ''), onclick,
  }, content);
}

/** 通用选项卡条：items 为 [key, label] 数组，切换时回调 onChange(key)。 */
export function extTabs(items, active, onChange, label = '视图筛选') {
  return el('div', { class: 'ext-tabs', role: 'tablist', 'aria-label': label },
    ...items.map(([key, text]) =>
      el('button', {
        type: 'button',
        class: 'ext-tab' + (key === active ? ' active' : ''),
        role: 'tab', 'aria-selected': String(key === active),
        onclick: () => onChange(key),
      }, text)));
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

/** 每个挂载点的三段槽位：竖向分区上/中/下，横向分区左/中/右。中间区是内容区，不参与挂载。 */
export const ZONE_SLOTS = {
  left: [{ id: 'top', name: '上' }, { id: 'mid', name: '中' }, { id: 'bottom', name: '下' }],
  right: [{ id: 'top', name: '上' }, { id: 'mid', name: '中' }, { id: 'bottom', name: '下' }],
  top: [{ id: 'left', name: '左' }, { id: 'mid', name: '中' }, { id: 'right', name: '右' }],
  bottom: [{ id: 'left', name: '左' }, { id: 'mid', name: '中' }, { id: 'right', name: '右' }],
};
/** 槽位挂载点 ID：zone:slot，例如 left:top。 */
export const slotPointId = (zone, slot) => `${zone}:${slot}`;
export const slotsOfZone = zone => ZONE_SLOTS[zone] || [];

/* ============================================================
   5. 业务扩展注册表 + 规划中清单
   ============================================================ */

let plannedFeatures = [];
export function setPlannedFeatures(list) { plannedFeatures = list; }
export const getPlannedFeatures = () => plannedFeatures;

/* 扩展生命周期：阶段（计划中/开发中/已上架）+ 安装/挂载/启用三态 */
export const EXT_STAGES = [
  { id: 'planning', label: '计划中' },
  { id: 'developing', label: '开发中' },
  { id: 'published', label: '已上架' },
  { id: 'system', label: '系统内置' },
];
export const extStageLabel = stage => EXT_STAGES.find(s => s.id === stage)?.label || '计划中';
/** 系统页为系统内置，其余 registry 视为已上架，清单项取声明阶段。 */
export function extStageOf(id) {
  if (hasSystemPage(id)) return 'system';
  if (registry.get(id)) return 'published';
  return getPlannedFeatures().find(f => f.id === id)?.stage || 'planning';
}
const extInstallState = () => store.get('extInstallState', {});
/** registry 内置默认已安装；清单条目需显式安装（可被显式卸载覆盖）。 */
export function isExtInstalled(id) {
  const rec = extInstallState()[id];
  if (rec && typeof rec.installed === 'boolean') return rec.installed;
  return !!registry.get(id);
}
export function installExt(id) {
  const all = extInstallState();
  all[id] = { ...(all[id] || {}), installed: true, version: null, installedAt: Date.now() };
  store.set('extInstallState', all);
  bus.emit('route');
}
export function uninstallExt(id) {
  const all = extInstallState();
  all[id] = { ...(all[id] || {}), installed: false };
  store.set('extInstallState', all);
  const enabled = store.get('extEnabled', {}); delete enabled[id]; store.set('extEnabled', enabled);
  const themeStyle = getActiveThemeStyle();
  if (themeStyle) {
    const mounts = store.get('themeStyleMounts', {});
    if (mounts[themeStyle.id]) {
      for (const [point, extId] of Object.entries(mounts[themeStyle.id])) if (extId === id) delete mounts[themeStyle.id][point];
      store.set('themeStyleMounts', mounts);
    }
  }
  bus.emit('route');
}
/** 已安装但版本未确认时视为可更新；更新后写入清单版本。 */
export function extNeedsUpdate(id) {
  if (!isExtInstalled(id)) return false;
  const feature = getPlannedFeatures().find(f => f.id === id);
  return !!(feature && extInstallState()[id]?.version !== feature.version);
}
export function updateExt(id) {
  if (!isExtInstalled(id)) return;
  const feature = getPlannedFeatures().find(f => f.id === id);
  const all = extInstallState();
  all[id] = { ...(all[id] || {}), installed: true, version: feature?.version || '1.0.0', updatedAt: Date.now() };
  store.set('extInstallState', all);
  bus.emit('route');
}
/** 显式挂载：themeStyleMounts 中任一挂载点（含槽位）绑定到该扩展。 */
export function isExtMounted(id) {
  const themeStyle = getActiveThemeStyle();
  if (!themeStyle) return false;
  if (Object.values(getThemeStyleMounts(themeStyle.id)).includes(id)) return true;
  return Object.keys(ZONE_SLOTS).some(zone =>
    slotsOfZone(zone).some(slot => resolveSlotMount(zone, slot.id) === id));
}

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
  if (!ext) {
    if (hasSystemPage(id)) return true;
    // 清单扩展：未安装视为未启用；未知 id 保持原行为
    if (getPlannedFeatures().some(f => f.id === id)) {
      return isExtInstalled(id) && store.get('extEnabled', {})[id] === true;
    }
    return true;
  }
  if (ext.group === 'system') return true;
  if (!isExtInstalled(id)) return false;
  return store.get('extEnabled', {})[id] === true;
}
export function setExtEnabled(id, on) {
  const map = store.get('extEnabled', {});
  map[id] = on;
  store.set('extEnabled', map);
  if (!on && router.extId === id) {
    router.go(firstMountedExtId());
  } else {
    bus.emit('route');
  }
}

/* ============================================================
   6. 主题风格注册表（第二扩展维度）
   ============================================================ */
export const themeStyleRegistry = {
  list: [],
  add(themeStyle) { this.list.push(themeStyle); },
  get(id) { return this.list.find(s => s.id === id); },
};
export function registerThemeStyle(themeStyle) { themeStyleRegistry.add(themeStyle); }
export const getAllThemeStyles = () => themeStyleRegistry.list.slice();

const DEFAULT_THEME_STYLE = 'classic';
export function getActiveThemeStyle() {
  const id = store.get('themeStyle', DEFAULT_THEME_STYLE);
  return themeStyleRegistry.get(id)
    || themeStyleRegistry.get(DEFAULT_THEME_STYLE)
    || themeStyleRegistry.list[0]
    || null;
}
export function setActiveThemeStyle(id) {
  if (!themeStyleRegistry.get(id)) return;
  store.set('themeStyle', id);
  document.body.dataset.themeStyle = id;
  bus.emit('themeStyle', id);
  bus.emit('route');
}

/** 挂载配置：themeStyleMounts[themeStyleId][pointId] = extId（存系统偏好） */
export function getThemeStyleMounts(themeStyleId) { return store.get('themeStyleMounts', {})[themeStyleId] || {}; }
export function setThemeStyleMount(themeStyleId, pointId, extId) {
  const all = store.get('themeStyleMounts', {});
  all[themeStyleId] = all[themeStyleId] || {};
  if (extId) all[themeStyleId][pointId] = extId;
  else delete all[themeStyleId][pointId];
  store.set('themeStyleMounts', all);
  bus.emit('route');
}
/** 挂载点独立启用态：mountEnabled[themeStyleId][pointId] = false 表示停用；缺省视为启用。 */
export function getMountEnabled(themeStyleId) { return store.get('mountEnabled', {})[themeStyleId] || {}; }
/** 查询某挂载点是否启用（缺省启用）。 */
export function mountEnabledOf(themeStyleId, pointId) { return getMountEnabled(themeStyleId)[pointId] !== false; }
/** 设置某挂载点的启用态，仅影响该挂载点。 */
export function setMountEnabled(themeStyleId, pointId, on) {
  const all = store.get('mountEnabled', {});
  all[themeStyleId] = all[themeStyleId] || {};
  all[themeStyleId][pointId] = !!on;
  store.set('mountEnabled', all);
  bus.emit('route');
}
/** 解析挂载点：用户配置优先，回落主题风格 defaultExt */
export function resolveMount(themeStyle, point) {
  return getThemeStyleMounts(themeStyle.id)[point.id] || point.defaultExt || null;
}

/** 解析槽位挂载：用户配置优先，回落主题风格 slotDefaults。 */
export function resolveSlotMount(zone, slot) {
  const themeStyle = getActiveThemeStyle();
  if (!themeStyle) return null;
  const pointId = slotPointId(zone, slot);
  return getThemeStyleMounts(themeStyle.id)[pointId]
    || themeStyle.slotDefaults?.[pointId]
    || null;
}

/** 槽位上启用中的扩展记录（含系统页与规划扩展），未启用或未挂载返回 null。 */
export function slotExtRecord(zone, slot) {
  const themeStyle = getActiveThemeStyle();
  if (!themeStyle) return null;
  const id = resolveSlotMount(zone, slot);
  if (!id || !extEnabled(id) || !mountEnabledOf(themeStyle.id, slotPointId(zone, slot))) return null;
  const ext = registry.get(id);
  if (ext) return ext;
  const planned = getPlannedFeatures().find(f => f.id === id);
  if (planned) return { id, name: planned.name, icon: planned.icon, desc: planned.desc, badge: null };
  const meta = getSystemMeta(id);
  if (meta) return {
    id,
    name: typeof meta.title === 'function' ? meta.title({}) : (meta.title || id),
    icon: id === 'settings' ? icons.settings : icons.puzzle,
    desc: id === 'ext-center' ? '扩展中心' : '设置',
    badge: null,
  };
  return null;
}

/** 首个已挂载且启用的扩展 ID，用于系统页退出后的回退。 */
export function firstMountedExtId() {
  for (const zone of ['left', 'top', 'right', 'bottom']) {
    for (const slot of slotsOfZone(zone)) {
      const record = slotExtRecord(zone, slot.id);
      if (record) return record.id;
    }
  }
  return 'ext-center';
}

/** 主题风格声明的挂载点 + 用户自定义挂载点；panels 主题风格未声明时回落到五区（兼容第三方主题风格）
 *  自定义点存 themeStylePoints[themeStyleId]，供主题风格详情页增删；stage 主题风格渲染时据此新增实物。 */
export function getThemeStyleMountPoints(themeStyle) {
  if (!themeStyle) return [];
  const base = Array.isArray(themeStyle.mountPoints) ? themeStyle.mountPoints.slice()
    : themeStyle.layout === 'stage' ? []
    : Object.entries(ZONES).filter(([id]) => id !== 'center').map(([id, zone]) => ({
        id,
        name: zone.label,
        desc: zone.role === 'nav' ? '主菜单 · 一级入口' : '扩展功能菜单',
        role: zone.role,
        slots: slotsOfZone(id).map(s => s.id),
      }));
  const extra = store.get('themeStylePoints', {})[themeStyle.id] || [];
  return base.concat(extra);
}
/** 自定义挂载点：仅能增删主题风格声明之外的点，内建点（defaultExt 声明）不可删 */
export function getCustomThemeStylePoints(themeStyleId) { return store.get('themeStylePoints', {})[themeStyleId] || []; }
export function addCustomThemeStylePoint(themeStyleId, point) {
  const all = store.get('themeStylePoints', {});
  all[themeStyleId] = all[themeStyleId] || [];
  if (all[themeStyleId].some(p => p.id === point.id)) return false;
  all[themeStyleId].push(point);
  store.set('themeStylePoints', all);
  bus.emit('route');
  return true;
}
export function updateCustomThemeStylePoint(themeStyleId, pointId, patch) {
  const all = store.get('themeStylePoints', {});
  const point = (all[themeStyleId] || []).find(p => p.id === pointId);
  if (!point) return false;
  Object.assign(point, patch);
  store.set('themeStylePoints', all);
  bus.emit('route');
  return true;
}
export function deleteCustomThemeStylePoint(themeStyleId, pointId) {
  const all = store.get('themeStylePoints', {});
  if (!all[themeStyleId]) return false;
  all[themeStyleId] = all[themeStyleId].filter(p => p.id !== pointId);
  store.set('themeStylePoints', all);
  const mounts = store.get('themeStyleMounts', {});
  if (mounts[themeStyleId]) { delete mounts[themeStyleId][pointId]; store.set('themeStyleMounts', mounts); }
  bus.emit('route');
  return true;
}
/** 浮层菜单（锚在按钮下方，自动夹紧到视口）— 供系统页复用
 *  支持 { sep:true } 分隔线、{ header:true, label } 分组标题；role=menu + 方向键导航 + Esc 关闭。 */
export function openPopMenu(anchor, items) {
  document.querySelector('.pop-menu')?.remove();
  const menu = el('div', { class: 'pop-menu', role: 'menu' });
  const buttons = [];
  items.forEach(item => {
    if (item.sep) { menu.append(el('div', { class: 'pop-menu-sep', role: 'separator' })); return; }
    if (item.header) { menu.append(el('div', { class: 'pop-menu-head', role: 'presentation' }, item.label)); return; }
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

/** 扩展在当前主题风格下的挂载位置文案：stage 按实物反查，panels 按槽位反查 */
export function mountLabelOfExt(themeStyle, ext) {
  const points = getThemeStyleMountPoints(themeStyle);
  // 用户显式挂载（含配置树写入的槽位级 pointId，如 left:mid）
  const mounts = getThemeStyleMounts(themeStyle.id);
  const pointId = Object.keys(mounts).find(p => mounts[p] === ext.id);
  if (pointId) {
    const point = points.find(p => p.id === pointId);
    if (point) return { label: `${point.name} · ${themeStyle.name}`, pointId };
    const [zone, slot] = pointId.split(':');
    const slotName = slotsOfZone(zone).find(s => s.id === slot)?.name;
    if (slotName) return { label: `${ZONES[zone]?.label || zone} · ${slotName}部`, pointId };
    return { label: pointId, pointId };
  }
  // stage 实物由 defaultExt 声明挂载
  if (themeStyle?.layout === 'stage') {
    const point = points.find(p => resolveMount(themeStyle, p) === ext.id);
    return point
      ? { label: `${point.name} · ${themeStyle.name}`, pointId: point.id }
      : { label: '未挂载', pointId: null };
  }
  return { label: '未挂载', pointId: null };
}

/* ============================================================
   7. 挂载配置快照（主题风格详情页草稿编辑）
   ============================================================ */
/** 挂载配置快照：供主题风格详情页做草稿编辑；应用时一次性写回。 */
export function getConfigSnapshot(themeStyleId) {
  const clone = v => JSON.parse(JSON.stringify(v));
  return {
    themeStyleMounts: clone(getThemeStyleMounts(themeStyleId)),
    themeStylePoints: clone(getCustomThemeStylePoints(themeStyleId)),
    extEnabled: clone(store.get('extEnabled', {})),
    mountEnabled: clone(store.get('mountEnabled', {})),
  };
}
/** 应用挂载配置快照：写回挂载点 / 自定义点 / 扩展启用态并触发全局重渲染。 */
export function applyConfigSnapshot(themeStyleId, snap) {
  const mounts = store.get('themeStyleMounts', {});
  mounts[themeStyleId] = snap.themeStyleMounts;
  store.set('themeStyleMounts', mounts);
  const points = store.get('themeStylePoints', {});
  points[themeStyleId] = snap.themeStylePoints;
  store.set('themeStylePoints', points);
  store.set('extEnabled', snap.extEnabled);
  store.set('mountEnabled', snap.mountEnabled || {});
  bus.emit('route');
}

/* ============================================================
   8. 主题色
   ============================================================ */
export const themeColorNames = { dark: '深色', light: '浅色', terminal: '终端', oled: 'OLED' };
export function applyThemeColor(themeColor) {
  document.body.dataset.themeColor = themeColor;
  store.set('themeColor', themeColor);
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

/* ============================================================
   未应用草稿的离开守卫：页面注册自己的判定与处理方式，导航统一询问
   ============================================================ */
const unappliedGuards = new Set();

/** 注册一个离开守卫；返回注销函数。isActive 限定页面，apply 返回 false 表示应用失败需留在原页。 */
export function registerUnappliedGuard(guard) {
  unappliedGuards.add(guard);
  return () => unappliedGuards.delete(guard);
}

/** 三选项确认：应用并离开 / 放弃修改并离开 / 取消；遮罩与 Esc 关闭等同取消。 */
export function confirmUnapplied() {
  return new Promise(resolve => {
    let settled = false;
    const finish = choice => { if (!settled) { settled = true; resolve(choice); } };
    openModal('有未应用的修改',
      el('p', { class: 'hint' }, '离开后未应用的更改将丢失，请选择如何处理。'),
      [
        { label: '取消', onClick: close => { finish(false); close(); } },
        { label: '放弃修改并离开', danger: true, onClick: close => { finish('discard'); close(); } },
        { label: '应用并离开', primary: true, onClick: close => { finish('apply'); close(); } },
      ],
      () => finish(false));
  });
}

/** 无草稿时同步放行，有草稿时返回用户选择后的 Promise<boolean>。 */
export function guardUnappliedNavigation() {
  const pending = [...unappliedGuards].filter(g => {
    try { return g.isActive() && g.isDirty(); } catch { return false; }
  });
  if (!pending.length) return true;
  return confirmUnapplied().then(choice => {
    if (choice === false) return false;
    const results = pending.map(g => (choice === 'apply' ? g.apply() : g.discard()));
    return results.every(r => r !== false);
  });
}

/** 导航入口统一走这里：确认后才真正改路由，取消则保持当前页面与 URL。 */
function navigateGuarded(change) {
  const verdict = guardUnappliedNavigation();
  if (verdict === true) change();
  else verdict.then(ok => { if (ok) change(); });
}

/** 同步菜单按钮文案，准确反映当前左栏是展开还是收起。 */
function syncNavToggleLabel() {
  const btn = document?.getElementById?.('navToggle');
  const body = document?.body;
  if (!btn || !body) return;
  const narrow = window.matchMedia?.('(max-width: 760px)').matches ?? window.innerWidth <= 760;
  const collapsed = narrow
    ? !body.classList.contains('nav-open')
    : body.classList.contains('nav-collapsed');
  const label = collapsed ? '展开菜单' : '收起菜单';
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

export const router = {
  extId: null, mode: 'home', id: null,
  go(extId) {
    if (!extEnabled(extId) && !hasSystemPage(extId)) return;
    navigateGuarded(() => {
      this.extId = extId;
      this.mode = 'home';
      this.id = null;
      document.body.classList.remove('nav-open');
      syncNavToggleLabel();
      syncHash();
      bus.emit('route');
    });
  },
  open(extId, detailId) {
    navigateGuarded(() => {
      this.extId = extId;
      this.mode = 'detail';
      this.id = detailId;
      syncHash();
      bus.emit('route');
    });
  },
  home() { navigateGuarded(() => { this.mode = 'home'; this.id = null; syncHash(); bus.emit('route'); }); },
  /** 回到主题风格主舞台（stage 主题风格专用） */
  back() { navigateGuarded(() => { this.extId = null; this.mode = 'home'; this.id = null; syncHash(); bus.emit('route'); }); },
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

/** 左侧栏按上/中/下三段渲染，每段最多一个入口。 */
function renderLeft() {
  const box = $('zoneLeft');
  if (!box) return;
  box.innerHTML = '';
  for (const slot of slotsOfZone('left')) {
    const cell = el('div', { class: 'zone-slot', 'data-slot': slot.id });
    const ext = slotExtRecord('left', slot.id);
    if (ext) cell.append(navItem(ext));
    box.append(cell);
  }
}

/** 顶栏挂载区按左/中/右三段渲染，两侧固定模块不参与挂载。 */
function renderTop() {
  const box = $('zoneTopMounts');
  if (!box) return;
  box.innerHTML = '';
  for (const slot of slotsOfZone('top')) {
    const cell = el('div', { class: 'top-slot', 'data-slot': slot.id });
    const ext = slotExtRecord('top', slot.id);
    if (ext) cell.append(el('button', {
      class: 'top-item' + (router.extId === ext.id ? ' active' : ''),
      onclick: () => router.go(ext.id),
    }, el('span', { class: 'icon', html: ext.icon }), el('span', {}, ext.name)));
    box.append(cell);
  }
}

function renderCenter() {
  const box = $('zoneCenter');
  if (!box) return;
  box.innerHTML = '';
  const ctx = { ext: router.extId, mode: router.mode, id: router.id };
  const themeStyle = getActiveThemeStyle();

  // 未选中扩展：stage 主题风格接管舞台
  if (!router.extId && themeStyle?.renderStage) {
    box.append(themeStyle.renderStage(ctx));
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
    if (themeStyle?.renderStage) {
      box.append(el('button', { class: 'stage-back', onclick: () => router.back() },
        el('span', { class: 'icon', html: icons.back }), `返回${themeStyle.name}`));
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

  // stage 主题风格下：扩展视图统一带"返回舞台"条（独立窗口无舞台，不显示）
  if (!isFocusMode() && themeStyle?.renderStage && themeStyle.stageBack !== false) {
    box.append(el('button', { class: 'stage-back', onclick: () => router.back() },
      el('span', { class: 'icon', html: icons.back }), `返回${themeStyle.name}`));
  }
  // 扩展 1 级页面（home）才提供"独立窗口打开"入口；2 级详情页不注入。
  // 独立窗口内自身已是目标视图，也不重复注入。
  if (!isFocusMode() && router.mode === 'home') {
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

/** 返回某个 entry 区（right/bottom）三段槽位上已启用的扩展，按槽位顺序去重。 */
export function entryExts(zone) {
  const out = [];
  const seen = new Set();
  for (const slot of slotsOfZone(zone)) {
    const ext = slotExtRecord(zone, slot.id);
    if (ext && !seen.has(ext.id)) {
      seen.add(ext.id);
      out.push(ext);
    }
  }
  return out;
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

/** 右侧栏按上/中/下三段渲染，每段最多一个入口。 */
function renderRight() {
  const panel = $('zoneRight');
  const body = $('zoneRightBody');
  if (!panel || !body) return;
  body.innerHTML = '';
  for (const slot of slotsOfZone('right')) {
    const cell = el('div', { class: 'zone-slot', 'data-slot': slot.id });
    const ext = slotExtRecord('right', slot.id);
    if (ext) cell.append(entryItem(ext));
    body.append(cell);
  }
  panel.hidden = !body.querySelector('.entry-item') || store.get('rightCollapsed', false);
  document.body.classList.toggle('right-hidden', panel.hidden);
}

/** 底部栏按左/中/右三段渲染；状态文字与快捷键提示已移除。 */
function renderBottom() {
  const box = $('zoneBottom');
  if (!box) return;
  box.innerHTML = '';
  for (const slot of slotsOfZone('bottom')) {
    const cell = el('div', { class: 'bottom-slot', 'data-slot': slot.id });
    const ext = slotExtRecord('bottom', slot.id);
    if (ext) cell.append(el('button', {
      class: 'bottom-entry' + (router.extId === ext.id ? ' active' : ''),
      title: `打开「${ext.name}」`,
      onclick: () => router.go(ext.id),
    }, el('span', { class: 'icon', html: ext.icon }), ext.name));
    box.append(cell);
  }
}

/** 把主题风格布局模式 + 页面类型写到 body（CSS 据此切换五区显隐/尺寸）
 *  data-page=system：设置/扩展中心/主题风格详情等系统页，隐藏一级工作台元素（左栏导航/顶部挂载/底部状态条/顶栏用户入口）
 */
/**
 * 顶栏二级页导航：系统页时用「返回 + 标题」替换 brand。
 * 标题/返回文案/返回动作取自 registerSystemPage 的 meta；缺省回工作台。
 */
function syncSystemTopBar(isSystem) {
  const bar = $('topSystem');
  if (!bar) return;
  bar.setAttribute('aria-hidden', String(!isSystem));
  const actionsHost = $('topPageActions');
  if (!isSystem) {
    if (actionsHost) actionsHost.replaceChildren();
    return;
  }
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
  if (actionsHost) {
    const action = typeof meta.topActions === 'function' ? meta.topActions(ctx) : null;
    actionsHost.replaceChildren(...(action ? [action] : []));
  }
}

export function applyThemeStyleLayout() {
  const themeStyle = getActiveThemeStyle();
  document.body.dataset.themeStyle = themeStyle?.id || DEFAULT_THEME_STYLE;
  document.body.dataset.themeStyleLayout = themeStyle?.layout || 'panels';
  const isSystem = hasSystemPage(router.extId);
  document.body.dataset.page = isSystem ? 'system' : 'work';
  // 系统页隐藏了用户头像入口；若面板仍开着（如用 ⌘, 进入），一并关闭避免浮层残留
  if (isSystem) closeUserPop();
  syncSystemTopBar(isSystem);
}

/** 退出系统页回工作台：stage 回舞台，panels 进首个导航扩展 */
export function leaveSystem() {
  const themeStyle = getActiveThemeStyle();
  if (themeStyle?.renderStage) { router.back(); return; }
  router.go(firstMountedExtId());
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
 * 未声明 domains、系统页、stage 主题风格、批量事件（hydrate / 无 key）一律整体重绘，行为与以前一致。
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
  applyThemeStyleLayout();
  renderLeft();
  renderTop();
  renderBottom();
}
function renderAll() {
  applyThemeStyleLayout();
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
  const current = document.body.dataset.themeColor || 'dark';
  const themeColorRow = el('button', { class: 'user-pop-row', onclick: () => {
    // 每次点击都读取当前主题色，不能用打开面板时捕获的 current（否则只能切换一次）
    const active = document.body.dataset.themeColor || current;
    const next = order[(order.indexOf(active) + 1) % order.length];
    applyThemeColor(next);
    themeColorRow.querySelector('.user-pop-value').textContent = themeColorNames[next];
  } },
    el('span', { class: 'icon', html: icons.info }),
    el('span', { class: 'user-pop-label' }, '主题色'),
    el('span', { class: 'user-pop-value' }, themeColorNames[current]),
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
    themeColorRow,
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
   10b. 五区尺寸拖拽（左 / 右改宽度，下改高度）
   ------------------------------------------------------------
   尺寸写入根元素的 --user-* 变量，由 CSS 在桌面端映射到 --left-w /
   --right-w / --bottom-h；窄屏保持抽屉式布局，不受覆盖值影响。
   ============================================================ */
const ZONE_RESIZERS = [
  { id: 'resizerLeft', key: 'leftW', prop: '--user-left-w', def: 208, min: 1, max: 420, axis: 'x', sign: 1, states: true },
  { id: 'resizerRight', key: 'rightW', prop: '--user-right-w', def: 268, min: 180, max: 520, axis: 'x', sign: -1 },
  { id: 'resizerBottom', key: 'bottomH', prop: '--user-bottom-h', def: 26, min: 20, max: 200, axis: 'y', sign: -1, viewportRatio: .45 },
];
/* 左栏只有四个合法状态：前三态宽度固定，info 态宽度自由（>= INFO_MIN_W） */
const LEFT_STATES = [
  { mode: 'close', width: 0 },
  { mode: 'icon', width: 56 },
  { mode: 'title', width: 176 },
];
const INFO_MIN_W = 208;
const isNarrowScreen = () => window.matchMedia?.('(max-width: 760px)').matches ?? window.innerWidth <= 760;
const zoneMax = cfg => cfg.viewportRatio
  ? Math.min(cfg.max, Math.round(window.innerHeight * cfg.viewportRatio))
  : cfg.max;
const clampZone = (cfg, value) => Math.min(Math.max(Math.round(value), cfg.min), zoneMax(cfg));
const readZone = cfg => {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cfg.prop));
  return Number.isFinite(n) ? n : cfg.def;
};
const writeZone = (cfg, value) => {
  document.documentElement.style.setProperty(cfg.prop, `${value}px`);
  $(cfg.id)?.setAttribute('aria-valuenow', String(value));
};
const setLeftMode = mode => { document.body.dataset.leftMode = mode; };

/** 宽度 → 状态：不足 info 下限时取最近的固定态；达到下限后保留自由宽度 */
const leftStateOf = width => width >= INFO_MIN_W
  ? { mode: 'info', width: Math.round(width) }
  : LEFT_STATES.reduce((a, b) => Math.abs(b.width - width) < Math.abs(a.width - width) ? b : a, LEFT_STATES[0]);

/** 落到某个合法状态：同步宽度、显示模式、收起标记与持久化 */
function applyLeftState(state) {
  const cfg = ZONE_RESIZERS[0];
  writeZone(cfg, state.width);
  setLeftMode(state.mode);
  if (state.mode === 'close') {
    setNavCollapsed(true);
    return;
  }
  document.body.classList.remove('nav-collapsed');
  store.set('navCollapsed', false);
  store.set(cfg.key, state.width);
}

function animateSnap() {
  document.body.classList.add('zone-snapping');
  window.setTimeout(() => document.body.classList.remove('zone-snapping'), 180);
}

/** 桌面端收起/展开左栏；收起时保留上次宽度，展开时恢复并同步状态 */
function setNavCollapsed(collapsed) {
  if (isNarrowScreen()) {
    document.body.classList.toggle('nav-open', !collapsed);
    syncNavToggleLabel();
    return;
  }
  document.body.classList.toggle('nav-collapsed', collapsed);
  store.set('navCollapsed', collapsed);
  if (collapsed) {
    setLeftMode('close');
  } else {
    const cfg = ZONE_RESIZERS[0];
    const saved = store.get(cfg.key, cfg.def);
    const width = clampZone(cfg, typeof saved === 'number' && saved > 0 ? saved : cfg.def);
    writeZone(cfg, width);
    setLeftMode(leftStateOf(width).mode);
  }
  syncNavToggleLabel();
}

function initZoneResizers() {
  for (const cfg of ZONE_RESIZERS) {
    const saved = store.get(cfg.key, null);
    if (typeof saved === 'number' && Number.isFinite(saved) && (!cfg.states || saved > 0)) {
      writeZone(cfg, clampZone(cfg, saved));
    }
  }
  setLeftMode(!isNarrowScreen() && store.get('navCollapsed', false)
    ? 'close'
    : leftStateOf(readZone(ZONE_RESIZERS[0])).mode);
  for (const cfg of ZONE_RESIZERS) {
    const handle = $(cfg.id);
    if (!handle) continue;
    handle.setAttribute('aria-valuemin', String(cfg.min));
    handle.setAttribute('aria-valuemax', String(zoneMax(cfg)));
    handle.setAttribute('aria-valuenow', String(clampZone(cfg, readZone(cfg))));

    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const start = readZone(cfg);
      const origin = cfg.axis === 'x' ? event.clientX : event.clientY;
      handle.setPointerCapture?.(event.pointerId);
      handle.classList.add('dragging');
      document.body.classList.add('resizing');
      event.preventDefault();

      const onMove = e => {
        const delta = (cfg.axis === 'x' ? e.clientX : e.clientY) - origin;
        const value = clampZone(cfg, start + delta * cfg.sign);
        writeZone(cfg, value);
        if (cfg.states) setLeftMode(leftStateOf(value).mode); // 拖动中预览即将落入的状态
      };
      const onEnd = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing');
        const value = readZone(cfg);
        if (!cfg.states) {
          store.set(cfg.key, value);
          return;
        }
        const state = leftStateOf(value); // 任何松手位置都落到四态之一
        if (state.width !== value) animateSnap();
        applyLeftState(state);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });

    // 键盘可达：左栏方向键在四态间切换，info 态内按步长调宽；其余区按 16px 步进
    handle.addEventListener('keydown', event => {
      const plus = cfg.axis === 'x' ? 'ArrowRight' : 'ArrowUp';
      const minus = cfg.axis === 'x' ? 'ArrowLeft' : 'ArrowDown';
      if (event.key !== plus && event.key !== minus) return;
      event.preventDefault();
      const dir = event.key === plus ? 1 : -1;
      if (!cfg.states) {
        const value = clampZone(cfg, readZone(cfg) + (event.shiftKey ? 32 : 16) * dir * cfg.sign);
        writeZone(cfg, value);
        store.set(cfg.key, value);
        return;
      }
      const current = leftStateOf(readZone(cfg));
      const step = event.shiftKey ? 32 : 16;
      let state;
      if (current.mode === 'info' && dir > 0) state = { mode: 'info', width: current.width + step };
      else if (current.mode === 'info' && current.width > INFO_MIN_W) state = { mode: 'info', width: Math.max(INFO_MIN_W, current.width - step) };
      else if (current.mode === 'info') state = LEFT_STATES[2];
      else {
        const order = ['close', 'icon', 'title', 'info'];
        const idx = Math.min(order.length - 1, Math.max(0, order.indexOf(current.mode) + dir));
        state = idx === 3 ? { mode: 'info', width: INFO_MIN_W } : LEFT_STATES[idx];
      }
      animateSnap();
      applyLeftState(state);
    });
  }
}

/* ============================================================
   11. 启动
   ============================================================ */
export function boot() {
  applyThemeColor(store.get('themeColor', 'dark'));
  initZoneResizers();
  if (isFocusMode()) document.body.dataset.focus = '1';
  // localStorage 镜像写入失败（配额满等）：SQLite 仍可保存，仅提示一次，避免用户无感知
  let warned = false;
  bus.on('store:error', () => {
    if (warned) return;
    warned = true;
    toast('本地缓存写入失败（空间不足？）。请到 设置 → 数据与备份 导出备份');
  });
  applyThemeStyleLayout();

  $('btnUser')?.addEventListener('click', openUserPanel);
  $('btnRefresh')?.addEventListener('click', refreshAllData);
  $('zoneRightClose')?.addEventListener('click', () => toggleRightPanel());
  const navToggle = $('navToggle'), backdrop = $('backdrop');
  if (navToggle && backdrop) {
    if (!isNarrowScreen() && store.get('navCollapsed', false)) document.body.classList.add('nav-collapsed');
    navToggle.addEventListener('click', () => {
      if (isNarrowScreen()) document.body.classList.toggle('nav-open');
      else setNavCollapsed(!document.body.classList.contains('nav-collapsed'));
      syncNavToggleLabel();
    });
    backdrop.addEventListener('click', () => {
      document.body.classList.remove('nav-open');
      syncNavToggleLabel();
    });
    window.addEventListener('resize', syncNavToggleLabel);
    syncNavToggleLabel();
  }

  bus.on('route', renderAll);
  bus.on('data', onData);
  window.addEventListener('hashchange', () => {
    const verdict = guardUnappliedNavigation();
    if (verdict === true) { applyHash(); return; }
    verdict.then(ok => { if (ok) applyHash(); else syncHash(); });
  });

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
      const themeStyle = getActiveThemeStyle();
      if (themeStyle?.renderStage && router.extId) { router.back(); return; }
      if (router.mode === 'detail') router.home();
      return;
    }
    if (matchShortcut(event, sc.settings)) {
      event.preventDefault();
      router.go('settings');
      return;
    }
    // 扩展快捷键：用户为具体扩展绑定，按下即打开该扩展
    if (!typing) {
      for (const [key, combo] of Object.entries(sc)) {
        if (!key.startsWith(EXT_PREFIX) || !matchShortcut(event, combo)) continue;
        const extId = key.slice(EXT_PREFIX.length);
        if (!extEnabled(extId) || !registry.get(extId)) continue;
        event.preventDefault();
        router.go(extId);
        return;
      }
    }
  });

  const themeStyle = getActiveThemeStyle();
  // 优先按 URL 直达；stage 主题风格下 hash 无效时才回舞台
  if (applyHash()) return;
  if (themeStyle?.renderStage) {
    router.back(); // stage 主题风格：启动即展示主舞台
  } else {
    router.go(firstMountedExtId());
  }
}
