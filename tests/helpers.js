/* 测试辅助：在 Node 中模拟浏览器的最小存储环境 */
export function installLocalStorage({ quota = Infinity } = {}) {
  const map = new Map();
  globalThis.localStorage = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      const size = [...map].reduce((n, [key, val]) => n + key.length + val.length, 0) + k.length + v.length;
      if (size > quota) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
  };
  return map;
}
/** 极简内存版 indexedDB：只覆盖 db.js 用到的 open / objectStore.put/get */
export function installFakeIndexedDB() {
  const stores = {};
  const request = (run) => {
    const req = {};
    queueMicrotask(() => { try { req.result = run(); req.onsuccess?.(); } catch (e) { req.error = e; req.onerror?.(); } });
    return req;
  };
  globalThis.indexedDB = {
    open() {
      const names = new Set(Object.keys(stores));
      const conn = {
        objectStoreNames: { contains: n => names.has(n) },
        createObjectStore: n => { stores[n] ||= new Map(); names.add(n); },
        transaction: name => {
          const tx = {};
          tx.objectStore = () => ({
            put: (val, key) => { stores[name].set(key, val); queueMicrotask(() => tx.oncomplete?.()); },
            get: key => request(() => stores[name].get(key)),
          });
          return tx;
        },
      };
      const req = { result: conn };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };
  return stores;
}
/** 最小 window / document，仅满足模块加载期的探测与事件注册 */
export function installFakeBrowser() {
  globalThis.window = globalThis.window || { navigator: globalThis.navigator, addEventListener() {}, matchMedia: () => ({ matches: false }) };
  globalThis.document = globalThis.document || { addEventListener() {}, hidden: false };
}
