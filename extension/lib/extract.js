// Read the conversation that is currently rendered on the page, using the selector config.
// Pure: takes a DOM-like document, so it is unit-tested in node on the fixture pages.
import { toMarkdown, toText, toSafeHtml } from './convert.js';
import { cleanTitle, normalizeLang } from './selectors.js';
import { chatIdFromUrl } from './services.js';

export const MAX_MESSAGES = 2000;
export const MAX_CHAT_CHARS = 3_000_000;

/** querySelectorAll over a union of selectors; invalid selectors are skipped, never thrown. */
export function selectUnion(root, list) {
  if (!root || !list || !list.length) return [];
  try {
    return Array.from(root.querySelectorAll(list.join(', ')));
  } catch {
    const ok = list.filter((s) => {
      try {
        root.querySelector(s);
        return true;
      } catch {
        return false;
      }
    });
    if (!ok.length) return [];
    try {
      return Array.from(root.querySelectorAll(ok.join(', ')));
    } catch {
      return [];
    }
  }
}

/** First element matched by the first selector in the list that matches anything. */
export function selectFirst(root, list) {
  for (const s of list || []) {
    try {
      const el = root.querySelector(s);
      if (el) return el;
    } catch {
      /* invalid selector on this engine */
    }
  }
  return null;
}

/** All elements of the first selector that matches anything. */
function selectAllFirst(root, list) {
  for (const s of list || []) {
    try {
      const els = Array.from(root.querySelectorAll(s));
      if (els.length) return els;
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Does the element match any selector of the list? */
export function matchesAny(el, list) {
  for (const s of list || []) {
    try {
      if (el.matches(s)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Drop elements nested in another element of the same list (keep the outermost). */
function outermost(els) {
  const set = new Set(els);
  return els.filter((e) => {
    for (let p = e.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });
}

/** A short label outside a <pre> whose parent also holds the <pre>: the code block header. */
function isCodeLabel(el) {
  try {
    if (el.querySelector('pre') || String(el.textContent || '').trim().length > 40) return false;
    const p = el.parentElement;
    return !!(p && p.querySelector('pre'));
  } catch {
    return false;
  }
}

/**
 * Conversion options for a service: strip list + code-language lookup.
 * @param {import('./selectors.js').ServiceConfig} cfg
 */
export function convertOptions(cfg) {
  return {
    // strip list + code-language labels that sit next to a <pre> (they are kept as the fence language)
    skip: (el) => matchesAny(el, cfg.strip) || (matchesAny(el, cfg.codeLanguage) && isCodeLabel(el)),
    langOf: (pre) => {
      let box = pre;
      for (const s of cfg.codeBlock || []) {
        try {
          const b = pre.closest(s);
          if (b) {
            box = b;
            break;
          }
        } catch {
          /* ignore */
        }
      }
      let label = selectFirst(box, cfg.codeLanguage);
      // label outside the container: look up to 3 ancestors that hold only this one code block
      for (let p = pre.parentElement, i = 0; !label && p && i < 3; p = p.parentElement, i++) {
        if (p.querySelectorAll('pre').length !== 1) break;
        label = selectFirst(p, cfg.codeLanguage);
      }
      return label ? normalizeLang(label.textContent) : '';
    },
  };
}

/**
 * @typedef {object} Message
 * @property {'user' | 'assistant'} role
 * @property {string} md
 * @property {string} text
 * @property {string} html
 */

/**
 * Messages rendered on the page.
 * @param {any} doc @param {import('./selectors.js').ServiceConfig} cfg
 * @returns {Message[]}
 */
export function extractMessages(doc, cfg) {
  const roots = outermost(selectUnion(doc, cfg.message)).slice(0, MAX_MESSAGES);
  const opts = convertOptions(cfg);
  /** @type {Message[]} */
  const out = [];
  let total = 0;
  for (const root of roots) {
    let isUser = matchesAny(root, cfg.userMessage);
    if (!isUser) isUser = !!selectFirst(root, cfg.userMessage);
    const parts = outermost(selectAllFirst(root, cfg.content));
    const nodes = parts.length ? parts : [root];
    const md = nodes.map((n) => toMarkdown(n, opts)).filter(Boolean).join('\n\n').trim();
    if (!md) continue;
    const text = nodes.map((n) => toText(n, opts)).filter(Boolean).join('\n\n').trim();
    const html = nodes.map((n) => toSafeHtml(n, opts)).filter(Boolean).join('\n');
    total += md.length + text.length + html.length;
    if (total > MAX_CHAT_CHARS) break;
    out.push({ role: isUser ? 'user' : 'assistant', md, text, html });
  }
  return out;
}

/**
 * Title of the open chat: title element → document.title without the service suffix →
 * first words of the first user message.
 * @param {any} doc @param {import('./selectors.js').ServiceConfig} cfg
 * @param {string} docTitle @param {Message[]} [messages]
 */
export function extractTitle(doc, cfg, docTitle, messages = []) {
  const el = selectFirst(doc, cfg.title);
  const fromEl = el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  if (fromEl) return fromEl.slice(0, 300);
  const fromDoc = cleanTitle(docTitle, cfg.titleSuffix);
  if (fromDoc) return fromDoc;
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '';
  const t = first.text.replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t;
}

/**
 * A sidebar link → chat reference, or null when it is not a chat link.
 * @param {any} a  <a> element @param {string} service @param {import('./selectors.js').ServiceConfig} cfg
 * @param {string} baseUrl page URL to resolve relative hrefs
 */
export function linkInfo(a, service, cfg, baseUrl) {
  if (!a || !a.getAttribute) return null;
  const href = a.getAttribute('href');
  if (!href) return null;
  let url;
  try {
    url = new URL(href, baseUrl).href;
  } catch {
    return null;
  }
  const chatId = chatIdFromUrl(service, url, cfg.chatPath);
  if (!chatId) return null;
  const title = String(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { chatId, url, title };
}

/**
 * What the page looks like for the health check.
 * @param {any} doc @param {import('./selectors.js').ServiceConfig} cfg @param {boolean} onChat
 */
export function probe(doc, cfg, onChat) {
  return {
    onChat,
    sidebar: !!selectFirst(doc, cfg.sidebarLink),
    messages: selectUnion(doc, cfg.message).length > 0,
    input: !!selectFirst(doc, cfg.input),
  };
}

/** Is an answer being generated right now? */
export function isStreaming(doc, cfg) {
  return !!selectFirst(doc, cfg.streaming);
}

/** Cheap fingerprint of the conversation to skip re-indexing unchanged chats. */
export function fingerprint(messages) {
  let h = 2166136261;
  for (const m of messages) {
    const s = `${m.role}\u0000${m.md}\u0001`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return `${messages.length}:${(h >>> 0).toString(36)}`;
}
