/* data-refresh.js — 手动刷新：云端同步 + 本地 SQLite 回读
 *
 * 供内核注入（core.setRefreshHandler），顶栏与扩展视图共用同一刷新语义：
 *   ① syncNowCloud()：上行本地 outbox + 下行远端记录并按 LWW 合并；
 *   ② reloadFromDb()：从 IndexedDB 最新快照回读所有域并重绘。
 * 任一步失败不抛出，结果交给内核 toast 提示；云端未启用时仍执行本地回读。
 */
import { syncNowCloud } from './cloud-sync.js';
import { reloadFromDb } from './db.js';
import { state } from './data.js';

/** 执行完整刷新，返回 { cloud, local, message }。 */
export async function refreshData() {
  let cloud = null;
  let cloudError = null;
  try {
    cloud = await syncNowCloud();
  } catch (e) {
    cloudError = e;
  }

  let local = false;
  let localError = null;
  try {
    local = await reloadFromDb(state);
  } catch (e) {
    localError = e;
  }

  const cloudText = cloudError ? `云端失败：${cloudError.message}`
    : cloud ? `上行 ${cloud.pushed} · 下行 ${Object.keys(cloud.pulled || {}).length} 域`
      : '云端未启用';
  const localText = localError ? `本地回读失败：${localError.message}`
    : local ? '本地已更新' : '本地无快照';
  return { cloud, local, message: `刷新完成 · ${cloudText} · ${localText}` };
}
