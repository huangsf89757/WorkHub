/* hlc.js — 单调时间戳（HLC 简化版），供 LWW 冲突判定使用
 *
 * 问题：设备时钟不同步时，纯 Date.now() 会让「时钟快」的设备永远胜出，
 *       且同一毫秒内的多次写入无法区分先后。
 * 做法：
 *   nextTs()   本地写入取 max(当前时间, 已见过的最大时间戳 + 1)，保证本机严格递增；
 *   observe()  合并远端记录时吸收其时间戳，之后本机的新写入一定晚于已见过的远端写入。
 * 保护：远端时间戳超前本机 MAX_DRIFT 以上视为异常时钟，不吸收（避免一台错乱设备拉高所有人）。
 */
export const MAX_DRIFT = 24 * 3600 * 1000;
let last = 0;
export function nextTs(now = Date.now()) {
  last = Math.max(now, last + 1);
  return last;
}
export function observe(ts, now = Date.now()) {
  if (!Number.isFinite(ts)) return;
  if (ts > now + MAX_DRIFT) return;
  if (ts > last) last = ts;
}
export const lastTs = () => last;
/** 仅供测试：重置内部状态 */
export function _reset() { last = 0; }
