/* theme-style-classic.js — 经典分栏主题风格（内核默认 baseline）
 *
 * 不接管舞台：五区布局即主界面。作为主题风格注册表里的一个选项，
 * 让"UI 样式"与业务扩展一样可枚举、可切换。
 */
import { registerThemeStyle, icons, ZONES } from './core.js';

registerThemeStyle({
  id: 'classic',
  name: '经典分栏',
  icon: icons.dashboard,
  desc: '左侧主菜单 + 中间内容 + 右/底功能面板。默认、信息密度最高的工作台主题风格。',
  layout: 'panels',
  // 经典分栏的挂载点就是五区；扩展中心据此展示，而非写死
  mountPoints: [
    { id: 'left',   name: ZONES.left.label,   desc: '主菜单 · 一级入口', role: 'nav', slots: ['top', 'mid', 'bottom'] },
    { id: 'top',    name: ZONES.top.label,    desc: '主菜单 · 一级入口', role: 'nav', slots: ['left', 'mid', 'right'] },
    { id: 'right',  name: ZONES.right.label,  desc: '扩展入口（详情在中间区）', role: 'entry', slots: ['top', 'mid', 'bottom'] },
    { id: 'bottom', name: ZONES.bottom.label, desc: '扩展入口（详情在中间区）', role: 'entry', slots: ['left', 'mid', 'right'] },
  ],
  // 空配置兜底：仅在用户未配置该槽位时生效，保证首启可进入扩展中心
  slotDefaults: { 'left:top': 'ext-center' },
  // 无 renderStage：走内核默认五区渲染
});
