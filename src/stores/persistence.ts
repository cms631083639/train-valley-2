/**
 * 底层持久化 I/O 原语（浏览器存储 + dev middleware 文件读写）。
 *
 * 从 stores/game.ts 抽出：这里只负责「读写 + 异常兜底」，不持有任何 store 状态、
 * 也不参与 seed 合并等业务编排——编排仍留在 store 里，便于单独替换存储实现。
 */

export const STORAGE_KEY = 'tv2-assistant-data-v2';

const DB_NAME = 'tv2-assistant';
const DB_VERSION = 1;
const STORE_NAME = 'data';

// ————————— IndexedDB —————————
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSave(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbLoad<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

// ————————— localStorage（JSON 包装，异常一律吞掉）—————————

/** 读取并 JSON.parse；不存在或解析失败返回 null */
export function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 写入（JSON.stringify），配额/隐私模式异常一律吞掉 */
export function writeLocal(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export function removeLocal(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ————————— dev middleware：直接读写 src/data/tv2.json —————————
// 注意：dev 优先文件系统、非 dev 才用浏览器存储，这一「优先级」由 store 的编排决定，
// 此处只提供两个原语。

/** GET /api/load-data —— 读取文件系统最新内容；失败 / 非 200 返回 null */
export async function fetchFileData<T = unknown>(): Promise<T | null> {
  try {
    const resp = await fetch('/api/load-data?t=' + Date.now());
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

/** POST /api/save-data —— 写回文件系统；返回 true 表示写入成功 */
export function pushFileData(payload: unknown): Promise<boolean> {
  return fetch('/api/save-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(async (r) => {
    const text = await r.text();
    try {
      const res = JSON.parse(text);
      if (res.ok) {
        console.log(`[store] 💾 已写入 src/data/tv2.json (${res.bytes} bytes)`);
        return true;
      }
      console.warn('[store] ⚠️ middleware 返回失败:', res.msg);
      return false;
    } catch {
      console.warn('[store] ⚠️ 响应非 JSON (status=' + r.status + '), body=' + text.slice(0, 100));
      return false;
    }
  }).catch((e: Error) => {
    console.warn('[store] ⚠️ middleware 请求失败:', e.message);
    return false;
  });
}
