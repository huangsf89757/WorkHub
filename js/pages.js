/* pages.js — 内核系统页面：扩展中心
 *
 * 与业务扩展分离：属于 WorkHub 本身，常驻、不可停用。
 * 设置页见 page-settings.js（左侧分类 + 搜索）。
 */
import {
  el, icons, registry, registerSystemPage, leaveSystem, toast, bus,
  getPlannedFeatures, getActiveThemeStyle,
  getThemeStyleMountPoints, mountLabelOfExt,
  EXT_STAGES, extStageOf,
  isExtInstalled, installExt, uninstallExt, extNeedsUpdate, updateExt, isExtMounted,
} from './core.js';
import { openExtDetail } from './page-ext-detail.js';
import { openThemeStyleDetail } from './page-theme-style-detail.js';

const STAGE_ICON = { planning: icons.clock, developing: icons.braces, published: icons.check };
const collapsedGroups = new Set();

/* ============================================================
   扩展中心：按阶段分组，每行呈现 安装 / 挂载 / 启用 三态
   ============================================================ */
registerSystemPage('ext-center', () => {
  const themeStyle = getActiveThemeStyle();
  const points = getThemeStyleMountPoints(themeStyle);
  const all = [
    ...registry.list.filter(ext => ext.group !== 'system'),
    ...getPlannedFeatures(),
  ];
  // 系统内置页有独立入口（设置/顶栏），不在扩展中心展示，避免出现空分组
  const groups = EXT_STAGES.filter(stage => stage.id !== 'system').map(stage => ({
    ...stage,
    items: all.filter(ext => extStageOf(ext.id) === stage.id),
  }));

  const actionBtn = (label, title, onclick, primary = false) => el('button', {
    class: 'btn' + (primary ? ' primary' : ''), title, 'aria-label': title, onclick,
  }, label);

  const row = ext => {
    const stage = extStageOf(ext.id);
    const installed = isExtInstalled(ext.id);
    const mounted = installed && isExtMounted(ext.id);
    const mount = mountLabelOfExt(themeStyle, ext);
    const openMounts = () => openThemeStyleDetail(themeStyle?.id, 'mounts', ext.id);
    const openDetail = () => openExtDetail(ext.id);

    const cells = [
      el('span', { class: 'icon ext-row-icon', html: ext.icon || icons.puzzle }),
      el('div', { class: 'ext-row-main' },
        el('button', {
          class: 'ext-row-name ext-name-link',
          title: '查看扩展详情', 'aria-label': `查看「${ext.name}」详情`,
          onclick: openDetail,
        }, ext.name),
        el('div', { class: 'ext-row-desc' }, ext.desc || '')),
      el('button', {
        class: 'icon-btn ext-row-detail',
        title: '详情', 'aria-label': `查看「${ext.name}」详情`,
        onclick: openDetail,
      }, el('span', { class: 'icon', html: icons.info })),
    ];

    if (installed) {
      cells.push(el('button', {
        class: 'icon-btn ext-row-mount',
        title: `${ext.name}${mounted ? `挂载于 ${mount.label}` : '未挂载'}，点击配置`,
        'aria-label': `${ext.name} 挂载配置`,
        onclick: openMounts,
      }, el('span', { class: 'icon', html: icons.mount })));
      if (extNeedsUpdate(ext.id)) cells.push(actionBtn('更新', `更新「${ext.name}」`, () => {
        updateExt(ext.id); toast('已更新：' + ext.name);
      }, true));
      cells.push(actionBtn('卸载', `卸载「${ext.name}」`, () => {
        uninstallExt(ext.id); toast('已卸载：' + ext.name);
      }));
    } else if (stage === 'published') {
      cells.push(actionBtn('安装', `安装「${ext.name}」`, () => {
        installExt(ext.id); toast('已安装：' + ext.name);
      }, true));
    }

    return el('div', { class: 'ext-row' }, ...cells);
  };

  return el('div', { class: 'page' },
    el('div', { class: 'page-meta' },
      el('span', { class: 'tag' }, `${all.length} 个扩展 · ${groups.map(g => `${g.label} ${g.items.length}`).join(' / ')}`)),
    el('p', { class: 'dash-greeting' },
      `WorkHub 是扩展式工作台：所有业务功能都是可插拔扩展。当前主题风格「${themeStyle?.name || '默认'}」定义了 ${points.length} 个挂载点，扩展的挂载位置随主题风格切换而变化。`),
    ...groups.map(g => {
      const open = !collapsedGroups.has(g.id);
      const toggle = () => {
        open ? collapsedGroups.add(g.id) : collapsedGroups.delete(g.id);
        bus.emit('route');
      };
      return el('div', { class: 'panel', style: g.id === EXT_STAGES[0].id ? '' : 'margin-top:18px' },
        el('div', { class: 'panel-head ext-group-head' },
          el('span', { class: 'icon ext-group-icon', html: STAGE_ICON[g.id] || icons.puzzle }),
          el('h3', {}, g.label),
          el('span', { class: 'ext-group-count' }, `${g.items.length} 项`),
          el('span', { class: 'ext-group-spacer' }),
          el('button', {
            class: 'ext-group-toggle' + (open ? ' open' : ''),
            title: open ? '收起' : '展开', 'aria-label': `${open ? '收起' : '展开'}${g.label}`,
            onclick: toggle,
          }, el('span', { class: 'icon', html: icons.chevronDown }))),
        open ? (g.items.length ? g.items.map(row) : el('div', { class: 'empty' }, '暂无扩展')) : null);
    }));
}, { title: '扩展中心', backLabel: '返回工作台', back: () => leaveSystem() });
