// Service worker: the single writer of folders/tags (chrome.storage.local) and of the search
// index (IndexedDB); registers the content script only on the sites the user enabled; welcome
// and uninstall pages of the brand site. It never makes network requests and never calls the
// chat services' APIs: the index only receives text the content script read from a chat the
// user opened.
import { brandUrls, welcomeUrlFor } from '../lib/brand.js';
import { SERVICES, originPattern, serviceForUrl, chatKey, safeChatUrl, isServiceId } from '../lib/services.js';
import { validateConfig, serviceConfig, healthFromProbe } from '../lib/selectors.js';
import { applyOp, normalizeState, upsertChat, removeChat, forgetHistory } from '../lib/org.js';
import { normalizeSettings } from '../lib/settings.js';
import { search, searchText, snippet, parseQuery, bestMessageText } from '../lib/search.js';
import { putChat, getChat, allSearchEntries, deleteChats, clearIndex } from './shared/db.js';

const SCRIPT_PREFIX = 'aco-';
const MAX_MESSAGE_CHARS = 400_000;

// ---------- install / uninstall ----------

chrome.runtime.onInstalled.addListener((details) => {
  const url = welcomeUrlFor(details && details.reason);
  if (url) chrome.tabs.create({ url }).catch(() => {});
  syncContentScripts();
});

// Page shown after the extension is removed (no data is sent: it is a plain static page).
try {
  chrome.runtime.setUninstallURL(brandUrls().bye).catch(() => {});
} catch {
  /* not available in this context */
}

chrome.runtime.onStartup.addListener(() => syncContentScripts());
chrome.permissions.onAdded.addListener(() => syncContentScripts());
chrome.permissions.onRemoved.addListener(() => syncContentScripts());

// ---------- content script registration (only for granted sites) ----------

let syncing = Promise.resolve();
function syncContentScripts() {
  syncing = syncing.then(doSync).catch(() => {});
  return syncing;
}

async function doSync() {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  for (const s of SERVICES) {
    const origin = originPattern(s.id);
    const id = SCRIPT_PREFIX + s.id;
    const granted = await chrome.permissions.contains({ origins: [origin] });
    const has = registered.some((r) => r.id === id);
    if (granted && !has) {
      await chrome.scripting.registerContentScripts([{ id, matches: [origin], js: ['src/content/loader.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
      // tabs that were already open: inject now (the loader is idempotent)
      const tabs = await chrome.tabs.query({ url: origin });
      for (const tab of tabs) {
        if (tab.id != null) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/loader.js'] }).catch(() => {});
      }
    } else if (!granted && has) {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    }
  }
}
syncContentScripts();

// ---------- data helpers ----------

/** @type {any} */
let bundledConfig = null;
async function loadConfig() {
  if (!bundledConfig) {
    const cfg = await (await fetch(chrome.runtime.getURL('config/selectors.json'))).json();
    bundledConfig = validateConfig(cfg).ok ? cfg : { version: 0, services: {} };
  }
  return bundledConfig;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}

let orgQueue = Promise.resolve();
/**
 * Serialised read-modify-write of the organisation state.
 * @param {(s: any) => {state: any, result?: any} | Promise<{state: any, result?: any}>} fn
 */
function withOrg(fn) {
  const p = orgQueue.then(async () => {
    const { org } = await chrome.storage.local.get('org');
    const s = normalizeState(org);
    const r = await fn(s);
    if (r.state !== s) await chrome.storage.local.set({ org: r.state });
    return r.result;
  });
  orgQueue = p.catch(() => {});
  return p;
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Validate messages coming from a content script. */
function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 2000).flatMap((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return [];
    const md = str(m.md, MAX_MESSAGE_CHARS);
    if (!md) return [];
    return [{ role: m.role, md, text: str(m.text, MAX_MESSAGE_CHARS), html: str(m.html, MAX_MESSAGE_CHARS * 2) }];
  });
}

/** @param {string} service @param {any} p */
async function indexChat(service, p) {
  const settings = await getSettings();
  if (!settings.services[service]?.index) return { ok: false, reason: 'disabled' };
  const chatId = str(p.chatId, 80).toLowerCase();
  if (!/^[a-z0-9-]{4,80}$/.test(chatId)) return { ok: false, reason: 'id' };
  const messages = cleanMessages(p.messages);
  const title = str(p.title, 300).replace(/\s+/g, ' ').trim();
  const url = safeChatUrl(service, chatId, str(p.url, 2000));
  if (messages.length) {
    const key = chatKey(service, chatId);
    await putChat({ key, service, chatId, title, url, messages, search: searchText(messages), indexedAt: Date.now() });
  }
  await withOrg((s) => ({ state: upsertChat(s, { service, chatId, title, url }, { seen: true }) }));
  return { ok: true, indexed: messages.length > 0 };
}

/** @param {string} query @param {{services?: string[], limit?: number}} o */
async function runSearch(query, o) {
  const entries = await allSearchEntries();
  const hits = search(entries, query, { services: o.services, limit: o.limit || 30 });
  const pq = parseQuery(query);
  const out = [];
  for (const h of hits) {
    const rec = await getChat(h.key);
    if (!rec) continue;
    out.push({ key: rec.key, service: rec.service, chatId: rec.chatId, title: rec.title, url: rec.url, indexedAt: rec.indexedAt, snippet: snippet(bestMessageText(rec.messages, query), pq, 70) });
  }
  return out;
}

async function openPrint(chat) {
  const id = `job${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  await chrome.storage.session.set({ [`print:${id}`]: chat });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/print/print.html?job=${id}`) });
}

// ---------- messages ----------

/** Content scripts may only act for the service of the page they run on. */
function senderService(sender) {
  if (sender.id !== chrome.runtime.id) return null;
  if (sender.tab && sender.url) return serviceForUrl(sender.url);
  return null;
}
/** Popup, organizer and print pages (also when they are open in a tab). */
const isExtensionPage = (sender) => sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));

// Ops a page script of a chat site may trigger through our panel (no deletes of folders/tags).
const CONTENT_OPS = new Set(['addFolder', 'addTag', 'moveChat', 'pinChat', 'tagChat']);

async function handle(msg, sender) {
  if (!msg || typeof msg.type !== 'string') return { ok: false };
  const fromPage = isExtensionPage(sender);
  const svc = senderService(sender);
  if (!fromPage && !svc) return { ok: false, error: 'sender' };

  switch (msg.type) {
    case 'config:get': {
      const service = svc || msg.service;
      if (!isServiceId(service)) return { ok: false };
      const cfg = await loadConfig();
      return { ok: true, config: serviceConfig(cfg, service), version: cfg.version };
    }
    case 'health:report': {
      if (!svc) return { ok: false };
      const h = healthFromProbe(msg.probe);
      if (h.status === 'unknown') return { ok: true };
      const { health } = await chrome.storage.local.get('health');
      const next = { ...(health || {}), [svc]: { ...h, sidebar: !!msg.probe.sidebar, at: Date.now(), version: (await loadConfig()).version } };
      await chrome.storage.local.set({ health: next });
      return { ok: true };
    }
    case 'chat:index': {
      if (!svc) return { ok: false };
      return indexChat(svc, msg);
    }
    case 'org:op': {
      const op = msg.op;
      if (!op || typeof op.type !== 'string') return { ok: false };
      if (svc && !CONTENT_OPS.has(op.type)) return { ok: false, error: 'op' };
      if (svc) {
        // a content script can only touch chats of its own service
        const refs = Array.isArray(op.chats) ? op.chats : op.chat ? [op.chat] : [];
        if (refs.some((r) => !r || r.service !== svc)) return { ok: false, error: 'service' };
      }
      const result = await withOrg((s) => applyOp(s, op));
      if (fromPage && op.type === 'removeChat') {
        const refs = Array.isArray(op.chats) ? op.chats : [op.chat];
        await deleteChats(refs.filter(Boolean).map((r) => chatKey(r.service, String(r.chatId).toLowerCase()))).catch(() => {});
      }
      return { ok: true, result };
    }
    case 'search': {
      const q = str(msg.query, 500);
      const services = svc ? [svc] : Array.isArray(msg.services) ? msg.services.filter(isServiceId) : undefined;
      return { ok: true, results: await runSearch(q, { services, limit: Math.min(Number(msg.limit) || 30, 100) }) };
    }
    case 'print:open': {
      const c = msg.chat || {};
      const service = svc || c.service;
      if (!isServiceId(service) || (svc && c.service && c.service !== svc)) return { ok: false };
      await openPrint({ service, chatId: str(c.chatId, 80), title: str(c.title, 300), url: safeChatUrl(service, str(c.chatId, 80).toLowerCase(), str(c.url, 2000)), messages: cleanMessages(c.messages) });
      return { ok: true };
    }
    case 'organizer:open': {
      const hash = typeof msg.hash === 'string' && /^#?[a-z-]{0,20}$/.test(msg.hash) ? msg.hash.replace(/^#?/, '#') : '';
      const q = typeof msg.query === 'string' && msg.query ? `?q=${encodeURIComponent(msg.query.slice(0, 200))}` : '';
      await chrome.tabs.create({ url: chrome.runtime.getURL(`src/organizer/organizer.html${q}${hash === '#' ? '' : hash}`) });
      return { ok: true };
    }
    // ----- extension pages only -----
    case 'index:clear': {
      if (!fromPage) return { ok: false };
      const service = isServiceId(msg.service) ? msg.service : undefined;
      await clearIndex(service);
      if (msg.forget) await withOrg((s) => ({ state: forgetHistory(s, service) }));
      return { ok: true };
    }
    case 'org:replace': {
      if (!fromPage) return { ok: false };
      await withOrg(() => ({ state: normalizeState(msg.org) }));
      return { ok: true };
    }
    case 'chat:forget': {
      if (!fromPage || typeof msg.key !== 'string') return { ok: false };
      await deleteChats([msg.key]);
      await withOrg((s) => ({ state: removeChat(s, msg.key) }));
      return { ok: true };
    }
    case 'sync:scripts': {
      await syncContentScripts();
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;
});

