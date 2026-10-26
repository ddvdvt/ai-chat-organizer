// Print-friendly page of one chat → the browser's "Save as PDF". The chat comes from the search
// index (?key=) or from a one-off job the content script handed over (?job=, session storage).
// Message HTML is parsed inertly and sanitised again before it is shown.
import { applyI18n, t } from '../shared/i18n.js';
import { h, uiLocale } from '../shared/page.js';
import { getChat } from '../shared/db.js';
import { toSafeHtml } from '../../lib/convert.js';
import { EXPORT_CSS } from '../../lib/exportfmt.js';
import { serviceInfo } from '../../lib/services.js';

applyI18n();
document.head.append(h('style', { text: EXPORT_CSS }));

const params = new URLSearchParams(location.search);
const main = /** @type {HTMLElement} */ (document.getElementById('doc'));

async function loadChat() {
  const job = params.get('job');
  if (job && /^job[a-z0-9]+$/.test(job)) {
    const k = `print:${job}`;
    const d = await chrome.storage.session.get(k);
    return d[k] || null;
  }
  const key = params.get('key');
  return key ? (await getChat(key)) || null : null;
}

function resanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  return toSafeHtml(doc.body);
}

(async () => {
  const chat = await loadChat();
  if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) {
    main.replaceChildren(h('p', {}, t('printNotFound')));
    document.body.dataset.ready = '0';
    return;
  }
  const title = chat.title || t('untitled');
  document.title = title;
  const svc = serviceInfo(chat.service)?.name || chat.service;
  let date = '';
  try {
    date = new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  } catch {
    date = new Date().toISOString();
  }
  const sections = chat.messages.map((m) => {
    const content = h('div', { class: 'content' });
    content.innerHTML = resanitize(m.html) || '';
    if (!content.textContent.trim()) content.replaceChildren(...String(m.text || m.md || '').split('\n').flatMap((l, i) => (i ? [h('br'), l] : [l])));
    return h('section', { class: `msg ${m.role === 'user' ? 'user' : 'assistant'}` }, h('p', { class: 'who' }, m.role === 'user' ? t('roleUser') : svc), content);
  });
  main.replaceChildren(h('header', {}, h('h1', {}, title), h('p', {}, `${svc} · ${chat.url} · ${t('exported')}: ${date}`)), ...sections);
  document.body.dataset.ready = '1';
  document.getElementById('print')?.addEventListener('click', () => print());
  if (params.get('noprint') !== '1') setTimeout(() => print(), 400);
})();
