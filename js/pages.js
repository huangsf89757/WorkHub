/* pages.js — 内核系统页面：扩展中心
 *
 * 与业务扩展分离：属于 WorkHub 本身，常驻、不可停用。
 * 设置页见 page-settings.js（左侧分类 + 搜索）。
 */
import {
  el, icons, registry, registerSystemPage, router, leaveSystem,
  getPlannedFeatures, placementPicker, extEnabled,
  setExtEnabled, getActiveSkin,
  getSkinMountPoints, mountLabelOfExt, openExtensionWindow,
} from './core.js';
import { openExtDetail } from './page-ext-detail.js';

/* ============================================================
   扩展中心
   ============================================================ */
registerSystemPage('ext-center', () => {
  const installed = registry.list.filter(ext => ext.group !== 'system');
  const planned = getPlannedFeatures();
  const skin = getActiveSkin();
  const points = getSkinMountPoints(skin);

  const installedRow = ext => {
    const on = extEnabled(ext.id);
    const mount = mountLabelOfExt(skin, ext);
    return el('div', { class: 'ext-row' },
      el('span', { class: 'icon ext-row-icon', html: ext.icon }),
      el('div', { class: 'ext-row-main' },
        el('button', {
          class: 'ext-row-name ext-name-link',
          title: '查看扩展详情', 'aria-label': `查看「${ext.name}」详情`,
          onclick: () => openExtDetail(ext.id),
        }, ext.name),
        el('div', { class: 'ext-row-desc' }, ext.desc || '')),
      el('button', {
        class: 'icon-btn ext-row-detail',
        title: '详情', 'aria-label': `查看「${ext.name}」详情`,
        onclick: () => openExtDetail(ext.id),
      }, el('span', { class: 'icon', html: icons.info })),
      el('button', {
        class: 'icon-btn ext-row-window',
        title: '独立窗口打开', 'aria-label': `在独立窗口打开「${ext.name}」`,
        onclick: () => openExtensionWindow(ext.id),
      }, el('span', { class: 'icon', html: icons.external })),
      el('button', {
        class: 'tag tag-btn',
        title: '点击修改挂载位置', 'aria-label': `${ext.name} 挂载位置：${mount.label}，点击修改`,
        onclick: () => {
          if (typeof skin?.configureMounts === 'function') skin.configureMounts();
          else placementPicker(ext, () => router.go('ext-center'));
        },
      }, mount.label),
      el('span', { class: `ext-row-state ${on ? 'on' : 'off'}` }, on ? 'on' : 'off'),
      el('button', {
        class: `switch${on ? ' on' : ''}`,
        title: on ? '停用' : '启用',
        'aria-label': `${on ? '停用' : '启用'}扩展「${ext.name}」`,
        'aria-pressed': String(on),
        onclick: () => setExtEnabled(ext.id, !on),
      }));
  };

  const plannedRow = feature => el('div', { class: 'ext-row planned' },
    el('span', { class: 'ext-row-index' }, feature.priority || '—'),
    el('div', { class: 'ext-row-main' },
      el('button', {
        class: 'ext-row-name ext-name-link',
        title: '查看规划详情', 'aria-label': `查看「${feature.name}」规划详情`,
        onclick: () => openExtDetail(feature.id),
      }, `${feature.name}  ·  ${feature.group}`),
      el('div', { class: 'ext-row-desc' }, feature.desc || '')),
    el('button', {
      class: 'icon-btn ext-row-detail',
      title: '详情', 'aria-label': `查看「${feature.name}」详情`,
      onclick: () => openExtDetail(feature.id),
    }, el('span', { class: 'icon', html: icons.info })),
    el('span', { class: 'tag' }, '规划中'));

  return el('div', { class: 'page' },
    // 返回与标题已上移到顶栏；统计信息保留在正文顶部
    el('div', { class: 'page-meta' },
      el('span', { class: 'tag' }, `${installed.length} 已安装 · ${planned.length} 规划中`)),
    el('p', { class: 'dash-greeting' },
      `WorkHub 是扩展式工作台：所有业务功能都是可插拔扩展。当前界面样式「${skin?.name || '默认'}」定义了 ${points.length} 个挂载点，扩展的挂载位置随界面样式切换而变化。`),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h3', {}, '已安装')),
      installed.length ? installed.map(installedRow)
        : el('div', { class: 'empty' }, '当前没有已安装的扩展 — 全部能力均待实现')),
    el('div', { class: 'panel', style: 'margin-top:18px' },
      el('div', { class: 'panel-head' }, el('h3', {}, '规划中（FEATURES）')),
      planned.length ? planned.map(plannedRow) : el('div', { class: 'empty' }, '暂无规划项')));
}, { title: '扩展中心', backLabel: '返回工作台', back: () => leaveSystem() });
