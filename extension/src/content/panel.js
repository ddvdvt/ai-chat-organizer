// In-page panel inside a closed Shadow DOM: folders for the chats of this site, the current chat
// (pin, folder, tags, export), search over opened chats of this site and the prompt library.
// Plus a small "folder" button that appears over the site's sidebar links on hover, and drag &
// drop of sidebar links onto folders. The site's own DOM is never modified.
import { folderTree, filterChats, folderCounts, chatKey } from '../../lib/org.js';
import { extractVars, fillPrompt } from '../../lib/prompts.js';
import { PANEL_CSS } from './panel-css.js';

/** Shadow root mode. Closed: page scripts cannot read your folders or other chats' titles. */
const SHADOW_MODE = 'closed';
const HOST_TAG = 'ai-chat-organizer-root';

const ICON_FOLDER = 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l1.8 2h9A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z';
const ICON_PIN = 'M14 3l7 7-3 1-4 4 .5 4.5L13 21l-4-4-5 5-1-1 5-5-4-4 1.5-1.5L10 11l4-4z';

/**
 * @typedef {object} PanelApi
 * @property {string} service
 * @property {string} serviceName
 * @property {(k: string, s?: string|string[]) => string} t
 * @property {() => any} getState
 * @property {(op: any) => Promise<any>} op
 * @property {(q: string) => Promise<any[]>} search
 * @property {(format: string) => Promise<{ok: boolean, error?: string}>} exportCurrent
 * @property {(text: string) => boolean} insertPrompt
 * @property {(url: string) => void} navigate
 * @property {(hash?: string) => void} openOrganizer
 * @property {(target: EventTarget | null) => {el: Element, ref: any} | null} sidebarChatAt
 */

/** Small DOM builder. */
function h(tag, attrs = {}, ...kids) {
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

function svg(path, size = 16) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'currentColor');
  s.append(p);
  return s;
}

/** @param {PanelApi} api */
export function createPanel(api) {
  const { t, service } = api;
  if (document.querySelector(HOST_TAG)) return null;
  const host = document.createElement(HOST_TAG);
  host.setAttribute('style', 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;');
  const root = host.attachShadow({ mode: SHADOW_MODE });
  root.append(h('style', { text: PANEL_CSS }));

  const ui = {
    open: false,
    tab: 'folders',
    expanded: new Set(),
    results: /** @type {any[] | null} */ (null),
    query: '',
    dragging: /** @type {any} */ (null),
    filling: /** @type {any} */ (null),
    menuRef: /** @type {any} */ (null),
    hoverRef: /** @type {any} */ (null),
  };

  // ---------- skeleton ----------
  const launcher = h('button', { class: 'launcher', type: 'button', 'aria-expanded': 'false', 'aria-label': t('panelOpen'), title: t('panelOpen') }, svg(ICON_FOLDER, 18));
  const curBox = h('div', { class: 'cur' });
  const warnBox = h('p', { class: 'warn', hidden: true, role: 'status' });
  const tabsBar = h('div', { class: 'tabs', role: 'tablist' });
  const panes = {
    folders: h('div', { class: 'pane', role: 'tabpanel' }),
    search: h('div', { class: 'pane', role: 'tabpanel', hidden: true }),
    prompts: h('div', { class: 'pane', role: 'tabpanel', hidden: true }),
  };
  for (const [id, label] of [['folders', t('tabFolders')], ['search', t('tabSearch')], ['prompts', t('tabPrompts')]]) {
    tabsBar.append(h('button', { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': String(id === ui.tab), onclick: () => setTab(id) }, label));
  }
  const folderList = h('div', { class: 'flist' });
  const newFolderInput = h('input', { type: 'text', maxlength: '60', placeholder: t('newFolderPh'), 'aria-label': t('newFolderPh') });
  const newFolderForm = h('form', { class: 'newf', onsubmit: (e) => (e.preventDefault(), createFolder()) }, newFolderInput, h('button', { type: 'submit', class: 'btn small' }, t('create')));
  const dropHintEl = h('p', { class: 'hint', hidden: true }, t('dropHint'));
  panes.folders.append(folderList, newFolderForm, dropHintEl);
  const searchInput = h('input', { type: 'search', class: 'q', placeholder: t('searchSitePh'), 'aria-label': t('searchSitePh') });
  const resultsBox = h('div', { class: 'results', 'aria-live': 'polite' });
  panes.search.append(searchInput, resultsBox);
  const promptsBox = h('div', { class: 'prompts' });
  panes.prompts.append(promptsBox);

  const drawer = h(
    'section',
    { class: 'drawer', role: 'dialog', 'aria-label': t('panelTitle'), hidden: true },
    h(
      'header',
      {},
      h('span', { class: 'logo' }, svg(ICON_FOLDER, 18)),
      h('strong', {}, t('panelTitle')),
      h('span', { class: 'svc' }, api.serviceName),
      h('button', { type: 'button', class: 'icon', title: t('openOrganizer'), 'aria-label': t('openOrganizer'), onclick: () => api.openOrganizer() }, '↗'),
      h('button', { type: 'button', class: 'icon close', title: t('close'), 'aria-label': t('close'), onclick: () => close() }, '×'),
    ),
    warnBox,
    curBox,
    tabsBar,
    panes.folders,
    panes.search,
    panes.prompts,
  );
  const hoverBtn = h('button', { class: 'hover', type: 'button', hidden: true, 'aria-label': t('moveToFolder'), title: t('moveToFolder') }, svg(ICON_FOLDER, 14));
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true });
  const toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
  const launcherWrap = h('div', { class: 'lwrap' }, launcher);
  root.append(launcherWrap, drawer, hoverBtn, menu, toastEl);
  document.documentElement.append(host);

  // ---------- helpers ----------
  const S = () => api.getState();
  const enabled = () => S().settings.services[service]?.panel !== false;
  const myChats = (f) => filterChats(S().org, { ...f, services: [service] });

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  }

  async function doOp(op, okMsg) {
    const r = await api.op(op);
    if (!r || !r.ok) toast(t('errorGeneric'));
    else if (okMsg) toast(okMsg);
    return r;
  }

  function setTab(id) {
    ui.tab = id;
    for (const b of tabsBar.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === id));
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== id;
    if (id === 'search') setTimeout(() => searchInput.focus(), 0);
    render(true);
  }

  function open(tab) {
    ui.open = true;
    drawer.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    if (tab) setTab(tab);
    render(true);
    const first = drawer.querySelector('button.close');
    if (first && !ui.dragging) /** @type {HTMLElement} */ (first).focus();
  }
  function close() {
    ui.open = false;
    drawer.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    closeMenu();
    launcher.focus();
  }
  launcher.addEventListener('click', () => (ui.open ? close() : open()));
  drawer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!menu.hidden) closeMenu();
      else close();
    }
  });

  async function createFolder(name = newFolderInput.value, parentId = null) {
    const n = String(name || '').trim();
    if (!n) return null;
    const r = await doOp({ type: 'addFolder', name: n, parentId });
    newFolderInput.value = '';
    return r && r.result ? r.result.id : null;
  }

  // ---------- current chat ----------
  function renderCurrent() {
    const st = S();
    curBox.replaceChildren();
    const cur = st.current;
    if (!cur) {
      curBox.append(h('p', { class: 'muted' }, t('noChatOpen')));
      return;
    }
    const meta = st.org.chats[chatKey(service, cur.chatId)];
    const ref = { service, chatId: cur.chatId, title: cur.title, url: cur.url };
    const pinned = !!(meta && meta.pinned);
    const folderSel = h('select', { 'aria-label': t('folder'), onchange: (e) => doOp({ type: 'moveChat', chat: ref, folderId: e.target.value || null }, t('moved')) }, h('option', { value: '' }, t('noFolder')));
    for (const f of folderTree(st.org)) {
      folderSel.append(h('option', { value: f.id, selected: meta && meta.folderId === f.id }, f.name));
      for (const c of f.children) folderSel.append(h('option', { value: c.id, selected: meta && meta.folderId === c.id }, `   ${c.name}`));
    }
    const tags = h('div', { class: 'tags' });
    for (const tg of st.org.tags) {
      const on = !!(meta && meta.tags.includes(tg.id));
      tags.append(h('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(on), style: `--c:${tg.color}`, onclick: () => doOp({ type: 'tagChat', chat: ref, tagId: tg.id }) }, tg.name));
    }
    const tagInput = h('input', { type: 'text', maxlength: '60', class: 'tagin', placeholder: t('newTagPh'), 'aria-label': t('newTagPh') });
    tags.append(
      h(
        'form',
        {
          class: 'tagform',
          onsubmit: async (e) => {
            e.preventDefault();
            const name = tagInput.value.trim();
            if (!name) return;
            const r = await doOp({ type: 'addTag', name });
            if (r && r.result && r.result.id) await doOp({ type: 'tagChat', chat: ref, tagId: r.result.id, on: true });
          },
        },
        tagInput,
      ),
    );
    const canExport = st.messagesOk;
    const exp = h('div', { class: 'exp', role: 'group', 'aria-label': t('export') }, h('span', { class: 'muted' }, `${t('export')}:`));
    for (const [f, label] of [['md', 'MD'], ['html', 'HTML'], ['txt', 'TXT'], ['json', 'JSON'], ['pdf', 'PDF']]) {
      exp.append(
        h(
          'button',
          {
            type: 'button',
            class: 'btn small',
            'data-format': f,
            disabled: !canExport,
            title: f === 'pdf' ? t('exportPdfHint') : `${t('export')} ${label}`,
            onclick: async () => {
              const r = await api.exportCurrent(f);
              toast(r.ok ? (f === 'pdf' ? t('pdfOpened') : t('exported')) : t(r.error === 'noMessages' ? 'noMessages' : 'errorGeneric'));
            },
          },
          label,
        ),
      );
    }
    curBox.append(
      h('p', { class: 'title', title: cur.title }, cur.title || t('untitled')),
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: `btn small pin${pinned ? ' on' : ''}`, 'aria-pressed': String(pinned), onclick: () => doOp({ type: 'pinChat', chat: ref }) }, svg(ICON_PIN, 13), pinned ? t('unpin') : t('pin')),
        folderSel,
      ),
      tags,
      exp,
    );
  }

  // ---------- folders ----------
  function chatRow(c) {
    const a = h(
      'a',
      {
        href: c.url,
        class: 'chat',
        draggable: 'true',
        title: c.title,
        onclick: (e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          api.navigate(c.url);
        },
        ondragstart: (e) => {
          ui.dragging = { service: c.service, chatId: c.chatId, title: c.title, url: c.url };
          e.dataTransfer.setData('text/uri-list', c.url);
          e.dataTransfer.effectAllowed = 'move';
        },
        ondragend: () => (ui.dragging = null),
      },
      c.pinned ? h('span', { class: 'pinmark', 'aria-label': t('pinned') }, svg(ICON_PIN, 11)) : null,
      h('span', { class: 'ct' }, c.title || t('untitled')),
    );
    const more = h('button', { type: 'button', class: 'icon more', 'aria-label': t('moveToFolder'), title: t('moveToFolder'), onclick: (e) => openMenu({ service: c.service, chatId: c.chatId, title: c.title, url: c.url }, e.currentTarget) }, '⋯');
    if (S().current && S().current.chatId === c.chatId) a.setAttribute('aria-current', 'page');
    return h('li', {}, a, more);
  }

  function dropTarget(el, folderId) {
    el.addEventListener('dragover', (e) => {
      if (!ui.dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', async (e) => {
      el.classList.remove('over');
      const ref = ui.dragging;
      if (!ref) return;
      e.preventDefault();
      ui.dragging = null;
      drawer.classList.remove('dropping');
      dropHintEl.hidden = true;
      await doOp({ type: 'moveChat', chat: ref, folderId }, t('moved'));
    });
  }

  function renderFolders() {
    const st = S();
    folderList.replaceChildren();
    const counts = folderCounts(st.org, [service]);
    const pinned = myChats({ folderId: 'pinned' });
    if (pinned.length) {
      folderList.append(h('p', { class: 'sec' }, t('pinned')), h('ul', { class: 'chats' }, pinned.map(chatRow)));
    }
    const tree = folderTree(st.org);
    if (!tree.length) {
      folderList.append(h('p', { class: 'empty' }, t('noFoldersYet')));
      return;
    }
    folderList.append(h('p', { class: 'sec' }, t('folders')));
    const ul = h('ul', { class: 'folders' });
    const folderItem = (f, depth) => {
      const isOpen = ui.expanded.has(f.id);
      const btn = h(
        'button',
        { type: 'button', class: 'frow', 'aria-expanded': String(isOpen), style: `--c:${f.color}`, onclick: () => (isOpen ? ui.expanded.delete(f.id) : ui.expanded.add(f.id), render(true)) },
        h('span', { class: 'caret', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸'),
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('span', { class: 'fn' }, f.name),
        h('span', { class: 'cnt' }, String(counts[f.id] || 0)),
      );
      dropTarget(btn, f.id);
      const li = h('li', { class: depth ? 'sub' : '' }, btn);
      if (isOpen) {
        const kids = h('ul', { class: 'inner' });
        for (const c of f.children || []) kids.append(folderItem(c, 1));
        const chats = myChats({ folderId: f.id, includeSub: false });
        if (chats.length) kids.append(...chats.map(chatRow));
        else if (!(f.children || []).length) kids.append(h('li', { class: 'muted small' }, t('folderEmptyHere')));
        li.append(kids);
      }
      return li;
    };
    for (const f of tree) ul.append(folderItem(f, 0));
    folderList.append(ul);
  }

  // ---------- search ----------
  let searchTimer = 0;
  let searchSeq = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });
  async function runSearch() {
    const q = searchInput.value.trim();
    ui.query = q;
    const seq = ++searchSeq;
    ui.results = q ? await api.search(q) : null;
    if (seq === searchSeq) renderSearch();
  }
  function renderSearch() {
    resultsBox.replaceChildren();
    if (!S().settings.services[service]?.index) {
      resultsBox.append(h('p', { class: 'empty' }, t('indexOffHere')));
      return;
    }
    if (!ui.query) {
      resultsBox.append(h('p', { class: 'muted small' }, t('searchExplain')));
      return;
    }
    const res = ui.results || [];
    if (!res.length) {
      resultsBox.append(h('p', { class: 'empty' }, t('nothingFound')));
      return;
    }
    const ul = h('ul', { class: 'res' });
    for (const r of res) {
      const snip = h('span', { class: 'snip' }, r.snippet.map((s) => (s.hit ? h('mark', {}, s.text) : s.text)));
      ul.append(
        h(
          'li',
          {},
          h(
            'a',
            {
              href: r.url,
              onclick: (e) => {
                if (e.ctrlKey || e.metaKey || e.button !== 0) return;
                e.preventDefault();
                api.navigate(r.url);
              },
            },
            h('span', { class: 'ct' }, r.title || t('untitled')),
            snip,
          ),
        ),
      );
    }
    resultsBox.append(ul);
  }

  // ---------- prompts ----------
  function insert(text) {
    const ok = api.insertPrompt(text);
    toast(ok ? t('promptInserted') : t('inputNotFound'));
    if (ok) {
      ui.filling = null;
      close();
    }
  }
  function renderPrompts() {
    promptsBox.replaceChildren();
    const list = S().prompts;
    if (ui.filling) {
      const p = ui.filling;
      const inputs = extractVars(p.body).map((v) => ({ v, el: h('textarea', { rows: '2', 'aria-label': v }) }));
      const form = h(
        'form',
        {
          class: 'fill',
          onsubmit: (e) => {
            e.preventDefault();
            insert(fillPrompt(p.body, Object.fromEntries(inputs.map((x) => [x.v, x.el.value]))));
          },
        },
        h('p', { class: 'title' }, p.title),
        ...inputs.map((x) => h('label', {}, h('span', {}, x.v), x.el)),
        h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn small primary' }, t('insert')), h('button', { type: 'button', class: 'btn small', onclick: () => ((ui.filling = null), render(true)) }, t('cancel'))),
      );
      promptsBox.append(form);
      setTimeout(() => inputs[0] && inputs[0].el.focus(), 0);
      return;
    }
    if (!list.length) {
      promptsBox.append(h('p', { class: 'empty' }, t('noPromptsYet')));
    } else {
      const ul = h('ul', { class: 'plist' });
      for (const p of list) {
        const vars = extractVars(p.body);
        ul.append(
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', class: 'prow', title: p.body.slice(0, 300), onclick: () => (vars.length ? ((ui.filling = p), render(true)) : insert(p.body)) },
              h('span', { class: 'ct' }, p.title),
              vars.length ? h('span', { class: 'vars' }, vars.map((v) => `{{${v}}}`).join(' ')) : null,
            ),
          ),
        );
      }
      promptsBox.append(ul);
    }
    promptsBox.append(h('button', { type: 'button', class: 'link', onclick: () => api.openOrganizer('#prompts') }, t('managePrompts')));
  }

  // ---------- "move to folder" menu ----------
  function closeMenu() {
    menu.hidden = true;
    ui.menuRef = null;
  }
  function openMenu(ref, anchor) {
    ui.menuRef = ref;
    const st = S();
    const meta = st.org.chats[chatKey(ref.service, ref.chatId)];
    const current = meta ? meta.folderId : null;
    menu.replaceChildren();
    const item = (label, checked, fn, extra = {}) =>
      h(
        'button',
        {
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': String(!!checked),
          ...extra,
          onclick: async () => {
            closeMenu();
            await fn();
          },
        },
        label,
      );
    menu.append(h('p', { class: 'mt', title: ref.title }, ref.title || t('untitled')));
    menu.append(item(t('noFolder'), !current, () => doOp({ type: 'moveChat', chat: ref, folderId: null }, t('moved'))));
    for (const f of folderTree(st.org)) {
      menu.append(item(f.name, current === f.id, () => doOp({ type: 'moveChat', chat: ref, folderId: f.id }, t('moved')), { style: `--c:${f.color}`, class: 'fi' }));
      for (const c of f.children) menu.append(item(c.name, current === c.id, () => doOp({ type: 'moveChat', chat: ref, folderId: c.id }, t('moved')), { style: `--c:${c.color}`, class: 'fi sub' }));
    }
    const pinned = !!(meta && meta.pinned);
    menu.append(h('hr'), h('button', { type: 'button', role: 'menuitem', onclick: async () => (closeMenu(), doOp({ type: 'pinChat', chat: ref }, pinned ? t('unpinned') : t('pinnedOk'))) }, pinned ? t('unpin') : t('pin')));
    const inp = h('input', { type: 'text', maxlength: '60', placeholder: t('newFolderPh'), 'aria-label': t('newFolderPh') });
    menu.append(
      h(
        'form',
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const id = await createFolder(inp.value);
            closeMenu();
            if (id) await doOp({ type: 'moveChat', chat: ref, folderId: id }, t('moved'));
          },
        },
        inp,
      ),
    );
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const mw = 240;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
    const top = Math.min(r.bottom + 4, window.innerHeight - Math.min(menu.scrollHeight, 360) - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    const first = menu.querySelector('button');
    if (first) /** @type {HTMLElement} */ (first).focus();
  }
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button')];
    const i = items.indexOf(/** @type {any} */ (root.activeElement));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (n) n.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  });
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!menu.hidden && !e.composedPath().includes(menu)) closeMenu();
    },
    true,
  );

  // ---------- hover button over sidebar links ----------
  let hoverTimer = 0;
  function hideHover() {
    hoverBtn.hidden = true;
    ui.hoverRef = null;
  }
  document.addEventListener(
    'mouseover',
    (e) => {
      if (!enabled()) return;
      if (e.target === host) {
        clearTimeout(hoverTimer);
        return;
      }
      const hit = api.sidebarChatAt(e.target);
      if (!hit) {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(hideHover, 400);
        return;
      }
      clearTimeout(hoverTimer);
      const r = hit.el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      ui.hoverRef = hit.ref;
      hoverBtn.hidden = false;
      hoverBtn.style.left = `${Math.round(Math.max(r.left + 4, r.right - 58))}px`;
      hoverBtn.style.top = `${Math.round(r.top + r.height / 2 - 11)}px`;
    },
    { passive: true, capture: true },
  );
  document.addEventListener('scroll', hideHover, { passive: true, capture: true });
  hoverBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ui.hoverRef) openMenu(ui.hoverRef, hoverBtn);
  });

  // ---------- drag sidebar links onto folders ----------
  document.addEventListener(
    'dragstart',
    (e) => {
      if (!enabled()) return;
      const hit = api.sidebarChatAt(e.target);
      if (!hit) return;
      ui.dragging = hit.ref;
      hideHover();
      drawer.classList.add('dropping');
      dropHintEl.hidden = false;
      // no re-render of an open folder list: rows must not move under the pointer
      if (!ui.open) open('folders');
      else if (ui.tab !== 'folders') setTab('folders');
    },
    true,
  );
  document.addEventListener(
    'dragend',
    () => {
      if (!ui.dragging) return;
      ui.dragging = null;
      drawer.classList.remove('dropping');
      dropHintEl.hidden = true;
    },
    true,
  );

  // ---------- render (only when something changed; never while the user types) ----------
  let lastKey = '';
  function render(force = false) {
    const st = S();
    launcherWrap.hidden = !enabled();
    if (!enabled()) {
      if (ui.open) close();
      hideHover();
      return;
    }
    const broken = (st.health && st.health.status === 'degraded') || !st.messagesOk;
    const key = JSON.stringify([ui.open, ui.tab, [...ui.expanded], st.current, st.messagesOk, st.health, st.org, st.prompts.length, st.prompts.map((p) => p.id + p.updatedAt), st.settings.services[service], !!ui.filling]);
    if (!force && key === lastKey) return;
    lastKey = key;
    warnBox.hidden = !broken;
    if (broken) warnBox.textContent = t('siteChangedPanel');
    if (!ui.open) return;
    const active = root.activeElement;
    if (!(active && curBox.contains(active) && active.tagName !== 'BUTTON')) renderCurrent();
    if (ui.tab === 'folders') renderFolders();
    if (ui.tab === 'search') renderSearch();
    if (ui.tab === 'prompts' && !(force === false && ui.filling && active && active.closest && active.closest('.fill'))) renderPrompts();
  }

  render(true);
  return { root, open: () => open(), render };
}
