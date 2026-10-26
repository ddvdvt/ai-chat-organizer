// Folders, tags, pins and chat metadata. Pure reducers over a plain JSON state that lives in
// chrome.storage.local; the service worker is the only writer (applyOp), every page reads.
import { isServiceId, chatKey, parseChatKey, safeChatUrl } from './services.js';

export const MAX_FOLDERS = 200;
export const MAX_TAGS = 100;
export const MAX_CHATS = 20000;
export const MAX_NAME = 60;
export const MAX_TITLE = 300;

/** Colour palette for folders and tags (readable on light and dark backgrounds). */
export const COLORS = ['#6b7280', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

/**
 * @typedef {object} Folder
 * @property {string} id
 * @property {string} name
 * @property {string | null} parentId  null = top level (only one level of nesting)
 * @property {string} color
 * @property {number} order
 *
 * @typedef {object} Tag
 * @property {string} id
 * @property {string} name
 * @property {string} color
 *
 * @typedef {object} ChatMeta
 * @property {string} key       "<service>:<chatId>"
 * @property {import('./services.js').ServiceId} service
 * @property {string} chatId
 * @property {string} title
 * @property {string} url
 * @property {string | null} folderId
 * @property {boolean} pinned
 * @property {string[]} tags
 * @property {number} seenAt    last time the chat was opened (ms), 0 if never seen
 * @property {number} addedAt
 *
 * @typedef {object} OrgState
 * @property {1} v
 * @property {Folder[]} folders
 * @property {Tag[]} tags
 * @property {Record<string, ChatMeta>} chats
 */

/** @returns {OrgState} */
export function emptyState() {
  return { v: 1, folders: [], tags: [], chats: {} };
}

let counter = 0;
/** Short unique id. */
export function newId(prefix = 'f') {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const cleanTitle = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
const cleanColor = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : COLORS[0]);
const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s);

/**
 * Validate and repair any input (storage contents, imported backup) into a well-formed state.
 * @param {any} raw @returns {OrgState}
 */
export function normalizeState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  const seen = new Set();
  for (const f of Array.isArray(raw.folders) ? raw.folders : []) {
    if (!f || !isId(f.id) || seen.has(f.id) || s.folders.length >= MAX_FOLDERS) continue;
    const name = cleanName(f.name);
    if (!name) continue;
    seen.add(f.id);
    s.folders.push({ id: f.id, name, parentId: isId(f.parentId) ? f.parentId : null, color: cleanColor(f.color), order: Number.isFinite(f.order) ? f.order : s.folders.length });
  }
  // only one level: a parent must exist and be top-level itself
  const top = new Set(s.folders.filter((f) => f.parentId === null).map((f) => f.id));
  for (const f of s.folders) if (f.parentId !== null && (!top.has(f.parentId) || f.parentId === f.id)) f.parentId = null;
  const tagIds = new Set();
  for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
    if (!t || !isId(t.id) || tagIds.has(t.id) || s.tags.length >= MAX_TAGS) continue;
    const name = cleanName(t.name);
    if (!name) continue;
    tagIds.add(t.id);
    s.tags.push({ id: t.id, name, color: cleanColor(t.color) });
  }
  const folderIds = new Set(s.folders.map((f) => f.id));
  const chats = raw.chats && typeof raw.chats === 'object' ? Object.values(raw.chats) : [];
  for (const c of chats) {
    if (!c || !isServiceId(c.service) || typeof c.chatId !== 'string' || !/^[A-Za-z0-9-]{4,80}$/.test(c.chatId)) continue;
    const key = chatKey(c.service, c.chatId.toLowerCase());
    if (s.chats[key] || Object.keys(s.chats).length >= MAX_CHATS) continue;
    s.chats[key] = {
      key,
      service: c.service,
      chatId: c.chatId.toLowerCase(),
      title: cleanTitle(c.title),
      url: safeChatUrl(c.service, c.chatId.toLowerCase(), c.url),
      folderId: isId(c.folderId) && folderIds.has(c.folderId) ? c.folderId : null,
      pinned: !!c.pinned,
      tags: Array.isArray(c.tags) ? [...new Set(c.tags.filter((t) => tagIds.has(t)))] : [],
      seenAt: Number.isFinite(c.seenAt) ? c.seenAt : 0,
      addedAt: Number.isFinite(c.addedAt) ? c.addedAt : 0,
    };
  }
  return s;
}

const clone = (s) => ({ v: 1, folders: s.folders.map((f) => ({ ...f })), tags: s.tags.map((t) => ({ ...t })), chats: { ...s.chats } });

/** Is a chat worth keeping in storage when it carries no organisation and was never seen? */
function isEmptyMeta(c) {
  return !c.folderId && !c.pinned && !c.tags.length && !c.seenAt;
}

/**
 * @param {OrgState} state @param {string} name @param {string | null} [parentId] @param {string} [color]
 * @returns {{state: OrgState, id: string | null, error?: string}}
 */
export function addFolder(state, name, parentId = null, color) {
  const n = cleanName(name);
  if (!n) return { state, id: null, error: 'empty' };
  if (state.folders.length >= MAX_FOLDERS) return { state, id: null, error: 'limit' };
  let parent = null;
  if (parentId) {
    const p = state.folders.find((f) => f.id === parentId);
    if (!p) return { state, id: null, error: 'parent' };
    if (p.parentId) return { state, id: null, error: 'depth' };
    parent = p.id;
  }
  const s = clone(state);
  const id = newId('f');
  const siblings = s.folders.filter((f) => f.parentId === parent);
  s.folders.push({ id, name: n, parentId: parent, color: color ? cleanColor(color) : COLORS[(s.folders.length + 5) % COLORS.length], order: siblings.length });
  return { state: s, id };
}

/** @param {OrgState} state @param {string} id @param {{name?: string, color?: string, parentId?: string | null}} patch */
export function updateFolder(state, id, patch) {
  const i = state.folders.findIndex((f) => f.id === id);
  if (i < 0) return state;
  const s = clone(state);
  const f = s.folders[i];
  if (patch.name !== undefined) {
    const n = cleanName(patch.name);
    if (n) f.name = n;
  }
  if (patch.color !== undefined) f.color = cleanColor(patch.color);
  if (patch.parentId !== undefined) {
    const p = patch.parentId ? s.folders.find((x) => x.id === patch.parentId) : null;
    const hasChildren = s.folders.some((x) => x.parentId === id);
    if (patch.parentId === null) f.parentId = null;
    else if (p && !p.parentId && p.id !== id && !hasChildren) f.parentId = p.id;
  }
  return s;
}

/**
 * Delete a folder and its subfolders; their chats become unsorted (chats are never deleted).
 * @param {OrgState} state @param {string} id
 */
export function deleteFolder(state, id) {
  if (!state.folders.some((f) => f.id === id)) return state;
  const s = clone(state);
  const gone = new Set([id, ...s.folders.filter((f) => f.parentId === id).map((f) => f.id)]);
  s.folders = s.folders.filter((f) => !gone.has(f.id));
  for (const [k, c] of Object.entries(s.chats)) {
    if (c.folderId && gone.has(c.folderId)) {
      const n = { ...c, folderId: null };
      if (isEmptyMeta(n)) delete s.chats[k];
      else s.chats[k] = n;
    }
  }
  return s;
}

/** Move a folder up/down among its siblings. @param {OrgState} state @param {string} id @param {-1 | 1} dir */
export function reorderFolder(state, id, dir) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return state;
  const s = clone(state);
  const sib = s.folders.filter((x) => x.parentId === f.parentId).sort((a, b) => a.order - b.order);
  sib.forEach((x, i) => (x.order = i));
  const i = sib.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= sib.length) return s;
  [sib[i].order, sib[j].order] = [sib[j].order, sib[i].order];
  return s;
}

/** @param {OrgState} state @param {string} name @param {string} [color] */
export function addTag(state, name, color) {
  const n = cleanName(name);
  if (!n) return { state, id: null, error: 'empty' };
  const existing = state.tags.find((t) => t.name.toLowerCase() === n.toLowerCase());
  if (existing) return { state, id: existing.id };
  if (state.tags.length >= MAX_TAGS) return { state, id: null, error: 'limit' };
  const s = clone(state);
  const id = newId('t');
  s.tags.push({ id, name: n, color: color ? cleanColor(color) : COLORS[(s.tags.length + 1) % COLORS.length] });
  return { state: s, id };
}

/** @param {OrgState} state @param {string} id @param {{name?: string, color?: string}} patch */
export function updateTag(state, id, patch) {
  const i = state.tags.findIndex((t) => t.id === id);
  if (i < 0) return state;
  const s = clone(state);
  if (patch.name !== undefined && cleanName(patch.name)) s.tags[i].name = cleanName(patch.name);
  if (patch.color !== undefined) s.tags[i].color = cleanColor(patch.color);
  return s;
}

/** @param {OrgState} state @param {string} id */
export function deleteTag(state, id) {
  if (!state.tags.some((t) => t.id === id)) return state;
  const s = clone(state);
  s.tags = s.tags.filter((t) => t.id !== id);
  for (const [k, c] of Object.entries(s.chats)) {
    if (c.tags.includes(id)) {
      const n = { ...c, tags: c.tags.filter((t) => t !== id) };
      if (isEmptyMeta(n)) delete s.chats[k];
      else s.chats[k] = n;
    }
  }
  return s;
}

/**
 * @typedef {object} ChatRef
 * @property {string} service
 * @property {string} chatId
 * @property {string} [title]
 * @property {string} [url]
 */

/**
 * Create or update a chat record (title/url refresh); `seen` also bumps seenAt.
 * @param {OrgState} state @param {ChatRef} ref @param {{seen?: boolean, now?: number}} [o]
 * @returns {OrgState}
 */
export function upsertChat(state, ref, o = {}) {
  if (!ref || !isServiceId(ref.service) || typeof ref.chatId !== 'string' || !/^[A-Za-z0-9-]{4,80}$/.test(ref.chatId)) return state;
  const chatId = ref.chatId.toLowerCase();
  const key = chatKey(ref.service, chatId);
  const now = o.now ?? Date.now();
  const prev = state.chats[key];
  if (!prev && Object.keys(state.chats).length >= MAX_CHATS) return state;
  const title = cleanTitle(ref.title) || prev?.title || '';
  const url = safeChatUrl(ref.service, chatId, ref.url || prev?.url);
  const next = prev
    ? { ...prev, title, url, seenAt: o.seen ? now : prev.seenAt }
    : { key, service: /** @type {any} */ (ref.service), chatId, title, url, folderId: null, pinned: false, tags: [], seenAt: o.seen ? now : 0, addedAt: now };
  if (prev && prev.title === next.title && prev.url === next.url && prev.seenAt === next.seenAt) return state;
  const s = clone(state);
  s.chats[key] = next;
  return s;
}

function patchChat(state, ref, fn) {
  let s = upsertChat(state, ref);
  const key = chatKey(ref.service, String(ref.chatId || '').toLowerCase());
  const c = s.chats[key];
  if (!c) return state;
  const n = fn({ ...c, tags: [...c.tags] });
  if (s === state) s = clone(state);
  if (isEmptyMeta(n)) delete s.chats[key];
  else s.chats[key] = n;
  return s;
}

/** Put a chat into a folder (null = unsorted). @param {OrgState} state @param {ChatRef} ref @param {string | null} folderId */
export function moveChat(state, ref, folderId) {
  if (folderId && !state.folders.some((f) => f.id === folderId)) return state;
  return patchChat(state, ref, (c) => ({ ...c, folderId: folderId || null }));
}

/** @param {OrgState} state @param {ChatRef} ref @param {boolean} [pinned] toggles when omitted */
export function pinChat(state, ref, pinned) {
  return patchChat(state, ref, (c) => ({ ...c, pinned: pinned === undefined ? !c.pinned : !!pinned }));
}

/** @param {OrgState} state @param {ChatRef} ref @param {string} tagId @param {boolean} [on] toggles when omitted */
export function tagChat(state, ref, tagId, on) {
  if (!state.tags.some((t) => t.id === tagId)) return state;
  return patchChat(state, ref, (c) => {
    const has = c.tags.includes(tagId);
    const want = on === undefined ? !has : !!on;
    return { ...c, tags: want ? (has ? c.tags : [...c.tags, tagId]) : c.tags.filter((t) => t !== tagId) };
  });
}

/** Rename a chat locally (the service is not changed). */
export function renameChat(state, ref, title) {
  const t = cleanTitle(title);
  if (!t) return state;
  return patchChat(state, ref, (c) => ({ ...c, title: t }));
}

/** Forget a chat's organisation (folder, pin, tags, history entry). @param {OrgState} state @param {string} key */
export function removeChat(state, key) {
  if (!state.chats[key]) return state;
  const s = clone(state);
  delete s.chats[key];
  return s;
}

/** Forget "seen" history (keeps organised chats). @param {OrgState} state @param {string} [service] */
export function forgetHistory(state, service) {
  const s = clone(state);
  for (const [k, c] of Object.entries(s.chats)) {
    if (service && c.service !== service) continue;
    const n = { ...c, seenAt: 0 };
    if (isEmptyMeta(n)) delete s.chats[k];
    else s.chats[k] = n;
  }
  return s;
}

/**
 * Apply a serialisable operation (sent from pages / content scripts to the service worker).
 * Unknown ops leave the state unchanged.
 * @param {OrgState} state @param {{type: string, [k: string]: any}} op
 * @returns {{state: OrgState, result?: any}}
 */
export function applyOp(state, op) {
  if (!op || typeof op.type !== 'string') return { state };
  const refs = Array.isArray(op.chats) ? op.chats : op.chat ? [op.chat] : [];
  const each = (fn) => ({ state: refs.reduce((s, r) => fn(s, r), state) });
  switch (op.type) {
    case 'addFolder': {
      const r = addFolder(state, op.name, op.parentId ?? null, op.color);
      return { state: r.state, result: { id: r.id, error: r.error } };
    }
    case 'updateFolder':
      return { state: updateFolder(state, op.id, op.patch || {}) };
    case 'deleteFolder':
      return { state: deleteFolder(state, op.id) };
    case 'reorderFolder':
      return { state: reorderFolder(state, op.id, op.dir === -1 ? -1 : 1) };
    case 'addTag': {
      const r = addTag(state, op.name, op.color);
      return { state: r.state, result: { id: r.id, error: r.error } };
    }
    case 'updateTag':
      return { state: updateTag(state, op.id, op.patch || {}) };
    case 'deleteTag':
      return { state: deleteTag(state, op.id) };
    case 'moveChat':
      return each((s, r) => moveChat(s, r, op.folderId ?? null));
    case 'pinChat':
      return each((s, r) => pinChat(s, r, op.pinned));
    case 'tagChat':
      return each((s, r) => tagChat(s, r, op.tagId, op.on));
    case 'renameChat':
      return each((s, r) => renameChat(s, r, op.title));
    case 'upsertChat':
      return each((s, r) => upsertChat(s, r, { seen: !!op.seen }));
    case 'removeChat':
      return { state: refs.reduce((s, r) => removeChat(s, chatKey(r.service, String(r.chatId).toLowerCase())), state) };
    case 'forgetHistory':
      return { state: forgetHistory(state, op.service) };
    default:
      return { state };
  }
}

// ---------- queries ----------

/** Folders as a tree sorted by order then name. @param {OrgState} state */
export function folderTree(state) {
  const by = (a, b) => a.order - b.order || a.name.localeCompare(b.name);
  return state.folders
    .filter((f) => f.parentId === null)
    .sort(by)
    .map((f) => ({ ...f, children: state.folders.filter((c) => c.parentId === f.id).sort(by) }));
}

/** Pinned first, then most recently seen/added, then title. @param {ChatMeta[]} list */
export function sortChats(list) {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Math.max(b.seenAt, b.addedAt) - Math.max(a.seenAt, a.addedAt) || a.title.localeCompare(b.title));
}

/**
 * Filter chats for a view.
 * @param {OrgState} state
 * @param {{folderId?: string | null | 'all' | 'pinned' | 'unsorted' | 'recent', tagId?: string, services?: string[], includeSub?: boolean}} f
 */
export function filterChats(state, f = {}) {
  let list = Object.values(state.chats);
  if (f.services && f.services.length) list = list.filter((c) => f.services.includes(c.service));
  const view = f.folderId ?? 'all';
  if (view === 'pinned') list = list.filter((c) => c.pinned);
  else if (view === 'unsorted') list = list.filter((c) => !c.folderId);
  else if (view === 'recent') list = list.filter((c) => c.seenAt > 0).sort((a, b) => b.seenAt - a.seenAt);
  else if (view !== 'all') {
    const ids = new Set([view]);
    if (f.includeSub !== false) for (const x of state.folders) if (x.parentId === view) ids.add(x.id);
    list = list.filter((c) => c.folderId && ids.has(c.folderId));
  }
  if (f.tagId) list = list.filter((c) => c.tags.includes(f.tagId));
  return view === 'recent' ? list : sortChats(list);
}

/** Number of chats per folder (including subfolders for top-level ones). @param {OrgState} state @param {string[]} [services] */
export function folderCounts(state, services) {
  /** @type {Record<string, number>} */
  const direct = {};
  for (const c of Object.values(state.chats)) {
    if (services && services.length && !services.includes(c.service)) continue;
    if (c.folderId) direct[c.folderId] = (direct[c.folderId] || 0) + 1;
  }
  /** @type {Record<string, number>} */
  const total = { ...direct };
  for (const f of state.folders) if (f.parentId && direct[f.id]) total[f.parentId] = (total[f.parentId] || 0) + direct[f.id];
  return total;
}

/** Folder path label: "Работа / Клиент А". @param {OrgState} state @param {string | null} id */
export function folderPath(state, id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return '';
  const p = f.parentId ? state.folders.find((x) => x.id === f.parentId) : null;
  return p ? `${p.name} / ${f.name}` : f.name;
}

export { chatKey, parseChatKey };
