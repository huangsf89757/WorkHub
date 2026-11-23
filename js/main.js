/* main.js — 应用装配入口
 *
 * 职责：装配基础设施 → 注册皮肤/系统页面/扩展 → 恢复数据 → 启动内核。
 * 新增业务扩展：新建 ext-<id>.js，在此 import（registry.add 自注册）。
 * 新增 UI 皮肤：新建 skin-<id>.js，在此 import（registerSkin 自注册）。
 */
import { boot, setDefaultStatus, setPlannedFeatures } from './core.js';
import { state, alive } from './data.js';
import { initStorage, flush } from './storage.js';
import './identity.js';           // 副作用：用户/家庭身份上下文（单机默认 me/home）
import './db.js';                 // 副作用：向 storage 注册 LocalAdapter
import './ext-todo.js';           // 副作用：注册 TODO 扩展（首个真实业务扩展）
import './skin-classic.js';       // 副作用：注册经典分栏皮肤（默认）
import './skin-studio3d.js';      // 副作用：注册 3D 工作室皮肤
import './page-skin-detail.js';   // 副作用：注册界面样式详情系统页
import './page-ext-detail.js';    // 副作用：注册通用扩展详情系统页（介绍 / README / 预览）
import './page-settings.js';      // 副作用：注册设置系统页（左侧分类 + 顶部搜索）
import './pages.js';              // 副作用：注册内核系统页面（扩展中心）
import { restoreOutbox } from './sync.js'; // 同步引擎（v1 骨架）
import planned from './features.js';
import platform from './platform.js';

setPlannedFeatures(planned);

setDefaultStatus(() => {
  const projects = alive('projects').filter(p => p.isActive).length;
  const pending = alive('tasks').filter(t => !t.done).length
    + alive('todos').filter(t => !t.done).length;
  return `${projects} 项目 · ${pending} 待办 · ${platform.label}`;
});

/* 存储恢复完成后启动 UI；失败也不阻塞启动（降级为空数据） */
initStorage(state).finally(() => {
  restoreOutbox(); // 恢复上次未推送的变更
  boot();
  console.log('%c WorkHub Ready · ' + platform.label,
    'background:#1d1d1f;color:#4ec9b0;padding:4px 10px;border-radius:4px;font-family:monospace;');
});

/* 页面隐藏时强制落盘（兜底，db.js 内也有） */
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
