/* ext-todo.js — TODO 扩展（首个真实业务扩展，后续扩展的样板）
 *
 * 展示标准扩展契约的完整用法：五钩子 + 通用 DAO + 领域声明 + 同步元数据（自动）。
 * UI 借鉴飞书任务：精简工具栏（新建 / 排序 / 分组）+ 分组折叠计数 + 每组新建入口，
 * 保留分组卡片风格；新建下拉同时提供新建任务与新建分组。
 */
import {
  el, registry, icons, router, pageHeader, openModal, input, toast, bus, store, field,
  rightPanelOpen, toggleRightPanel,
} from './core.js';
import {
  state, declareDomain, insert, update, remove, alive, byId, newMeta, uid,
} from './data.js';

/* README：应用内「扩展详情 › README」展示的精简版；完整文档见 docs/extensions/todo.md */
const TODO_README = [
  '# TODO 扩展',
  '',
  '> 状态：✅ 已实现 · 首个真实业务扩展，后续扩展的参考样板',
  '',
  '## 1. 定位',
  '',
  '分组待办管理。验证「扩展契约 + 通用 DAO + 同步元数据 + 五区渲染 + 界面样式挂载」端到端可用，同时作为新扩展的实现范本。',
  '',
  '## 2. 扩展契约',
  '',
  '通过 `registry.add({...})` 自注册，五个钩子全部实现：',
  '',
  '| 钩子 | 渲染区 | 内容 |',
  '|---|---|---|',
  '| `badge()` | left / top 导航 | 未完成任务数（0 时不显示） |',
  '| `home(ctx)` | center | 主列表：视图切换、工具栏、分组任务 |',
  '| `detail(id,ctx)` | center | 单条待办编辑：标题/日期/分组/优先级/标签胶囊/备注/完成态 |',
  '| `panel(ctx)` | right | 统计：待完成/已完成/已逾期/完成率 + 分组分布 |',
  '| `status(ctx)` | bottom | `N 待办未完成 · M 逾期` |',
  '',
  '注册元数据：`id=todo`、`order=1.9`、`group=main`、`mounts=[left]`。',
  '',
  '## 3. 数据域',
  '',
  '```js',
  "declareDomain('todos', [])",
  "declareDomain('todoGroups', [])",
  '```',
  '',
  '**todo 记录结构：**',
  '',
  '| 字段 | 类型 | 说明 |',
  '|---|---|---|',
  '| `id` | string | `uid()`（crypto.randomUUID） |',
  '| `title` | string | 标题 |',
  '| `done` | boolean | 完成态 |',
  '| `completedAt` | number \\| null | 完成时间戳；标记完成时写入、取消时清空 |',
  '| `created` | number | 创建时间戳（稳定，不随保存刷新） |',
  '| `priority` | high \\| medium \\| low | 优先级 |',
  '| `start` / `due` | number \\| null | 开始 / 截止时间戳 |',
  '| `note` | string | 备注 |',
  '| `tags` | string[] | 标签 |',
  '| `groupId` | string | 所属分组，空串表示未分组 |',
  '| `meta` | object | `{updatedAt, updatedBy, deletedAt, rev}`；分组记录另有 `name/sort/created` |',
  '',
  '分组表为完整同步表（四同步列齐备）；`sort` 为记录字段，可随 LWW 同步。',
  '删除走 `remove()` 软删除墓碑；分组删除时组内待办先移到未分组再软删分组。',
  '',
  '## 4. 视图与交互',
  '',
  '主视图三个 tab：**全部 / 未完成 / 已完成**。',
  '',
  '- 工具栏「新建」下拉：新建任务 / 新建分组；右侧「排序」「分组」下拉切换维度',
  '- 每行：圆形复选框切换完成、标题进详情、优先级色点、标签、截止日、删除',
  '- 每组下方「新建任务」：回车直接创建到该组',
  '- 自定义分组「⋯」：重命名 / 删除；备注 500ms 防抖 + blur 提交',
  '',
  '## 5. 界面样式适配',
  '',
  '- 经典分栏：左侧导航 + center 列表 + right 统计（详情态隐藏）+ bottom 状态',
  '- 3D 工作室：默认挂「电脑」实物（`defaultExt: todo`），点击进入并带返回舞台条',
  '',
  '## 6. 已知取舍',
  '',
  '- 记录级 LWW：两端同改一条会丢一端，笔记类未来升级字段级合并',
  '- 路由内存态：刷新回默认页，同步落地后可编入 URL',
].join('\n');

/* ============================================================
   领域声明 + 首次种子
   ============================================================ */
declareDomain('todos', []);
declareDomain('todoGroups', []);

function seedIfEmpty() {
  if (state.todos.length || state.todoGroups.length) return;
  const now = Date.now(), day = 86400000;
  const work = { id: uid(), name: '工作', sort: 0, created: now - day * 3, meta: newMeta() };
  const life = { id: uid(), name: '生活', sort: 1, created: now - day * 3, meta: newMeta() };
  state.todoGroups.push(work, life);
  state.todos.push(
    { id: uid(), title: 'Review 新提交的 PR', done: false, priority: 'high', start: now - day, due: now + day, note: '重点看并发部分', tags: ['代码评审'], groupId: work.id, created: now - day * 2, completedAt: null, meta: newMeta() },
    { id: uid(), title: '回复技术社区私信', done: false, priority: 'low', start: now - day, due: now - day, note: '', tags: ['社区'], groupId: life.id, created: now - day, completedAt: null, meta: newMeta() },
    { id: uid(), title: '整理本周周报', done: true, priority: 'medium', start: null, due: null, note: '', tags: [], groupId: work.id, created: now - day * 3, completedAt: now - day * 2, meta: newMeta() },
  );
  // 种子不逐个 commit（避免污染 outbox），启动末尾统一持久化一次
  store.set('todoGroups', state.todoGroups);
  store.set('todos', state.todos);
}
seedIfEmpty();

/* ============================================================
   视图状态（模块内，不持久化）
   ============================================================ */
let view = 'all';            // all | undone | done
let sortBy = 'default';      // default | due | created | priority
let groupBy = 'group';       // group | priority | due | none
const collapsed = new Set();

const PRIO = { high: 0, medium: 1, low: 2 };
const PRIO_LABEL = { high: '高', medium: '中', low: '低' };
const SORT_LABEL = { default: '默认', due: '截止日', created: '创建时间', priority: '优先级' };
const GROUP_LABEL = { group: '自定义分组', priority: '优先级', due: '截止日', none: '不分组' };
const COLS = [
  { id: 'start',   label: '开始时间' },
  { id: 'due',     label: '截止时间' },
  { id: 'created', label: '创建时间' },
];

const isToday = ts => {
  if (!ts) return false;
  const d = new Date(ts), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
const isLate = t => t.due && !t.done && t.due < Date.now() && !isToday(t.due);
const shortDate = ts => {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const fullShort = ts => {
  if (!ts) return '—';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** 窄屏只保留截止列，避免列溢出 */
const visibleCols = () => COLS.filter(c => window.innerWidth >= 760 || c.id === 'due');
const gridStyle = () =>
  `grid-template-columns: 22px 10px minmax(0,1fr) ${visibleCols().map(() => '88px').join(' ')} 24px`;

/* ============================================================
   通用浮层菜单（锚在按钮下方，自动夹紧到视口）
   ============================================================ */
function openMenu(anchor, items) {
  document.querySelector('.todo-menu')?.remove();
  const menu = el('div', { class: 'todo-menu', role: 'menu' });
  const buttons = [];
  items.forEach(item => {
    const btn = el('button', {
      class: 'todo-menu-item' + (item.active ? ' active' : '') + (item.danger ? ' danger' : ''),
      role: 'menuitem', 'aria-current': item.active ? 'true' : null,
      onclick: () => { close(); item.onClick?.(); },
    }, item.label);
    buttons.push(btn);
    menu.append(btn);
  });
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  let top = rect.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menu.offsetHeight - 6);
  menu.style.top = top + 'px';
  const onKeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); anchor.focus?.(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const i = buttons.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? (i + 1) % buttons.length : (i <= 0 ? buttons.length - 1 : i - 1);
      buttons[next]?.focus();
    }
  };
  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', onKeydown);
  };
  const outside = event => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) close();
  };
  document.addEventListener('keydown', onKeydown);
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  buttons[0]?.focus();
}

/* ============================================================
   操作
   ============================================================ */
function addTodo(title, groupId = '', priority = 'medium', due = null, start = null, extra = {}) {
  if (!title?.trim()) return;
  insert('todos', {
    title: title.trim(), done: false, priority, start, due,
    note: extra.note || '', tags: Array.isArray(extra.tags) ? extra.tags : [],
    groupId, created: Date.now(), completedAt: null,
  });
}

function toggleTodo(id) {
  const todo = byId('todos', id);
  if (todo) {
    const done = !todo.done;
    update('todos', id, { done, completedAt: done ? Date.now() : null });
  }
}

/** 应用内确认弹窗：替代原生 confirm，键盘/焦点/主题一致 */
function confirmDialog({ title, message, confirmLabel = '删除', onConfirm }) {
  openModal(title, el('p', { class: 'sd-desc' }, message), [
    { label: '取消' },
    { label: confirmLabel, danger: true, onClick: close => { close(); onConfirm(); } },
  ]);
}
function askDeleteTodo(todo) {
  confirmDialog({
    title: '删除待办',
    message: `确定删除「${todo.title}」？此操作不可撤销。`,
    onConfirm: () => { remove('todos', todo.id); toast('已删除'); },
  });
}

function askGroup(onDone) {
  const name = input({ placeholder: '分组名称', maxlength: 30 });
  openModal('新建分组', el('div', {}, name), [
    { label: '取消' },
    { label: '创建', primary: true, onClick: close => {
      if (name.value.trim()) {
        // sort 取当前最大值 +1，作为记录字段持久化（可随 LWW 同步）
        const maxSort = state.todoGroups.reduce((m, g) => Math.max(m, g.sort ?? 0), -1);
        insert('todoGroups', { name: name.value.trim(), sort: maxSort + 1, created: Date.now() });
        onDone?.();
        close();
      }
    } },
  ]);
}

/** 重命名自定义分组：仅改分组名，待办归属不变 */
function askRenameGroup(id, oldName) {
  const name = input({ value: oldName, placeholder: '分组名称', maxlength: 30 });
  openModal('重命名分组', el('div', {}, name), [
    { label: '取消' },
    { label: '保存', primary: true, onClick: close => {
      const value = name.value.trim();
      if (value && value !== oldName) {
        update('todoGroups', id, { name: value });
        bus.emit('route');
        toast('分组已重命名');
      }
      close();
    } },
  ]);
}

/** 删除自定义分组：组内待办先移到未分组，再软删分组 */
function deleteGroup(id, name) {
  for (const todo of alive('todos').filter(t => t.groupId === id)) {
    update('todos', todo.id, { groupId: '' });
  }
  remove('todoGroups', id);
  bus.emit('route');
  toast(`分组「${name}」已删除，待办已移到未分组`);
}

/**
 * 标签胶囊编辑器：回车 / 逗号添加，× 删除，退格删最后一个。
 * 新建与详情共用；getTags() 读取当前标签（含输入框内尚未回车的内容）。
 */
function tagEditor(initial = [], onChange) {
  const wrap = el('div', { class: 'tag-editor' });
  const chips = el('div', { class: 'tag-chips' });
  const entry = el('input', {
    type: 'text', class: 'tag-entry', maxlength: 24,
    placeholder: '输入标签后回车添加', 'aria-label': '添加标签',
  });
  wrap.append(chips, entry);
  let tags = [...initial];

  const emit = () => onChange?.(tags.slice());
  const render = () => {
    chips.innerHTML = '';
    tags.forEach((tag, i) => chips.append(el('span', { class: 'tag-chip' },
      el('span', {}, tag),
      el('button', {
        type: 'button', class: 'tag-chip-del',
        title: `删除标签「${tag}」`, 'aria-label': `删除标签「${tag}」`,
        // 阻止 blur，避免删标签时先把输入框待提交内容 add 进来导致错位
        onmousedown: event => event.preventDefault(),
        onclick: () => { tags.splice(i, 1); render(); emit(); },
      }, '×'))));
  };

  const add = raw => {
    const value = String(raw || '').trim().replace(/^[,，]+|[,，]+$/g, '');
    entry.value = '';
    if (!value || tags.includes(value)) return;
    tags.push(value);
    render();
    emit();
  };

  entry.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
      event.preventDefault();
      add(entry.value);
    } else if (event.key === 'Backspace' && !entry.value && tags.length) {
      event.preventDefault();
      tags.pop(); render(); emit();
    }
  });
  entry.addEventListener('blur', () => { if (entry.value.trim()) add(entry.value); });

  render();
  wrap.getTags = () => {
    const pending = String(entry.value || '').trim().replace(/^[,，]+|[,，]+$/g, '');
    return pending && !tags.includes(pending) ? [...tags, pending] : [...tags];
  };
  return wrap;
}

/**
 * 任务表单字段：新建与详情共用同一套命名、顺序与栅格，保证两个界面一致。
 * 顺序：标题 → 开始时间 / 截止日期 → 分组 / 优先级 → 标签 → 备注
 */
function todoFields({ title, start, due, priority, group, tags, note }) {
  return [
    field('标题', title),
    el('div', { class: 'prop-grid' },
      field('开始时间', start), field('截止日期', due)),
    el('div', { class: 'prop-grid' },
      field('分组', group), field('优先级', priority)),
    field('标签', tags),
    field('备注', note),
  ];
}

/** 新建任务弹窗：与待办详情使用相同的字段结构与顺序 */
function askNewTask() {
  const title = input({ placeholder: '输入任务标题…', maxlength: 120 });
  const group = el('select', { class: 'input select' },
    el('option', { value: '' }, '未分组'),
    ...alive('todoGroups').map(g => el('option', { value: g.id }, g.name)));
  const priority = el('select', { class: 'input select' },
    ...Object.entries(PRIO_LABEL).map(([key, label]) => el('option', { value: key }, label)));
  priority.value = 'medium';
  const start = el('input', { type: 'date', class: 'input' });
  const due = el('input', { type: 'date', class: 'input' });
  const tags = tagEditor();
  const note = el('textarea', { class: 'input textarea', placeholder: '备注…' });

  openModal('新建任务', el('div', { class: 'todo-form-card' },
    ...todoFields({ title, priority, start, due, group, tags, note })), [
    { label: '取消' },
    { label: '创建', primary: true, onClick: close => {
      if (!title.value.trim()) return;
      addTodo(
        title.value,
        group.value,
        priority.value,
        due.value ? new Date(due.value).getTime() : null,
        start.value ? new Date(start.value).getTime() : null,
        { note: note.value, tags: tags.getTags() },
      );
      close();
      toast('已创建任务');
    } },
  ]);
}

/* ============================================================
   过滤 / 排序 / 分组
   ============================================================ */
function filtered() {
  let list = alive('todos');
  if (view === 'undone') list = list.filter(t => !t.done);
  else if (view === 'done') list = list.filter(t => t.done);

  const arr = [...list];
  if (sortBy === 'due') arr.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  else if (sortBy === 'created') arr.sort((a, b) => b.created - a.created);
  else if (sortBy === 'priority') arr.sort((a, b) => (PRIO[a.priority] ?? 1) - (PRIO[b.priority] ?? 1));
  else arr.sort((a, b) => (a.done - b.done) || (PRIO[a.priority] ?? 1) - (PRIO[b.priority] ?? 1));
  return arr;
}

function sections(todos) {
  if (groupBy === 'group') {
    const groups = alive('todoGroups');
    const list = groups.map(g => ({
      id: 'g:' + g.id, name: g.name, groupId: g.id,
      todos: todos.filter(t => t.groupId === g.id),
    }));
    list.push({
      id: 'ungrouped', name: '未分组', groupId: '',
      todos: todos.filter(t => !t.groupId || !groups.some(g => g.id === t.groupId)),
    });
    return list;
  }
  if (groupBy === 'priority') {
    return Object.entries(PRIO_LABEL).map(([key, label]) => ({
      id: 'p:' + key, name: label + '优先级', priority: key,
      todos: todos.filter(t => t.priority === key),
    }));
  }
  if (groupBy === 'due') {
    return [
      { id: 'd:late', name: '已逾期', todos: todos.filter(isLate) },
      { id: 'd:today', name: '今天', todos: todos.filter(t => isToday(t.due)) },
      { id: 'd:future', name: '未来', todos: todos.filter(t => t.due && !isToday(t.due) && !isLate(t)) },
      { id: 'd:none', name: '无截止日', todos: todos.filter(t => !t.due) },
    ];
  }
  return [{ id: 'all', name: '全部任务', todos }];
}

/* ============================================================
   视图片段
   ============================================================ */
function dataCell(id, content) {
  if (!visibleCols().some(c => c.id === id)) return null;
  return el('span', { class: `todo-cell cell-${id}` }, content);
}

function todoRow(todo) {
  const checkbox = el('input', {
    type: 'checkbox', class: 'todo-cb', onchange: () => toggleTodo(todo.id),
  });
  checkbox.checked = !!todo.done;

  const titleCell = el('div', { class: 'todo-title-wrap' },
    el('button', { class: 'todo-title', onclick: () => router.open('todo', todo.id) }, todo.title),
    (todo.tags || []).length
      ? el('span', { class: 'todo-tags' }, todo.tags.slice(0, 3).map(tag => el('span', { class: 'todo-tag' }, tag)))
      : null);

  return el('div', { class: 'todo-row' + (todo.done ? ' done' : ''), style: gridStyle() },
    checkbox,
    el('span', {
      class: `prio-dot ${todo.priority}`,
      role: 'img', 'aria-label': `优先级：${PRIO_LABEL[todo.priority] || '中'}`,
    }),
    titleCell,
    dataCell('start', el('span', { class: 'todo-date' }, shortDate(todo.start))),
    dataCell('due', el('span', {
      class: 'todo-date' + (isLate(todo) ? ' late' : isToday(todo.due) ? ' today' : ''),
    }, shortDate(todo.due))),
    dataCell('created', el('span', { class: 'todo-date muted' }, fullShort(todo.created))),
    el('button', {
      class: 'icon-btn todo-del', title: '删除', 'aria-label': `删除待办「${todo.title}」`,
      onclick: () => askDeleteTodo(todo),
    }, el('span', { class: 'icon', html: icons.trash })));
}

/** 每组下方的「新建任务」入口（点击展开输入，回车创建到该组） */
function inlineNew(sec) {
  const wrap = el('div', { class: 'todo-inline-new' });
  wrap.append(el('button', {
    class: 'todo-inline-btn',
    onclick: () => {
      wrap.innerHTML = '';
      const fieldInput = input({ placeholder: '新建任务，回车创建…', class: 'todo-inline-input', maxlength: 120 });
      wrap.append(fieldInput);
      fieldInput.focus();
      const commit = () => {
        const value = fieldInput.value.trim();
        if (value) addTodo(value, sec.groupId || '', sec.priority || 'medium');
        bus.emit('route');
      };
      fieldInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') bus.emit('route');
      });
      fieldInput.addEventListener('blur', () => { if (!fieldInput.value.trim()) bus.emit('route'); });
    },
  }, el('span', { class: 'icon', html: icons.plus }), '新建任务'));
  return wrap;
}

function sectionNode(sec) {
  const isCollapsed = collapsed.has(sec.id);
  const head = el('button', {
    class: 'todo-group-head',
    onclick: () => {
      if (isCollapsed) collapsed.delete(sec.id);
      else collapsed.add(sec.id);
      bus.emit('route');
    },
  },
    el('span', { class: 'icon chev' + (isCollapsed ? '' : ' open'), html: icons.chevronDown }),
    el('span', {}, sec.name),
    el('span', { class: 'todo-group-count' }, String(sec.todos.length)));

  // 仅真实自定义分组有管理菜单；未分组/优先级/截止日等虚拟分组没有 groupId
  const more = sec.groupId
    ? el('button', {
        class: 'todo-group-more', title: '分组操作', 'aria-label': `分组「${sec.name}」操作菜单`,
        onclick: event => openMenu(event.currentTarget, [
          { label: '重命名', onClick: () => askRenameGroup(sec.groupId, sec.name) },
          { label: '删除', danger: true, onClick: () => confirmDialog({
            title: '删除分组',
            message: `删除分组「${sec.name}」？组内待办将移到未分组。`,
            onConfirm: () => deleteGroup(sec.groupId, sec.name),
          }) },
        ]),
      }, '⋯')
    : null;

  const body = el('div', { class: 'todo-group-body' });
  if (!isCollapsed) {
    sec.todos.forEach(todo => body.append(todoRow(todo)));
    body.append(inlineNew(sec));
  }
  return el('div', { class: 'todo-group' },
    el('div', { class: 'todo-group-head-row' }, head, more),
    body);
}

/** 精简工具栏：新建（下拉任务/分组）+ 排序 + 分组 */
function toolbar() {
  return el('div', { class: 'todo-toolbar-fs' },
    el('button', {
      class: 'btn todo-new',
      onclick: event => openMenu(event.currentTarget, [
        { label: '新建任务', onClick: askNewTask },
        { label: '新建分组', onClick: () => askGroup(() => bus.emit('route')) },
      ]),
    },
      el('span', { class: 'icon', html: icons.plus }), '新建'),
    el('button', {
      class: 'todo-tbtn',
      onclick: event => openMenu(event.currentTarget, Object.entries(SORT_LABEL).map(([key, label]) => ({
        label: '排序：' + label, active: sortBy === key,
        onClick: () => { sortBy = key; bus.emit('route'); },
      }))),
    }, el('span', { class: 'icon', html: icons.sort }), '排序：' + SORT_LABEL[sortBy]),
    el('button', {
      class: 'todo-tbtn',
      onclick: event => openMenu(event.currentTarget, Object.entries(GROUP_LABEL).map(([key, label]) => ({
        label: '分组：' + label, active: groupBy === key,
        onClick: () => { groupBy = key; collapsed.clear(); bus.emit('route'); },
      }))),
    }, el('span', { class: 'icon', html: icons.folder }), '分组：' + GROUP_LABEL[groupBy]));
}

/* ============================================================
   扩展注册
   ============================================================ */
registry.add({
  id: 'todo',
  name: 'TODO',
  icon: icons.todo,
  order: 1.9,
  group: 'main',
  mounts: ['left'],
  domains: ['todos', 'todoGroups'], // center / right 只依赖这两个域：其他域变更时不重绘主内容
  desc: '分组待办、优先级、开始/截止日、标签，精简工具栏与分组视图。首个真实业务扩展样板。',
  readme: TODO_README,
  docFile: 'docs/extensions/todo.md',
  links: [{ label: '完整文档', href: 'docs/extensions/todo.md' }],

  badge() {
    return alive('todos').filter(t => !t.done).length || null;
  },

  home() {
    view = view === 'detail' ? 'all' : view;
    const todos = filtered();

    const tabs = el('div', { class: 'todo-tabs', role: 'tablist', 'aria-label': '待办筛选' },
      ...[['all', '全部'], ['undone', '未完成'], ['done', '已完成']].map(([key, label]) =>
        el('button', {
          class: 'todo-tab' + (view === key ? ' active' : ''),
          role: 'tab', 'aria-selected': String(view === key),
          onclick: () => { view = key; bus.emit('route'); },
        }, label)));

    const body = el('div', { class: 'todo-body' });
    const list = sections(todos);
    if (list.length) list.forEach(sec => body.append(sectionNode(sec)));
    else body.append(el('div', { class: 'empty big' }, '没有符合条件的待办'));

    return el('div', { class: 'page todo-page' },
      pageHeader({
        title: 'TODO',
        actions: [el('button', {
          class: 'tag tag-btn' + (rightPanelOpen() ? ' active' : ''),
          title: '展开/收起右侧功能面板',
          'aria-label': `展开或收起右侧面板，${alive('todos').filter(t => !t.done).length} 项待完成`,
          'aria-pressed': String(rightPanelOpen()),
          onclick: toggleRightPanel,
        }, `${alive('todos').filter(t => !t.done).length} 待完成`)],
      }),
      toolbar(),
      tabs,
      body);
  },

  detail(id) {
    const todo = byId('todos', id);
    if (!todo) {
      return el('div', { class: 'page' },
        pageHeader({ title: 'TODO', back: true }),
        el('div', { class: 'empty' }, '待办不存在'));
    }

    const title = input({ value: todo.title, class: 'input', maxlength: 120 });
    title.addEventListener('change', () =>
      update('todos', id, { title: title.value.trim() || todo.title }));

    const note = el('textarea', { class: 'input textarea', placeholder: '备注…' }, todo.note || '');
    let noteTimer = null;
    const saveNote = () => update('todos', id, { note: note.value });
    note.addEventListener('input', () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(saveNote, 500);
    });
    note.addEventListener('blur', () => {
      clearTimeout(noteTimer);
      if (byId('todos', id)?.note !== note.value) saveNote();
    });

    const priority = el('select', { class: 'input select' },
      Object.entries(PRIO_LABEL).map(([key, label]) => {
        const option = el('option', { value: key }, label);
        if (todo.priority === key) option.selected = true;
        return option;
      }));
    priority.addEventListener('change', () => update('todos', id, { priority: priority.value }));

    const dateInput = (value, onChange) => {
      const node = el('input', {
        type: 'date', class: 'input',
        value: value ? new Date(value).toISOString().slice(0, 10) : '',
      });
      node.addEventListener('change', () => onChange(node.value ? new Date(node.value).getTime() : null));
      return node;
    };
    const start = dateInput(todo.start, value => update('todos', id, { start: value }));
    const due = dateInput(todo.due, value => update('todos', id, { due: value }));

    const group = el('select', { class: 'input select' },
      el('option', { value: '' }, '未分组'),
      ...alive('todoGroups').map(g => {
        const option = el('option', { value: g.id }, g.name);
        if (todo.groupId === g.id) option.selected = true;
        return option;
      }));
    group.addEventListener('change', () => update('todos', id, { groupId: group.value }));

    const tags = tagEditor(todo.tags || [], next => update('todos', id, { tags: next }));

    const doneCbId = 'todo-done-' + id;
    const doneCheckbox = el('input', {
      type: 'checkbox', id: doneCbId, onchange: () => toggleTodo(id),
    });
    doneCheckbox.checked = !!todo.done;

    return el('div', { class: 'page narrow' },
      pageHeader({
        title: '待办详情', back: true,
        actions: [el('button', {
          class: 'btn danger',
          onclick: () => confirmDialog({
            title: '删除待办',
            message: `确定删除「${todo.title}」？此操作不可撤销。`,
            onConfirm: () => { remove('todos', id); router.go('todo'); toast('已删除'); },
          }),
        }, '删除')],
      }),
      el('div', { class: 'todo-form-card' },
        el('div', { class: 'todo-detail-state' }, doneCheckbox,
          el('label', { for: doneCbId }, todo.done ? '标记为未完成' : '标记为已完成')),
        ...todoFields({ title, priority, start, due, group, tags, note })));
  },

  panel() {
    const items = alive('todos');
    const done = items.filter(t => t.done).length;
    const pending = items.length - done;
    const late = items.filter(isLate).length;
    const groups = alive('todoGroups');
    const row = (key, value) => el('div', { class: 'insp-row' },
      el('span', { class: 'insp-key' }, key), el('span', { class: 'insp-val' }, String(value)));

    return el('div', {},
      el('div', { class: 'insp-section' },
        el('div', { class: 'insp-label' }, '概览'),
        row('待完成', pending), row('已完成', done), row('已逾期', late),
        row('完成率', (items.length ? Math.round(done / items.length * 100) : 0) + '%')),
      el('div', { class: 'insp-section' },
        el('div', { class: 'insp-label' }, '分组分布'),
        ...groups.map(g => row(g.name, items.filter(t => t.groupId === g.id).length)),
        row('未分组', items.filter(t => !t.groupId).length)));
  },

  status() {
    const items = alive('todos');
    const pending = items.filter(t => !t.done).length;
    const late = items.filter(isLate).length;
    return `${pending} 待办未完成${late ? ` · ${late} 逾期` : ''}`;
  },
});
