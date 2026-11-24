/* page-settings.js — 设置系统页（左侧分栏 + 栏内搜索 + VSCode 式源码）
 *
 * 结构：标题 → 左侧（搜索框 + 分类导航）/ 右侧（界面视图 或 源码视图）。
 * 分类：账户 / 通用（含快捷键、界面样式、主题风格）/ 关于。
 * 搜索：由 settings.search.json 的 aliases 驱动，命中设置键对应的分类。
 * 源码：settings.json 为默认模板，localStorage 为生效值；两个视图双向同步。
 * 数据全部取自现有契约（core / sync / platform / version.json），偏好键不混入业务数据。
 */
import {
  el, icons, router, bus, store, registerSystemPage, toast, leaveSystem,
  themeNames, applyTheme, input,
  getAllSkins, getActiveSkin, setActiveSkin,
  openPopMenu, openModal, fmtTime,
  SHORTCUT_ACTIONS, getShortcuts, setShortcut, resetShortcuts,
  comboFromEvent, formatShortcut,
} from './core.js';
import { openSkinDetail } from './page-skin-detail.js';
import { syncSnapshot } from './sync.js';
import { downloadBackup, downloadDatabaseFile, readBackupFile, applyBackup, getLastBackupAt } from './backup.js';
import platform, { PLATFORM_LABEL } from './platform.js';
import { getCloudConfig, setCloudConfig, clearCloudConfig, isValidCloudUrl, CLOUD_PREFILL } from './cloud-config.js';
import { signUp, signIn, signOut, cloudAuthSnapshot, isSignedIn } from './cloud-auth.js';
import { refreshCloudSync, syncNowCloud, cloudSyncActive } from './cloud-sync.js';

/* ---------- 版本信息（version.json 异步读取，失败降级） ---------- */
let VERSION = { name: 'WorkHub', version: '—', builtAt: '—' };
fetch(new URL('../version.json', import.meta.url))
  .then(r => r.ok ? r.json() : null)
  .then(d => { if (d?.version) VERSION = d; })
  .catch(() => {});

/* ---------- VSCode 式设置：源码模板 + 搜索规则（异步加载，失败降级） ---------- */
const SETTINGS_URL = new URL('../settings.json', import.meta.url);
const SEARCH_URL = new URL('../settings.search.json', import.meta.url);
let SETTINGS_DEFAULT = { theme: 'dark', skin: 'classic', shortcuts: {} };
let SEARCH_RULES = null;         // 当前生效的搜索规则（可应用内编辑覆盖）
let SEARCH_RULES_DEFAULT = null; // 文件默认，供「载入默认」恢复
const loadDefaults = () => {
  fetch(SETTINGS_URL, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d && typeof d === 'object' && !Array.isArray(d)) SETTINGS_DEFAULT = d; })
    .catch(() => {});
  fetch(SEARCH_URL, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return;
      SEARCH_RULES_DEFAULT = d;
      // 用户编辑过的规则存 localStorage，优先于文件默认
      const saved = store.get('searchRules', null);
      SEARCH_RULES = (saved && typeof saved === 'object' && !Array.isArray(saved)) ? saved : d;
    })
    .catch(() => {});
};
loadDefaults();

/* ---------- 视图状态（模块内；搜索词/分类/视图模式跨重绘保留） ---------- */
let activeCat = 'general';
let query = '';
let viewMode = 'visual';   // 'visual' | 'source'
let sourceFile = 'settings'; // 'settings' | 'search' —— 源码视图当前编辑哪份文件
let sourceText = '';       // 源码编辑器内容
let sourceError = '';      // 源码校验/保存错误提示

/* ---------- 元数据 ---------- */
const CATS = [
  { id: 'account', name: '账户', icon: icons.user, desc: '身份、设备与数据同步' },
  { id: 'general', name: '通用', icon: icons.settings, desc: '启动行为、快捷键、界面样式与主题' },
  { id: 'data', name: '数据与备份', icon: icons.inbox, desc: '导出备份、导入恢复，防止清理浏览器数据后丢失' },
  { id: 'about', name: '关于', icon: icons.info, desc: '版本信息与文档' },
];
const catOf = id => CATS.find(c => c.id === id) || CATS[0];

const infoRow = (key, value, mono) => el('div', { class: 'insp-row' },
  el('span', { class: 'insp-key' }, key),
  el('span', { class: 'insp-val' + (mono ? ' mono' : '') }, String(value)));

/** 统一的设置卡片容器 */
const card = (title, ...body) => el('section', { class: 'panel setg-card' },
  el('div', { class: 'panel-head' }, el('h3', {}, title)),
  el('div', { class: 'settings-body' }, ...body));

/** 带设置键的卡片：键对应 settings.search.json 的规则 key，用于搜索命中高亮 */
const cardFor = (key, title, ...body) => {
  const node = card(title, ...body);
  node.dataset.settingKey = key;
  return node;
};

/* ============================================================
   设置序列化 / 应用（源码视图 ↔ 可视化双向同步的核心）
   ============================================================ */
/** 当前生效设置 → settings.json 文本（镜像当前 localStorage 与 body 状态） */
function serializeSettings() {
  const obj = {
    theme: document.body.dataset.theme || SETTINGS_DEFAULT.theme || 'dark',
    skin: getActiveSkin()?.id || SETTINGS_DEFAULT.skin || 'classic',
    shortcuts: getShortcuts(),
  };
  return JSON.stringify(obj, null, 2);
}

/** settings.json 默认模板文本（载入默认用；不立即生效，需保存） */
function defaultSettingsText() {
  return JSON.stringify(SETTINGS_DEFAULT, null, 2);
}

/** combo 槽位展开：range 类（1-9）展开为 9 个键；meta/ctrl 归一为 mod */
function slotsOf(combo) {
  const parts = String(combo).split('+').map(p => (p === 'meta' || p === 'ctrl') ? 'mod' : p);
  const key = parts.pop();
  return key === '1-9'
    ? Array.from({ length: 9 }, (_, i) => [...parts, String(i + 1)].join('+'))
    : [[...parts, key].join('+')];
}

/** 校验并应用一份设置对象；只应用出现的键，未出现的键保持当前值。返回 {ok, error} */
function applySettingsObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    return { ok: false, error: '设置必须是一个 JSON 对象' };

  if ('theme' in obj) {
    if (typeof obj.theme !== 'string' || !themeNames[obj.theme])
      return { ok: false, error: `未知主题：${String(obj.theme)}（可选 ${Object.keys(themeNames).join(' / ')}）` };
  }
  if ('skin' in obj) {
    if (typeof obj.skin !== 'string' || !getAllSkins().some(s => s.id === obj.skin))
      return { ok: false, error: `未知界面样式：${String(obj.skin)}（可选 ${getAllSkins().map(s => s.id).join(' / ')}）` };
  }
  if ('shortcuts' in obj) {
    const sc = obj.shortcuts;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc))
      return { ok: false, error: 'shortcuts 必须是一个对象' };
    for (const a of SHORTCUT_ACTIONS) {
      if (typeof sc[a.id] !== 'string' || !sc[a.id].trim())
        return { ok: false, error: `快捷键 ${a.id} 的值无效（应形如 "mod+,"）` };
    }
    const seen = new Map();
    for (const a of SHORTCUT_ACTIONS) {
      for (const slot of slotsOf(sc[a.id])) {
        if (seen.has(slot))
          return { ok: false, error: `快捷键冲突：${seen.get(slot)} 与「${a.label}」都占用 ${slot}` };
        seen.set(slot, a.label);
      }
    }
  }

  // 全部校验通过后再写，避免中途失败造成半应用状态
  if ('theme' in obj) applyTheme(obj.theme);
  if ('skin' in obj) setActiveSkin(obj.skin);
  if ('shortcuts' in obj) {
    const normalized = Object.fromEntries(SHORTCUT_ACTIONS.map(a => [a.id, String(obj.shortcuts[a.id]).trim()]));
    store.set('shortcuts', normalized);
    bus.emit('shortcuts');
  }
  return { ok: true };
}

/* ---------- 搜索规则 settings.search.json：序列化 / 校验 / 应用 ---------- */
/** 当前搜索规则 → JSON 文本 */
function serializeSearchRules() {
  return JSON.stringify(SEARCH_RULES || SEARCH_RULES_DEFAULT || {}, null, 2);
}

/** 校验并应用搜索规则；持久化到 wh_searchRules，让用户编辑覆盖文件默认。返回 {ok, error} */
function applySearchRules(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    return { ok: false, error: '搜索规则必须是一个 JSON 对象' };
  for (const [key, rule] of Object.entries(obj)) {
    if (key.startsWith('$')) continue; // $schema / $comment 元字段
    if (!rule || typeof rule !== 'object' || Array.isArray(rule))
      return { ok: false, error: `规则「${key}」必须是对象` };
    if (!Array.isArray(rule.aliases) || !rule.aliases.every(a => typeof a === 'string'))
      return { ok: false, error: `规则「${key}」的 aliases 必须是字符串数组` };
    if (!CATS.some(c => c.id === rule.category))
      return { ok: false, error: `规则「${key}」的 category 无效（可用 ${CATS.map(c => c.id).join(' / ')}）` };
  }
  SEARCH_RULES = obj;
  store.set('searchRules', obj);
  return { ok: true };
}

/* ============================================================
   各分类的渲染（每项都是纯函数，读实时状态）
   ============================================================ */
/* ---------- 数据与备份 ---------- */
const DOMAIN_LABEL = { todos: '待办', todoGroups: '待办分组' };
const countText = counts => Object.entries(counts).filter(([, n]) => n)
  .map(([k, n]) => `${DOMAIN_LABEL[k] || k} ${n}`).join('、') || '无数据';
function dataView() {
  const last = getLastBackupAt();
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const { obj, checked } = await readBackupFile(file);
      confirmImport(obj, checked);
    } catch (error) { toast('导入失败：' + error.message); }
  });
  return [
    cardFor('data', '导出备份',
      el('p', { class: 'hint' }, '浏览器存储可能被清理或损坏。定期导出备份文件，是数据唯一可靠的第二份副本。'),
      infoRow('上次备份', last ? fmtTime(last) : '从未备份'),
      el('div', { class: 'btn-line' },
        el('button', {
          class: 'btn primary',
          onclick: () => {
            const { name, counts } = downloadBackup();
            toast(`已导出 ${name}（${countText(counts)}）`);
            bus.emit('route');
          },
        }, '导出备份文件'),
        el('button', {
          class: 'btn',
          title: '原始 SQLite 文件，可用 DB Browser for SQLite 或 sqlite3 打开；只能在此设备上用，不能用「导入恢复」导入',
          onclick: () => {
            const result = downloadDatabaseFile();
            toast(result ? `已导出 ${result.name}（${Math.round(result.size / 1024)} KB）` : '数据库尚未就绪，无法导出');
          },
        }, '导出数据库文件 (.sqlite)'))),
    cardFor('data', '导入恢复',
      el('p', { class: 'hint' }, '合并：与现有数据按最后修改时间合并，不会丢失较新的修改。替换：以备份为准，备份中没有的本地记录会被删除。'),
      el('div', { class: 'btn-line' },
        el('button', { class: 'btn', onclick: () => fileInput.click() }, '选择备份文件…')),
      fileInput),
  ];
}
function confirmImport(obj, checked) {
  let mode = 'merge';
  const counts = Object.fromEntries(Object.entries(checked.domains).map(([k, v]) => [k, v.length]));
  const radio = (value, label) => el('label', { class: 'check-row' },
    el('input', { type: 'radio', name: 'import-mode', value, checked: value === mode, onchange: () => { mode = value; } }),
    ' ' + label);
  const body = el('div', { class: 'settings-body' },
    infoRow('备份时间', fmtTime(obj.exportedAt)),
    infoRow('包含数据', countText(counts)),
    ...(checked.skipped.length ? [infoRow('将跳过', checked.skipped.join('、') + '（对应扩展未安装）')] : []),
    radio('merge', '合并（推荐）'),
    radio('replace', '替换（会删除备份中没有的本地记录）'));
  openModal('导入备份', body, [
    { label: '取消' },
    {
      label: '导入', primary: true,
      onClick: close => {
        try {
          const { report } = applyBackup(obj, { mode });
          const sum = Object.values(report).reduce((a, r) => a + r.added + r.updated + r.removed, 0);
          toast(`导入完成：${sum} 条变更`);
          close();
          bus.emit('route');
        } catch (error) { toast('导入失败：' + error.message); }
      },
    },
  ]);
}
/** 云端同步（Supabase）：配置 / 注册 / 登录 / 立即同步 */
function cloudSyncView() {
  const cfg = getCloudConfig();
  const auth = cloudAuthSnapshot();
  const active = cloudSyncActive();
  const s = syncSnapshot();

  const urlInput = input({ type: 'url', placeholder: 'https://your-project.supabase.co', value: cfg.url || CLOUD_PREFILL.url, spellcheck: 'false' });
  const keyInput = input({ type: 'text', placeholder: 'anon / publishable key', value: cfg.anonKey || CLOUD_PREFILL.anonKey, spellcheck: 'false' });
  const emailInput = input({ type: 'email', placeholder: '邮箱', autocomplete: 'email' });
  const passInput = input({ type: 'password', placeholder: '密码（至少 6 位）', autocomplete: 'new-password' });

  const redraw = () => bus.emit('route');
  const status = active ? '已连接 · 自动同步中'
    : (cfg.configured ? '已配置 · 未登录' : '未配置（本地优先）');

  const saveConfig = async () => {
    const url = urlInput.value.trim();
    if (!isValidCloudUrl(url)) { toast('Project URL 需为 https 地址'); return; }
    if (!keyInput.value.trim()) { toast('请填写 anon key'); return; }
    setCloudConfig(url, keyInput.value);
    await refreshCloudSync();
    toast('云端配置已保存');
    redraw();
  };

  const doSignUp = async () => {
    const email = emailInput.value.trim(), password = passInput.value;
    if (!email || password.length < 6) { toast('请填写邮箱与至少 6 位密码'); return; }
    try {
      const r = await signUp(email, password);
      if (r?.pendingConfirmation) toast('注册成功，请查收确认邮件后再登录');
      else { await refreshCloudSync(); toast('注册并登录成功'); }
      redraw();
    } catch (e) { toast(e.message); }
  };

  const doSignIn = async () => {
    const email = emailInput.value.trim(), password = passInput.value;
    if (!email || !password) { toast('请填写邮箱与密码'); return; }
    try {
      await signIn(email, password);
      await refreshCloudSync();
      toast('登录成功，云端同步已启用');
      redraw();
    } catch (e) { toast(e.message); }
  };

  const doSignOut = async () => {
    await signOut();
    await refreshCloudSync();
    toast('已登出，回到本地模式');
    redraw();
  };

  const doSyncNow = async () => {
    try {
      const r = await syncNowCloud();
      toast(r ? `同步完成：上行 ${r.pushed} · 下行 ${Object.keys(r.pulled || {}).length} 域` : '云端未启用');
    } catch (e) { toast(e.message); }
  };

  const doClear = () => {
    clearCloudConfig();
    refreshCloudSync();
    toast('已清除云端配置');
    redraw();
  };

  const btn = (label, onClick, cls = '') => el('button', { class: 'btn ' + cls, onclick: onClick }, label);

  return cardFor('account', '云端同步（Supabase）',
    infoRow('状态', status),
    infoRow('待推送变更', s.pending),
    el('p', { class: 'hint' }, '本地优先不变：所有写入先落本机，联网登录后后台自动按 LWW 合并。'),
    el('div', { class: 'setg-field' }, el('label', {}, 'Project URL'), urlInput),
    el('div', { class: 'setg-field' }, el('label', {}, 'anon / publishable key'), keyInput),
    el('div', { class: 'setg-actions' },
      btn('保存配置', saveConfig, 'primary'),
      cfg.configured ? btn('清除配置', doClear) : null),
    auth.signedIn
      ? el('div', { class: 'setg-field' },
          el('p', { class: 'hint' }, `已登录：${auth.email || auth.userId}`),
          el('div', { class: 'setg-actions' },
            btn('立即同步', doSyncNow, 'primary'),
            btn('登出', doSignOut)))
      : el('div', {},
          el('div', { class: 'setg-field' }, el('label', {}, '邮箱'), emailInput),
          el('div', { class: 'setg-field' }, el('label', {}, '密码'), passInput),
          el('div', { class: 'setg-actions' },
            btn('注册', doSignUp),
            btn('登录', doSignIn, 'primary'))),
    el('p', { class: 'hint' }, '首次使用需先在 Supabase 建项目并执行 supabase/migrations/0001_sync_schema.sql，详见 docs/supabase-setup.md。'));
}

function accountView() {
  const s = syncSnapshot();
  return [
    cardFor('account', '个人身份',
      el('div', { class: 'setg-profile' },
        el('div', { class: 'user-avatar' }, 'HSF'),
        el('div', {},
          el('div', { class: 'user-name' }, '本地用户'),
          el('div', { class: 'user-sub' }, 'HSF · 本地优先工作区'))),
      el('p', { class: 'hint' }, 'WorkHub 为本地优先应用，账户数据仅存于本机，无需登录。')),
    cardFor('account', '设备与同步',
      infoRow('设备 ID', s.deviceId, true),
      infoRow('运行环境', PLATFORM_LABEL[platform.platform] || platform.platform),
      infoRow('网络', s.online ? '在线' : '离线'),
      infoRow('同步引擎', s.enabled ? '已接入云端同步' : '未启用（本地优先）'),
      infoRow('待推送变更', s.pending),
      infoRow('本地存储', s.storage?.adapter || 'local-sqlite-idb'),
      el('p', { class: 'hint' }, '本地优先：变更先落本地，联网后由同步引擎按 LWW 策略在多端合并。')),
    cloudSyncView(),
  ];
}

function generalView() {
  return [
    shortcutView(),
    ...skinView(),
    ...themeView(),
  ];
}

/* ---------- 快捷键（可录制自定义，真正生效） ---------- */
let recordingId = null; // 正在录制的动作 id，跨重绘保留
let recordingCleanup = null;

function shortcutView() {
  const sc = getShortcuts();
  const rows = SHORTCUT_ACTIONS.map(action => {
    const combo = sc[action.id];
    const recording = recordingId === action.id;
    const keyBtn = el('button', {
      class: 'hk-key' + (recording ? ' recording' : ''),
      'data-recording': recording ? '1' : null,
      'aria-label': recording
        ? `正在录制「${action.label}」快捷键，按 Esc 取消`
        : `修改「${action.label}」快捷键，当前 ${formatShortcut(combo)}`,
      onclick: () => startRecording(action.id),
    }, recording ? '按下快捷键…' : formatShortcut(combo));
    return el('div', { class: 'hk-row' },
      el('span', { class: 'hk-name' }, action.label),
      el('span', { class: 'hk-combo' }, keyBtn),
      el('button', {
        class: 'icon-btn hk-edit', title: '修改快捷键', 'aria-label': `修改「${action.label}」快捷键`,
        onclick: () => startRecording(action.id),
      }, el('span', { class: 'icon', html: icons.edit })));
  });

  const resetBtn = el('button', {
    class: 'btn hk-reset',
    onclick: () => { resetShortcuts(); toast('快捷键已恢复默认'); bus.emit('route'); },
  }, el('span', { class: 'icon', html: icons.back }), '恢复默认');

  return cardFor('shortcuts', '快捷键',
    el('div', { class: 'hk-list' }, ...rows),
    el('div', { class: 'hk-foot' },
      el('p', { class: 'hint' }, '点击按键修改；按 Esc 取消录制。输入时切换类快捷键自动让位。'),
      resetBtn));
}

function stopRecording() {
  if (recordingCleanup) { recordingCleanup(); recordingCleanup = null; }
  recordingId = null;
}

function startRecording(id) {
  stopRecording();
  recordingId = id;
  const onKey = event => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { stopRecording(); bus.emit('route'); return; }
    const combo = comboFromEvent(event);
    if (!combo) return; // 纯修饰键，继续等待
    stopRecording();
    const result = setShortcut(id, combo);
    if (!result.ok) toast(result.error);
    else toast(`已设置：${formatShortcut(combo)}`);
    bus.emit('route');
  };
  // capture 阶段拦截，避免触发全局快捷键与页面默认行为
  document.addEventListener('keydown', onKey, true);
  recordingCleanup = () => document.removeEventListener('keydown', onKey, true);
  bus.emit('route'); // 重绘进入录制态
}

function skinView() {
  const activeSkin = getActiveSkin();
  const skinCards = el('div', { class: 'skin-cards' },
    getAllSkins().map(skin => {
      const activate = () => {
        setActiveSkin(skin.id);
        router.go('settings');
        toast(`已切换：${skin.name}`);
      };
      const more = el('button', {
        class: 'skin-card-more', title: skin.name + ' 更多', 'aria-label': skin.name + ' 更多操作',
        onclick: event => {
          event.stopPropagation();
          openPopMenu(event.currentTarget, [
            { label: '查看详情', onClick: () => openSkinDetail(skin.id) },
            // 已是当前样式时不再提供「设为当前样式」，避免冗余操作
            ...(activeSkin?.id === skin.id ? [] : [{ label: '设为当前界面样式', onClick: activate }]),
          ]);
        },
      }, el('span', { class: 'icon', html: icons.more }));
      return el('div', {
        class: 'skin-card' + (activeSkin?.id === skin.id ? ' active' : ''),
        role: 'button', tabindex: '0', 'aria-label': `界面样式：${skin.name}`,
        onclick: activate,
        onkeydown: event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
        },
      },
        el('span', { class: 'icon', html: skin.icon }),
        el('span', { class: 'skin-card-name' }, skin.name),
        el('span', { class: 'skin-card-desc' }, skin.desc || ''),
        more);
    }));
  return [
    cardFor('skin', '界面样式',
      skinCards,
      activeSkin?.settingsPanel ? activeSkin.settingsPanel() : null,
      el('p', { class: 'hint' }, '点击卡片切换界面样式；卡片右上角「⋯」可查看详情与挂载点配置。')),
  ];
}

function themeView() {
  const themeButtons = el('div', { class: 'btn-line', role: 'group', 'aria-label': '主题' },
    Object.entries(themeNames).map(([id, name]) => {
      const active = document.body.dataset.theme === id;
      return el('button', {
        class: 'btn' + (active ? ' primary' : ''),
        'aria-pressed': String(active),
        onclick: () => { applyTheme(id); router.go('settings'); },
      }, name);
    }));
  return [
    cardFor('theme', '主题风格', themeButtons,
      el('p', { class: 'hint' }, '主题即时生效并持久化；跟随系统「减少动态效果」偏好自动关闭动画。')),
  ];
}

function aboutView() {
  const updateBtn = el('button', {
    class: 'btn',
    onclick: async () => {
      updateBtn.disabled = true;
      updateBtn.textContent = '检测中…';
      try {
        const r = await fetch(new URL('../version.json', import.meta.url), { cache: 'no-store' });
        const d = await r.json();
        toast(d?.version === VERSION.version
          ? `已是最新版本 ${VERSION.version}`
          : `版本清单：${d?.version || '未知'}（当前 ${VERSION.version}）`);
      } catch {
        toast('无法读取版本清单，当前为本地版本');
      } finally {
        updateBtn.disabled = false;
        updateBtn.textContent = '检测更新';
      }
    },
  }, el('span', { class: 'icon', html: icons.download }), '检测更新');
  const docs = [
    { label: '项目说明', href: 'docs/README.md' },
    { label: '架构设计', href: 'docs/architecture.md' },
    { label: '扩展清单', href: 'FEATURES.md' },
    { label: '路线图', href: 'ROADMAP.md' },
  ];
  return [
    cardFor('about', '基本信息',
      infoRow('应用名称', VERSION.name),
      infoRow('版本', VERSION.version, true),
      infoRow('构建时间', VERSION.builtAt, true),
      infoRow('运行环境', PLATFORM_LABEL[platform.platform] || platform.platform),
      infoRow('架构', '零构建 · 原生 ES Modules · 五区布局'),
      infoRow('数据策略', '本地优先 · 可插拔同步')),
    cardFor('about', '检测更新',
      el('div', { class: 'setg-update' },
        el('span', { class: 'tag' }, `当前 v${VERSION.version}`), updateBtn),
      el('p', { class: 'hint' }, '版本清单随应用分发；本地无服务端更新通道，检测仅比对分发版本号。')),
    cardFor('about', '文档与资源',
      el('div', { class: 'btn-line' }, docs.map(d =>
        el('a', { class: 'btn', href: d.href, target: '_blank', rel: 'noopener' },
          el('span', { class: 'icon', html: icons.file }), d.label)))),
  ];
}

const VIEWS = {
  account: { render: accountView },
  general: { render: generalView },
  data: { render: dataView },
  about: { render: aboutView },
};

/* ---------- 搜索匹配（由 settings.search.json 的 aliases 驱动） ---------- */
function matchCat(cat, q) {
  if (!q) return true;
  // 分类名 / 描述直接命中（兜底：配置未加载时仍可搜「通用」「账户」「关于」）
  if (`${cat.name} ${cat.desc}`.toLowerCase().includes(q)) return true;
  if (!SEARCH_RULES) return false;
  // 设置键的 aliases 命中后，高亮其 category
  return Object.entries(SEARCH_RULES).some(([key, rule]) => {
    if (key.startsWith('$') || !rule || typeof rule !== 'object') return false;
    if (rule.category !== cat.id) return false;
    return (rule.aliases || []).some(a => String(a).toLowerCase().includes(q));
  });
}
/**
 * 计算搜索命中的具体设置键（用于高亮对应卡片）。
 * 返回 Set：aliases 命中 query 的规则 key；分类名/描述直接命中时，命中该分类下的所有键。
 */
function matchedKeys(q) {
  const hit = new Set();
  if (!q || !SEARCH_RULES) return hit;
  // 优先：aliases 精确命中具体设置键（如「主题」→ theme）
  for (const [key, rule] of Object.entries(SEARCH_RULES)) {
    if (key.startsWith('$') || !rule || typeof rule !== 'object') continue;
    if ((rule.aliases || []).some(a => String(a).toLowerCase().includes(q))) hit.add(key);
  }
  if (hit.size) return hit;
  // 兜底：仅当无精确命中时，分类名/描述命中（如直接搜「通用」）→ 整类高亮
  for (const cat of CATS) {
    if (!`${cat.name} ${cat.desc}`.toLowerCase().includes(q)) continue;
    for (const [key, rule] of Object.entries(SEARCH_RULES)) {
      if (key.startsWith('$') || !rule || typeof rule !== 'object') continue;
      if (rule.category === cat.id) hit.add(key);
    }
  }
  return hit;
}

/** 搜索命中分类时返回该分类，否则空数组（整类匹配，避免只显示半项内容） */
function visibleCats() {
  const q = query.trim().toLowerCase();
  return CATS.filter(c => matchCat(c, q));
}

/* ============================================================
   源码视图（VSCode 式 settings.json 编辑器）
   ============================================================ */
function viewToggle() {
  const mk = (mode, label, icon) => el('button', {
    class: 'seg-btn' + (viewMode === mode ? ' active' : ''),
    'aria-pressed': String(viewMode === mode),
    onclick: () => {
      if (viewMode === mode) return;
      // 进入源码视图时按当前文件重新序列化，保证两个视图同步
      if (mode === 'source') sourceText = sourceFile === 'search' ? serializeSearchRules() : serializeSettings();
      if (mode === 'visual') sourceError = '';
      viewMode = mode;
      bus.emit('route');
    },
  }, el('span', { class: 'icon', html: icon }), label);
  return el('div', { class: 'seg', role: 'group', 'aria-label': '设置视图' },
    mk('visual', '界面', icons.settings),
    mk('source', '源码', icons.braces));
}

const SOURCE_FILES = [
  { id: 'settings', name: 'settings.json', desc: '偏好设置', serialize: () => serializeSettings(), def: () => defaultSettingsText(), apply: applySettingsObject },
  { id: 'search', name: 'settings.search.json', desc: '搜索规则', serialize: () => serializeSearchRules(), def: () => JSON.stringify(SEARCH_RULES_DEFAULT || {}, null, 2), apply: applySearchRules },
];
const sourceFileOf = () => SOURCE_FILES.find(f => f.id === sourceFile) || SOURCE_FILES[0];

function sourceView() {
  const file = sourceFileOf();
  // 注意：输入时只更新变量、不重绘，否则 textarea 会重建导致焦点/光标丢失
  const editor = el('textarea', {
    class: 'setg-source-editor',
    spellcheck: 'false',
    'aria-label': file.name + ' 源码',
  });
  editor.value = sourceText;
  editor.addEventListener('input', () => { sourceText = editor.value; });

  const resetBtn = el('button', {
    class: 'btn',
    onclick: () => {
      sourceText = file.def();
      sourceError = '';
      bus.emit('route');
      toast('已载入文件默认配置，点击「保存」生效');
    },
  }, el('span', { class: 'icon', html: icons.back }), '载入默认');

  const copyBtn = el('button', {
    class: 'btn',
    onclick: async () => {
      try { await navigator.clipboard.writeText(sourceText); toast(`已复制 ${file.name}`); }
      catch { toast('复制失败，请手动选择文本'); }
    },
  }, el('span', { class: 'icon', html: icons.copy }), '复制');

  const saveBtn = el('button', {
    class: 'btn primary',
    onclick: () => {
      let obj;
      try { obj = JSON.parse(sourceText); }
      catch (e) { sourceError = `JSON 语法错误：${e.message}`; bus.emit('route'); return; }
      const res = file.apply(obj);
      if (!res.ok) { sourceError = res.error; bus.emit('route'); return; }
      sourceError = '';
      sourceText = file.serialize(); // 保存后回写规范化文本
      toast(`${file.name} 已保存并生效`);
      bus.emit('route');
    },
  }, el('span', { class: 'icon', html: icons.check }), '保存');

  // 文件切换：settings.json / settings.search.json
  const fileTabs = el('div', { class: 'setg-source-files', role: 'tablist', 'aria-label': '配置文件' },
    ...SOURCE_FILES.map(f => el('button', {
      class: 'setg-source-filetab' + (sourceFile === f.id ? ' active' : ''),
      role: 'tab', 'aria-selected': String(sourceFile === f.id),
      title: f.desc,
      onclick: () => {
        if (sourceFile === f.id) return;
        sourceFile = f.id;
        sourceText = f.serialize();
        sourceError = '';
        bus.emit('route');
      },
    }, f.name)));

  return el('div', { class: 'setg-source' },
    el('div', { class: 'setg-source-bar' },
      el('div', { class: 'setg-source-file' },
        el('span', { class: 'icon', html: icons.braces }),
        el('span', {}, file.name),
        el('span', { class: 'tag' }, file.desc)),
      el('div', { class: 'setg-source-actions' }, resetBtn, copyBtn, saveBtn)),
    fileTabs,
    editor,
    sourceError ? el('div', { class: 'setg-source-error', role: 'alert' }, sourceError) : null,
    el('p', { class: 'hint' }, sourceFile === 'search'
      ? '搜索规则与 settings.json 的键对应：aliases 为匹配词（如 theme / style / 风格 / 主题），category 为命中后高亮的分类。保存后立即生效并覆盖文件默认。'
      : '与界面双向同步：此处保存后立即生效；界面修改在切回源码时同步。修改保存在本地（localStorage），settings.json 为默认模板。'));
}

/* ============================================================
   页面注册
   ============================================================ */
registerSystemPage('settings', () => {
  // 分类导航项（独立构建，供局部刷新复用）
  const navItems = (cats, current) => cats.map(cat => el('button', {
    class: 'setg-nav-item' + (current === cat.id ? ' active' : ''),
    'aria-current': current === cat.id ? 'page' : null,
    onclick: () => { activeCat = cat.id; viewMode = 'visual'; bus.emit('route'); },
  },
    el('span', { class: 'icon', html: cat.icon }),
    el('span', { class: 'setg-nav-name' }, cat.name)));

  // 右侧内容（独立构建，供局部刷新复用）
  const buildContent = (q, cats, current) => {
    const cat = catOf(current);
    // 搜索命中：给命中的设置卡片加高亮，其余卡片降低强调（仍可交互）
    const hits = matchedKeys(q);
    const cards = VIEWS[current].render().map(node => {
      if (!node?.dataset || !node.classList?.contains('setg-card')) return node;
      const key = node.dataset.settingKey;
      const isHit = q && key && hits.has(key);
      if (isHit) node.classList.add('setg-hit');
      else if (q) node.classList.add('setg-dim');
      if (isHit && !node.querySelector('.setg-hit-flag')) {
        node.querySelector('.panel-head')?.append(
          el('span', { class: 'setg-hit-flag' }, '匹配'));
      }
      return node;
    });
    return el('div', { class: 'setg-content' },
      el('div', { class: 'setg-content-head' },
        el('div', {},
          el('h2', {}, viewMode === 'source' ? '设置源码' : cat.name),
          el('span', { class: 'setg-content-desc' },
            viewMode === 'source' ? `${sourceFileOf().name} · 与界面双向同步`
              : (q && hits.size ? `已高亮 ${hits.size} 项匹配设置` : cat.desc))),
        viewToggle()),
      viewMode === 'source'
        ? sourceView()
        : (q && !cats.length
            ? el('div', { class: 'empty big' }, `没有找到与「${query}」相关的设置`)
            : cards));
  };
  const resolve = () => {
    const q = query.trim().toLowerCase();
    const cats = visibleCats();
    const current = cats.some(c => c.id === activeCat) ? activeCat : (cats[0]?.id || 'general');
    return { q, cats, current };
  };

  const { q, cats, current } = resolve();

  const searchInput = el('input', {
    type: 'search', class: 'input setg-search',
    placeholder: '搜索设置（如：主题、theme、界面样式、快捷键）',
    'aria-label': '搜索设置',
    value: query,
  });
  const clearBtn = el('button', {
    class: 'setg-clear', title: '清除搜索', 'aria-label': '清除搜索',
    hidden: !query,
    onclick: () => {
      query = '';
      searchInput.value = '';
      clearBtn.hidden = true;
      searchInput.focus();
      refresh();
    },
  }, '×');

  const navHost = el('div', { class: 'setg-nav-host' }, ...navItems(cats, current));
  const contentHost = el('div', { class: 'setg-content-host' }, buildContent(q, cats, current));

  /**
   * 局部刷新：只重建分类列表与内容区，搜索框 DOM 保持不变。
   * 关键：输入一个字符时不能走 bus.emit('route') 全量重绘，否则搜索框被替换 → 焦点丢失、中文输入法组合被打断。
   */
  function refresh() {
    const r = resolve();
    clearBtn.hidden = !query;
    navHost.replaceChildren(...navItems(r.cats, r.current));
    contentHost.replaceChildren(buildContent(r.q, r.cats, r.current));
  }

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    viewMode = 'visual'; // 搜索即回到可视化结果
    refresh();           // 局部刷新，保住焦点与 IME
  });

  const sidebar = el('nav', { class: 'setg-side', 'aria-label': '设置分类' },
    el('div', { class: 'setg-search-wrap' }, searchInput, clearBtn),
    el('div', { class: 'setg-side-title' }, '设置分类'),
    navHost);

  // 返回与标题已上移到顶栏（见 core.syncSystemTopBar），内容区不再重复渲染
  return el('div', { class: 'page setg-page' },
    el('div', { class: 'setg-layout' }, sidebar, contentHost));
}, { title: '设置', backLabel: '返回工作台', back: () => leaveSystem() });

/** 供外部进入设置并定位到某分类（保留以供扩展中心/关于页跳转） */
export function openSettings(category) {
  if (category && VIEWS[category]) activeCat = category;
  query = '';
  viewMode = 'visual';
  router.go('settings');
}
