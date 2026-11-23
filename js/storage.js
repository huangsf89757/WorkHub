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
export function registerAdapter(a) { adapter = a; }
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
