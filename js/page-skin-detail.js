/* page-skin-detail.js — 界面样式详情页（系统页）
 *
 * 入口：设置 › 界面样式 › 皮肤卡片「⋯」› 查看详情 → router.open('skin-detail', skinId)
 * 三 Tab：介绍 / 预览 / 挂载点配置（单一树形结构）
 * 数据全部走 core 契约；增删走 addGroup/deleteGroup/setPlacement（panels）
 *   与 addCustomSkinPoint/deleteCustomSkinPoint/setSkinMount（stage）。
 */
import {
  el, icons, router, bus, registerSystemPage, toast, openModal, field, input,
  getAllSkins, getActiveSkin, setActiveSkin,
  getSkinMountPoints, getCustomSkinPoints, addCustomSkinPoint,
  updateCustomSkinPoint, deleteCustomSkinPoint,
  getSkinMounts, setSkinMount, resolveMount,
  getMenuLayout, addGroup, updateGroup, deleteGroup, setPlacement, placementOf, placementPicker,
  registry, getPlannedFeatures, openPopMenu,
} from './core.js';

let activeSkinId = null;
let activeTab = 'intro';
let expanded = new Set();

const skinById = id => getAllSkins().find(s => s.id === id) || getActiveSkin();
/** 该挂载点是否走 skinMounts（stage 实物 + classic 左侧栏底部常驻位） */
const viaSkinMount = (skin, point) => skin.layout === 'stage' || point?.via === 'skinMount';
const extName = id =>
  registry.get(id)?.name
  || getPlannedFeatures().find(f => f.id === id)?.name
  || (id === 'settings' ? '设置' : id === 'ext-center' ? '扩展中心' : id);
const extType = id =>
  registry.get(id) ? '已安装'
    : getPlannedFeatures().find(f => f.id === id) ? '规划中'
    : '系统页';

/* ---------- 介绍 ---------- */
function introView(skin) {
  const points = getSkinMountPoints(skin);
  const kv = (k, v, mono) => el('div', { class: 'sd-kv-row' },
    el('span', { class: 'sd-kv-k' }, k),
    el('span', { class: 'sd-kv-v' + (mono ? ' mono' : '') }, String(v)));
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h3', {}, '界面样式介绍')),
    el('div', { class: 'sd-pad' },
      el('div', { class: 'sd-kv' },
        kv('名称', skin.name),
        kv('描述', skin.desc || '—'),
        kv('布局模式', skin.layout, true),
        kv('挂载点', `${points.length} 个`),
        kv('界面样式 ID', skin.id, true)),
      el('div', { class: 'sd-contract' },
        el('span', {}, '数据源　', el('b', {}, 'getSkinMountPoints(skin)'), ' / ', el('b', {}, 'getMenuLayout()')),
        el('span', {}, '解析　　', el('b', {}, 'resolveMount(skin, point)')),
        el('span', {}, '写入　　', el('b', {}, 'setSkinMount()'), ' / ', el('b', {}, 'setPlacement()')),
        el('span', {}, '目录　　', el('b', {}, 'addGroup()'), ' / ', el('b', {}, 'deleteGroup()'), ' / ', el('b', {}, 'addCustomSkinPoint()')))));
}

/* ---------- 预览 ---------- */
function previewView(skin) {
  const box = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h3', {}, '预览 · ' + skin.name),
      el('span', { class: 'sd-count' }, '示意，非实际渲染')),
    el('div', { class: 'sd-pad' }));
  const body = box.lastChild;
  if (skin.layout === 'panels') {
    const zone = (cls, label) => el('div', { class: 'sd-pv-zone can ' + cls }, label);
    body.append(el('div', { class: 'sd-pv-classic' },
      zone('top', '顶部栏 · top（主菜单）'),
      zone('left', '左侧栏 · left'),
      el('div', { class: 'sd-pv-center' }, el('span', { class: 'icon', html: icons.dashboard }),
        '中间区 · center（主内容）'),
      zone('right', '右侧栏 · right'),
      zone('bottom', '底部栏 · bottom（状态条）')));
    body.append(el('div', { class: 'sd-pv-legend' },
      el('span', {}, el('i', { class: 'a' }), '可挂载区'),
      el('span', {}, el('i', { class: 'b' }), '内容区')));
  } else {
    const room = el('div', { class: 'sd-pv-room' });
    const pos = { computer: [50, 34], desk: [24, 44], pet: [76, 50], person: [50, 68], shelf: [17, 22], toolbox: [83, 24] };
    getSkinMountPoints(skin).forEach((p, i) => {
      const extId = resolveMount(skin, p);
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

/* ---------- 挂载点配置（单一树） ---------- */
function treeView(skin) {
  const points = getSkinMountPoints(skin);
  const customIds = new Set(getCustomSkinPoints(skin.id).map(p => p.id));
  const builtin = skin.mountPoints || [];
  const panel = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h3', {}, '挂载点配置'),
      el('span', { class: 'sd-count' }, `${countPoints(skin)} 个挂载点`)),
    el('div', { class: 'sd-tree-toolbar' },
      el('button', {
        class: 'btn primary', onclick: () => askAddPoint(skin),
      }, el('span', { class: 'icon', html: icons.plus }), '新增挂载点'),
      el('span', { class: 'hint' }, '删除已有扩展的挂载点时会先弹窗确认并转移绑定')),
    el('div', { class: 'sd-tree', role: 'tree', 'aria-label': '挂载点树' }));
  const tree = panel.lastChild;
  points.forEach(p => tree.append(pointRow(skin, p, 0,
    p.id === 'left' ? leftChildren(skin) : [], customIds.has(p.id), builtin.some(b => b.id === p.id))));
  return panel;
}
function countPoints(skin) { return getSkinMountPoints(skin).length + leftChildren(skin).filter(c => c.kind === 'group').length; }

/** panels 的 left 分区下：主菜单（内建）+ 自定义分组；其余分区无子节点 */
function leftChildren(skin) {
  if (skin.id !== 'classic' || skin.layout !== 'panels') return [];
  const layout = getMenuLayout();
  return [
    { id: 'left:main', name: '主菜单', kind: 'main', mounts: mountedAt(skin, 'left', 'main') },
    ...layout.groups.filter(g => g.zone === 'left').map(g => ({
      id: g.id, name: g.name, kind: 'group', mounts: mountedAt(skin, 'left', 'group:' + g.id),
    })),
  ];
}
function mountedAt(skin, zone, slot) {
  return registry.list.filter(e => {
    const p = placementOf(e);
    if (p.zone !== zone) return false;
    if (slot === 'main') return p.slot === 'main' || !p.slot;
    return p.slot === slot;
  }).map(e => e.id);
}
function pointMounts(skin, point) {
  if (viaSkinMount(skin, point)) {
    const id = resolveMount(skin, point);
    return id ? [id] : [];
  }
  const zoneId = point.id;
  return registry.list.filter(e => placementOf(e).zone === zoneId && !e.group).map(e => e.id);
}

function pointRow(skin, point, depth, children, custom, builtin) {
  const key = skin.id + ':' + point.id;
  const hasKids = children.length > 0;
  const open = expanded.has(key);
  const mounts = pointMounts(skin, point);
  const row = el('div', {
    class: 'sd-trow' + (depth === 0 ? ' root' : ''), role: 'treeitem', tabindex: '0',
    'aria-expanded': hasKids ? String(open) : 'false',
  });
  row.style.paddingLeft = (12 + depth * 20) + 'px';
  const chev = el('span', { class: 'sd-chev' + (hasKids ? (open ? ' open' : '') : ' leaf') },
    el('span', { class: 'icon', html: icons.chevron }));
  row.append(chev,
    el('span', { class: 'icon', html: point.kind === 'group' ? icons.folder : (skin.layout === 'stage' ? icons.disk : icons.folder) }),
    el('span', { class: 'sd-tn' }, point.name));
  if (mounts.length) row.append(el('span', { class: 'sd-cnt' }, `${mounts.length} 绑定`));
  const more = el('button', { class: 'sd-more', 'aria-label': point.name + ' 更多操作' },
    el('span', { class: 'icon', html: icons.more || icons.settings }));
  row.append(el('span', { class: 'sd-sp' }), more);

  const toggle = () => { if (!hasKids) return; open ? expanded.delete(key) : expanded.add(key); rerender(); };
  chev.onclick = e => { e.stopPropagation(); toggle(); };
  row.onclick = toggle;
  row.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    if (e.key === 'ArrowRight' && hasKids && !open) { e.preventDefault(); expanded.add(key); rerender(); }
    if (e.key === 'ArrowLeft' && hasKids && open) { e.preventDefault(); expanded.delete(key); rerender(); }
  };
  more.onclick = e => {
    e.stopPropagation();
    const items = [];
    if (skin.id === 'classic' && point.id === 'left') items.push({ label: '新增子挂载点', onClick: () => askAddGroup(skin) });
    else if (skin.layout === 'stage' && !builtin) items.push({ label: '重命名', onClick: () => askRenamePoint(skin, point) });
    else if (point.kind === 'group') items.push({ label: '重命名', onClick: () => askRenameGroup(skin, point) });
    if (items.length) items.push({ sep: true });
    items.push({
      label: builtin && viaSkinMount(skin, point) ? '解除自定义绑定' : '删除挂载点',
      danger: true, onClick: () => askDelete(skin, point, children, custom, builtin),
    });
    openPopMenu(more, items);
  };

  const frag = document.createDocumentFragment();
  frag.append(row);
  if (open && hasKids) {
    const group = el('div', { class: 'sd-tgroup', role: 'group' });
    children.forEach(c => group.append(childRow(skin, c, depth + 1)));
    frag.append(group);
  }
  if (open && mounts.length) {
    const g = el('div', { class: 'sd-tgroup' });
    g.style.paddingLeft = (32 + depth * 20) + 'px';
    mounts.forEach(id => {
      const f = el('div', { class: 'sd-frow' },
        el('span', { class: 'icon', html: icons.file }),
        el('span', { class: 'sd-fn' }, extName(id)),
        el('span', { class: 'pill' }, extType(id)),
        el('span', { class: 'sd-sp' }),
        el('button', { class: 'btn tiny', onclick: () => askRebind(skin, point, id, children) }, '改绑'));
      g.append(f);
    });
    frag.append(g);
  }
  return frag;
}
function childRow(skin, child, depth) {
  const row = el('div', { class: 'sd-trow', role: 'treeitem', tabindex: '0', style: 'padding-left:' + (12 + depth * 20) + 'px' },
    el('span', { class: 'sd-chev leaf' }, el('span', { class: 'icon', html: icons.chevron })),
    el('span', { class: 'icon', html: icons.folder }),
    el('span', { class: 'sd-tn' }, child.name));
  if (child.mounts.length) row.append(el('span', { class: 'sd-cnt' }, `${child.mounts.length} 绑定`));
  const more = el('button', { class: 'sd-more', 'aria-label': child.name + ' 更多操作' },
    el('span', { class: 'icon', html: icons.more || icons.settings }));
  row.append(el('span', { class: 'sd-sp' }), more);
  more.onclick = e => {
    e.stopPropagation();
    openPopMenu(more, [
      { label: '重命名', onClick: () => askRenameGroup(skin, child) },
      { sep: true },
      { label: '删除挂载点', danger: true, onClick: () => askDeleteGroup(skin, child) },
    ]);
  };
  const frag = document.createDocumentFragment(); frag.append(row);
  if (child.mounts.length) {
    const g = el('div', { class: 'sd-tgroup' });
    g.style.paddingLeft = (32 + depth * 20) + 'px';
    child.mounts.forEach(id => g.append(el('div', { class: 'sd-frow' },
      el('span', { class: 'icon', html: icons.file }),
      el('span', { class: 'sd-fn' }, extName(id)),
      el('span', { class: 'pill' }, extType(id)),
      el('span', { class: 'sd-sp' }),
      el('button', { class: 'btn tiny', onclick: () => askRebindGroup(skin, child, id) }, '改绑'))));
    frag.append(g);
  }
  return frag;
}

/* ---------- 操作弹窗 ---------- */
function mountTargets(exclude) {
  const out = [];
  for (const e of registry.list.filter(x => x.group !== 'system')) out.push({ id: e.id, label: `${e.name}（已安装）` });
  for (const f of getPlannedFeatures()) out.push({ id: f.id, label: `${f.name}（规划·${f.priority}）` });
  out.push({ id: 'settings', label: '设置（系统）' }, { id: 'ext-center', label: '扩展中心（系统）' });
  return out;
}
function selectField(label, options, selected) {
  const needsPlaceholder = selected == null && options.length && options[0].id !== '';
  const opts = needsPlaceholder ? [{ id: '', label: '请选择…' }, ...options] : options;
  const sel = el('select', { class: 'input select' }, opts.map(o => {
    const op = el('option', { value: o.id }, o.label);
    if (op.value === selected) op.selected = true;
    return op;
  }));
  return field(label, sel);
}
function askAddPoint(skin) {
  const nameInput = input({ placeholder: '挂载点名称' });
  const body = el('div', {},
    el('div', { class: 'sd-err', role: 'alert', hidden: true }),
    field('名称', nameInput),
    el('p', { class: 'hint' }, skin.layout === 'stage'
      ? '新增的实物挂载点会出现在 3D 舞台与挂载配置中，可为其绑定扩展。'
      : '经典分栏的左侧主菜单新增一个文件夹分组。'));
  openModal('新增挂载点', body, [
    { label: '取消' },
    { label: '创建', primary: true, onClick: close => {
      const name = nameInput.value.trim();
      const errBox = body.querySelector('.sd-err');
      const fail = msg => { errBox.hidden = false; errBox.textContent = msg; nameInput.focus(); };
      if (!name) return fail('请输入挂载点名称');
      if (skin.layout === 'stage') {
        const id = 'cp_' + Date.now().toString(36);
        if (!addCustomSkinPoint(skin.id, { id, name, desc: '自定义挂载点', icon: icons.puzzle })) return fail('已存在同名挂载点');
        toast('已新增挂载点：' + name);
      } else {
        if (getMenuLayout().groups.some(g => g.name === name && g.zone === 'left')) return fail('已存在同名分组');
        addGroup(name, 'left');
        toast('已新增分组：' + name);
      }
      close(); rerender();
    } },
  ]);
}
function askAddGroup(skin) { askAddPoint(skin); }
function askRenameGroup(skin, child) {
  const nameInput = input({ value: child.name });
  const body = el('div', {}, el('div', { class: 'sd-err', role: 'alert', hidden: true }), field('名称', nameInput));
  openModal('重命名挂载点', body, [
    { label: '取消' },
    { label: '保存', primary: true, onClick: close => {
      const name = nameInput.value.trim();
      if (!name) { const e = body.querySelector('.sd-err'); e.hidden = false; e.textContent = '请输入名称'; return; }
      updateGroup(child.id, { name });
      toast('已重命名'); close(); rerender();
    } },
  ]);
}
function askRenamePoint(skin, point) {
  const nameInput = input({ value: point.name });
  const body = el('div', {}, el('div', { class: 'sd-err', role: 'alert', hidden: true }), field('名称', nameInput));
  openModal('重命名挂载点', body, [
    { label: '取消' },
    { label: '保存', primary: true, onClick: close => {
      const name = nameInput.value.trim();
      if (!name) { const e = body.querySelector('.sd-err'); e.hidden = false; e.textContent = '请输入名称'; return; }
      updateCustomSkinPoint(skin.id, point.id, { name });
      toast('已重命名'); close(); rerender();
    } },
  ]);
}
/** 删除确认：有绑定时列出扩展并要求选择「目标挂载点」（不是扩展） */
function confirmDelete({ title, desc, mounts, targets = [], onDelete }) {
  const body = el('div', {},
    el('p', { class: 'sd-desc' }, desc),
    mounts.length ? el('div', { class: 'sd-warn' }, `该挂载点已挂载 ${mounts.length} 个扩展，删除前需指定其去向。`) : null,
    mounts.length ? el('div', { class: 'sd-vlist' }, mounts.map(id =>
      el('div', {}, el('span', { class: 'icon', html: icons.file }), extName(id) + '（' + extType(id) + '）'))) : null,
    mounts.length ? selectField('将绑定转移到', targets.length ? targets : [{ id: '', label: '无其它挂载点（将解除挂载）' }], null) : null,
    el('div', { class: 'sd-err', role: 'alert', hidden: true }));
  const buttons = [{ label: '取消' }, {
    label: '确认删除', danger: true, onClick: close => {
      const target = mounts.length ? body.querySelector('select')?.value || null : null;
      const err = body.querySelector('.sd-err');
      if (mounts.length && targets.length && !target) {
        err.hidden = false; err.textContent = '请选择转移目标'; return;
      }
      onDelete(target);
      close(); rerender();
    },
  }];
  openModal(title, body, buttons);
}
/** 备选挂载点：skinMount 型（stage 实物 / classic 左栏底部）→ 其它同类挂载点；panels 分组 → 其它分组 + 主菜单 */
function transferTargets(skin, excludeId, kind = 'group') {
  if (kind === 'skinMount') {
    return getSkinMountPoints(skin)
      .filter(p => p.id !== excludeId && viaSkinMount(skin, p))
      .map(p => ({ id: p.id, label: p.name }));
  }
  const out = [{ id: 'main', label: '主菜单（未分组）' }];
  getMenuLayout().groups.filter(g => g.zone === 'left' && g.id !== excludeId)
    .forEach(g => out.push({ id: g.id, label: g.name }));
  return out;
}
function askDelete(skin, point, children, custom, builtin) {
  const mounts = pointMounts(skin, point);
  const affected = mounts.concat(children.flatMap(c => c.mounts || []));
  const skinMountKind = viaSkinMount(skin, point);
  confirmDelete({
    title: builtin && skinMountKind ? '解除自定义绑定 · 需确认' : '删除挂载点 · 需确认',
    desc: builtin && skinMountKind
      ? `「${point.name}」是界面样式内建挂载点，无法删除；此处解除其自定义绑定${point.defaultExt ? '并回落到默认扩展' : ''}。`
      : `确定删除「${point.name}」？`,
    mounts: affected,
    targets: transferTargets(skin, point.id, skinMountKind ? 'skinMount' : 'group'),
    onDelete: target => {
      if (skinMountKind) {
        // 先转移绑定到目标挂载点，再解除/删除当前点
        if (target) affected.forEach(id => setSkinMount(skin.id, target, id));
        if (builtin) setSkinMount(skin.id, point.id, null);
        else deleteCustomSkinPoint(skin.id, point.id);
        const label = transferTargets(skin, point.id, 'skinMount').find(t => t.id === target)?.label || target;
        toast(target ? `已删除，${affected.length} 个绑定转移至「${label}」` : '已删除并解除挂载');
      } else {
        // 内建分区不可删，仅解除其上的绑定
        if (target && target !== 'main') affected.forEach(id => setPlacement(id, { zone: 'left', slot: 'group:' + target }));
        else if (target === 'main') affected.forEach(id => setPlacement(id, null));
        toast('已更新挂载点：' + point.name);
      }
    },
  });
}
function askDeleteGroup(skin, group) {
  confirmDelete({
    title: '删除挂载点 · 需确认',
    desc: `确定删除「${group.name}」？`,
    mounts: group.mounts || [],
    targets: transferTargets(skin, group.id),
    onDelete: target => {
      if (target && target !== 'main') (group.mounts || []).forEach(id => setPlacement(id, { zone: 'left', slot: 'group:' + target }));
      else if (target === 'main') (group.mounts || []).forEach(id => setPlacement(id, null));
      deleteGroup(group.id);
      toast('已删除分组：' + group.name);
    },
  });
}
function askRebind(skin, point, oldId, children) {
  if (!viaSkinMount(skin, point)) {
    // panels 普通分区：挂载位置由 placementPicker 统一编排（left/top/分组）
    const ext = registry.get(oldId);
    if (ext) placementPicker(ext, rerender);
    else toast('规划中扩展暂不支持改绑');
    return;
  }
  const wrapped = selectField('绑定扩展', mountTargets(), oldId);
  openModal('修改绑定扩展', el('div', {}, wrapped,
    el('p', { class: 'hint' }, `挂载点「${point.name}」· 写入 setSkinMount()`)), [
    { label: '取消' },
    { label: '解除挂载', onClick: close => { setSkinMount(skin.id, point.id, null); toast('已解除挂载'); close(); rerender(); } },
    { label: '应用', primary: true, onClick: close => {
      setSkinMount(skin.id, point.id, wrapped.querySelector('select').value || null);
      toast('已更新绑定'); close(); rerender();
    } },
  ]);
}
function askRebindGroup(skin, group, oldId) {
  const wrapped = selectField('绑定扩展', mountTargets(), oldId);
  openModal('修改绑定扩展', el('div', {}, wrapped), [
    { label: '取消' },
    { label: '应用', primary: true, onClick: close => {
      const id = wrapped.querySelector('select').value;
      setPlacement(oldId, id ? { zone: 'left', slot: 'group:' + group.id } : null);
      toast('已更新绑定'); close(); rerender();
    } },
  ]);
}

function rerender() { bus.emit('route'); }

/* ---------- 页面注册 ---------- */
registerSystemPage('skin-detail', ctx => {
  const skin = skinById(ctx.id || activeSkinId);
  activeSkinId = skin.id;
  const page = el('div', { class: 'page sd-page' },
    // 返回与标题已上移到顶栏；内容区只保留实体展示与操作
    el('div', { class: 'sd-header' },
      el('div', { class: 'sd-hero' },
        el('div', { class: 'sd-hero-icon' }, el('span', { class: 'icon', html: skin.icon || icons.puzzle })),
        el('div', {}, el('h1', {}, skin.name),
          el('div', { class: 'sub mono' }, skin.id + ' · ' + skin.layout))),
      el('div', { class: 'sd-actions' },
        (() => {
          const current = getActiveSkin()?.id === skin.id;
          return [
            el('span', { class: 'pill' + (current ? ' ok' : '') }, current ? '当前使用' : '未启用'),
            current ? null : el('button', {
              class: 'btn',
              onclick: () => { setActiveSkin(skin.id); toast('已切换：' + skin.name); },
            }, '设为当前界面样式'),
          ];
        })())),
    el('div', { class: 'sd-tabs', role: 'tablist', 'aria-label': '界面样式详情' },
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
  content.append(({ intro: introView, preview: previewView, mounts: treeView })[activeTab](skin));
  return page;
}, {
  title: ctx => skinById(ctx.id || activeSkinId)?.name || '界面样式',
  backLabel: '返回界面样式',
  back: () => router.go('settings'),
});

/* 供设置页调用：进入某皮肤详情 */
export function openSkinDetail(skinId) {
  activeSkinId = skinId;
  activeTab = 'intro';
  expanded = new Set();
  router.open('skin-detail', skinId);
}
