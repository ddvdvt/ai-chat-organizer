// Saved prompts with {{variables}}. Pure.
import { newId } from './org.js';

export const MAX_PROMPTS = 300;
export const MAX_PROMPT_CHARS = 20000;
const VAR_RE = /\{\{\s*([\p{L}\p{N}_][\p{L}\p{N}_ .-]{0,39}?)\s*\}\}/gu;

/**
 * @typedef {object} Prompt
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {number} updatedAt
 */

/** Variable names in order of first appearance. @param {string} body */
export function extractVars(body) {
  const out = [];
  for (const m of String(body || '').matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out.slice(0, 20);
}

/**
 * Replace {{name}} with values; variables without a value stay as they are.
 * @param {string} body @param {Record<string, string>} values
 */
export function fillPrompt(body, values = {}) {
  return String(body || '').replace(VAR_RE, (m, name) => (Object.prototype.hasOwnProperty.call(values, name) && String(values[name]) !== '' ? String(values[name]) : m));
}

/** @param {any} list @returns {Prompt[]} */
export function normalizePrompts(list) {
  const out = [];
  const ids = new Set();
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p.body !== 'string' || !p.body.trim() || out.length >= MAX_PROMPTS) continue;
    let id = typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.id) ? p.id : newId('p');
    if (ids.has(id)) id = newId('p');
    ids.add(id);
    const body = p.body.slice(0, MAX_PROMPT_CHARS);
    const title = String(p.title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || body.replace(/\s+/g, ' ').trim().slice(0, 40);
    out.push({ id, title, body, updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : 0 });
  }
  return out;
}

/** Insert or replace a prompt (by id). @param {Prompt[]} list @param {Partial<Prompt>} p */
export function savePrompt(list, p, now = Date.now()) {
  const [clean] = normalizePrompts([{ ...p, updatedAt: now }]);
  if (!clean) return list;
  const i = list.findIndex((x) => x.id === p.id);
  if (i < 0) return list.length >= MAX_PROMPTS ? list : [clean, ...list];
  const next = [...list];
  next[i] = { ...clean, id: list[i].id };
  return next;
}

/** @param {Prompt[]} list @param {string} id */
export function deletePrompt(list, id) {
  return list.filter((p) => p.id !== id);
}

/** Example prompts for the empty library. @param {'ru' | 'en'} lang */
export function samplePrompts(lang) {
  const ru = [
    { title: 'Объясни простыми словами', body: 'Объясни {{тема}} простыми словами, как для новичка. Приведи один пример из жизни.' },
    { title: 'Ревью кода', body: 'Сделай ревью этого кода на {{язык}}: найди ошибки, проблемы безопасности и предложи исправления.\n\n{{код}}' },
  ];
  const en = [
    { title: 'Explain simply', body: 'Explain {{topic}} in simple words for a beginner. Give one real-life example.' },
    { title: 'Code review', body: 'Review this {{language}} code: find bugs and security issues and suggest fixes.\n\n{{code}}' },
  ];
  return normalizePrompts(lang === 'ru' ? ru : en);
}
