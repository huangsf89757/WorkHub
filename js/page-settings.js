/* page-settings.js — 设置系统页（左侧分栏 + 栏内搜索 + VSCode 式源码）
 *
 * 结构：顶栏（返回 + 标题 + 界面/源码图标切换） → 左侧（搜索框 + 分类导航）/ 右侧（界面视图 或 源码视图）。
 * 分类：账户 / 通用（含快捷键、主题风格、主题色）/ 关于。
 * 搜索：由 settings.search.json 的 aliases 驱动，命中设置键对应的分类。
 * 源码：settings.json 为默认模板，localStorage 为生效值；两个视图双向同步。
 * 数据全部取自现有契约（core / sync / platform / version.json），偏好键不混入业务数据。
 */
import {
  el, icons, router, bus, store, registerSystemPage, toast, leaveSystem,
  registerUnappliedGuard, guardUnappliedNavigation,
  themeColorNames, applyThemeColor, input,
  getAllThemeStyles, getActiveThemeStyle, setActiveThemeStyle,
  openModal, fmtTime,
  SHORTCUT_ACTIONS, getShortcuts, setShortcut, resetShortcuts,
  getExtShortcuts, setExtShortcut, removeExtShortcut, shortcutExtCandidates,
  comboFromEvent, formatShortcut, registry,
} from './core.js';
import { openThemeStyleDetail } from './page-theme-style-detail.js';
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
let SETTINGS_DEFAULT = { themeColor: 'dark', themeStyle: 'classic', shortcuts: {} };
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
let sourceDraft = { settings: '', search: '' };  // 编辑器文本（可能含未应用的更改）
let sourceApplied = { settings: '', search: '' }; // 已应用文本，用于判定是否有未应用更改
let sourceError = '';      // 源码校验/应用错误提示

/* ---------- 元数据 ---------- */
const CATS = [
  { id: 'account', name: '账户', icon: icons.user, desc: '身份、设备与数据同步' },
  { id: 'general', name: '通用', icon: icons.settings, desc: '启动行为、快捷键、主题风格与主题色' },
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
    themeColor: document.body.dataset.themeColor || SETTINGS_DEFAULT.themeColor || 'dark',
    themeStyle: getActiveThemeStyle()?.id || SETTINGS_DEFAULT.themeStyle || 'classic',
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

  if ('themeColor' in obj) {
    if (typeof obj.themeColor !== 'string' || !themeColorNames[obj.themeColor])
      return { ok: false, error: `未知主题色：${String(obj.themeColor)}（可选 ${Object.keys(themeColorNames).join(' / ')}）` };
  }
  if ('themeStyle' in obj) {
    if (typeof obj.themeStyle !== 'string' || !getAllThemeStyles().some(s => s.id === obj.themeStyle))
      return { ok: false, error: `未知主题风格：${String(obj.themeStyle)}（可选 ${getAllThemeStyles().map(s => s.id).join(' / ')}）` };
  }
  if ('shortcuts' in obj) {
    const sc = obj.shortcuts;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc))
      return { ok: false, error: 'shortcuts 必须是一个对象' };
    const entries = [];
    for (const a of SHORTCUT_ACTIONS) {
      if (typeof sc[a.id] !== 'string' || !sc[a.id].trim())
        return { ok: false, error: `快捷键 ${a.id} 的值无效（应形如 "mod+,"）` };
      entries.push({ name: a.label, combo: String(sc[a.id]).trim() });
    }
    for (const [key, combo] of Object.entries(sc)) {
      if (!key.startsWith('ext:')) continue;
      if (typeof combo !== 'string' || !combo.trim())
        return { ok: false, error: `快捷键 ${key} 的值无效` };
      const extId = key.slice(4);
      entries.push({ name: `扩展「${registry.get(extId)?.name || extId}」`, combo: String(combo).trim() });
    }
    const seen = new Map();
    for (const e of entries) {
      for (const slot of slotsOf(e.combo)) {
        if (seen.has(slot))
          return { ok: false, error: `快捷键冲突：${seen.get(slot)} 与「${e.name}」都占用 ${slot}` };
        seen.set(slot, e.name);
      }
    }
  }

  // 全部校验通过后再写，避免中途失败造成半应用状态
  if ('themeColor' in obj) applyThemeColor(obj.themeColor);
  if ('themeStyle' in obj) setActiveThemeStyle(obj.themeStyle);
  if ('shortcuts' in obj) {
    const normalized = Object.fromEntries(SHORTCUT_ACTIONS.map(a => [a.id, String(obj.shortcuts[a.id]).trim()]));
    for (const [key, combo] of Object.entries(obj.shortcuts)) {
      if (key.startsWith('ext:')) normalized[key] = String(combo).trim();
    }
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
    ...themeStyleView(),
    ...themeColorView(),
  ];
}

/* ---------- 快捷键（可录制自定义，真正生效） ---------- */
let recordingId = null; // 正在录制的动作 id，跨重绘保留
let recordingCleanup = null;

function shortcutView() {
  const sc = getShortcuts();
  const extSc = getExtShortcuts();
  const extName = id => registry.get(id)?.name || id;

  // 按键本身就是编辑入口，不再需要旁边的铅笔按钮
  const keyBtn = (id, label, combo) => {
    const recording = recordingId === id;
    return el('button', {
      class: 'hk-key' + (recording ? ' recording' : ''),
      'data-recording': recording ? '1' : null,
      'aria-label': recording
        ? `正在录制「${label}」快捷键，按 Esc 取消`
        : `修改「${label}」快捷键，当前 ${formatShortcut(combo)}`,
      onclick: () => startRecording(id),
    }, recording ? '按下快捷键…' : formatShortcut(combo));
  };
  const extLabel = id => el('span', { class: 'hk-name' },
    el('span', { class: 'hk-ext-tag' }, '扩展'), extName(id));

  const builtinRows = SHORTCUT_ACTIONS.map(action =>
    el('div', { class: 'hk-row' },
      el('span', { class: 'hk-name' }, action.label),
      el('span', { class: 'hk-combo' }, keyBtn(action.id, action.label, sc[action.id]))));

  const extRows = Object.entries(extSc).map(([extId, combo]) =>
    el('div', { class: 'hk-row' },
      extLabel(extId),
      el('span', { class: 'hk-combo' }, keyBtn('ext:' + extId, extName(extId), combo)),
      el('button', {
        class: 'icon-btn hk-remove', title: '移除快捷键',
        'aria-label': `移除「${extName(extId)}」的快捷键`,
        onclick: () => { removeExtShortcut(extId); toast('已移除：' + extName(extId)); bus.emit('route'); },
      }, el('span', { class: 'icon', html: icons.trash }))));

  // 弹窗选完扩展、尚未录制：先出一行占位，按 Esc 即消失
  const pendingExt = recordingId?.startsWith('ext:') ? recordingId.slice(4) : null;
  const pendingRow = pendingExt && !extSc[pendingExt]
    ? el('div', { class: 'hk-row' },
        extLabel(pendingExt),
        el('span', { class: 'hk-combo' }, keyBtn(recordingId, extName(pendingExt), '')))
    : null;
  const emptyHint = !extRows.length && !pendingRow
    ? el('p', { class: 'hint hk-empty' }, '还没有扩展快捷键。点「添加扩展快捷键」为当前界面的扩展绑定按键。')
    : null;

  const addBtn = el('button', { class: 'btn hk-add', onclick: askAddExtShortcut },
    el('span', { class: 'icon', html: icons.plus }), '添加扩展快捷键');
  const resetBtn = el('button', { class: 'btn hk-reset', onclick: askResetShortcuts },
    el('span', { class: 'icon', html: icons.restore }), '恢复默认');

  const section = cardFor('shortcuts', '快捷键',
    el('div', { class: 'hk-list' }, ...builtinRows, ...extRows, pendingRow, emptyHint),
    el('div', { class: 'hk-foot' },
      el('p', { class: 'hint' }, '点击按键修改；按 Esc 取消录制。输入文字时快捷键自动让位。'),
      addBtn));
  section.classList.add('setg-card-with-action');
  section.querySelector('.panel-head').append(resetBtn);
  return section;
}

/** 恢复默认：有自定义扩展快捷键时先询问是否一并删除 */
function askResetShortcuts() {
  const count = Object.keys(getExtShortcuts()).length;
  const finish = (clearExt, message) => {
    resetShortcuts({ keepExt: !clearExt });
    toast(message);
    bus.emit('route');
  };
  if (!count) {
    finish(true, '快捷键已恢复默认');
    return;
  }
  openModal('恢复默认快捷键',
    el('div', { class: 'hk-reset-desc' },
      el('p', { class: 'hint' }, '内置快捷键将恢复为「⌘ / Ctrl + ,」与「Esc」。'),
      el('p', { class: 'hint' }, `当前有 ${count} 个已添加的扩展快捷键，是否一并删除？`)),
    [
      { label: '取消' },
      { label: '一并删除', danger: true, onClick: close => {
        close(); finish(true, '快捷键已恢复默认，扩展快捷键已删除');
      } },
      { label: '保留扩展快捷键', primary: true, onClick: close => {
        close(); finish(false, '内置快捷键已恢复默认，扩展快捷键已保留');
      } },
    ]);
}

/** 弹窗选择当前主题风格下已添加且可用的扩展，选中后进入快捷键录制 */
function askAddExtShortcut() {
  const bound = getExtShortcuts();
  const candidates = shortcutExtCandidates().filter(ext => !bound[ext.id]);
  if (!candidates.length) {
    toast('当前界面没有可添加快捷键的扩展，请先在扩展中心启用');
    return;
  }
  let picked = candidates[0].id;
  const list = el('div', { class: 'hk-pick-list' }, ...candidates.map(ext => {
    const radio = el('input', { type: 'radio', name: 'hk-ext', value: ext.id });
    radio.checked = ext.id === picked;
    radio.addEventListener('change', () => { if (radio.checked) picked = ext.id; });
    return el('label', { class: 'hk-pick-row' },
      radio,
      el('span', { class: 'hk-pick-name' }, ext.name),
      el('span', { class: 'hk-pick-id mono' }, ext.id));
  }));
  openModal('添加扩展快捷键',
    el('div', {},
      el('p', { class: 'hint hk-pick-hint' }, '选择扩展后，为它按下一个快捷键：'),
      list),
    [{ label: '取消' }, { label: '下一步', primary: true, onClick: close => {
      close();
      startRecording('ext:' + picked);
    } }]);
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
    const result = id.startsWith('ext:')
      ? setExtShortcut(id.slice(4), combo)
      : setShortcut(id, combo);
    if (!result.ok) toast(result.error);
    else toast(`已设置：${formatShortcut(combo)}`);
    bus.emit('route');
  };
  // capture 阶段拦截，避免触发全局快捷键与页面默认行为
  document.addEventListener('keydown', onKey, true);
  recordingCleanup = () => document.removeEventListener('keydown', onKey, true);
  bus.emit('route'); // 重绘进入录制态
}

function themeStyleView() {
  const activeThemeStyle = getActiveThemeStyle();
  const themeStyleCards = el('div', { class: 'theme-style-cards' },
    getAllThemeStyles().map(themeStyle => {
      const isCurrent = activeThemeStyle?.id === themeStyle.id;
      const activate = () => {
        setActiveThemeStyle(themeStyle.id);
        router.go('settings');
        toast(`已切换：${themeStyle.name}`);
      };
      const iconAction = (icon, title, onClick, extraClass = '') => el('button', {
        class: 'theme-style-card-act' + (extraClass ? ' ' + extraClass : ''),
        title, 'aria-label': title,
        onclick: event => { event.stopPropagation(); onClick(); },
      }, el('span', { class: 'icon', html: icon }));
      const actions = el('div', { class: 'theme-style-card-actions' },
        iconAction(icons.info, '查看详情：' + themeStyle.name, () => openThemeStyleDetail(themeStyle.id)),
        ...(isCurrent ? [] : [iconAction(icons.power, '设为当前主题风格：' + themeStyle.name, activate, 'primary')]));
      return el('div', {
        class: 'theme-style-card' + (isCurrent ? ' active' : ''),
        role: 'button', tabindex: '0', 'aria-label': `主题风格：${themeStyle.name}`,
        onclick: activate,
        onkeydown: event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
        },
      },
        el('span', { class: 'icon', html: themeStyle.icon }),
        el('span', { class: 'theme-style-card-name' }, themeStyle.name),
        el('span', { class: 'theme-style-card-desc' }, themeStyle.desc || ''),
        actions);
    }));
  return [
    cardFor('themeStyle', '主题风格',
      themeStyleCards,
      activeThemeStyle?.settingsPanel ? activeThemeStyle.settingsPanel() : null,
      el('p', { class: 'hint' }, '点击卡片切换主题风格；卡片右上角图标可查看详情或设为当前主题风格。')),
  ];
}

function themeColorView() {
  const themeColorButtons = el('div', { class: 'btn-line', role: 'group', 'aria-label': '主题色' },
    Object.entries(themeColorNames).map(([id, name]) => {
      const active = document.body.dataset.themeColor === id;
      return el('button', {
        class: 'btn' + (active ? ' primary' : ''),
        'aria-pressed': String(active),
        onclick: () => { applyThemeColor(id); router.go('settings'); },
      }, name);
    }));
  return [
    cardFor('themeColor', '主题色', themeColorButtons,
      el('p', { class: 'hint' }, '主题色即时生效并持久化；跟随系统「减少动态效果」偏好自动关闭动画。')),
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
  // 优先：aliases 精确命中具体设置键（如「主题色」→ themeColor）
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
let viewToggleEl = null;

/** 顶栏单图标按钮：图标表示当前视图，点击在界面 / 源码间切换 */
function viewToggle() {
  viewToggleEl = el('button', {
    type: 'button', class: 'icon-btn setg-view-toggle',
    onclick: () => {
      const next = viewMode === 'visual' ? 'source' : 'visual';
      const proceed = () => {
        // 进入源码视图时按当前生效设置重建两份文本，保证两个视图同步
        if (next === 'source') syncSourceFromLive();
        else sourceError = '';
        viewMode = next;
        bus.emit('route');
      };
      const verdict = guardUnappliedNavigation();
      if (verdict === true) proceed();
      else verdict.then(ok => { if (ok) proceed(); });
    },
  });
  syncViewToggle();
  return viewToggleEl;
}

/** 搜索输入等局部刷新不走路由，这里同步顶栏按钮的图标、提示与选中态 */
function syncViewToggle() {
  if (!viewToggleEl) return;
  const isSource = viewMode === 'source';
  const label = isSource ? '切换到界面视图' : '切换到源码视图';
  viewToggleEl.replaceChildren(el('span', { class: 'icon', html: isSource ? icons.braces : icons.settings }));
  viewToggleEl.title = label;
  viewToggleEl.setAttribute('aria-label', label);
  viewToggleEl.setAttribute('aria-pressed', String(isSource));
}

const SOURCE_FILES = [
  { id: 'settings', name: 'settings.json', desc: '偏好设置', serialize: () => serializeSettings(), def: () => defaultSettingsText(), apply: applySettingsObject },
  { id: 'search', name: 'settings.search.json', desc: '搜索规则', serialize: () => serializeSearchRules(), def: () => JSON.stringify(SEARCH_RULES_DEFAULT || {}, null, 2), apply: applySearchRules },
];
const sourceFileOf = () => SOURCE_FILES.find(f => f.id === sourceFile) || SOURCE_FILES[0];

/** 某份配置是否有尚未应用的编辑 */
const sourceDirty = id => sourceDraft[id] !== sourceApplied[id];

/** 从当前生效设置重建两份文本；进入源码视图时调用，未应用的草稿不再保留 */
function syncSourceFromLive() {
  sourceDraft.settings = sourceApplied.settings = serializeSettings();
  sourceDraft.search = sourceApplied.search = serializeSearchRules();
  sourceError = '';
}

/** 校验并应用指定文件的编辑文本；返回是否成功，重绘由调用方决定 */
function applySource(id) {
  const file = SOURCE_FILES.find(f => f.id === id) || SOURCE_FILES[0];
  let obj;
  try { obj = JSON.parse(sourceDraft[id]); }
  catch (e) { sourceError = `JSON 语法错误：${e.message}`; return false; }
  const res = file.apply(obj);
  if (!res.ok) { sourceError = res.error; return false; }
  const text = file.serialize();
  sourceDraft[id] = text;
  sourceApplied[id] = text;
  return true;
}

/** 格式化当前 JSON 草稿：2 空格缩进；解析失败时显示错误，不改动草稿。 */
function formatCurrentSource() {
  let obj;
  try { obj = JSON.parse(sourceDraft[sourceFile]); }
  catch (e) {
    sourceError = `JSON 语法错误：${e.message}`;
    bus.emit('route');
    toast('格式化失败：JSON 语法错误');
    return false;
  }
  const text = JSON.stringify(obj, null, 2);
  sourceDraft[sourceFile] = text;
  const editor = document.querySelector('.setg-source-editor');
  if (editor) editor.value = text;
  sourceError = '';
  document.querySelector('.setg-source-error')?.remove();
  syncSourceDirtyUI();
  toast('已格式化');
  return true;
}

/** 应用当前文件；失败时留在页面显示错误 */
function applyCurrentSource() {
  const name = sourceFileOf().name;
  const ok = applySource(sourceFile);
  if (ok) { sourceError = ''; toast(`${name} 已应用并生效`); }
  bus.emit('route');
  return ok;
}

/** 离开前一次性应用所有脏文件；失败时保留草稿并返回 false */
function applyAllSources() {
  const ids = SOURCE_FILES.filter(f => sourceDirty(f.id)).map(f => f.id);
  if (!ids.every(id => applySource(id))) { bus.emit('route'); return false; }
  sourceError = '';
  toast('设置已应用并生效');
  bus.emit('route');
  return true;
}

registerUnappliedGuard({
  isActive: () => router.extId === 'settings' && viewMode === 'source',
  isDirty: () => SOURCE_FILES.some(f => sourceDirty(f.id)),
  apply: applyAllSources,
  discard: () => { sourceDraft = { ...sourceApplied }; sourceError = ''; },
});

/** 输入时不重绘（保住焦点与光标），只在现有 DOM 上同步未应用状态 */
function syncSourceDirtyUI() {
  const dirty = sourceDirty(sourceFile);
  document.querySelectorAll('.setg-source-apply').forEach(btn => { btn.disabled = !dirty; });
  document.querySelectorAll('.setg-source-state').forEach(node => node.classList.toggle('dirty', dirty));
  document.querySelectorAll('.setg-source-state-text').forEach(node => {
    node.textContent = dirty ? '有未应用的更改' : '已与当前设置同步';
  });
  document.querySelectorAll('.setg-source-filetab').forEach(tab => {
    const tabDirty = sourceDirty(tab.dataset.file);
    tab.classList.toggle('dirty', tabDirty);
    const dot = tab.querySelector('.setg-source-dot');
    if (tabDirty && !dot) tab.append(el('span', { class: 'setg-source-dot', title: '有未应用的更改' }));
    if (!tabDirty && dot) dot.remove();
  });
}

function sourceView() {
  const file = sourceFileOf();
  // 注意：输入时只更新草稿、不重绘，否则 textarea 会重建导致焦点/光标丢失
  const editor = el('textarea', {
    class: 'setg-source-editor',
    spellcheck: 'false',
    'aria-label': file.name + ' 源码',
  });
  editor.value = sourceDraft[sourceFile];
  editor.addEventListener('input', () => {
    sourceDraft[sourceFile] = editor.value;
    if (sourceError) {
      sourceError = '';
      document.querySelector('.setg-source-error')?.remove();
    }
    syncSourceDirtyUI();
  });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (sourceDirty(sourceFile)) applyCurrentSource();
    }
  });

  const resetBtn = el('button', {
    class: 'btn',
    onclick: () => {
      sourceDraft[sourceFile] = file.def();
      sourceError = '';
      bus.emit('route');
      toast('已载入文件默认配置，点击「应用」生效');
    },
  }, el('span', { class: 'icon', html: icons.restore }), '载入默认');

  const formatBtn = el('button', {
    class: 'btn',
    title: '将当前 JSON 格式化为 2 空格缩进',
    onclick: formatCurrentSource,
  }, el('span', { class: 'icon', html: icons.braces }), '格式化');

  const copyBtn = el('button', {
    class: 'btn',
    onclick: async () => {
      try { await navigator.clipboard.writeText(sourceDraft[sourceFile]); toast(`已复制 ${file.name}`); }
      catch { toast('复制失败，请手动选择文本'); }
    },
  }, el('span', { class: 'icon', html: icons.copy }), '复制');

  const applyBtn = el('button', {
    class: 'btn primary setg-source-apply',
    disabled: !sourceDirty(sourceFile),
    title: '校验并应用当前文件的更改',
    onclick: applyCurrentSource,
  }, el('span', { class: 'icon', html: icons.check }), '应用');

  // 文件切换：settings.json / settings.search.json；各文件的未应用草稿分别保留
  const fileTabs = el('div', { class: 'setg-source-files', role: 'tablist', 'aria-label': '配置文件' },
    ...SOURCE_FILES.map(f => el('button', {
      class: 'setg-source-filetab'
        + (sourceFile === f.id ? ' active' : '')
        + (sourceDirty(f.id) ? ' dirty' : ''),
      'data-file': f.id,
      role: 'tab', 'aria-selected': String(sourceFile === f.id),
      title: f.desc + (sourceDirty(f.id) ? '（有未应用的更改）' : ''),
      onclick: () => {
        if (sourceFile === f.id) return;
        sourceFile = f.id;
        sourceError = '';
        bus.emit('route');
      },
    }, el('span', { class: 'icon', html: icons.braces }), f.name,
      sourceDirty(f.id) ? el('span', { class: 'setg-source-dot', title: '有未应用的更改' }) : null)));

  return el('div', { class: 'setg-source' },
    fileTabs,
    el('div', { class: 'setg-source-bar' },
      el('div', { class: 'setg-source-state' + (sourceDirty(sourceFile) ? ' dirty' : '') },
        el('span', { class: 'setg-source-state-dot' }),
        el('span', { class: 'setg-source-state-text' },
          sourceDirty(sourceFile) ? '有未应用的更改' : '已与当前设置同步')),
      el('div', { class: 'setg-source-actions' }, formatBtn, resetBtn, copyBtn, applyBtn)),
    editor,
    sourceError ? el('div', { class: 'setg-source-error', role: 'alert' }, sourceError) : null,
    el('p', { class: 'hint' }, sourceFile === 'search'
      ? '搜索规则与 settings.json 的键对应：aliases 为匹配词（如 themeColor / style / 风格 / 主题色），category 为命中后高亮的分类。编辑后点击「应用」（或按 ⌘/Ctrl + Enter）才保存并生效。'
      : '与界面双向同步：此处编辑后点击「应用」（或按 ⌘/Ctrl + Enter）才生效；界面修改在切回源码时同步。修改保存在本地（localStorage），settings.json 为默认模板。'));
}

/* ============================================================
   页面注册
   ============================================================ */
registerSystemPage('settings', () => {
  // 分类导航项（独立构建，供局部刷新复用）
  const navItems = (cats, current) => cats.map(cat => el('button', {
    class: 'setg-nav-item' + (current === cat.id ? ' active' : ''),
    'aria-current': current === cat.id ? 'page' : null,
    onclick: () => {
      const category = cat.id;
      const proceed = () => { activeCat = category; viewMode = 'visual'; bus.emit('route'); };
      const verdict = guardUnappliedNavigation();
      if (verdict === true) proceed();
      else verdict.then(ok => { if (ok) proceed(); });
    },
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
            viewMode === 'source' ? '编辑配置源码 · 修改后点击「应用」生效'
              : (q && hits.size ? `已高亮 ${hits.size} 项匹配设置` : cat.desc)))),
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
    placeholder: '搜索设置（如：主题色、themeColor、主题风格、快捷键）',
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
    syncViewToggle();    // 顶栏控件不随内容区重建，需单独同步
    refresh();           // 局部刷新，保住焦点与 IME
  });

  const sidebar = el('nav', { class: 'setg-side', 'aria-label': '设置分类' },
    el('div', { class: 'setg-search-wrap' }, searchInput, clearBtn),
    el('div', { class: 'setg-side-title' }, '设置分类'),
    navHost);

  // 源码视图专注编辑配置：隐藏左侧搜索/分类栏，编辑区占满宽度（顶栏切换仍可用）
  const isSource = viewMode === 'source';
  const layout = el('div', { class: 'setg-layout' + (isSource ? ' source-mode' : '') },
    ...(isSource ? [] : [sidebar]), contentHost);

  // 返回与标题已上移到顶栏（见 core.syncSystemTopBar），内容区不再重复渲染
  return el('div', { class: 'page setg-page' }, layout);
}, {
  title: '设置', backLabel: '返回工作台', back: () => leaveSystem(),
  topActions: () => viewToggle(),
});

/** 供外部进入设置并定位到某分类（保留以供扩展中心/关于页跳转） */
export function openSettings(category) {
  if (category && VIEWS[category]) activeCat = category;
  query = '';
  viewMode = 'visual';
  router.go('settings');
}
