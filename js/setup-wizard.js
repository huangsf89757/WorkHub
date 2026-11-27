/* setup-wizard.js — 首次访问的项目初始化向导
 *
 * 未标记 setupDone 时由 main.js 在 boot 前调用，阻塞展示分步引导；
 * 草稿只存在向导内，点「完成」才落盘，避免中途改动污染偏好。
 * 完成后写入标记，后续启动直接进工作台。
 */
import {
  el, store, registry, bus, themeColorNames, themeStyleRegistry,
  applyThemeColor, applyDefaultInstalledExts, installExt, uninstallExt, isExtInstalled,
} from './core.js';
import { DEFAULT_USER_NAME } from './identity.js';
import { isProxyMode } from './cloud-config.js';

export const SETUP_DONE_KEY = 'setupDone';
export const isSetupDone = () => store.get(SETUP_DONE_KEY, false) === true;

const STEPS = ['欢迎', '个性化', '扩展', '完成'];
const COLOR_SWATCH = { dark: '#181818', light: '#e8e8e8', terminal: '#0d0d0d', oled: '#000000' };
const businessExts = () => registry.list.filter(ext => ext.group !== 'system');

/** 无初始化标记则展示向导；返回是否实际展示。 */
export async function maybeRunSetup() {
  if (isSetupDone()) return false;
  await runSetupWizard();
  return true;
}

/** 安装态落盘：全新一次写入并锁定；已有记录则逐个对齐用户勾选。 */
function syncInstallState(selected) {
  if (applyDefaultInstalledExts(selected)) return;
  for (const ext of businessExts()) {
    if (selected.includes(ext.id) === isExtInstalled(ext.id)) continue;
    if (selected.includes(ext.id)) installExt(ext.id);
    else uninstallExt(ext.id);
  }
}

/** 落盘：仅在此处写入全部初始化配置。 */
export function commitSetup(draft) {
  const name = String(draft.name || '').trim();
  if (name) store.set('currentUserName', name);
  applyThemeColor(draft.themeColor);
  if (themeStyleRegistry.get(draft.themeStyle)) store.set('themeStyle', draft.themeStyle);
  syncInstallState([...draft.selectedExts]);
  store.set(SETUP_DONE_KEY, true);
  bus.emit('setup:done');
}

/** 跳过：保留现有配置，只锁定初始化标记与安装态。 */
export function skipSetup() {
  applyDefaultInstalledExts([]);
  store.set(SETUP_DONE_KEY, true);
  bus.emit('setup:done');
}

const row = (key, value) => el('div', { class: 'setup-summary-row' },
  el('span', { class: 'setup-summary-key' }, key),
  el('span', { class: 'setup-summary-val' }, value));

/** 展示向导，返回 Promise：用户点「进入 WorkHub」或「跳过」后 resolve。 */
export function runSetupWizard() {
  return new Promise(resolve => {
    const draft = {
      name: '',
      themeColor: document.body.dataset.themeColor || 'dark',
      themeStyle: themeStyleRegistry.list[0]?.id || 'classic',
      // 预选 extensions.json 已种子化的扩展，用户可在向导里调整
      selectedExts: new Set(businessExts().filter(ext => isExtInstalled(ext.id)).map(ext => ext.id)),
    };
    let step = 0;

    const head = el('div', { class: 'setup-head' });
    const body = el('div', { class: 'setup-body' });
    const foot = el('div', { class: 'setup-foot' });
    const overlay = el('div', {
      class: 'setup-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'setup-title',
    }, el('div', { class: 'setup-card' }, head, body, foot));

    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    const close = skipped => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (skipped) skipSetup(); else commitSetup(draft);
      resolve();
    };
    const go = next => {
      step = Math.max(0, Math.min(STEPS.length - 1, next));
      render();
    };

    const renderHead = () => head.replaceChildren(
      el('div', { class: 'setup-brand' }, 'WorkHub · 首次启动'),
      el('h1', { id: 'setup-title' }, '初始化 WorkHub'),
      el('div', { class: 'setup-steps', 'aria-hidden': 'true' },
        ...STEPS.map((_, index) => el('span', {
          class: 'setup-step-dot' + (index <= step ? ' done' : ''),
        }))),
    );

    const choice = (pressed, onclick, ...children) => el('button', {
      class: 'setup-choice', 'aria-pressed': String(pressed), onclick,
    }, ...children);

    const renderBody = () => {
      const exts = businessExts();
      if (step === 0) {
        body.replaceChildren(
          el('h2', { class: 'setup-title' }, '欢迎使用 WorkHub'),
          el('p', { class: 'setup-desc' },
            'WorkHub 是本地优先的扩展式工作台：数据先保存在这台设备上，需要时再同步到云端。接下来用几步完成基础配置，之后随时可以在设置页修改。'),
          el('div', { class: 'setup-note' },
            el('div', null, '· 数据默认只存本地，离线可用'),
            el('div', null, '· 功能以扩展方式按需安装'),
            el('div', null, '· 云端同步在代理环境自动启用')),
        );
      } else if (step === 1) {
        const nameInput = el('input', {
          class: 'setup-input', type: 'text', maxlength: '24',
          placeholder: '例如：小林', 'aria-label': '你的称呼', value: draft.name,
          oninput: event => { draft.name = event.target.value; },
        });
        body.replaceChildren(
          el('h2', { class: 'setup-title' }, '个性化你的工作台'),
          el('div', { class: 'setup-section' },
            el('div', { class: 'setup-section-label' }, '称呼'),
            nameInput),
          el('div', { class: 'setup-section' },
            el('div', { class: 'setup-section-label' }, '主题色 · 点击即时预览'),
            el('div', { class: 'setup-choices cols-4' },
              ...Object.entries(themeColorNames).map(([id, label]) => choice(
                draft.themeColor === id,
                () => { draft.themeColor = id; document.body.dataset.themeColor = id; renderBody(); },
                el('span', { class: 'setup-swatch', style: `background:${COLOR_SWATCH[id]}` }),
                el('span', { class: 'setup-choice-main' }, el('span', { class: 'setup-choice-name' }, label)))))),
          el('div', { class: 'setup-section' },
            el('div', { class: 'setup-section-label' }, '主题风格'),
            el('div', { class: 'setup-choices' },
              ...themeStyleRegistry.list.map(style => choice(
                draft.themeStyle === style.id,
                () => { draft.themeStyle = style.id; renderBody(); },
                el('span', { class: 'setup-choice-main' },
                  el('span', { class: 'setup-choice-name' }, style.name || style.id),
                  el('span', { class: 'setup-choice-desc' }, style.desc || '')))))),
        );
      } else if (step === 2) {
        body.replaceChildren(
          el('h2', { class: 'setup-title' }, '选择要安装的扩展'),
          el('p', { class: 'setup-desc' },
            '业务功能都是可插拔扩展。这里只做安装，挂载位置与启用状态稍后在扩展中心配置。'),
          el('div', { class: 'setup-section' },
            exts.length
              ? el('div', { class: 'setup-choices' }, ...exts.map(ext => {
                const on = draft.selectedExts.has(ext.id);
                return choice(on, () => {
                  if (on) draft.selectedExts.delete(ext.id); else draft.selectedExts.add(ext.id);
                  renderBody();
                },
                el('span', { class: 'setup-choice-main' },
                  el('span', { class: 'setup-choice-name' }, ext.name || ext.id),
                  el('span', { class: 'setup-choice-desc' }, ext.desc || '')),
                el('span', { class: 'setup-check' }, on ? '✓' : ''));
              }))
              : el('p', { class: 'setup-desc' }, '当前没有可安装的业务扩展，稍后可在扩展中心按需安装。')),
        );
      } else {
        const names = exts.filter(ext => draft.selectedExts.has(ext.id)).map(ext => ext.name || ext.id);
        body.replaceChildren(
          el('h2', { class: 'setup-title' }, '初始化完成'),
          el('p', { class: 'setup-desc' },
            '配置已就绪。进入 WorkHub 后，所有设置都可以随时在设置页调整。'),
          el('div', { class: 'setup-summary' },
            row('称呼', draft.name.trim() || DEFAULT_USER_NAME),
            row('主题色', themeColorNames[draft.themeColor] || draft.themeColor),
            row('主题风格', themeStyleRegistry.get(draft.themeStyle)?.name || draft.themeStyle),
            row('已选扩展', names.join('、') || '暂无'),
            row('云端同步', isProxyMode() ? '代理模式 · 已就绪' : '未配置 · 可稍后在设置中开启')),
        );
      }
    };

    const renderFoot = () => foot.replaceChildren(
      el('span', { class: 'setup-count' }, `第 ${step + 1} / ${STEPS.length} 步`),
      el('div', { class: 'setup-actions' },
        step < STEPS.length - 1
          ? el('button', { class: 'setup-btn ghost', onclick: () => close(true) }, '跳过')
          : null,
        step > 0 ? el('button', { class: 'setup-btn', onclick: () => go(step - 1) }, '上一步') : null,
        el('button', {
          class: 'setup-btn primary',
          onclick: () => { if (step === STEPS.length - 1) close(false); else go(step + 1); },
        }, step === STEPS.length - 1 ? '进入 WorkHub' : '下一步')),
    );

    const render = () => {
      renderHead();
      renderBody();
      renderFoot();
      body.querySelector('input, button')?.focus();
    };

    render();
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
  });
}
