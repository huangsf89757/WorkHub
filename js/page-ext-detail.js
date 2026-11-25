/* page-ext-detail.js — 通用扩展详情系统页
 *
 * 目标：任意扩展（已安装 registry / 规划 features / 内核系统页）都自动拥有详情页。
 * 入口：扩展中心每一行的「详情」。三 Tab：介绍 / README / 预览。
 * 数据全部来自现有契约；扩展可选提供 readme（Markdown）覆盖自动生成的骨架。
 * 零额外注册：新扩展只要进了 registry 或 features，详情页即自动可用。
 */
import {
  el, icons, router, bus, registerSystemPage,
  registry, getPlannedFeatures, extStageLabel, extStageOf,
} from './core.js';
import { renderMarkdown } from './md.js';

let activeExtId = null;
let activeTab = 'intro';

const HOOKS = [
  ['badge',  'badge()',  '导航角标',    'left / top 导航项显示计数'],
  ['home',   'home(ctx)', '主视图',     'center 区主内容'],
  ['detail', 'detail(id,ctx)', '详情视图', 'center 区单条记录编辑'],
];

/* ---------- 统一元数据：三类扩展归一为同一结构 ---------- */
const SYSTEM_META = {
  'ext-center': {
    id: 'ext-center', name: '扩展中心', icon: icons.puzzle, kind: 'system',
    desc: '内核系统页：枚举已安装与规划中的扩展，查看挂载点分布并管理启用状态。',
    hooks: [], docFile: 'docs/architecture.md',
  },
  'settings': {
    id: 'settings', name: '设置', icon: icons.settings, kind: 'system',
    desc: '内核系统页：主题色、主题风格与设备同步信息。',
    hooks: [], docFile: 'docs/README.md',
  },
};

function makeReadme(info) {
  const hookRows = HOOKS.map(([key, sig, label, zone]) =>
    `| \`${sig}\` | ${label} | ${info.hooks.includes(key) ? '✅ 已实现' : '—'} | ${zone} |`).join('\n');
  return [
    `# ${info.name}`,
    '',
    `> ${info.desc || '暂无描述。'}`,
    '',
    `## 状态`,
    '',
    `- 类型：**${info.kindLabel}**`,
    `- 分组：${info.group}`,
    '',
    `## 扩展契约`,
    '',
    '通过 \`registry.add({...})\` 自注册，按需实现下列钩子：',
    '',
    '| 钩子 | 作用 | 状态 | 渲染区 |',
    '|---|---|---|---|',
    hookRows,
    '',
    '## 接入方式',
    '',
    '```js',
    `// js/ext-${info.id}.js`,
    `registry.add({ id: '${info.id}', name: '${info.name}', /* ... */ });`,
    `// js/main.js 顶部 import 一次即完成接入`,
    "import './ext-" + info.id + ".js';",
    '```',
    '',
    '---',
    '',
    '_此 README 由内核根据扩展元数据自动生成；扩展可通过提供 `readme` 字段覆盖。_',
  ].filter(x => x !== '').join('\n');
}

/** 核心：把任意 id 归一为详情元数据；未知返回 null */
export function extInfo(id) {
  if (SYSTEM_META[id]) {
    const m = SYSTEM_META[id];
    return {
      ...m, group: extStageLabel('system'), kindLabel: '系统内置', status: '系统内置',
      readme: m.readme || makeReadme({ ...m, hooks: [] }), links: [],
    };
  }
  const ext = registry.get(id);
  if (ext) {
    const info = {
      id, name: ext.name || id, icon: ext.icon || icons.puzzle, kind: 'installed',
      kindLabel: '已安装扩展', status: '已安装', desc: ext.desc || '',
      group: extStageLabel(extStageOf(id)),
      hooks: HOOKS.filter(([key]) => typeof ext[key] === 'function').map(([key]) => key),
      docFile: ext.docFile || `docs/extensions/${id}.md`,
      ext,
    };
    return {
      ...info,
      readme: typeof ext.readme === 'function' ? ext.readme() : (ext.readme || makeReadme(info)),
      links: ext.links || [],
    };
  }
  const planned = getPlannedFeatures().find(f => f.id === id);
  if (planned) {
    const info = {
      id, name: planned.name || id, icon: planned.icon || icons.puzzle, kind: 'planned',
      kindLabel: '规划中扩展', status: extStageLabel(extStageOf(id)), desc: planned.desc || '',
      group: extStageLabel(extStageOf(id)), hooks: planned.hooks || [],
      docFile: planned.docFile || 'FEATURES.md',
    };
    return {
      ...info,
      readme: typeof planned.readme === 'function' ? planned.readme()
        : (planned.readme || makeReadme(info) + '\n\n> ⬜ 该扩展尚在规划中，以上为预期契约。'),
      links: planned.links || [],
    };
  }
  return null;
}

/* ---------- 视图 ---------- */
const kv = (k, v, mono) => el('div', { class: 'ed-kv-row' },
  el('span', { class: 'ed-kv-k' }, k),
  el('span', { class: 'ed-kv-v' + (mono ? ' mono' : '') }, String(v)));

function introView(info) {
  const statusCls = info.kind === 'installed' ? 'ok' : info.kind === 'system' ? '' : 'warn';
  const body = el('div', { class: 'sd-pad' },
    el('div', { class: 'ed-kv' },
      kv('名称', info.name),
      kv('扩展 ID', info.id, true),
      kv('状态', info.status),
      kv('类型', info.kindLabel),
      kv('分组', info.group),
      kv('已实现钩子', info.hooks.length ? info.hooks.join(' / ') : '—', true),
      kv('文档', info.docFile, true)),
    el('div', { class: 'sd-contract' },
      el('span', {}, '注册　　', el('b', {}, 'registry.add()'), ' → ', el('b', {}, `js/ext-${info.id}.js`)),
      el('span', {}, '装配　　', el('b', {}, 'main.js'), ' 顶部 import 一次'),
      el('span', {}, '契约　　', el('b', {}, 'home / detail / panel / status / badge')),
      el('span', {}, '数据　　', el('b', {}, 'declareDomain()'), ' + meta/outbox')),
    info.links.length
      ? el('div', { class: 'ed-links' }, info.links.map(l =>
          el('a', { class: 'btn', href: l.href, target: '_blank', rel: 'noopener' },
            el('span', { class: 'icon', html: icons.external }), l.label)))
      : null);
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h3', {}, '扩展介绍'),
      el('span', { class: 'pill ' + statusCls }, info.status)),
    body);
}

function readmeView(info) {
  const link = el('a', {
    class: 'ed-doc-link', href: info.docFile, target: '_blank', rel: 'noopener',
    title: '在新标签打开原始 Markdown 文档',
  }, el('span', { class: 'icon', html: icons.file }), info.docFile);
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h3', {}, 'README'),
      el('span', { class: 'sd-count' }, 'Markdown')),
    el('div', { class: 'sd-pad md-body' },
      el('div', { class: 'ed-doc-bar' }, link),
      ...renderMarkdown(info.readme)));
}

function previewView(info) {
  const hasPreview = typeof info.ext?.preview === 'function';
  const box = el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h3', {}, '预览 · ' + info.name),
      el('span', { class: 'sd-count' }, hasPreview ? '可交互 · 模拟数据不落库' : '示意，非实际渲染')),
    el('div', { class: 'sd-pad' }));
  const body = box.lastChild;

  if (hasPreview) {
    let snapshot = null;
    try {
      snapshot = info.ext.preview();
    } catch (err) {
      console.warn('[ext-detail] 预览渲染失败：' + info.id, err);
    }
    if (snapshot?.nodeType) {
      body.append(snapshot);
      return box;
    }
  }

  body.append(el('div', { class: 'empty big' }, '该扩展未提供 UI 预览快照'));
  return box;
}

/* ---------- Tab 容器（复用主题风格详情页的键盘语义） ---------- */
const TABS = [['intro', '介绍'], ['readme', 'README'], ['preview', '预览']];
const VIEW = { intro: introView, readme: readmeView, preview: previewView };

registerSystemPage('ext-detail', ctx => {
  const id = ctx.id || activeExtId;
  const info = extInfo(id);
  if (!info) {
    // 返回已上移到顶栏
    return el('div', { class: 'page' },
      el('div', { class: 'empty big' }, '未找到该扩展的详情数据'));
  }
  activeExtId = info.id;

  const page = el('div', { class: 'page sd-page' },
    // 返回与标题已上移到顶栏；内容区只保留实体展示与操作
    el('div', { class: 'sd-header' },
      el('div', { class: 'sd-hero' },
        el('div', { class: 'sd-hero-icon' }, el('span', { class: 'icon', html: info.icon || icons.puzzle })),
        el('div', {}, el('h1', {}, info.name),
          el('div', { class: 'sub mono' }, info.id + ' · ' + info.kindLabel))),
      el('div', { class: 'sd-actions' },
        el('span', { class: 'pill ' + (info.kind === 'installed' ? 'ok' : info.kind === 'planned' ? 'warn' : '') }, info.status))),
    el('div', { class: 'sd-tabs', role: 'tablist', 'aria-label': '扩展详情' },
      ...TABS.map(([tid, label], i, arr) =>
        el('button', {
          class: 'sd-tab' + (activeTab === tid ? ' on' : ''), role: 'tab',
          id: 'ed-tab-' + tid, 'aria-controls': 'ed-panel-' + tid,
          'aria-selected': String(activeTab === tid),
          tabindex: activeTab === tid ? '0' : '-1',
          onclick: () => { activeTab = tid; rerender(); },
          onkeydown: e => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const dir = e.key === 'ArrowRight' ? 1 : -1;
            activeTab = arr[(i + dir + arr.length) % arr.length][0];
            rerender();
            document.getElementById('ed-tab-' + activeTab)?.focus();
          },
        }, label))),
    el('div', {
      class: 'sd-content', role: 'tabpanel',
      id: 'ed-panel-' + activeTab, 'aria-labelledby': 'ed-tab-' + activeTab,
    }));
  page.lastChild.append(VIEW[activeTab](info));
  return page;
}, {
  title: ctx => extInfo(ctx.id || activeExtId)?.name || '扩展详情',
  backLabel: '返回扩展中心',
  back: () => router.go('ext-center'),
});

function rerender() { bus.emit('route'); }

/** 供扩展中心调用：进入某扩展详情 */
export function openExtDetail(id) {
  activeExtId = id;
  activeTab = 'intro';
  router.open('ext-detail', id);
}
