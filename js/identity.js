/* identity.js — 本地用户身份（单机默认 me）
 *
 * 家庭 / 组织模型已从基座撤销（组织结构待重新设计，将另立更通用的组织架构）。
 * 本模块只回答"当前用户是谁"，不再有家庭、可见范围、归属等概念。
 *
 * 设计约束：
 *   1. 身份是业务概念，不放在 platform.js（那里只管设备/运行环境）。
 *   2. 记录 meta 不再写入归属字段；用户维度仅在需要时由调用方显式读取。
 *   3. 依赖 base.js 的 store/bus（base 不反向依赖本模块，无循环）。
 */
import { store, bus } from './base.js';

export const DEFAULT_USER_ID = 'me';
export const DEFAULT_USER_NAME = '我';

/* ---------- 当前用户 ---------- */
export function getCurrentUserId() {
  return store.get('currentUserId', DEFAULT_USER_ID) || DEFAULT_USER_ID;
}

export function getCurrentUserName() {
  return store.get('currentUserName', DEFAULT_USER_NAME) || DEFAULT_USER_NAME;
}

/** 切换当前用户（未来登录态调用）；单机永不触发 */
export function setCurrentUser(id, name) {
  store.set('currentUserId', id);
  if (name !== undefined) store.set('currentUserName', name);
  bus.emit('user:change', { id, name });
}

/** 当前用户身份快照 */
export function currentUser() {
  return { id: getCurrentUserId(), name: getCurrentUserName() };
}

export default {
  DEFAULT_USER_ID, DEFAULT_USER_NAME,
  getCurrentUserId, getCurrentUserName, setCurrentUser, currentUser,
};
