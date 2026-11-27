/* main.js — 应用装配入口
 *
 * 职责：装配基础设施 → 注册主题风格/系统页面/扩展 → 恢复数据 → 启动内核。
 * 新增业务扩展：新建 ext-<id>.js，在此 import（registry.add 自注册）。
 * 新增 UI 主题风格：新建 theme-style-<id>.js，在此 import（registerThemeStyle 自注册）。
 */
import { boot, setPlannedFeatures, setRefreshHandler, applyDefaultInstalledExts } from './core.js';
import { refreshData } from './data-refresh.js';
import { state } from './data.js';
import { initStorage, flush } from './storage.js';
import './identity.js';           // 本地用户身份（单机默认 me，无家庭/组织）
import './db.js';                 // 副作用：向 storage 注册 LocalAdapter
import './ext-todo.js';           // 副作用：注册 任务扩展（首个真实业务扩展）
import './theme-style-classic.js';       // 副作用：注册经典分栏主题风格（默认）
import './theme-style-studio3d.js';      // 副作用：注册 3D 工作室主题风格
import './page-theme-style-detail.js';   // 副作用：注册主题风格详情系统页
import './page-ext-detail.js';    // 副作用：注册通用扩展详情系统页（介绍 / README / 预览）
import './page-settings.js';      // 副作用：注册设置系统页（左侧分类 + 顶部搜索）
import './pages.js';              // 副作用：注册内核系统页面（扩展中心）
import { restoreOutbox, bootstrapPrefs } from './sync.js'; // 同步引擎（骨架 + Supabase CloudAdapter）
import { initCloudSync } from './cloud-sync.js'; // 云端同步引导（无配置则 no-op）
import { maybeRunSetup } from './setup-wizard.js'; // 首次访问初始化向导
import planned from './features.js';
import platform from './platform.js';

setPlannedFeatures(planned);

setRefreshHandler(refreshData);

const DEFAULT_EXTS_URL = new URL('../extensions.json', import.meta.url);

/** 全新工作台按 extensions.json 种子化默认安装；配置缺失或不可读时保持不预装 */
async function applyDefaultInstalls() {
  let ids = [];
  try {
    const res = await fetch(DEFAULT_EXTS_URL, { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (Array.isArray(cfg?.defaultInstalled)) ids = cfg.defaultInstalled;
    }
  } catch { /* 配置不可读：降级为不预装 */ }
  applyDefaultInstalledExts(ids);
}

/* 存储恢复完成后启动 UI；失败也不阻塞启动（降级为空数据） */
initStorage(state).finally(async () => {
  restoreOutbox(); // 恢复上次未推送的变更
  bootstrapPrefs(); // 旧版本存量偏好补种上云；全新设备跳过
  await applyDefaultInstalls(); // 先于 boot：全新工作台按配置初始化安装态
  await maybeRunSetup(); // 未标记 setupDone 时展示分步向导，完成/跳过后继续
  boot();
  // 云端同步非阻塞引导：有配置且会话有效才注入 adapter，否则保持本地优先
  await initCloudSync();
  console.log('%c WorkHub Ready · ' + platform.label,
    'background:#1d1d1f;color:#4ec9b0;padding:4px 10px;border-radius:4px;font-family:monospace;');
});

/* 页面隐藏时强制落盘（兜底，db.js 内也有） */
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
