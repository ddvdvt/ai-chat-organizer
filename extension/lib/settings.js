// User settings: per-service switches. Pure.
import { SERVICE_IDS } from './services.js';
import { FORMATS } from './exportfmt.js';

/**
 * @typedef {object} ServiceSettings
 * @property {boolean} index  remember opened chats (title + text) for search — opt-out
 * @property {boolean} panel  show the in-page panel button
 *
 * @typedef {object} Settings
 * @property {Record<string, ServiceSettings>} services
 * @property {string} exportFormat
 */

/** @returns {Settings} */
export function defaultSettings() {
  return {
    services: Object.fromEntries(SERVICE_IDS.map((id) => [id, { index: true, panel: true }])),
    exportFormat: 'md',
  };
}

/** @param {any} raw @returns {Settings} */
export function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  for (const id of SERVICE_IDS) {
    const s = raw.services && raw.services[id];
    if (s && typeof s === 'object') {
      if (typeof s.index === 'boolean') d.services[id].index = s.index;
      if (typeof s.panel === 'boolean') d.services[id].panel = s.panel;
    }
  }
  if (FORMATS.includes(raw.exportFormat)) d.exportFormat = raw.exportFormat;
  return d;
}
