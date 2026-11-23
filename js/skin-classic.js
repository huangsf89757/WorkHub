/* skin-classic.js — 经典分栏皮肤（内核默认 baseline）
 *
 * 不接管舞台：五区布局即主界面。作为皮肤注册表里的一个选项，
 * 让"UI 样式"与业务扩展一样可枚举、可切换。
 */
import { registerSkin, icons, ZONES } from './core.js';

registerSkin({
  id: 'classic',
  name: '经典分栏',
  icon: icons.dashboard,
  desc: '左侧主菜单 + 中间内容 + 右/底功能面板。默认、信息密度最高的工作台界面样式。',
  layout: 'panels',
  // 经典分栏的挂载点就是五区；扩展中心据此展示，而非写死
  mountPoints: [
    { id: 'left',   name: ZONES.left.label,   desc: '主菜单 · 一级入口', role: 'nav' },
    { id: 'top',    name: ZONES.top.label,    desc: '主菜单 · 一级入口', role: 'nav' },
    { id: 'center', name: ZONES.center.label, desc: '主内容区',          role: 'content' },
    { id: 'right',  name: ZONES.right.label,  desc: '扩展功能菜单',      role: 'panel' },
    { id: 'bottom', name: ZONES.bottom.label, desc: '扩展功能状态条',    role: 'panel' },
    // 左侧栏底部常驻入口：像 stage 实物一样走 skinMounts 配置（不再写死扩展中心）
    { id: 'left-bottom', name: '左侧栏底部', desc: '常驻入口 · 可挂载任意扩展', role: 'nav', via: 'skinMount' },
  ],
  // 无 renderStage：走内核默认五区渲染
});
