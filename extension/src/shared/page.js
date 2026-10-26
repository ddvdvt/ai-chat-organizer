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
