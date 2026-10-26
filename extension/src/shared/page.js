// Helpers for the extension's own pages (popup, organizer, print).
import { serviceInfo, originPattern, SERVICES } from '../../lib/services.js';

/** Small DOM builder: h('a', {href, class, onclick}, 'text', child). */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const ICONS = {
  pin: 'M14 3l7 7-3 1-4 4 .5 4.5L13 21l-4-4-5 5-1-1 5-5-4-4 1.5-1.5L10 11l4-4z',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  edit: 'M4 17.25V20h2.75L17.8 8.94l-2.75-2.75zM20.7 6.04a1 1 0 0 0 0-1.41l-1.33-1.33a1 1 0 0 0-1.41 0l-1.13 1.13 2.75 2.75z',
  trash: 'M8 3h8v2h5v2H3V5h5zM5 9h14l-1.2 12H6.2zm4 2v8h2v-8zm4 0v8h2v-8z',
};

/** Inline SVG icon (decorative; the button carries the label). @param {keyof typeof ICONS} name */
export function icon(name, size = 15) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name]);
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('fill-rule', 'evenodd');
  svg.append(p);
  return svg;
}

/** Message to the service worker. */
export async function send(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    return null;
  }
}

/** Organisation op through the service worker (the single writer). */
export function op(o) {
  return send({ type: 'org:op', op: o });
}

/** Save bytes/text as a file via a temporary link (no downloads permission needed). */
export function download(data, name, mime) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

let toastEl = null;
let toastTimer = 0;
export function toast(msg) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2800);
}

/** Coloured service badge. */
export function badge(service) {
  const s = serviceInfo(service);
  return h('span', { class: 'badge', style: `--c:${s ? s.color : '#888'}` }, s ? s.name : service);
}

/** Which services the user enabled (host permission granted). @returns {Promise<Record<string, boolean>>} */
export async function grantedServices() {
  const out = {};
  for (const s of SERVICES) {
    try {
      out[s.id] = await chrome.permissions.contains({ origins: [originPattern(s.id)] });
    } catch {
      out[s.id] = false;
    }
  }
  return out;
}

/** Ask for access to one site (must run in a click handler). */
export async function requestService(service) {
  try {
    const ok = await chrome.permissions.request({ origins: [originPattern(service)] });
    if (ok) await send({ type: 'sync:scripts' });
    return ok;
  } catch {
    return false;
  }
}

/** Revoke access to one site. */
export async function revokeService(service) {
  try {
    const ok = await chrome.permissions.remove({ origins: [originPattern(service)] });
    await send({ type: 'sync:scripts' });
    return ok;
  } catch {
    return false;
  }
}

/** Localised date+time, short. */
export function shortDate(ms, locale) {
  if (!ms) return '';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** UI locale like "ru" / "en". */
export function uiLocale() {
  try {
    return (chrome.i18n.getMessage('@@ui_locale') || 'ru').replace('_', '-');
  } catch {
    return 'ru';
  }
}
