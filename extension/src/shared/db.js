// IndexedDB of the extension origin (service worker, organizer and print pages): full text of
// the chats the user opened. Two stores: `chats` (messages for export) and `search` (title +
// normalised text only, so search never loads whole conversations).

const NAME = 'ai-chat-organizer';
const VERSION = 1;

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

/** @returns {Promise<IDBDatabase>} */
export function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'key' }).createIndex('service', 'service');
      if (!db.objectStoreNames.contains('search')) db.createObjectStore('search', { keyPath: 'key' }).createIndex('service', 'service');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

/** @template T @param {IDBRequest<T>} req @returns {Promise<T>} */
const done = (req) => new Promise((res, rej) => ((req.onsuccess = () => res(req.result)), (req.onerror = () => rej(req.error))));

/** @param {IDBTransaction} tx */
const finished = (tx) => new Promise((res, rej) => ((tx.oncomplete = () => res(undefined)), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error))));

/**
 * Save a chat: full record + search entry.
 * @param {{key: string, service: string, chatId: string, title: string, url: string, messages: any[], search: string, indexedAt: number}} rec
 */
export async function putChat(rec) {
  const db = await openDb();
  const tx = db.transaction(['chats', 'search'], 'readwrite');
  tx.objectStore('chats').put(rec);
  tx.objectStore('search').put({ key: rec.key, service: rec.service, title: rec.title, search: rec.search, indexedAt: rec.indexedAt });
  await finished(tx);
}

/** @param {string} key */
export async function getChat(key) {
  const db = await openDb();
  return done(db.transaction('chats').objectStore('chats').get(key));
}

/** All search entries (title + normalised text). */
export async function allSearchEntries() {
  const db = await openDb();
  return done(db.transaction('search').objectStore('search').getAll());
}

/** Keys of all indexed chats. @returns {Promise<string[]>} */
export async function indexedKeys() {
  const db = await openDb();
  return /** @type {any} */ (done(db.transaction('search').objectStore('search').getAllKeys()));
}

/** @param {string[]} keys */
export async function deleteChats(keys) {
  const db = await openDb();
  const tx = db.transaction(['chats', 'search'], 'readwrite');
  for (const k of keys) {
    tx.objectStore('chats').delete(k);
    tx.objectStore('search').delete(k);
  }
  await finished(tx);
}

/** Delete every indexed chat of a service, or all of them. @param {string} [service] */
export async function clearIndex(service) {
  if (!service) {
    const db = await openDb();
    const tx = db.transaction(['chats', 'search'], 'readwrite');
    tx.objectStore('chats').clear();
    tx.objectStore('search').clear();
    await finished(tx);
    return;
  }
  const keys = (await indexedKeys()).filter((k) => k.startsWith(`${service}:`));
  await deleteChats(keys);
}

/** Number of indexed chats per service. @returns {Promise<Record<string, number>>} */
export async function countByService() {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of await indexedKeys()) {
    const s = k.split(':')[0];
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}
