// The three supported chat services: ids, hosts, permission patterns, chat ids from URLs. Pure.

/** URL scheme of the services (e2e tests serve local fixtures over http and patch this copy). */
export const PROTO = 'https';

/** @typedef {'chatgpt' | 'claude' | 'gemini'} ServiceId */

/**
 * @typedef {object} ServiceInfo
 * @property {ServiceId} id
 * @property {string} name   human name (compatibility only, never part of the extension name)
 * @property {string} host
 * @property {string} color  badge colour in the UI
 */

/** @type {ServiceInfo[]} */
export const SERVICES = [
  { id: 'chatgpt', name: 'ChatGPT', host: 'chatgpt.com', color: '#10a37f' },
  { id: 'claude', name: 'Claude', host: 'claude.ai', color: '#c96442' },
  { id: 'gemini', name: 'Gemini', host: 'gemini.google.com', color: '#4c7bf4' },
];

export const SERVICE_IDS = /** @type {ServiceId[]} */ (SERVICES.map((s) => s.id));

/** @param {string} id */
export function serviceInfo(id) {
  return SERVICES.find((s) => s.id === id) || null;
}

/** @param {string} id */
export function isServiceId(id) {
  return SERVICE_IDS.includes(/** @type {any} */ (id));
}

/** Host-permission / content-script match pattern of a service. */
export function originPattern(id, proto = PROTO) {
  const s = serviceInfo(id);
  return s ? `${proto}://${s.host}/*` : '';
}

/**
 * Which service a URL belongs to (exact host match only).
 * @param {string} url
 * @returns {ServiceId | null}
 */
export function serviceForUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== `${PROTO}:`) return null;
  const s = SERVICES.find((x) => x.host === u.hostname);
  return s ? s.id : null;
}

/** Default chat-URL patterns; selectors.json may override them (see lib/selectors.js). */
export const DEFAULT_CHAT_PATHS = {
  chatgpt: ['/c/([0-9a-fA-F][0-9a-fA-F-]{15,63})(?:[/?#]|$)'],
  claude: ['/chat/([0-9a-fA-F][0-9a-fA-F-]{15,63})(?:[/?#]|$)'],
  gemini: ['/app/([0-9a-fA-F]{8,64})(?:[/?#]|$)', '/gem/[^/]+/([0-9a-fA-F]{8,64})(?:[/?#]|$)'],
};

/**
 * Extract a chat id from a URL or path of the service.
 * @param {string} service
 * @param {string} urlOrPath absolute URL or a path like "/c/123"
 * @param {string[]} [patterns] regex sources with one capture group
 * @returns {string | null}
 */
export function chatIdFromUrl(service, urlOrPath, patterns) {
  if (!isServiceId(service) || typeof urlOrPath !== 'string') return null;
  let path = urlOrPath;
  try {
    const u = new URL(urlOrPath, `${PROTO}://${serviceInfo(service).host}/`);
    if (serviceForUrl(u.href) !== service) return null;
    path = u.pathname;
  } catch {
    return null;
  }
  for (const src of patterns && patterns.length ? patterns : DEFAULT_CHAT_PATHS[service]) {
    let re;
    try {
      re = new RegExp(src);
    } catch {
      continue;
    }
    const m = re.exec(path);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
}

/** Stable key of a chat in storage. */
export function chatKey(service, chatId) {
  return `${service}:${chatId}`;
}

/** @param {string} key @returns {{service: ServiceId, chatId: string} | null} */
export function parseChatKey(key) {
  const m = /^([a-z]+):(.+)$/.exec(String(key || ''));
  return m && isServiceId(m[1]) ? { service: /** @type {ServiceId} */ (m[1]), chatId: m[2] } : null;
}

/**
 * Canonical URL to open a chat (used when only the id is known).
 * @param {string} service @param {string} chatId
 */
export function chatUrl(service, chatId) {
  const host = serviceInfo(service)?.host;
  if (!host || !/^[0-9a-zA-Z-]+$/.test(chatId)) return '';
  const path = service === 'chatgpt' ? `/c/${chatId}` : service === 'claude' ? `/chat/${chatId}` : `/app/${chatId}`;
  return `${PROTO}://${host}${path}`;
}

/**
 * Keep a stored chat URL only if it really points at that service; otherwise rebuild it.
 * @param {string} service @param {string} chatId @param {string} [url]
 */
export function safeChatUrl(service, chatId, url) {
  if (url && serviceForUrl(url) === service && chatIdFromUrl(service, url)) {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      /* fall through */
    }
  }
  return chatUrl(service, chatId);
}
