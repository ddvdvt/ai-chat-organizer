// Selector config (extension/config/selectors.json): validation, per-service section and the
// "which features still work" logic behind graceful degradation. Pure, no chrome.* calls.
import { SERVICE_IDS, DEFAULT_CHAT_PATHS } from './services.js';

const MAX_SELECTOR_LEN = 300;
const MAX_LIST = 40;
const TOP_KEYS = new Set(['$schema', 'comment', 'version', 'updated', 'services']);
export const SELECTOR_KEYS = ['sidebarLink', 'message', 'userMessage', 'content', 'strip', 'codeBlock', 'codeLanguage', 'title', 'input', 'streaming'];
const SERVICE_KEYS = new Set([...SELECTOR_KEYS, 'chatPath', 'titleSuffix']);

/** Is this string safe to use as a CSS selector (no CSS injection, sane length)? */
export function isSafeSelector(s) {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= MAX_SELECTOR_LEN && !/[<{}@;\\\r\n]/.test(s) && !/\/\*|url\s*\(|expression\s*\(/i.test(s);
}

/** A chat-path regex: short, compiles, has exactly one capture group, no nested quantifiers. */
export function isSafePathRegex(s) {
  if (typeof s !== 'string' || !s || s.length > 200) return false;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(s)) return false; // (a+)+ style catastrophic backtracking
  try {
    const re = new RegExp(s);
    const groups = new RegExp(`${s}|`).exec('').length - 1;
    return groups === 1 && !re.test('');
  } catch {
    return false;
  }
}

/**
 * @param {any} cfg
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateConfig(cfg) {
  const errors = [];
  const err = (m) => errors.length < 50 && errors.push(m);
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, errors: ['config must be an object'] };
  for (const k of Object.keys(cfg)) if (!TOP_KEYS.has(k)) err(`unknown key "${k}"`);
  if (!Number.isInteger(cfg.version) || cfg.version < 1) err('version must be a positive integer');
  if (cfg.updated !== undefined && (typeof cfg.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cfg.updated))) err('updated must be YYYY-MM-DD');
  if (cfg.comment !== undefined && typeof cfg.comment !== 'string') err('comment must be a string');
  const svcs = cfg.services;
  if (!svcs || typeof svcs !== 'object' || Array.isArray(svcs)) {
    err('services must be an object');
    return { ok: false, errors };
  }
  for (const [id, s] of Object.entries(svcs)) {
    const at = `services.${id}`;
    if (!SERVICE_IDS.includes(/** @type {any} */ (id))) {
      err(`unknown service "${id}"`);
      continue;
    }
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      err(`${at} must be an object`);
      continue;
    }
    for (const [k, v] of Object.entries(s)) {
      if (!SERVICE_KEYS.has(k)) {
        err(`${at}: unknown key "${k}"`);
        continue;
      }
      if (!Array.isArray(v) || v.length > MAX_LIST) {
        err(`${at}.${k} must be an array (≤ ${MAX_LIST})`);
        continue;
      }
      v.forEach((x, i) => {
        const ok = k === 'chatPath' ? isSafePathRegex(x) : k === 'titleSuffix' ? typeof x === 'string' && x.length > 0 && x.length <= 60 : isSafeSelector(x);
        if (!ok) err(`${at}.${k}[${i}] is invalid`);
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @typedef {object} ServiceConfig
 * @property {string[]} chatPath
 * @property {string[]} sidebarLink
 * @property {string[]} message
 * @property {string[]} userMessage
 * @property {string[]} content
 * @property {string[]} strip
 * @property {string[]} codeBlock
 * @property {string[]} codeLanguage
 * @property {string[]} title
 * @property {string[]} titleSuffix
 * @property {string[]} input
 * @property {string[]} streaming
 */

/**
 * Section for one service with every key present (unknown/invalid entries dropped).
 * @param {any} cfg @param {string} service
 * @returns {ServiceConfig}
 */
export function serviceConfig(cfg, service) {
  const raw = (cfg && cfg.services && cfg.services[service]) || {};
  /** @type {any} */
  const out = {};
  for (const k of SERVICE_KEYS) {
    const list = Array.isArray(raw[k]) ? raw[k] : [];
    out[k] = list.filter((x) => (k === 'chatPath' ? isSafePathRegex(x) : k === 'titleSuffix' ? typeof x === 'string' && x : isSafeSelector(x)));
  }
  if (!out.chatPath.length) out.chatPath = [...(DEFAULT_CHAT_PATHS[service] || [])];
  return out;
}

/** Features of the in-page integration and the selector lists each one needs. */
export const FEATURES = {
  sidebar: ['sidebarLink'],
  messages: ['message'],
  prompts: ['input'],
};

/**
 * @typedef {object} Probe  what the content script observed on a page
 * @property {boolean} onChat     the URL is a chat page
 * @property {boolean} sidebar    at least one sidebar chat link matched
 * @property {boolean} messages   at least one message matched
 * @property {boolean} input      the prompt input matched
 * @property {boolean} [settled]  the page had enough time to render (probe is final)
 */

/**
 * Turn a probe into a health record. A feature counts as broken only when the page had time to
 * render and the thing must exist: messages on chat pages, the prompt input on every page.
 * Sidebar links are not required (the sidebar may be collapsed or the history empty), so a
 * missing sidebar never marks the service as changed.
 * @param {Probe} p
 * @returns {{status: 'ok' | 'degraded' | 'unknown', broken: string[]}}
 */
export function healthFromProbe(p) {
  if (!p || !p.settled) return { status: 'unknown', broken: [] };
  const broken = [];
  if (p.onChat && !p.messages) broken.push('messages');
  if (!p.input) broken.push('prompts');
  return { status: broken.length ? 'degraded' : 'ok', broken };
}

/**
 * Strip a service suffix (" - Claude") from a document title. Titles equal to a bare service
 * name ("ChatGPT") are not chat titles and give ''.
 * @param {string} title @param {string[]} suffixes
 */
export function cleanTitle(title, suffixes = []) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  for (const s of [...suffixes].sort((a, b) => b.length - a.length)) {
    if (t === s.trim()) return '';
    if (t.endsWith(s)) t = t.slice(0, -s.length).trim();
  }
  return t.slice(0, 300);
}

/** Normalise a code-block language label ("Python", "c++ Copy code") → "python" / "c++". */
export function normalizeLang(label) {
  const m = /^[\s]*([A-Za-z0-9+#._-]{1,20})/.exec(String(label || ''));
  if (!m) return '';
  const l = m[1].toLowerCase();
  return /^(copy|code|копировать|edit)$/.test(l) ? '' : l;
}
