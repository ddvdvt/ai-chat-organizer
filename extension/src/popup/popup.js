// Popup: status of the current chat site, quick export, enabling sites, search entry point.
import { applyI18n, t } from '../shared/i18n.js';
import { wireBrandLinks } from '../shared/brand-link.js';
import { h, send, grantedServices, requestService, revokeService, toast } from '../shared/page.js';
import { SERVICES, serviceForUrl, serviceInfo } from '../../lib/services.js';
import { normalizeState } from '../../lib/org.js';
import { countByService } from '../shared/db.js';

applyI18n();
wireBrandLinks();

const here = /** @type {HTMLElement} */ (document.getElementById('here'));

async function activeTab() {
  try {
    // popup.html?tabId=N binds the page to a tab (used when it is opened as a normal page)
    const forced = Number(new URLSearchParams(location.search).get('tabId'));
    if (forced) return await chrome.tabs.get(forced);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

/** @param {number} tabId @param {any} msg */
async function toTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    return null;
  }
}

const FEATURE_LABEL = { messages: 'featureMessages', prompts: 'featurePrompts', sidebar: 'featureSidebar' };

async function renderHere(granted) {
  const tab = await activeTab();
  const service = tab && tab.url ? serviceForUrl(tab.url) : null;
  here.replaceChildren();
  if (!service || !granted[service]) {
    here.append(h('p', { class: 'lead' }, t('openASite')), h('p', { class: 'muted small' }, t('openASiteHint')));
    return;
  }
  const info = serviceInfo(service);
  const { health } = await chrome.storage.local.get('health');
  const hl = health && health[service];
  const res = tab && tab.id != null ? await toTab(tab.id, { type: 'tab:info' }) : null;
  const status = h('p', { class: 'status' }, h('span', { class: 'badge', style: `--c:${info.color}` }, info.name), ' ');
  here.append(status);
  if (!res || !res.ok) {
    status.append(h('span', { class: 'muted' }, t('reloadTab')));
    return;
  }
  const degraded = (hl && hl.status === 'degraded') || res.messagesOk === false;
  status.append(h('span', { class: degraded ? 'warn-t' : 'ok-t' }, degraded ? t('statusDegraded') : t('statusOk')));
  if (degraded) {
    const broken = new Set([...(hl && hl.broken) || [], ...(res.messagesOk === false ? ['messages'] : [])]);
    here.append(h('p', { class: 'warnbox small' }, t('siteChanged', [[...broken].map((b) => t(FEATURE_LABEL[b] || b)).join(', ')])));
  }
  if (!res.chat) {
    here.append(h('p', { class: 'muted small' }, t('noChatOpen')));
  } else {
    here.append(h('p', { class: 'chat-title', title: res.chat.title }, res.chat.title || t('untitled')), h('p', { class: 'muted small' }, t('messagesOnScreen', [String(res.chat.count)])));
    const row = h('div', { class: 'exp', role: 'group', 'aria-label': t('export') });
    for (const [f, label] of [['md', 'Markdown'], ['html', 'HTML'], ['txt', 'TXT'], ['json', 'JSON'], ['pdf', 'PDF']]) {
      row.append(
        h(
          'button',
          {
            class: 'btn small',
            type: 'button',
            'data-format': f,
            disabled: !res.chat.count,
            onclick: async () => {
              const r = await toTab(/** @type {number} */ (tab.id), { type: 'tab:export', format: f });
              if (r && r.ok) {
                toast(f === 'pdf' ? t('pdfOpened') : t('exported'));
                if (f === 'pdf') window.close();
              } else toast(t('errorGeneric'));
            },
          },
          label,
        ),
      );
    }
    here.append(row);
  }
  here.append(
    h(
      'button',
      {
        class: 'btn small ghost',
        type: 'button',
        onclick: async () => {
          await toTab(/** @type {number} */ (tab.id), { type: 'tab:panel' });
          window.close();
        },
      },
      t('showPanel'),
    ),
  );
}

async function renderSites(granted) {
  const ul = /** @type {HTMLElement} */ (document.getElementById('sites'));
  ul.replaceChildren();
  for (const s of SERVICES) {
    const on = !!granted[s.id];
    const input = h('input', { type: 'checkbox', role: 'switch', checked: on, 'aria-label': `${s.name} (${s.host})` });
    input.addEventListener('change', async () => {
      input.disabled = true;
      const ok = input.checked ? await requestService(s.id) : await revokeService(s.id);
      if (!ok) toast(t('permissionNotChanged'));
      await refresh();
    });
    ul.append(
      h(
        'li',
        {},
        h('span', { class: 'dot', style: `--c:${s.color}` }),
        h('span', { class: 'site' }, h('strong', {}, s.name), h('span', { class: 'muted small' }, s.host)),
        h('label', { class: 'switch' }, input, h('span', { class: 'small muted' }, on ? t('on') : t('off'))),
      ),
    );
  }
}

async function renderStats() {
  const { org } = await chrome.storage.local.get('org');
  const s = normalizeState(org);
  let indexed = 0;
  try {
    const c = await countByService();
    indexed = Object.values(c).reduce((a, b) => a + b, 0);
  } catch {
    /* IndexedDB unavailable */
  }
  const pinned = Object.values(s.chats).filter((c) => c.pinned).length;
  /** @type {HTMLElement} */ (document.getElementById('stats')).textContent = t('popupStats', [String(indexed), String(s.folders.length), String(pinned)]);
}

async function refresh() {
  const granted = await grantedServices();
  await Promise.all([renderSites(granted), renderHere(granted).catch(() => {}), renderStats().catch(() => {})]);
  document.body.dataset.ready = '1';
}

/** @type {HTMLElement} */ (document.getElementById('openOrganizer')).addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
/** @type {HTMLFormElement} */ (document.getElementById('searchForm')).addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = /** @type {HTMLInputElement} */ (document.getElementById('q')).value.trim();
  await send({ type: 'organizer:open', query: q });
  window.close();
});

refresh();
