import type { Payload } from '../types';

/**
 * The last data payload, kept in this browser (IndexedDB) so the dashboard opens at once with the
 * figures it showed last time, while the fresh data downloads behind. The copy is replaced after
 * every successful download and is never read by anything else.
 */
const DB = 'eduport-sales';
const STORE = 'payload';
const KEY = 'latest';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function readCachedPayload(): Promise<Payload | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        const v = req.result as { savedAt?: number; text?: string } | undefined;
        db.close();
        if (!v || typeof v.text !== 'string' || !v.savedAt || Date.now() - v.savedAt > MAX_AGE_MS) { resolve(null); return; }
        try { const p = JSON.parse(v.text) as Payload; resolve(Array.isArray(p.rows) && Array.isArray(p.fields) ? p : null); } catch { resolve(null); }
      };
      req.onerror = () => { db.close(); resolve(null); };
    } catch { resolve(null); }
  });
}

export async function writeCachedPayload(payload: Payload): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ savedAt: Date.now(), text: JSON.stringify(payload) }, KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); resolve(); };
    } catch { resolve(); }
  });
}
