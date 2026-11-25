/* theme-style-studio3d.js — 3D 工作室主题风格（UI 样式作为扩展的示范实现）
 *
 * 主界面变为一间等距 3D 工作室：地面 + 桌子 + 电脑 + 宠物 + 小人 + 书架 + 工具箱。
 * 每个"实物"是一个扩展挂载点：点击实物 → 打开它挂载的扩展。
 * 挂载关系由用户配置（core.getThemeStyleMounts / setThemeStyleMount），未配置时用 defaultExt，
 * 因此"扩展挂到 3D 模型的实物上"完全数据驱动。
 *
 * 纯 CSS 3D + SVG，零依赖、零构建、跟随主题色 token；遵守无渐变无玻璃约束。
 */
import {
  registerThemeStyle, getThemeStyleMounts, setThemeStyleMount, getCustomThemeStylePoints,
  getPlannedFeatures, registry, router, icons, el, openModal, toast, bus, field,
  mountEnabledOf,
} from './core.js';

const THEME_STYLE_ID = 'studio3d';

/* ---------- 场景实物（扩展挂载点） ---------- */
// pos: 地面上的百分比坐标；defaultExt: 默认挂载
const OBJECTS = [
  { id: 'computer', name: '电脑',   desc: '编码与任务的主战场', icon: icons.dashboard, defaultExt: 'todo',      pos: { x: 50, y: 40 }, kind: 'computer' },
  { id: 'desk',     name: '书桌',   desc: '项目与文档',         icon: icons.projects,  defaultExt: 'projects',  pos: { x: 26, y: 46 }, kind: 'desk' },
  { id: 'pet',      name: '宠物',   desc: '你的知识伙伴',       icon: icons.notes,     defaultExt: 'notes',     pos: { x: 76, y: 55 }, kind: 'pet' },
  { id: 'person',   name: '小人',   desc: '个人设置面板',       icon: icons.settings,  defaultExt: 'settings',  pos: { x: 50, y: 72 }, kind: 'person' },
  { id: 'shelf',    name: '书架',   desc: '学习计划与收藏',     icon: icons.learning,  defaultExt: 'learning',  pos: { x: 18, y: 24 }, kind: 'shelf' },
  { id: 'toolbox',  name: '工具箱', desc: '开发小工具集合',     icon: icons.tools,     defaultExt: 'tool-time', pos: { x: 82, y: 26 }, kind: 'toolbox' },
];

/** 可扩展目标：已安装扩展 + 规划扩展 + 系统页 */
function mountTargets() {
  const options = [];
  for (const ext of registry.list.filter(e => e.group !== 'system')) {
    options.push({ id: ext.id, label: `${ext.name}（已安装）` });
  }
  for (const feature of getPlannedFeatures()) {
    options.push({ id: feature.id, label: `${feature.name}（规划·${feature.priority}）` });
  }
  options.push({ id: 'ext-center', label: '扩展中心（系统）' });
  options.push({ id: 'settings', label: '设置（系统）' });
  return options;
}

function targetLabel(id) {
  if (!id) return '未挂载';
  return mountTargets().find(item => item.id === id)?.label || id;
}

/* ---------- 单个实物 DOM ---------- */
function objectNode(obj) {
  const extId = getThemeStyleMounts(THEME_STYLE_ID)[obj.id] || obj.defaultExt;
  const disabled = !mountEnabledOf(THEME_STYLE_ID, obj.id);
  const node = el('button', {
    class: `studio-object obj-${obj.kind}` + (disabled ? ' disabled' : ''),
    style: `left:${obj.pos.x}%;top:${obj.pos.y}%;${disabled ? 'opacity:.4' : ''}`,
    title: `${obj.name} · ${obj.desc} → ${targetLabel(extId)}${disabled ? '（已停用）' : ''}`,
    'aria-label': `${disabled ? '已停用的挂载点' : '打开'}「${obj.name}」，当前挂载：${targetLabel(extId)}`,
    // 停用挂载点只提示，不打开扩展
    onclick: disabled ? () => toast(`挂载点「${obj.name}」已停用`) : () => router.go(extId),
  });
  node.dataset.point = obj.id;

  node.append(el('span', { class: 'obj-shadow' }));
  node.append(el('span', { class: 'obj-body' },
    el('span', { class: 'obj-face obj-front' }),
    el('span', { class: 'obj-face obj-side' }),
    el('span', { class: 'obj-face obj-top' })));
  node.append(el('span', { class: 'obj-badge' },
    el('span', { class: 'icon', html: obj.icon })));
  node.append(el('span', { class: 'obj-label' },
    el('span', { class: 'obj-name' }, obj.name),
    el('span', { class: 'obj-target' }, targetLabel(extId))));
  return node;
}

/* ---------- 挂载配置弹窗 ---------- */
export function openStudioSettings() {
  const rows = OBJECTS.map(obj => {
    const selected = getThemeStyleMounts(THEME_STYLE_ID)[obj.id] || obj.defaultExt;
    const select = el('select', { class: 'input select' },
      mountTargets().map(target => {
        const option = el('option', { value: target.id }, target.label);
        if (selected === target.id) option.selected = true;
        return option;
      }));
    return field(`${obj.name} · ${obj.desc}`, select);
  });
  const body = el('div', { class: 'studio-settings' },
    el('p', { class: 'hint' }, '把每个实物绑定到一个扩展。点击实物即可打开它挂载的功能。'),
    ...rows);

  openModal('3D 工作室 · 挂载设置', body, [
    { label: '取消' },
    { label: '重置默认', onClick: () => {
      OBJECTS.forEach(obj => setThemeStyleMount(THEME_STYLE_ID, obj.id, null));
      toast('已恢复默认挂载');
    } },
    { label: '保存', primary: true, onClick: close => {
      body.querySelectorAll('select').forEach((select, i) => {
        setThemeStyleMount(THEME_STYLE_ID, OBJECTS[i].id, select.value || null);
      });
      toast('挂载已更新');
      close();
      bus.emit('route');
    } },
  ]);
}

/** 内建实物 + 用户在详情页新增的自定义挂载点（带默认摆放坐标） */
function stageObjects() {
  const custom = getCustomThemeStylePoints(THEME_STYLE_ID).map((p, i) => ({
    ...p,
    desc: p.desc || '自定义挂载点',
    icon: p.icon || icons.puzzle,
    defaultExt: p.defaultExt || null,
    pos: p.pos || { x: 30 + (i % 4) * 16, y: 18 + Math.floor(i / 4) * 20 },
    kind: 'custom',
  }));
  return OBJECTS.concat(custom);
}

/* ---------- 舞台渲染 ---------- */
function renderStage() {
  const toolbar = el('div', { class: 'studio-toolbar' },
    el('div', { class: 'studio-title' },
      el('span', { class: 'icon', html: icons.puzzle }),
      el('span', {}, '3D 工作室')),
    el('div', { class: 'studio-actions' },
      el('button', { class: 'btn', onclick: openStudioSettings },
        el('span', { class: 'icon', html: icons.settings }), '配置挂载'),
      el('button', { class: 'btn', onclick: () => router.go('ext-center') }, '扩展中心')));

  const room = el('div', { class: 'studio-room' },
    el('div', { class: 'studio-floor' }),
    el('div', { class: 'studio-wall studio-wall-left' }),
    el('div', { class: 'studio-wall studio-wall-right' }),
    el('div', { class: 'studio-rug' }),
    ...stageObjects().map(objectNode));

  const hint = el('div', { class: 'studio-hint' },
    '点击房间里的实物打开对应扩展 · 每个实物都是一个可配置的扩展挂载点');

  return el('div', { class: 'studio-stage' }, toolbar,
    el('div', { class: 'studio-viewport' }, room), hint);
}

/* ---------- 主题风格专属设置面板（嵌入设置页） ---------- */
function settingsPanel() {
  return el('div', { class: 'studio-settings-inline' },
    el('div', { class: 'panel-head' }, el('h3', {}, '3D 工作室 · 实物挂载')),
    el('div', { class: 'settings-body' },
      ...OBJECTS.map(obj => el('div', { class: 'set-row' },
        el('span', { class: 'set-label' }, obj.name),
        el('span', { class: 'set-sub' }, obj.desc),
        el('button', { class: 'btn', onclick: openStudioSettings }, '配置')))));
}

registerThemeStyle({
  id: THEME_STYLE_ID,
  name: '3D 工作室',
  icon: icons.blog,
  desc: '把主界面变成一间 3D 工作室：桌子、电脑、宠物、小人都是扩展挂载点，点击即可打开对应功能。',
  layout: 'stage',
  mountPoints: OBJECTS.map(({ id, name, desc, icon, defaultExt }) => ({ id, name, desc, icon, defaultExt })),
  configureMounts: openStudioSettings,
  renderStage,
  settingsPanel,
});
