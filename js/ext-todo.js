/* ext-todo.js — 任务扩展（首个真实业务扩展，后续扩展的样板）
 *
 * 展示标准扩展契约的完整用法：五钩子 + 通用 DAO + 领域声明 + 同步元数据（自动）。
 * UI 借鉴飞书任务：精简工具栏（新建 / 排序 / 分组）+ 分组折叠计数 + 每组新建入口，
 * 保留分组卡片风格；新建下拉同时提供新建任务与新建分组。
 */
import {
  el, registry, icons, router, pageHeader, openModal, input, toast, bus, field, refreshAllData,
} from './core.js';
import {
  state, declareDomain, insert, update, remove, alive, byId,
} from './data.js';

/* README：应用内「扩展详情 › README」展示的精简版；完整文档见 docs/extensions/todo.md */
const TODO_README = [
  '# 任务扩展',
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
  '',
  '待办数在标题栏角标显示；主视图为「新建/排序/分组」工具栏 + 分组任务列表 + 列标题。',
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
  '| `groupId` | string | 所属分组，空串表示默认组 |',
  '| `meta` | object | `{updatedAt, updatedBy, deletedAt, rev}`；分组记录另有 `name/sort/created` |',
  '',
  '分组表为完整同步表（四同步列齐备）；`sort` 为记录字段，可随 LWW 同步。',
  '删除走 `remove()` 软删除墓碑。所有分组均为真实记录，无虚拟未分组：无分组时新建任务自动创建“默认”组；删除分组连带删除组内待办（二次确认）。',
  '',
  '## 4. 视图与交互',
  '',
  '主视图三个 tab：**全部 / 未完成 / 已完成**。',
  '',
  '- 工具栏「新建」下拉：新建任务 / 新建分组；右侧「排序」「分组」下拉切换维度',
  '- 每行：圆形复选框切换完成、标题进详情、优先级色点、标签、截止日、删除',
  '- 新建任务统一走工具栏「新建」下拉，可在弹窗中选择分组',
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
   领域声明（初始为空，不注入示例数据）
   ============================================================ */
declareDomain('todos', []);
declareDomain('todoGroups', []);

/* ============================================================
   视图状态（模块内，不持久化）
   ============================================================ */
let view = 'all';            // all | undone | done
let sortBy = 'default';      // default | due | created | priority
let groupBy = 'group';       // group | priority | due | none
const collapsed = new Set();
let sortableInstances = [];  // SortableJS 实例缓存，重绘前销毁避免重复绑定

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
/**
 * 纯函数：新建任务时决定归属分组 id。
 * 无真实分组 → 返回 null（调用方自动建"默认"组）；有分组 → 选中 id 有效则用，否则回退第一个。
 */
export function ensureGroupForNewTask(groups, selectedId) {
  if (!groups || groups.length === 0) return null;
  return groups.some(g => g.id === selectedId) ? selectedId : groups[0].id;
}

/** 纯函数：返回属于指定分组的待办 id 列表（删除分组连带删除用） */
export function todoIdsInGroup(todos, groupId) {
  return todos.filter(t => t.groupId === groupId).map(t => t.id);
}

function addTodo(title, groupId = '', priority = 'medium', due = null, start = null, extra = {}) {
  if (!title?.trim()) return;
  const groups = alive('todoGroups');
  let targetGroupId = ensureGroupForNewTask(groups, groupId);
  if (targetGroupId === null) {
    // 无任何分组：自动创建一个真实的"默认"分组并归属它
    const id = insert('todoGroups', { name: '默认', sort: 0, created: Date.now() });
    targetGroupId = typeof id === 'string' ? id : (id?.id ?? '');
  }
  insert('todos', {
    title: title.trim(), done: false, priority, start, due,
    note: extra.note || '', tags: Array.isArray(extra.tags) ? extra.tags : [],
    groupId: targetGroupId, created: Date.now(), completedAt: null,
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

/** 删除分组：连带软删组内所有待办（调用方已二次确认），再软删分组 */
function deleteGroup(id, name) {
  const ids = todoIdsInGroup(alive('todos'), id);
  for (const todoId of ids) remove('todos', todoId);
  remove('todoGroups', id);
  bus.emit('route');
  toast(`分组「${name}」及其 ${ids.length} 条待办已删除`);
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
/** 必填字段标签：标题后带红色星号 */
const requiredLabel = text =>
  el('span', {}, text, el('span', { class: 'field-req', 'aria-label': '必填' }, ' *'));

function todoFields({ title, start, due, priority, group, tags, note }) {
  return [
    field(requiredLabel('标题'), title),
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
  const groups = alive('todoGroups');
  const group = el('select', { class: 'input select' },
    ...groups.map(g => el('option', { value: g.id }, g.name)));
  group.disabled = groups.length === 0; // 无分组时由 addTodo 自动建"默认"组
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
    // 所有分组均为真实记录（无虚拟默认组），按 sort 升序，全部可拖动
    const groups = alive('todoGroups').slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    return groups.map(g => ({
      id: 'g:' + g.id, name: g.name, groupId: g.id,
      todos: todos.filter(t => t.groupId === g.id),
    }));
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

  const handle = el('span', {
    class: 'todo-drag-handle' + (groupBy === 'group' ? '' : ' hidden'),
    title: '拖动移动到其他分组', 'aria-label': '拖动待办',
    html: '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="2" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/><circle cx="2" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="2" cy="13" r="1.2"/><circle cx="8" cy="13" r="1.2"/></svg>',
  });

  // 手柄在任务框外（左侧），但同一 draggable 单元内，SortableJS 以 .todo-row-wrap 为拖动项
  const row = el('div', { class: 'todo-row' + (todo.done ? ' done' : ''), style: gridStyle() },
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

  return el('div', { class: 'todo-row-wrap', 'data-todo-id': todo.id }, handle, row);
}

/** 列标题行：与任务行共用 grid 模板，严格对齐；仅自定义分组视图显示 */
function headerRow() {
  return el('div', { class: 'todo-header-row', style: gridStyle(), 'aria-hidden': 'true' },
    el('span'),                                   // 复选框列
    el('span'),                                   // 优先级列
    el('span', { class: 'todo-head-label' }, '标题'),
    ...visibleCols().map(c => el('span', { class: 'todo-head-label' }, c.label)),
    el('span'));                                  // 删除列
}

/**
 * 纯函数：从 DOM 顺序的 group id 列表生成 sort 映射。
 * 过滤空 id（无虚拟默认组），所有真实分组 sort 从 0 连续编号。
 */
export function sortOrdersFromDomIds(domIds) {
  const orders = new Map();
  domIds.filter(id => id).forEach((id, i) => orders.set(id, i));
  return orders;
}

/** SortableJS 分组 onEnd：按 DOM 新顺序把自定义分组 sort 重置为 0..n-1（默认组 DOM 固定第一，不参与） */
function syncGroupOrderFromDOM(container) {
  const domIds = [...container.querySelectorAll('.todo-group[data-group-id]')].map(n => n.dataset.groupId);
  const orders = sortOrdersFromDomIds(domIds);
  let changed = false;
  for (const [id, sort] of orders) {
    if (byId('todoGroups', id)?.sort !== sort) { update('todoGroups', id, { sort }); changed = true; }
  }
  if (changed) bus.emit('route');
}

/** SortableJS 任务 onEnd：任务被拖到目标容器 → 更新 groupId（默认组容器 data-group-id=''） */
function syncTodoGroupFromDOM(evt) {
  const todoId = evt.item?.dataset?.todoId;
  const toGroupId = evt.to?.dataset?.groupId;
  if (!todoId || toGroupId === undefined) return;
  const todo = byId('todos', todoId);
  if (!todo || (todo.groupId || '') === toGroupId) return;
  update('todos', todoId, { groupId: toGroupId });
  bus.emit('route');
}

/** 初始化 SortableJS：分组排序 + 任务跨组拖动；重绘前先销毁旧实例 */
function initSortables(body) {
  sortableInstances.forEach(s => s.destroy());
  sortableInstances = [];
  if (groupBy !== 'group' || !window.Sortable) return;

  // 分组排序：handle 限定在自定义分组的标题行（默认组无 data-group-id，不可拖）
  const groupSort = window.Sortable.create(body, {
    handle: '.todo-group-head-row[data-group-handle]',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: () => syncGroupOrderFromDOM(body),
  });
  sortableInstances.push(groupSort);

  // 任务跨组：每个分组 body 是一个列表，同名 group 允许互相拖
  body.querySelectorAll('.todo-group-body').forEach(list => {
    const todoSort = window.Sortable.create(list, {
      group: 'workhub-todos',
      handle: '.todo-drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      draggable: '.todo-row-wrap',
      onEnd: syncTodoGroupFromDOM,
    });
    sortableInstances.push(todoSort);
  });
}

function sectionNode(sec) {
  const isCollapsed = collapsed.has(sec.id);
  const isReal = !!sec.groupId; // 真实自定义分组才参与拖动排序；默认/虚拟分组不可拖

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

  // 分组标题行：自定义分组带 data-group-handle 供 SortableJS 作为拖动手柄（左侧图标）
  const headRow = el('div', {
    class: 'todo-group-head-row',
    ...(isReal && groupBy === 'group' ? { 'data-group-handle': '1' } : {}),
  });
  if (isReal && groupBy === 'group') {
    headRow.append(el('span', {
      class: 'todo-group-drag-handle', title: '拖动调整分组顺序', 'aria-label': '拖动分组',
      html: '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor"><circle cx="2" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/><circle cx="2" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="2" cy="13" r="1.2"/><circle cx="8" cy="13" r="1.2"/></svg>',
    }));
  }
  headRow.append(head);

  // 仅真实自定义分组有管理菜单；默认/优先级/截止日等虚拟分组没有 groupId
  const more = isReal
    ? el('button', {
        class: 'todo-group-more', title: '分组操作', 'aria-label': `分组「${sec.name}」操作菜单`,
        onclick: event => openMenu(event.currentTarget, [
          { label: '重命名', onClick: () => askRenameGroup(sec.groupId, sec.name) },
          { label: '删除', danger: true, onClick: () => confirmDialog({
            title: '删除分组',
            message: `删除分组「${sec.name}」？组内 ${sec.todos.length} 条待办将一并删除，不可撤销。`,
            onConfirm: () => deleteGroup(sec.groupId, sec.name),
          }) },
        ]),
      }, '⋯')
    : null;
  if (more) headRow.append(more);

  const body = el('div', { class: 'todo-group-body', 'data-group-id': sec.groupId || '' });
  if (!isCollapsed) {
    sec.todos.forEach(todo => body.append(todoRow(todo)));
  }

  const groupNode = el('div', {
    class: 'todo-group',
    'data-group-id': sec.groupId,
  }, headRow, body);
  return groupNode;
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
  name: '任务',
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
    initSortables(body); // SortableJS：分组排序 + 任务跨组拖动（仅自定义分组视图）

    return el('div', { class: 'page todo-page' },
      pageHeader({ title: '任务', actions: [el('button', {
        class: 'icon-btn todo-refresh',
        title: '刷新数据（云端同步 + 本地回读）',
        'aria-label': '刷新任务数据',
        onclick: refreshAllData,
      }, el('span', { class: 'icon', html: icons.refresh }))] }),
      toolbar(),
      tabs,
      groupBy === 'group' ? headerRow() : null,
      body);
  },

  detail(id) {
    const todo = byId('todos', id);
    if (!todo) {
      return el('div', { class: 'page' },
        pageHeader({ title: '任务', back: true }),
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

    const aliveGroups = alive('todoGroups');
    // 归属组不在列表（异常/旧数据）时补一个只读占位，避免选中态丢失
    if (todo.groupId && !aliveGroups.some(g => g.id === todo.groupId)) {
      aliveGroups.push({ id: todo.groupId, name: '（原分组已删除）' });
    }
    const group = el('select', { class: 'input select' },
      ...aliveGroups.map(g => {
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

});
