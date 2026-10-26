// Export a chat to Markdown, HTML (standalone, print-friendly), JSON or plain text; file names;
// bulk export as a zip. Pure.
import { escapeHtml } from './convert.js';
import { createZip } from './zip.js';
import { serviceInfo } from './services.js';

/**
 * @typedef {object} ExportChat
 * @property {string} service
 * @property {string} chatId
 * @property {string} title
 * @property {string} url
 * @property {Array<{role: 'user' | 'assistant', md: string, text: string, html: string}>} messages
 * @property {number} [indexedAt]
 */

/**
 * @typedef {object} Labels  localised words used inside exported files
 * @property {string} user        "Вы"
 * @property {string} untitled    "Без названия"
 * @property {string} exported    "Экспортировано"
 * @property {string} source      "Источник"
 * @property {string} [locale]    BCP 47 for dates
 */

/** @type {Labels} */
export const DEFAULT_LABELS = { user: 'You', untitled: 'Untitled chat', exported: 'Exported', source: 'Source', locale: 'en' };

export const FORMATS = ['md', 'html', 'json', 'txt'];
const MIME = { md: 'text/markdown;charset=utf-8', html: 'text/html;charset=utf-8', json: 'application/json;charset=utf-8', txt: 'text/plain;charset=utf-8' };

export function mimeOf(format) {
  return MIME[format] || 'application/octet-stream';
}

const roleLabel = (chat, m, L) => (m.role === 'user' ? L.user : serviceInfo(chat.service)?.name || 'Assistant');

function dateLine(now, L) {
  try {
    return new Intl.DateTimeFormat(L.locale || 'en', { dateStyle: 'long', timeStyle: 'short' }).format(now);
  } catch {
    return now.toISOString();
  }
}

/** Make arbitrary text a single safe Markdown heading line. */
const headingText = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * @param {ExportChat} chat @param {Labels} [L] @param {Date} [now]
 */
export function toMarkdownDoc(chat, L = DEFAULT_LABELS, now = new Date()) {
  const title = headingText(chat.title) || L.untitled;
  const svc = serviceInfo(chat.service)?.name || chat.service;
  const head = [`# ${title}`, '', `> ${svc} · ${L.source}: <${chat.url}> · ${L.exported}: ${dateLine(now, L)}`];
  const body = chat.messages.map((m) => `## ${roleLabel(chat, m, L)}\n\n${m.md}`);
  return `${[head.join('\n'), ...body].join('\n\n')}\n`;
}

/** @param {ExportChat} chat @param {Labels} [L] @param {Date} [now] */
export function toTextDoc(chat, L = DEFAULT_LABELS, now = new Date()) {
  const title = headingText(chat.title) || L.untitled;
  const svc = serviceInfo(chat.service)?.name || chat.service;
  const head = `${title}\n${'='.repeat(Math.min(60, Math.max(3, [...title].length)))}\n${svc} · ${chat.url}\n${L.exported}: ${dateLine(now, L)}`;
  const body = chat.messages.map((m) => {
    const who = roleLabel(chat, m, L);
    return `${who}:\n${'-'.repeat([...who].length + 1)}\n${m.text}`;
  });
  return `${[head, ...body].join('\n\n')}\n`;
}

/** @param {ExportChat} chat @param {Date} [now] */
export function toJsonDoc(chat, now = new Date()) {
  return `${JSON.stringify(
    {
      format: 'ai-chat-organizer/1',
      service: chat.service,
      chatId: chat.chatId,
      title: chat.title,
      url: chat.url,
      exportedAt: now.toISOString(),
      messages: chat.messages.map((m) => ({ role: m.role, markdown: m.md, text: m.text })),
    },
    null,
    2,
  )}\n`;
}

/** Stylesheet of the HTML export and the print page: readable, light/dark, print-friendly. */
export const EXPORT_CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1d2330;--muted:#5d6676;--line:#d8dde6;--soft:#f4f6f9;--code:#f6f8fa;--user:#eef2ff}
@media (prefers-color-scheme:dark){:root{--bg:#16181d;--fg:#e6e9ef;--muted:#9aa3b2;--line:#343a46;--soft:#1f232b;--code:#1b1f27;--user:#232a3d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:820px;margin:0 auto;padding:32px 20px 64px}
header h1{font-size:28px;line-height:1.25;margin:0 0 6px}
header p{margin:0;color:var(--muted);font-size:14px;word-break:break-all}
.msg{margin:22px 0;padding:14px 18px;border:1px solid var(--line);border-radius:10px;break-inside:auto}
.msg.user{background:var(--user)}
.who{font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0 0 6px}
.content>:first-child{margin-top:0}.content>:last-child{margin-bottom:0}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:13.5px/1.5 ui-monospace,"Cascadia Mono",Consolas,monospace}
code{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:.92em;background:var(--code);padding:.1em .3em;border-radius:4px}
pre code{background:none;padding:0;font-size:inherit}
table{border-collapse:collapse;margin:12px 0;display:block;overflow:auto;max-width:100%}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--soft)}
blockquote{margin:12px 0;padding:2px 14px;border-left:4px solid var(--line);color:var(--muted)}
a{color:#2563eb}
.img{color:var(--muted);font-style:italic}
@media print{
  :root{--bg:#fff;--fg:#000;--muted:#444;--line:#bbb;--soft:#f2f2f2;--code:#f6f6f6;--user:#f3f5fb}
  body{font-size:12pt}
  main{max-width:none;padding:0}
  .msg{border-color:#ccc}
  pre{white-space:pre-wrap}
  a{color:#000}
  .noprint{display:none!important}
}`;

/**
 * Standalone HTML document. Message HTML must already be sanitised (lib/convert.js toSafeHtml).
 * @param {ExportChat} chat @param {Labels} [L] @param {Date} [now]
 */
export function toHtmlDoc(chat, L = DEFAULT_LABELS, now = new Date()) {
  const title = headingText(chat.title) || L.untitled;
  const svc = serviceInfo(chat.service)?.name || chat.service;
  const msgs = chat.messages
    .map((m) => `<section class="msg ${m.role}"><p class="who">${escapeHtml(roleLabel(chat, m, L))}</p><div class="content">${m.html || `<p>${escapeHtml(m.text).replace(/\n/g, '<br>')}</p>`}</div></section>`)
    .join('\n');
  return `<!doctype html>
<html lang="${escapeHtml(L.locale || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body><main>
<header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(svc)} · ${escapeHtml(L.source)}: ${escapeHtml(chat.url)} · ${escapeHtml(L.exported)}: ${escapeHtml(dateLine(now, L))}</p></header>
${msgs}
</main></body>
</html>
`;
}

/**
 * @param {ExportChat} chat @param {string} format md | html | json | txt @param {Labels} [L] @param {Date} [now]
 */
export function exportChat(chat, format, L = DEFAULT_LABELS, now = new Date()) {
  switch (format) {
    case 'md':
      return toMarkdownDoc(chat, L, now);
    case 'html':
      return toHtmlDoc(chat, L, now);
    case 'json':
      return toJsonDoc(chat, now);
    case 'txt':
      return toTextDoc(chat, L, now);
    default:
      throw new Error(`unknown format ${format}`);
  }
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Safe file name (Windows/macOS/Linux) from a chat title.
 * @param {string} title @param {string} ext without dot @param {string} [fallback]
 */
export function fileName(title, ext, fallback = 'chat') {
  let base = String(title || '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  base = [...base].slice(0, 80).join('').trim();
  if (!base || RESERVED.test(base)) base = fallback;
  return `${base}.${ext}`;
}

/** Make names unique: "a.md", "a (2).md", … @param {string[]} names */
export function uniqueNames(names) {
  const used = new Set();
  return names.map((n) => {
    let name = n;
    const dot = n.lastIndexOf('.');
    const stem = dot > 0 ? n.slice(0, dot) : n;
    const ext = dot > 0 ? n.slice(dot) : '';
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${stem} (${i})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/**
 * Zip with one file per chat, grouped in folders by service.
 * @param {ExportChat[]} chats @param {string} format @param {Labels} [L] @param {Date} [now]
 * @returns {Uint8Array}
 */
export function exportZip(chats, format, L = DEFAULT_LABELS, now = new Date()) {
  const names = uniqueNames(chats.map((c) => `${c.service}/${fileName(c.title, format, c.chatId)}`));
  return createZip(chats.map((c, i) => ({ name: names[i], data: exportChat(c, format, L, now) })), { date: now });
}
