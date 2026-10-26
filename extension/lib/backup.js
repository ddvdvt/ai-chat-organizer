// Backup file of the organisation data (folders, tags, pins, prompts, settings). The search
// index is not included: it is rebuilt by opening chats. Pure.
import { normalizeState } from './org.js';
import { normalizePrompts } from './prompts.js';
import { normalizeSettings } from './settings.js';

export const BACKUP_FORMAT = 'ai-chat-organizer-backup/1';
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

/** @param {any} org @param {any} prompts @param {any} settings @param {Date} [now] */
export function makeBackup(org, prompts, settings, now = new Date()) {
  return { format: BACKUP_FORMAT, exportedAt: now.toISOString(), org: normalizeState(org), prompts: normalizePrompts(prompts), settings: normalizeSettings(settings) };
}

/**
 * @param {string} text
 * @returns {{ok: true, org: any, prompts: any[], settings: any} | {ok: false, error: string}}
 */
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'size' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  if (!raw || raw.format !== BACKUP_FORMAT) return { ok: false, error: 'format' };
  return { ok: true, org: normalizeState(raw.org), prompts: normalizePrompts(raw.prompts), settings: normalizeSettings(raw.settings) };
}
