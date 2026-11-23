/* identity.js — 用户与家庭身份上下文（多用户协作预留，v5）
 *
 * 单机默认：当前用户 = 'me'，家庭 = 'home'，绝不弹出登录、不改变现有 UI。
 * 未来升级为家庭工作台时：登录态写入 currentUserId/currentHouseholdId，
 * 业务层无需改动——所有归属判定都通过本模块读取。
 *
 * 设计约束：
 *   1. 身份是业务概念，不放在 platform.js（那里只管设备/运行环境）。
 *   2. 归属信息进记录 meta（userId/ownerId/scope/householdId），不改业务表列。
 *   3. 依赖 core.js 的 store/bus（core 不反向依赖本模块，无循环）。
 */
import { store, bus } from './core.js';

export const DEFAULT_USER_ID = 'me';
export const DEFAULT_USER_NAME = '我';
export const DEFAULT_HOUSEHOLD_ID = 'home';
export const DEFAULT_HOUSEHOLD_NAME = '我的家';

/** 可见范围：private 仅自己 / family 家庭成员 / shared 指定对象 */
export const VISIBILITY = Object.freeze({
  PRIVATE: 'private',
  FAMILY: 'family',
  SHARED: 'shared',
});

/** 成员角色：owner 家庭所有者 / member 普通成员（未来可加 admin/guest） */
export const ROLES = Object.freeze({
  OWNER: 'owner',
  MEMBER: 'member',
});

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

/* ---------- 当前家庭 ---------- */
export function getCurrentHouseholdId() {
  return store.get('currentHouseholdId', DEFAULT_HOUSEHOLD_ID) || DEFAULT_HOUSEHOLD_ID;
}

export function getCurrentHouseholdName() {
  return store.get('currentHouseholdName', DEFAULT_HOUSEHOLD_NAME) || DEFAULT_HOUSEHOLD_NAME;
}

/** 切换当前家庭（未来多家庭调用） */
export function setCurrentHousehold(id, name) {
  store.set('currentHouseholdId', id);
  if (name !== undefined) store.set('currentHouseholdName', name);
  bus.emit('household:change', { id, name });
}

/* ---------- 默认可见范围 ---------- */
export function getDefaultScope() {
  return store.get('defaultScope', VISIBILITY.PRIVATE) || VISIBILITY.PRIVATE;
}

export function setDefaultScope(scope) {
  store.set('defaultScope', scope);
  bus.emit('scope:change', scope);
}

/**
 * 生成一条记录的归属元数据片段（合并进 meta）。
 * 默认 ownerId=当前用户、scope=private、householdId=当前家庭，单机行为等价于"属于我"。
 * 传入 opts 可覆盖（未来"共享给家庭"的场景）。
 */
export function ownershipMeta(opts = {}) {
  const me = getCurrentUserId();
  return {
    ownerId: opts.ownerId ?? me,
    scope: opts.scope ?? getDefaultScope(),
    householdId: opts.householdId ?? getCurrentHouseholdId(),
  };
}

/** 判断当前用户是否为记录归属者（权限预留，未来扩展用） */
export function isOwner(record) {
  return (record?.meta?.ownerId ?? DEFAULT_USER_ID) === getCurrentUserId();
}

export default {
  DEFAULT_USER_ID, DEFAULT_HOUSEHOLD_ID, VISIBILITY, ROLES,
  getCurrentUserId, getCurrentUserName, setCurrentUser, currentUser,
  getCurrentHouseholdId, getCurrentHouseholdName, setCurrentHousehold,
  getDefaultScope, setDefaultScope, ownershipMeta, isOwner,
};
