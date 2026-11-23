/* storage.js — 存储适配器抽象层
 *
 * 业务层只认 init / persist / flush 三个动作，不关心数据落在 SQLite 还是云端。
 * 当前适配器：LocalAdapter（sql.js WASM + IndexedDB，见 db.js）。
 * 未来：CloudAdapter 由 sync.js 在凭据就绪时注入。换后端不改业务代码。
 *
 * 适配器契约：
 *   name                     标识
 *   init(state)              async，打开存储、首次导入或恢复
 *   persistDomain(key, arr)   sync/async，写一个领域全集
 *   flush()                   async，强制落盘
 *   info()                    诊断信息
 */

let adapter = null;
/** 扩展声明的自带表（declareDomain 的 table 选项）。适配器可能晚于扩展注册，所以先缓存再补发。 */
const domainSpecs = new Map();
export function registerAdapter(a) {
  adapter = a;
  for (const [key, spec] of domainSpecs) adapter.registerDomain?.(key, spec);
}
/** 扩展声明自己的持久化表：spec = { table: 'ext_<扩展id>_<名称>' }，无需修改适配器 */
export function registerDomainStorage(key, spec) {
  domainSpecs.set(key, spec);
  try { adapter?.registerDomain?.(key, spec); }
  catch (e) { console.warn('[storage] registerDomain failed', key, e); }
}
export const getAdapter = () => adapter;

/** 未初始化适配器时静默降级，保证 UI 永不因存储不可用而崩 */
export async function initStorage(state) {
  if (!adapter) return false;
  try { await adapter.init(state); return true; }
  catch (e) { console.warn('[storage] init failed', e); return false; }
}

export function persist(key, records) {
  if (!adapter) return;
  try { adapter.persistDomain(key, records); }
  catch (e) { console.warn('[storage] persist failed', e); }
}

export async function flush() {
  if (!adapter?.flush) return;
  try { await adapter.flush(); }
  catch (e) { console.warn('[storage] flush failed', e); }
}

export const storageInfo = () => adapter?.info?.() ?? null;

/* ---------- 同步 outbox 持久化（可选能力：适配器未实现则退化为仅内存） ----------
 *   outboxAppend(entry)   entry = { seq, domain, op, record, at }
 *   outboxAck(seqs)       推送成功 / 被合并的条目出队
 *   outboxLoad()          启动时恢复未推送条目，按 seq 升序
 */
export function outboxAppend(entry) {
  try { adapter?.outboxAppend?.(entry); }
  catch (e) { console.warn('[storage] outboxAppend failed', e); }
}
export function outboxAck(seqs) {
  if (!seqs?.length) return;
  try { adapter?.outboxAck?.(seqs); }
  catch (e) { console.warn('[storage] outboxAck failed', e); }
}
export function outboxLoad() {
  try { return adapter?.outboxLoad?.() ?? []; }
  catch (e) { console.warn('[storage] outboxLoad failed', e); return []; }
}
