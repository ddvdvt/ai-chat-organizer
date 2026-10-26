// Content script for the enabled chat sites. Reads only the conversation that is open on the
// screen (DOM), never calls the site's API and never walks the history in the background.
// Everything visible is drawn inside a closed Shadow DOM; the site's own markup is not changed.
import { serviceForUrl, serviceInfo, chatIdFromUrl } from '../../lib/services.js';
import { extractMessages, extractTitle, probe, isStreaming, linkInfo, selectUnion, selectFirst, fingerprint } from '../../lib/extract.js';
import { exportChat, fileName, mimeOf } from '../../lib/exportfmt.js';
import { normalizeState } from '../../lib/org.js';
import { normalizeSettings } from '../../lib/settings.js';
import { normalizePrompts } from '../../lib/prompts.js';
import { createPanel } from './panel.js';

const TICK_MS = 2000;
const SETTLE_MS = 12000;

/** @param {string} key @param {string|string[]} [subs] */
export function t(key, subs) {
  try {
    return chrome.i18n.getMessage(key, subs) || key;
  } catch {
    return key;
  }
}

/** Message to the service worker; resolves to null if the extension was reloaded/removed. */
async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    return null;
  }
}

export async function start() {
  const service = serviceForUrl(location.href);
  if (!service) return;
  const res = await send({ type: 'config:get' });
  if (!res || !res.ok) return;
  /** @type {import('../../lib/selectors.js').ServiceConfig} */
  const cfg = res.config;
  const info = serviceInfo(service);

  const data = await chrome.storage.local.get(['org', 'settings', 'prompts', 'health']);
  const state = {
    org: normalizeState(data.org),
    settings: normalizeSettings(data.settings),
    prompts: normalizePrompts(data.prompts),
    health: (data.health && data.health[service]) || null,
    current: /** @type {{chatId: string, title: string, url: string} | null} */ (null),
    messagesOk: true,
  };

  const chatIdOf = (url) => chatIdFromUrl(service, url, cfg.chatPath);

  /** Snapshot of the chat on the screen (for export). */
  function currentChat() {
    const chatId = chatIdOf(location.href);
    if (!chatId) return null;
    const messages = extractMessages(document, cfg);
    return { service, chatId, title: extractTitle(document, cfg, document.title, messages), url: location.href, messages };
  }

  function labels() {
    return { user: t('roleUser'), untitled: t('untitled'), exported: t('exported'), source: t('source'), locale: t('@@ui_locale').replace('_', '-') || 'ru' };
  }

  function download(text, name, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    panel.root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /** @param {string} format md | html | json | txt | pdf @returns {Promise<{ok: boolean, error?: string}>} */
  async function exportCurrent(format) {
    const chat = currentChat();
    if (!chat) return { ok: false, error: 'noChat' };
    if (!chat.messages.length) return { ok: false, error: 'noMessages' };
    if (format === 'pdf') {
      const r = await send({ type: 'print:open', chat });
      return { ok: !!(r && r.ok) };
    }
    download(exportChat(chat, format, labels()), fileName(chat.title, format, chat.chatId), mimeOf(format));
    return { ok: true };
  }

  /** Put text into the prompt box at the caret (or at the end). */
  function insertPrompt(text) {
    const el = /** @type {HTMLElement | null} */ (selectFirst(document, cfg.input));
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length;
      el.setRangeText(text, start, el.selectionEnd ?? start, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    const sel = getSelection();
    if (sel && !el.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    // Rich editors (ProseMirror, Quill) handle a paste of plain text best; plain contenteditable
    // ignores it, then insertText is used.
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      if (ev.defaultPrevented) return true;
    } catch {
      /* ClipboardEvent unsupported */
    }
    if (document.execCommand('insertText', false, text)) return true;
    el.textContent += text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  /** Open a chat: click the site's own sidebar link (no reload) or navigate. */
  function navigate(url) {
    const id = chatIdOf(url);
    const link = id && selectUnion(document, cfg.sidebarLink).find((a) => linkInfo(a, service, cfg, location.href)?.chatId === id);
    if (link) /** @type {HTMLElement} */ (link).click();
    else location.assign(url);
  }

  /** Chat reference for a sidebar link element (for the hover menu and drag-and-drop). */
  function sidebarChatAt(target) {
    if (!(target instanceof Element)) return null;
    for (const sel of cfg.sidebarLink) {
      let a = null;
      try {
        a = target.closest(sel);
      } catch {
        continue;
      }
      if (a) {
        const inf = linkInfo(a, service, cfg, location.href);
        if (inf) return { el: a, ref: { service, chatId: inf.chatId, title: inf.title, url: inf.url } };
      }
    }
    return null;
  }

  const panel = createPanel({
    service,
    serviceName: info.name,
    t,
    getState: () => state,
    op: (op) => send({ type: 'org:op', op }),
    search: async (q) => ((await send({ type: 'search', query: q, limit: 20 })) || {}).results || [],
    exportCurrent,
    insertPrompt,
    navigate,
    openOrganizer: (hash) => send({ type: 'organizer:open', hash }),
    sidebarChatAt,
  });
  if (!panel) return;

  // ----- state from storage -----
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.org) state.org = normalizeState(changes.org.newValue);
    if (changes.settings) state.settings = normalizeSettings(changes.settings.newValue);
    if (changes.prompts) state.prompts = normalizePrompts(changes.prompts.newValue);
    if (changes.health) state.health = (changes.health.newValue && changes.health.newValue[service]) || null;
    panel.render();
  });

  // ----- watch the page: URL changes (SPA), new messages, health -----
  let lastUrl = '';
  let urlSince = 0;
  let lastLight = '';
  let lastFp = '';
  let reported = false;

  function lightSignature() {
    const roots = selectUnion(document, cfg.message);
    const last = roots[roots.length - 1];
    return `${roots.length}:${last ? String(last.textContent || '').length : 0}`;
  }

  async function tick() {
    if (document.hidden) return;
    try {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        urlSince = Date.now();
        lastLight = '';
        lastFp = '';
        reported = false;
      }
      const chatId = chatIdOf(url);
      const settled = Date.now() - urlSince > SETTLE_MS;
      // title is refreshed every tick (services rename new chats after the first answer)
      if (chatId) {
        const title = extractTitle(document, cfg, document.title, []);
        state.current = { chatId, title, url };
      } else state.current = null;

      const p = probe(document, cfg, !!chatId);
      state.messagesOk = !chatId || p.messages || !settled;
      if (settled && !reported) {
        reported = true;
        send({ type: 'health:report', probe: { ...p, settled: true } });
      }

      if (chatId && state.settings.services[service]?.index && !isStreaming(document, cfg)) {
        const light = lightSignature();
        if (light !== lastLight) {
          lastLight = light;
          const messages = extractMessages(document, cfg);
          const fp = fingerprint(messages);
          if (fp !== lastFp && (messages.length || settled)) {
            lastFp = fp;
            const title = extractTitle(document, cfg, document.title, messages);
            state.current = { chatId, title, url };
            send({ type: 'chat:index', chatId, url, title, messages });
          }
        }
      }
      panel.render();
    } catch {
      /* never break the host page */
    }
  }

  setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => !document.hidden && tick());
  tick();

  // ----- commands from the popup -----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg) return false;
    if (msg.type === 'tab:export') {
      exportCurrent(String(msg.format)).then(sendResponse);
      return true;
    }
    if (msg.type === 'tab:panel') {
      panel.open();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'tab:info') {
      const c = currentChat();
      sendResponse({ ok: true, chat: c ? { chatId: c.chatId, title: c.title, count: c.messages.length } : null, messagesOk: state.messagesOk });
      return false;
    }
    return false;
  });
}
