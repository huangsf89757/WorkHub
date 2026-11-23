/* md.js — 极简 Markdown 子集渲染器（零依赖，遵循 WorkHub 零构建约束）
 *
 * 支持块：# 标题 / 段落 / - 与 1. 列表 / > 引用 / ``` 代码块 / | 表格 / --- 分隔线
 * 支持行内：**粗体** `代码` [文本](链接) \*转义
 * 全程用 DOM 构建（textContent / el），不注入 innerHTML —— README 内容即使含 HTML 也不会执行。
 */
import { el } from './core.js';

/** 行内 token 化：粗体 / 行内代码 / 链接，其余为纯文本 */
function inline(text) {
  const out = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m;
  const pushText = s => {
    if (s) out.push(document.createTextNode(s.replace(/\\([*_`|[\]])/g, '$1')));
  };
  while ((m = re.exec(text))) {
    pushText(text.slice(last, m.index));
    const t = m[0];
    if (t[0] === '`') out.push(el('code', { class: 'md-code-inline' }, t.slice(1, -1)));
    else if (t.slice(0, 2) === '**') out.push(el('strong', {}, t.slice(2, -2)));
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      if (link) out.push(el('a', { class: 'md-link', href: link[2], target: '_blank', rel: 'noopener' }, link[1]));
      else pushText(t);
    }
    last = re.lastIndex;
  }
  pushText(text.slice(last));
  return out;
}

/** 表格单元格拆分：先转义 \| 占位，避免把单元格内的竖线切断 */
function cells(line) {
  let s = line.trim().replace(/\\\|/g, '\u0000');
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(x => x.trim().replace(/\u0000/g, '|'));
}
const isTableSep = line => line.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);

/** 把 Markdown 文本渲染成 DOM 节点数组 */
export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // 代码块
    if (/^```/.test(line.trim())) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
      i++; // 闭合符
      out.push(el('pre', { class: 'md-code' }, el('code', {}, buf.join('\n'))));
      continue;
    }
    // 分隔线
    if (/^(---+|\*\*\*+)$/.test(line.trim())) { out.push(el('hr', { class: 'md-hr' })); i++; continue; }
    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push(el('h' + Math.min(h[1].length, 4), { class: 'md-h' }, inline(h[2]))); i++; continue; }
    // 引用（连续 > 行）
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(el('blockquote', { class: 'md-quote' }, buf.map(b => el('div', {}, inline(b)))));
      continue;
    }
    // 表格
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(cells(lines[i++]));
      out.push(el('div', { class: 'md-table-wrap' },
        el('table', { class: 'md-table' },
          el('thead', {}, el('tr', {}, head.map(c => el('th', {}, inline(c))))),
          el('tbody', {}, body.map(row => el('tr', {}, row.map(c => el('td', {}, inline(c)))))))));
      continue;
    }
    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(el('li', {}, inline(lines[i++].replace(/^\s*[-*]\s+/, ''))));
      }
      out.push(el('ul', { class: 'md-list' }, items));
      continue;
    }
    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(el('li', {}, inline(lines[i++].replace(/^\s*\d+\.\s+/, ''))));
      }
      out.push(el('ol', { class: 'md-list' }, items));
      continue;
    }
    // 段落：合并连续普通行
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim()
      && !/^(#{1,6}\s|>|```|---\s*$|\s*[-*]\s+|\s*\d+\.\s+|\|)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(el('p', { class: 'md-p' }, inline(buf.join(' '))));
  }
  return out;
}

export default renderMarkdown;
