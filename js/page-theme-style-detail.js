/* page-theme-style-detail.js — 主题风格详情页（系统页）
 *
 * 入口：设置 › 主题风格 › 主题风格卡片「⋯」› 查看详情 → router.open('theme-style-detail', themeStyleId)
 * 三 Tab：介绍 / 预览 / 挂载点配置（单一树形结构）
 * 数据全部走 core 契约；增删走 setThemeStyleMount（panels 槽位）
 *   与 addCustomThemeStylePoint/deleteCustomThemeStylePoint（stage）。
 */
import {
  el, icons, router, bus, registerSystemPage, toast, openModal, field, input,
  registerUnappliedGuard,
  getAllThemeStyles, getActiveThemeStyle, setActiveThemeStyle,
  getConfigSnapshot, applyConfigSnapshot, ZONES, slotsOfZone, slotPointId,
  registry, getPlannedFeatures, openPopMenu, isExtInstalled,
} from './core.js';

let activeThemeStyleId = null;
let activeTab = 'intro';
let collapsed = new Set();
let collapsedFor = null;
let focusExtId = null;   // 从扩展中心跳转过来时，需展开并高亮的扩展 id
let focusAppliedFor = null; // 已执行过展开的主题风格，避免重绘时反复强制展开

const themeStyleById = id => getAllThemeStyles().find(s => s.id === id) || getActiveThemeStyle();
const extName = id =>
  registry.get(id)?.name
  || getPlannedFeatures().find(f => f.id === id)?.name
  || (id === 'settings' ? '设置' : id === 'ext-center' ? '扩展中心' : id);
/* ---------- 挂载配置草稿：改动先入草稿，点「应用」才写回并同步到主界面 ---------- */
let draft = null;
let draftBaseline = null;
const clone = v => JSON.parse(JSON.stringify(v));

/** 进入某主题风格的配置页时建立草稿；同主题风格重渲染保留未应用的改动。 */
function ensureDraft(themeStyle) {
  if (draft?.themeStyleId === themeStyle.id) return;
  const snap = getConfigSnapshot(themeStyle.id);
  draft = { themeStyleId: themeStyle.id, ...snap };
  draftBaseline = clone(draft);
}
function draftDirty() {
  return !!draft && JSON.stringify(draft) !== JSON.stringify(draftBaseline);
}
function applyDraft() {
  if (!draftDirty()) return;
  // 写回内部会 emit route 立即重绘，基线须先更新，否则按钮会残留高亮
  draftBaseline = clone(draft);
  applyConfigSnapshot(draft.themeStyleId, {
    themeStyleMounts: draft.themeStyleMounts,
    themeStylePoints: draft.themeStylePoints,
    extEnabled: draft.extEnabled,
    mountEnabled: draft.mountEnabled,
  });
  toast('已应用挂载点配置');
}
function revertDraft() {
  discardDraft();
  toast('已撤销未应用的变更');
  rerender();
}
/** 离开时放弃草稿；重绘由后续导航负责 */
function discardDraft() {
  draft = clone(draftBaseline);
}

registerUnappliedGuard({
  isActive: () => router.extId === 'theme-style-detail',
  isDirty: draftDirty,
  apply: () => { applyDraft(); return true; },
  discard: () => { discardDraft(); return true; },
});

/** 挂载实例键：槽位绑定用 zone，stage 实物用 point.id。 */
function dMountKey(item) {
  return item.binding === 'slot' ? item.zone : item.point?.id;
}
/** 挂载点启用态独立于扩展全局开关：缺省视为启用，同一扩展多处挂载互不影响。 */
function dEnabled(themeStyle, item) {
  const ext = registry.get(item.extId);
  if (!ext || ext.group === 'system') return true;
  const key = dMountKey(item);
  return !key || draft.mountEnabled[themeStyle.id]?.[key] !== false;
}
function dResolve(themeStyle, point) {
  return draft.themeStyleMounts[point.id] || point.defaultExt || null;
}
function dPoints(themeStyle) {
  const base = Array.isArray(themeStyle.mountPoints) ? themeStyle.mountPoints.slice()
    : themeStyle.layout === 'stage' ? []
    : Object.entries(ZONES).filter(([id]) => id !== 'center').map(([id, zone]) => ({
        id, name: zone.label, desc: zone.role === 'nav' ? '主菜单 · 一级入口' : '扩展功能菜单',
        role: zone.role, slots: slotsOfZone(id).map(s => s.id),
      }));
  return base.concat(draft.themeStylePoints);
}
function dSetMount(pointId, extId) {
  if (extId) draft.themeStyleMounts[pointId] = extId;
  else delete draft.themeStyleMounts[pointId];
}
function dSetEnabled(themeStyle, item, on) {
  const key = dMountKey(item);
  if (!key) return;
  draft.mountEnabled[themeStyle.id] = draft.mountEnabled[themeStyle.id] || {};
  draft.mountEnabled[themeStyle.id][key] = !!on;
}
function dDeleteCustomPoint(pointId) {
  draft.themeStylePoints = draft.themeStylePoints.filter(p => p.id !== pointId);
  delete draft.themeStyleMounts[pointId];
}

/* ---------- 介绍 ---------- */
function introView(themeStyle) {
  const points = dPoints(themeStyle);
  const kv = (k, v, mono) => el('div', { class: 'sd-kv-row' },
    el('span', { class: 'sd-kv-k' }, k),
    el('span', { class: 'sd-kv-v' + (mono ? ' mono' : '') }, String(v)));
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h3', {}, '主题风格介绍')),
    el('div', { class: 'sd-pad' },
      el('div', { class: 'sd-kv' },
        kv('名称', themeStyle.name),
        kv('描述', themeStyle.desc || '—'),
        kv('布局模式', themeStyle.layout, true),
        kv('挂载点', `${points.length} 个`),
        kv('主题风格 ID', themeStyle.id, true)),
      el('div', { class: 'sd-contract' },
        el('span', {}, '数据源　', el('b', {}, 'getConfigSnapshot()'), ' → 草稿'),
        el('span', {}, '解析　　', el('b', {}, '草稿挂载快照')),
        el('span', {}, '应用　　', el('b', {}, 'applyConfigSnapshot()')),
        el('span', {}, '目录　　', el('b', {}, 'setThemeStyleMount()'), ' / ', el('b', {}, 'addCustomThemeStylePoint()')))));
}

/* ---------- 预览 ---------- */
function previewView(themeStyle) {
  const box = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h3', {}, '预览 · ' + themeStyle.name),
      el('span', { class: 'sd-count' }, '示意，非实际渲染')),
    el('div', { class: 'sd-pad' }));
  const body = box.lastChild;
  if (themeStyle.layout === 'panels') {
    const zone = (cls, label, zoneId, dirs, slotIds) => el('div', { class: 'sd-pv-zone can ' + cls },
      el('span', { class: 'sd-pv-zone-name' }, label),
      el('span', { class: 'sd-pv-slots' }, dirs.map((d, i) => {
        const extId = dResolve(themeStyle, { id: slotPointId(zoneId, slotIds[i]) });
        return el('i', { class: extId ? 'bound' : '', title: extId ? extName(extId) : `${label} · ${d}部` },
          extId ? extName(extId) : d);
      })));
    body.append(el('div', { class: 'sd-pv-classic' },
      zone('top', '顶部栏', 'top', ['左', '中', '右'], ['left', 'mid', 'right']),
      zone('left', '左侧栏', 'left', ['上', '中', '下'], ['top', 'mid', 'bottom']),
      el('div', { class: 'sd-pv-center' }, el('span', { class: 'icon', html: icons.dashboard }),
        '中间区 · 主内容（非挂载点）'),
      zone('right', '右侧栏', 'right', ['上', '中', '下'], ['top', 'mid', 'bottom']),
      zone('bottom', '底部栏', 'bottom', ['左', '中', '右'], ['left', 'mid', 'right'])));
    body.append(el('div', { class: 'sd-pv-legend' },
      el('span', {}, el('i', { class: 'a' }), '可挂载区'),
      el('span', {}, el('i', { class: 'b' }), '内容区')));
  } else {
    const room = el('div', { class: 'sd-pv-room' });
    const pos = { computer: [50, 34], desk: [24, 44], pet: [76, 50], person: [50, 68], shelf: [17, 22], toolbox: [83, 24] };
    dPoints(themeStyle).forEach((p, i) => {
      const extId = dResolve(themeStyle, p);
      const xy = pos[p.id] || [22 + (i % 4) * 19, 26 + Math.floor(i / 4) * 30];
      const node = el('div', { class: 'sd-pv-obj' });
      node.style.left = xy[0] + '%'; node.style.top = xy[1] + '%';
      node.append(el('div', { class: 'sd-pv-box' }, el('span', { class: 'icon', html: icons.file })),
        el('div', { class: 'sd-pv-nm' }, p.name),
        el('div', { class: 'sd-pv-to' }, extId ? '→ ' + extName(extId) : '→ 未挂载'));
      room.append(node);
    });
    body.append(room, el('p', { class: 'hint', style: 'margin-top:10px' },
      '点击房间里的实物打开对应扩展 · 每个实物都是一个可配置的挂载点'));
  }
  return box;
}

/* ---------- 挂载点配置（分区 → 三段槽位 → 文件夹 / 扩展） ---------- */
/** 展开三态：全部收起 → 展开扩展（展开挂载区域、显现槽位） → 全部展开；custom 仅作手动调整后的提示态。 */
const EXPAND_ORDER = ['collapsed', 'mounted', 'all'];
const EXPAND_META = {
  collapsed: { label: '全部收起', icon: icons.expandNone },
  mounted: { label: '扩展展开', icon: icons.expandPartial },
  all: { label: '全部展开', icon: icons.expandAll },
  custom: { label: '自定义', icon: icons.expandPartial },
};
const sameKeys = (a, b) => a.size === b.size && [...a].every(k => b.has(k));
function expandPresets(themeStyle) {
  return {
    collapsed: new Set(allTreeKeys(themeStyle)),
    mounted: initCollapsed(themeStyle),
    all: new Set(),
  };
}
/** 由当前 collapsed 集合反推所处的展开态，手动调整后落到 custom。 */
function expandStateOf(themeStyle) {
  const p = expandPresets(themeStyle);
  if (sameKeys(collapsed, p.all)) return 'all';
  if (sameKeys(collapsed, p.collapsed)) return 'collapsed';
  if (sameKeys(collapsed, p.mounted)) return 'mounted';
  return 'custom';
}
/** 下一态跳过与当前等价的预设（如无挂载时 mounted === collapsed）。 */
function nextExpandState(themeStyle) {
  const current = expandStateOf(themeStyle);
  const from = current === 'custom' ? 'collapsed' : current;
  const presets = expandPresets(themeStyle);
  const at = EXPAND_ORDER.indexOf(from);
  return EXPAND_ORDER.slice(at + 1).concat(EXPAND_ORDER.slice(0, at + 1))
    .find(s => !sameKeys(presets[s], presets[from]))
    || EXPAND_ORDER[(at + 1) % EXPAND_ORDER.length];
}
function cycleExpandState(themeStyle) {
  collapsed = expandPresets(themeStyle)[nextExpandState(themeStyle)];
  rerender();
}

function treeView(themeStyle) {
  const state = expandStateOf(themeStyle);
  const meta = EXPAND_META[state];
  const nextMeta = EXPAND_META[nextExpandState(themeStyle)];
  const hint = `当前：${meta.label}（点击切换到${nextMeta.label}）`;
  const panel = el('div', { class: 'panel sd-tree-panel' },
    el('div', { class: 'panel-head' }, el('h3', {}, '挂载点配置'),
      el('div', { class: 'sd-tree-actions' },
        ...(draftDirty() ? [
          el('button', { class: 'btn tiny', onclick: revertDraft }, '撤销'),
          el('button', { class: 'btn tiny primary', onclick: applyDraft }, '应用'),
        ] : []),
        el('button', {
          class: 'btn tiny sd-expand-btn' + (state === 'custom' ? ' custom' : ''),
          title: hint, 'aria-label': hint,
          onclick: () => cycleExpandState(themeStyle),
        },
          el('span', { class: 'icon', html: meta.icon }),
          meta.label))),
    el('div', { class: 'sd-tree', role: 'tree', 'aria-label': '挂载点树' }));
  const tree = panel.lastChild;
  dPoints(themeStyle).forEach(p => tree.append(
    themeStyle.layout === 'stage' || !p.slots?.length ? stagePointRow(themeStyle, p) : zoneRow(themeStyle, p)));
  return panel;
}

function slotChildren(themeStyle, point, slot) {
  const zone = slotPointId(point.id, slot.id);
  const extId = dResolve(themeStyle, { id: zone });
  return extId ? [{ kind: 'ext', id: extId, name: extName(extId), extId, binding: 'slot', zone }] : [];
}
function stageChildren(themeStyle, point) {
  const id = dResolve(themeStyle, point);
  return id ? [{ kind: 'ext', id, name: extName(id), extId: id, binding: 'point', point }] : [];
}

/** 槽位是否挂了扩展。 */
function slotHasExt(themeStyle, point, slot) {
  return slotChildren(themeStyle, point, slot).length > 0;
}
/** 槽位下挂载的扩展数，供计数徽章使用。 */
function slotExtCount(themeStyle, point, slot) {
  return slotChildren(themeStyle, point, slot).length;
}
/** 「扩展展开」预设：展开有扩展的路径，其余收起；无任何扩展时与「全部收起」等价，从而被跳过。 */
function initCollapsed(themeStyle) {
  const next = new Set();
  let anyExt = false;
  for (const point of dPoints(themeStyle)) {
    const pointKey = themeStyle.id + ':' + point.id;
    if (themeStyle.layout === 'stage' || !point.slots?.length) {
      if (!stageChildren(themeStyle, point).length) next.add(pointKey);
      else anyExt = true;
      continue;
    }
    let hasExt = false;
    for (const slot of slotsOfZone(point.id)) {
      if (slotHasExt(themeStyle, point, slot)) hasExt = true;
      else next.add(themeStyle.id + ':' + slotPointId(point.id, slot.id));
    }
    if (hasExt) anyExt = true;
    else next.add(pointKey);
  }
  // 没有任何扩展时，返回与「全部收起」相同的集合，令中间态被 nextExpandState 跳过
  return anyExt ? next : new Set(allTreeKeys(themeStyle));
}
/** 树中所有可折叠节点的 key，供「全部收起」使用。 */
function allTreeKeys(themeStyle) {
  const keys = [];
  for (const point of dPoints(themeStyle)) {
    keys.push(themeStyle.id + ':' + point.id);
    if (themeStyle.layout !== 'stage' && point.slots?.length) {
      for (const slot of slotsOfZone(point.id)) keys.push(themeStyle.id + ':' + slotPointId(point.id, slot.id));
    }
  }
  return keys;
}
/** 新增内容后展开其所在路径，避免用户看不到刚加的项。 */
function revealZone(themeStyle, point, zone) {
  collapsed.delete(themeStyle.id + ':' + zone);
  if (point) collapsed.delete(themeStyle.id + ':' + point.id);
}
/** 展开某扩展在当前主题风格的全部挂载路径（同一扩展可能挂多处）。 */
function revealExtPaths(themeStyle, extId) {
  if (!extId) return;
  for (const point of dPoints(themeStyle)) {
    const pointKey = themeStyle.id + ':' + point.id;
    if (themeStyle.layout === 'stage' || !point.slots?.length) {
      if (dResolve(themeStyle, point) === extId) collapsed.delete(pointKey);
      continue;
    }
    for (const slot of slotsOfZone(point.id)) {
      const zone = slotPointId(point.id, slot.id);
      if (dResolve(themeStyle, { id: zone }) === extId) {
        collapsed.delete(themeStyle.id + ':' + zone);
        collapsed.delete(pointKey);
      }
    }
  }
}

function treeRow({ depth, icon, name, count, root = false, hasKids = false, key = '' }) {
  const open = hasKids ? !collapsed.has(key) : false;
  const row = el('div', {
    class: 'sd-trow' + (root ? ' root' : '') + (hasKids ? ' has-kids' : ''),
    role: 'treeitem', tabindex: '0', 'aria-level': String(depth + 1),
    ...(hasKids ? { 'aria-expanded': String(open) } : {}),
  });
  row.style.setProperty('--depth', depth);
  const chev = el('span', { class: 'sd-chev' + (hasKids ? (open ? ' open' : '') : ' leaf') },
    el('span', { class: 'icon', html: icons.chevron }));
  row.append(chev, el('span', { class: 'icon', html: icon }), el('span', { class: 'sd-tn' }, name));
  if (count > 0) row.append(el('span', { class: 'sd-cnt' }, String(count)));
  row.append(el('span', { class: 'sd-sp' }));
  if (hasKids) {
    const toggle = () => {
      collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
      rerender();
    };
    chev.onclick = e => { e.stopPropagation(); toggle(); };
    row.onclick = toggle;
    row.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowRight' && !open) { e.preventDefault(); collapsed.delete(key); rerender(); }
      if (e.key === 'ArrowLeft' && open) { e.preventDefault(); collapsed.add(key); rerender(); }
    };
  }
  return { row, open };
}
function rowActions(actions) {
  return actions.map(a => el('button', {
    class: 'sd-row-btn' + (a.danger ? ' danger' : ''),
    title: a.title, 'aria-label': a.title,
    onclick: e => { e.stopPropagation(); a.onClick(e.currentTarget); },
  }, el('span', { class: 'icon', html: a.icon })));
}

/** 分区行：仅是挂载区域（非挂载点），不可新增、不可删除。 */
function zoneRow(themeStyle, point) {
  const key = themeStyle.id + ':' + point.id;
  const { row, open } = treeRow({
    depth: 0, icon: icons.folder, name: point.name,
    count: slotsOfZone(point.id).reduce((n, slot) => n + slotExtCount(themeStyle, point, slot), 0),
    root: true, hasKids: true, key,
  });
  const frag = document.createDocumentFragment();
  frag.append(row);
  if (open) slotsOfZone(point.id).forEach(slot => frag.append(slotRow(themeStyle, point, slot)));
  return frag;
}

/** 三段槽位行：上/中/下或左/中/右。 */
function slotRow(themeStyle, point, slot) {
  const zone = slotPointId(point.id, slot.id);
  const key = themeStyle.id + ':' + zone;
  const children = slotChildren(themeStyle, point, slot);
  const { row, open } = treeRow({
    depth: 1, icon: icons.group, name: slot.name + '部',
    count: slotExtCount(themeStyle, point, slot),
    hasKids: true, key,
  });
  rowActions([
    { icon: icons.plus, title: '新增子项', onClick: btn => askAddMenu(themeStyle, btn, { point, slot, zone }) },
  ]).forEach(b => row.append(b));
  const frag = document.createDocumentFragment();
  frag.append(row);
  if (open) children.forEach(item => frag.append(itemRow(themeStyle, point, slot, item, 2)));
  return frag;
}

/** 3D 实物挂载点：没有分区槽位，直接列绑定扩展。 */
function stagePointRow(themeStyle, point) {
  const key = themeStyle.id + ':' + point.id;
  const children = stageChildren(themeStyle, point);
  const { row, open } = treeRow({
    depth: 0, icon: icons.disk, name: point.name, count: children.length,
    root: true, hasKids: true, key,
  });
  rowActions([
    { icon: icons.plus, title: '新增子项', onClick: btn => askAddMenu(themeStyle, btn, { point, zone: point.id }) },
  ]).forEach(b => row.append(b));
  const frag = document.createDocumentFragment();
  frag.append(row);
  if (open) children.forEach(item => frag.append(itemRow(themeStyle, point, null, item, 1)));
  return frag;
}

/** 扩展行：删除挂载 + 启停开关。 */
function itemRow(themeStyle, point, slot, item, depth) {
  const extRec = registry.get(item.extId) || getPlannedFeatures().find(f => f.id === item.extId);
  const { row } = treeRow({
    depth,
    icon: extRec?.icon || icons.puzzle,
    name: extRec?.name || item.name,
  });
  if (item.extId === focusExtId) row.classList.add('sd-trow-focus');
  const enabled = dEnabled(themeStyle, item);
  rowActions([
    {
      icon: enabled ? icons.eye : icons.eyeOff,
      title: enabled ? '停用扩展' : '启用扩展',
      onClick: () => {
        const next = !enabled;
        dSetEnabled(themeStyle, item, next);
        toast((next ? '已启用：' : '已停用：') + extName(item.extId) + '（待应用）');
        rerender();
      },
    },
    { icon: icons.trash, danger: true, title: '删除扩展', onClick: () => askDeleteExt(themeStyle, item) },
  ]).forEach(b => row.append(b));
  return row;
}

/* ---------- 行内新增 / 删除 ---------- */
function askAddMenu(themeStyle, anchor, ctx) {
  askAddExtension(themeStyle, ctx);
}
function confirmModal(title, desc, onConfirm, dangerText = '确认删除') {
  const body = el('div', {}, el('p', { class: 'sd-desc' }, desc));
  openModal(title, body, [
    { label: '取消' },
    { label: dangerText, danger: true, onClick: close => { onConfirm(); toast('已从草稿移除，待应用'); close(); rerender(); } },
  ]);
}
function askAddExtension(themeStyle, ctx) {
  const pick = mountPicker();
  openModal('添加扩展', el('div', {}, field('扩展', pick.node)), [{ label: '取消' }, {
    label: '添加', primary: true, onClick: close => {
      const id = pick.value();
      if (!id) { toast('请选择扩展'); return; }
      const zone = ctx.zone || ctx.point.id;
      dSetMount(zone, id);
      revealZone(themeStyle, ctx.point, zone);
      toast('已添加：' + extName(id) + '（待应用）'); close(); rerender();
    },
  }]);
}
function askDeleteExt(themeStyle, item) {
  confirmModal('删除扩展 · 需确认',
    `确定从「${item.name}」移除「${extName(item.extId)}」？此操作只解除挂载，不会卸载扩展。`,
    () => {
      if (item.binding === 'slot') dSetMount(item.zone, null);
      else if (item.binding === 'point') dSetMount(item.point.id, null);
    });
}
/* ---------- 操作弹窗 ---------- */
function mountTargets() {
  const out = [];
  for (const e of registry.list.filter(x => x.group !== 'system' && isExtInstalled(x.id))) {
    out.push({ id: e.id, label: e.name, group: e.group === 'main' ? '扩展中心' : (e.group || '扩展中心'), icon: e.icon || icons.puzzle });
  }
  for (const f of getPlannedFeatures().filter(x => x.stage === 'published' && isExtInstalled(x.id))) {
    out.push({ id: f.id, label: f.name, group: f.group || '未分组', icon: f.icon || icons.puzzle });
  }
  out.push(
    { id: 'settings', label: '设置', group: '系统内置', icon: icons.settings },
    { id: 'ext-center', label: '扩展中心', group: '系统内置', icon: icons.puzzle },
  );
  return out;
}
/** 带图标与分组的扩展选择控件：点击按钮弹出浮层菜单。 */
function mountPicker() {
  let selectedId = null;
  const targets = mountTargets();
  const btn = el('button', { class: 'input select mount-pick', type: 'button' });
  const paint = () => {
    const t = targets.find(x => x.id === selectedId);
    const nodes = [];
    if (t) nodes.push(el('span', { class: 'icon', html: t.icon || icons.puzzle }));
    nodes.push(el('span', {}, t ? t.label : '请选择…'));
    btn.replaceChildren(...nodes);
  };
  btn.onclick = () => {
    const items = [];
    let lastGroup = null;
    for (const t of targets) {
      if (t.group !== lastGroup) { items.push({ header: true, label: t.group }); lastGroup = t.group; }
      items.push({
        label: t.label,
        active: t.id === selectedId,
        node: el('span', { class: 'pop-menu-label' },
          el('span', { class: 'icon', html: t.icon || icons.puzzle }), t.label),
        onClick: () => { selectedId = t.id; paint(); },
      });
    }
    openPopMenu(btn, items);
  };
  paint();
  return { node: btn, value: () => selectedId };
}
function rerender() { bus.emit('route'); }

/* ---------- 页面注册 ---------- */
registerSystemPage('theme-style-detail', ctx => {
  const themeStyle = themeStyleById(ctx.id || activeThemeStyleId);
  activeThemeStyleId = themeStyle.id;
  ensureDraft(themeStyle);
  if (collapsedFor !== themeStyle.id) {
    collapsed = initCollapsed(themeStyle);
    collapsedFor = themeStyle.id;
  }
  // 从扩展中心跳转：首次进入挂载页时展开目标扩展的全部挂载路径
  if (focusExtId && activeTab === 'mounts' && focusAppliedFor !== themeStyle.id + ':' + focusExtId) {
    revealExtPaths(themeStyle, focusExtId);
    focusAppliedFor = themeStyle.id + ':' + focusExtId;
  }
  const page = el('div', { class: 'page sd-page' },
    // 返回与标题已上移到顶栏；内容区只保留实体展示与操作
    el('div', { class: 'sd-header' },
      el('div', { class: 'sd-hero' },
        el('div', { class: 'sd-hero-icon' }, el('span', { class: 'icon', html: themeStyle.icon || icons.puzzle })),
        el('div', {}, el('h1', {}, themeStyle.name),
          el('div', { class: 'sub mono' }, themeStyle.id + ' · ' + themeStyle.layout))),
      el('div', { class: 'sd-actions' },
        (() => {
          const current = getActiveThemeStyle()?.id === themeStyle.id;
          return [
            el('span', { class: 'pill' + (current ? ' ok' : '') }, current ? '当前使用' : '未启用'),
            current ? null : el('button', {
              class: 'btn',
              onclick: () => { setActiveThemeStyle(themeStyle.id); toast('已切换：' + themeStyle.name); },
            }, '设为当前主题风格'),
          ];
        })())),
    el('div', { class: 'sd-tabs', role: 'tablist', 'aria-label': '主题风格详情' },
      ...[['intro', '介绍'], ['preview', '预览'], ['mounts', '挂载点配置']].map(([id, label], i, arr) =>
        el('button', {
          class: 'sd-tab' + (activeTab === id ? ' on' : ''), role: 'tab',
          id: 'sd-tab-' + id,
          'aria-controls': 'sd-panel-' + id,
          'aria-selected': String(activeTab === id),
          tabindex: activeTab === id ? '0' : '-1',
          onclick: () => { activeTab = id; rerender(); },
          onkeydown: e => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const dir = e.key === 'ArrowRight' ? 1 : -1;
            const next = arr[(i + dir + arr.length) % arr.length];
            activeTab = next[0]; rerender();
            document.getElementById('sd-tab-' + activeTab)?.focus();
          },
        }, label))),
    el('div', {
      class: 'sd-content', role: 'tabpanel',
      id: 'sd-panel-' + activeTab, 'aria-labelledby': 'sd-tab-' + activeTab,
    }));
  const content = page.lastChild;
  content.append(({ intro: introView, preview: previewView, mounts: treeView })[activeTab](themeStyle));
  return page;
}, {
  title: ctx => themeStyleById(ctx.id || activeThemeStyleId)?.name || '主题风格',
  backLabel: '返回主题风格',
  back: () => router.go('settings'),
});

/* 供设置页调用：进入某主题风格详情 */
export function openThemeStyleDetail(themeStyleId, tab = 'intro', focusId = null) {
  activeThemeStyleId = themeStyleId;
  activeTab = tab;
  collapsedFor = null;
  focusExtId = focusId;
  router.open('theme-style-detail', themeStyleId);
}
