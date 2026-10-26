// Organizer page (options page, opens in a tab): all chats of all enabled services in folders,
// tags, pins; full-text search over opened chats; single and bulk export; prompt library;
// settings (sites, indexing opt-out per service), backup.
import { applyI18n, t } from '../shared/i18n.js';
import { wireBrandLinks } from '../shared/brand-link.js';
import { h, icon, send, op, download, toast, badge, grantedServices, requestService, revokeService, shortDate, uiLocale } from '../shared/page.js';
import { SERVICES } from '../../lib/services.js';
import { normalizeState, folderTree, filterChats, folderCounts, folderPath, COLORS } from '../../lib/org.js';
import { normalizeSettings } from '../../lib/settings.js';
import { normalizePrompts, savePrompt, deletePrompt, extractVars, samplePrompts } from '../../lib/prompts.js';
import { search as searchIndex, snippet, parseQuery, bestMessageText } from '../../lib/search.js';
import { exportChat, exportZip, fileName, mimeOf } from '../../lib/exportfmt.js';
import { makeBackup, parseBackup } from '../../lib/backup.js';
import { allSearchEntries, getChat, indexedKeys, countByService } from '../shared/db.js';

applyI18n();
wireBrandLinks();

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const LOCALE = uiLocale();

const st = {
  org: normalizeState(null),
  settings: normalizeSettings(null),
  prompts: /** @type {import('../../lib/prompts.js').Prompt[]} */ ([]),
  health: /** @type {Record<string, any>} */ ({}),
  indexed: new Set(),
  counts: /** @type {Record<string, number>} */ ({}),
  granted: /** @type {Record<string, boolean>} */ ({}),
  view: 'chats',
  nav: /** @type {string} */ ('all'),
  tagId: /** @type {string | null} */ (null),
  services: new Set(),
  query: '',
  results: /** @type {Array<{key: string, snippet: any[], rec?: any}> | null} */ (null),
  selected: new Set(),
  promptId: /** @type {string | null} */ (null),
};

const labels = () => ({ user: t('roleUser'), untitled: t('untitled'), exported: t('exported'), source: t('source'), locale: LOCALE });

async function load() {
  const d = await chrome.storage.local.get(['org', 'settings', 'prompts', 'health']);
  st.org = normalizeState(d.org);
  st.settings = normalizeSettings(d.settings);
  st.prompts = normalizePrompts(d.prompts);
  st.health = d.health || {};
  try {
    st.indexed = new Set(await indexedKeys());
    st.counts = await countByService();
  } catch {
    st.indexed = new Set();
  }
  st.granted = await grantedServices();
}

// ---------- dialog ----------

/**
 * @param {{title: string, body: Node[], ok?: string, danger?: boolean, extra?: Node[]}} o
 * @returns {Promise<boolean>}
 */
function dialog(o) {
  const dlg = $('dlg');
  $('dlgTitle').textContent = o.title;
  $('dlgBody').replaceChildren(...o.body, ...(o.extra || []));
  $('dlgOk').textContent = o.ok || t('save');
  $('dlgOk').className = `btn ${o.danger ? 'danger' : 'primary'}`;
  return new Promise((resolve) => {
    const finish = (v) => {
      $('dlgForm').onsubmit = null;
      $('dlgCancel').onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    $('dlgForm').onsubmit = (e) => {
      e.preventDefault();
      finish(true);
    };
    $('dlgCancel').onclick = () => finish(false);
    dlg.onclose = () => finish(false);
    dlg.showModal();
    const first = $('dlgBody').querySelector('input,select,textarea');
    if (first) first.focus();
  });
}

const confirmDlg = (title, text, ok) => dialog({ title, body: [h('p', {}, text)], ok, danger: true });

function colorPicker(current) {
  const wrap = h('div', { class: 'colors', role: 'radiogroup', 'aria-label': t('color') });
  COLORS.forEach((c, i) => {
    const id = `col${i}`;
    wrap.append(h('input', { type: 'radio', name: 'color', id, value: c, checked: c === current, style: `--c:${c}`, 'aria-label': c }), h('label', { for: id, style: `--c:${c}` }));
  });
  return wrap;
}
const pickedColor = () => /** @type {HTMLInputElement | null} */ (document.querySelector('#dlgBody input[name=color]:checked'))?.value;

async function folderDialog(folder) {
  const name = h('input', { type: 'text', maxlength: '60', value: folder ? folder.name : '', required: true });
  const parent = h('select', {}, h('option', { value: '' }, t('topLevel')));
  const hasChildren = folder && st.org.folders.some((f) => f.parentId === folder.id);
  for (const f of folderTree(st.org)) if (!folder || f.id !== folder.id) parent.append(h('option', { value: f.id, selected: folder && folder.parentId === f.id }, f.name));
  if (hasChildren) parent.disabled = true;
  const extra = [];
  if (folder) {
    extra.push(
      h(
        'div',
        { class: 'row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => op({ type: 'reorderFolder', id: folder.id, dir: -1 }) }, `↑ ${t('moveUp')}`),
        h('button', { type: 'button', class: 'btn small', onclick: () => op({ type: 'reorderFolder', id: folder.id, dir: 1 }) }, `↓ ${t('moveDown')}`),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            type: 'button',
            class: 'btn small danger',
            onclick: async () => {
              $('dlg').close();
              if (await confirmDlg(t('deleteFolder'), t('confirmDeleteFolder', [folder.name]), t('delete'))) {
                await op({ type: 'deleteFolder', id: folder.id });
                if (st.nav === folder.id) st.nav = 'all';
              }
            },
          },
          t('deleteFolder'),
        ),
      ),
    );
  }
  const ok = await dialog({
    title: folder ? t('editFolder') : t('newFolder'),
    body: [h('label', { class: 'field' }, h('span', {}, t('name')), name), h('label', { class: 'field' }, h('span', {}, t('parentFolder')), parent), h('div', { class: 'field' }, h('span', {}, t('color')), colorPicker(folder ? folder.color : COLORS[(st.org.folders.length + 5) % COLORS.length]))],
    extra,
  });
  if (!ok || !name.value.trim()) return;
  if (folder) await op({ type: 'updateFolder', id: folder.id, patch: { name: name.value, color: pickedColor(), parentId: parent.value || null } });
  else {
    const r = await op({ type: 'addFolder', name: name.value, parentId: parent.value || null, color: pickedColor() });
    if (r && r.result && r.result.error === 'limit') toast(t('limitReached'));
  }
}

async function tagDialog(tag) {
  const name = h('input', { type: 'text', maxlength: '60', value: tag ? tag.name : '', required: true });
  const extra = tag
    ? [
        h(
          'button',
          {
            type: 'button',
            class: 'btn small danger',
            onclick: async () => {
              $('dlg').close();
              if (await confirmDlg(t('deleteTag'), t('confirmDeleteTag', [tag.name]), t('delete'))) {
                await op({ type: 'deleteTag', id: tag.id });
                if (st.tagId === tag.id) st.tagId = null;
              }
            },
          },
          t('deleteTag'),
        ),
      ]
    : [];
  const ok = await dialog({ title: tag ? t('editTag') : t('newTag'), body: [h('label', { class: 'field' }, h('span', {}, t('name')), name), h('div', { class: 'field' }, h('span', {}, t('color')), colorPicker(tag ? tag.color : COLORS[(st.org.tags.length + 1) % COLORS.length]))], extra });
  if (!ok || !name.value.trim()) return;
  if (tag) await op({ type: 'updateTag', id: tag.id, patch: { name: name.value, color: pickedColor() } });
  else await op({ type: 'addTag', name: name.value, color: pickedColor() });
}

// ---------- sidebar ----------

function navItem(id, label, count, extra = {}) {
  const active = st.nav === id && !st.tagId;
  const b = h('button', { type: 'button', class: `nav-item${active ? ' active' : ''}`, 'aria-current': active ? 'true' : null, onclick: () => ((st.nav = id), (st.tagId = null), clearSearch(), (st.selected = new Set()), render()), ...extra }, ...label, h('span', { class: 'cnt' }, String(count)));
  return b;
}

function dropOn(el, folderId) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-aco-chats')) return;
    e.preventDefault();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', async (e) => {
    el.classList.remove('over');
    const data = e.dataTransfer.getData('application/x-aco-chats');
    if (!data) return;
    e.preventDefault();
    const refs = JSON.parse(data);
    await op({ type: 'moveChat', chats: refs, folderId });
    toast(t('movedN', [String(refs.length)]));
  });
}

function svcFilter() {
  return st.services.size ? [...st.services] : undefined;
}

function renderSide() {
  const all = filterChats(st.org, { services: svcFilter() });
  const list = $('navList');
  list.replaceChildren(
    h('li', {}, navItem('all', [t('allChats')], all.length)),
    h('li', {}, navItem('recent', [t('recent')], all.filter((c) => c.seenAt).length)),
    h('li', {}, navItem('pinned', [t('pinned')], all.filter((c) => c.pinned).length)),
  );
  const unsorted = navItem('unsorted', [t('noFolder')], all.filter((c) => !c.folderId).length);
  dropOn(unsorted, null);
  list.append(h('li', {}, unsorted));

  const counts = folderCounts(st.org, svcFilter());
  const fl = $('folders');
  fl.replaceChildren();
  const tree = folderTree(st.org);
  if (!tree.length) fl.append(h('li', { class: 'muted small pad' }, t('noFoldersSide')));
  const item = (f, sub) => {
    const b = navItem(f.id, [h('span', { class: 'dot', style: `--c:${f.color}` }), h('span', { class: 'nm' }, f.name)], counts[f.id] || 0, { 'data-folder': f.id });
    dropOn(b, f.id);
    const edit = h('button', { type: 'button', class: 'btn small ghost edit', title: t('editFolder'), 'aria-label': `${t('editFolder')}: ${f.name}`, onclick: () => folderDialog(f) }, icon('edit', 13));
    return h('li', { class: sub ? 'sub' : '' }, b, edit);
  };
  for (const f of tree) {
    fl.append(item(f, false));
    for (const c of f.children) fl.append(item(c, true));
  }

  const tl = $('tags');
  tl.replaceChildren();
  if (!st.org.tags.length) tl.append(h('li', { class: 'muted small pad' }, t('noTagsSide')));
  for (const tg of st.org.tags) {
    const n = all.filter((c) => c.tags.includes(tg.id)).length;
    const active = st.tagId === tg.id;
    const b = h('button', { type: 'button', class: `nav-item${active ? ' active' : ''}`, 'aria-current': active ? 'true' : null, onclick: () => ((st.tagId = active ? null : tg.id), clearSearch(), render()) }, h('span', { class: 'chip', style: `--c:${tg.color}` }, `# ${tg.name}`), h('span', { class: 'cnt' }, String(n)));
    tl.append(h('li', {}, b, h('button', { type: 'button', class: 'btn small ghost edit', title: t('editTag'), 'aria-label': `${t('editTag')}: ${tg.name}`, onclick: () => tagDialog(tg) }, icon('edit', 13))));
  }

  const sf = $('svcFilter');
  sf.replaceChildren();
  for (const s of SERVICES) {
    const on = st.services.has(s.id);
    sf.append(h('button', { type: 'button', class: `svc${on ? ' on' : ''}`, 'aria-pressed': String(on), style: `--c:${s.color}`, onclick: () => (on ? st.services.delete(s.id) : st.services.add(s.id), render()) }, s.name));
  }
}

// ---------- chat list ----------

function clearSearch() {
  st.query = '';
  st.results = null;
  $('q').value = '';
}

async function runSearch() {
  const q = $('q').value.trim();
  st.query = q;
  st.selected = new Set();
  if (!q) {
    st.results = null;
    render();
    return;
  }
  const entries = await allSearchEntries();
  const hits = searchIndex(entries, q, { services: svcFilter(), limit: 200 });
  const pq = parseQuery(q);
  const out = [];
  for (const hit of hits) {
    const rec = await getChat(hit.key);
    if (rec) out.push({ key: hit.key, rec, snippet: snippet(bestMessageText(rec.messages, q), pq, 90) });
  }
  if (q === st.query) {
    st.results = out;
    render();
  }
}

/** Chats shown in the main list. */
function visibleChats() {
  if (st.results) {
    return st.results.map((r) => {
      const meta = st.org.chats[r.key];
      return meta || { key: r.key, service: r.rec.service, chatId: r.rec.chatId, title: r.rec.title, url: r.rec.url, folderId: null, pinned: false, tags: [], seenAt: 0, addedAt: r.rec.indexedAt };
    });
  }
  return filterChats(st.org, { folderId: st.nav, tagId: st.tagId || undefined, services: svcFilter() });
}

const refOf = (c) => ({ service: c.service, chatId: c.chatId, title: c.title, url: c.url });

function folderSelect(c) {
  const sel = h('select', { 'aria-label': `${t('folder')}: ${c.title || t('untitled')}`, class: 'move', onchange: async (e) => (await op({ type: 'moveChat', chat: refOf(c), folderId: e.target.value || null }), toast(t('moved'))) }, h('option', { value: '' }, t('noFolder')));
  for (const f of folderTree(st.org)) {
    sel.append(h('option', { value: f.id, selected: c.folderId === f.id }, f.name));
    for (const s of f.children) sel.append(h('option', { value: s.id, selected: c.folderId === s.id }, `   ${s.name}`));
  }
  return sel;
}

async function exportOne(c, format) {
  const rec = await getChat(c.key);
  if (!rec) return toast(t('notIndexed'));
  if (format === 'pdf') {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`src/print/print.html?key=${encodeURIComponent(c.key)}`) });
    return;
  }
  download(exportChat({ ...rec, title: c.title || rec.title }, format, labels()), fileName(c.title || rec.title, format, rec.chatId), mimeOf(format));
}

async function tagsDialog(c) {
  if (!st.org.tags.length) {
    await tagDialog(null);
    return;
  }
  const boxes = st.org.tags.map((tg) => ({ tg, el: h('input', { type: 'checkbox', checked: c.tags.includes(tg.id) }) }));
  const ok = await dialog({ title: t('tagsFor', [c.title || t('untitled')]), body: [h('div', { class: 'checks' }, boxes.map((b) => h('label', {}, b.el, h('span', { class: 'chip', style: `--c:${b.tg.color}` }, `# ${b.tg.name}`))))] });
  if (!ok) return;
  for (const b of boxes) if (b.el.checked !== c.tags.includes(b.tg.id)) await op({ type: 'tagChat', chat: refOf(c), tagId: b.tg.id, on: b.el.checked });
}

async function renameDialog(c) {
  const name = h('input', { type: 'text', maxlength: '300', value: c.title, required: true });
  if (await dialog({ title: t('renameChat'), body: [h('label', { class: 'field' }, h('span', {}, t('name')), name), h('p', { class: 'muted small' }, t('renameNote'))] })) await op({ type: 'renameChat', chat: refOf(c), title: name.value });
}

function chatRow(c, snip) {
  const indexed = st.indexed.has(c.key);
  const tags = c.tags.map((id) => st.org.tags.find((x) => x.id === id)).filter(Boolean);
  const check = h('input', { type: 'checkbox', 'aria-label': `${t('select')}: ${c.title || t('untitled')}`, checked: st.selected.has(c.key), onchange: (e) => (e.target.checked ? st.selected.add(c.key) : st.selected.delete(c.key), updateBulk()) });
  const pin = h('button', { type: 'button', class: `btn small ghost pin${c.pinned ? ' on' : ''}`, 'aria-pressed': String(c.pinned), title: c.pinned ? t('unpin') : t('pin'), 'aria-label': c.pinned ? t('unpin') : t('pin'), onclick: () => op({ type: 'pinChat', chat: refOf(c) }) }, icon('pin'));
  const exp = h(
    'select',
    {
      class: 'exp',
      'aria-label': `${t('export')}: ${c.title || t('untitled')}`,
      disabled: !indexed,
      title: indexed ? t('export') : t('notIndexed'),
      onchange: async (e) => {
        const f = e.target.value;
        e.target.value = '';
        if (f) await exportOne(c, f);
      },
    },
    h('option', { value: '' }, `${t('export')}…`),
    ...['md', 'html', 'txt', 'json', 'pdf'].map((f) => h('option', { value: f }, f.toUpperCase())),
  );
  const meta = h(
    'div',
    { class: 'meta' },
    c.folderId ? h('span', { class: 'chip', style: `--c:${st.org.folders.find((f) => f.id === c.folderId)?.color || '#888'}` }, folderPath(st.org, c.folderId)) : null,
    ...tags.map((tg) => h('span', { class: 'chip', style: `--c:${tg.color}` }, `# ${tg.name}`)),
    c.seenAt ? h('span', { class: 'muted' }, shortDate(c.seenAt, LOCALE)) : null,
    h('span', { class: `muted idx${indexed ? ' on' : ''}`, title: indexed ? t('indexedHint') : t('notIndexed') }, indexed ? t('inSearch') : t('linkOnly')),
  );
  const li = h(
    'li',
    { class: `row${st.selected.has(c.key) ? ' sel' : ''}`, draggable: 'true', 'data-key': c.key },
    check,
    pin,
    badge(c.service),
    h('div', { class: 'main' }, h('a', { class: 'title', href: c.url, target: '_blank', rel: 'noopener' }, c.title || t('untitled')), meta, snip ? h('p', { class: 'snip' }, snip.map((s) => (s.hit ? h('mark', {}, s.text) : s.text))) : null),
    folderSelect(c),
    exp,
    h('button', { type: 'button', class: 'btn small ghost', title: t('tags'), 'aria-label': `${t('tags')}: ${c.title}`, onclick: () => tagsDialog(c) }, icon('tag')),
    h('button', { type: 'button', class: 'btn small ghost', title: t('renameChat'), 'aria-label': `${t('renameChat')}: ${c.title}`, onclick: () => renameDialog(c) }, icon('edit')),
    h(
      'button',
      {
        type: 'button',
        class: 'btn small ghost danger',
        title: t('forgetChat'),
        'aria-label': `${t('forgetChat')}: ${c.title}`,
        onclick: async () => {
          if (await confirmDlg(t('forgetChat'), t('confirmForgetChat', [c.title || t('untitled')]), t('delete'))) {
            await send({ type: 'chat:forget', key: c.key });
            st.selected.delete(c.key);
            if (st.results) st.results = st.results.filter((r) => r.key !== c.key);
          }
        },
      },
      icon('trash'),
    ),
  );
  li.addEventListener('dragstart', (e) => {
    const keys = st.selected.has(c.key) ? [...st.selected] : [c.key];
    const refs = keys.map((k) => st.org.chats[k] || (k === c.key ? c : null)).filter(Boolean).map(refOf);
    e.dataTransfer.setData('application/x-aco-chats', JSON.stringify(refs));
    e.dataTransfer.effectAllowed = 'move';
  });
  return li;
}

function viewTitle() {
  if (st.results) return t('searchResults', [st.query]);
  if (st.tagId) return `# ${st.org.tags.find((x) => x.id === st.tagId)?.name || ''}`;
  if (st.nav === 'all') return t('allChats');
  if (st.nav === 'recent') return t('recent');
  if (st.nav === 'pinned') return t('pinned');
  if (st.nav === 'unsorted') return t('noFolder');
  return folderPath(st.org, st.nav);
}

function emptyText() {
  if (st.results) return t('nothingFound');
  if (!Object.keys(st.org.chats).length) return Object.values(st.granted).some(Boolean) ? t('emptyAllEnabled') : t('emptyAllNoSites');
  if (st.nav !== 'all' && st.nav !== 'recent' && st.nav !== 'pinned' && st.nav !== 'unsorted') return t('emptyFolder');
  return t('emptyView');
}

function renderList() {
  const chats = visibleChats();
  $('viewTitle').textContent = viewTitle();
  $('viewCount').textContent = String(chats.length);
  const snips = new Map((st.results || []).map((r) => [r.key, r.snippet]));
  const list = $('list');
  list.replaceChildren(...chats.map((c) => chatRow(c, snips.get(c.key))));
  $('empty').hidden = chats.length > 0;
  $('empty').replaceChildren(h('p', {}, emptyText()));
  if (!chats.length && !Object.values(st.granted).some(Boolean)) $('empty').append(enableButtons());
  for (const k of [...st.selected]) if (!chats.some((c) => c.key === k)) st.selected.delete(k);
  updateBulk(chats);
}

function enableButtons() {
  return h(
    'div',
    { class: 'row center' },
    SERVICES.map((s) => h('button', { type: 'button', class: 'btn', onclick: async () => (await requestService(s.id)) && (await refresh()) }, t('enableSite', [s.name]))),
  );
}

function updateBulk(chats = visibleChats()) {
  const n = st.selected.size;
  const sel = $('bulkMove');
  sel.replaceChildren(h('option', { value: '__' }, n ? t('moveSelected', [String(n)]) : t('moveSelectedNone')), h('option', { value: '' }, t('noFolder')));
  for (const f of folderTree(st.org)) {
    sel.append(h('option', { value: f.id }, f.name));
    for (const s of f.children) sel.append(h('option', { value: s.id }, `   ${s.name}`));
  }
  sel.disabled = !n;
  $('selectAll').checked = n > 0 && n === chats.length;
  $('selectAll').indeterminate = n > 0 && n < chats.length;
  const exportable = (n ? [...st.selected] : chats.map((c) => c.key)).filter((k) => st.indexed.has(k)).length;
  $('bulkExport').disabled = !exportable;
  $('bulkExport').textContent = t('exportZipN', [String(exportable)]);
  for (const li of $('list').children) li.classList.toggle('sel', st.selected.has(li.getAttribute('data-key')));
}

$('selectAll').addEventListener('change', (e) => {
  const chats = visibleChats();
  st.selected = e.target.checked ? new Set(chats.map((c) => c.key)) : new Set();
  for (const cb of $('list').querySelectorAll('li > input[type=checkbox]')) cb.checked = e.target.checked;
  updateBulk(chats);
});
$('bulkMove').addEventListener('change', async (e) => {
  const v = e.target.value;
  if (v === '__') return;
  const refs = [...st.selected].map((k) => st.org.chats[k] || null).filter(Boolean).map(refOf);
  const missing = [...st.selected].filter((k) => !st.org.chats[k]).map((k) => {
    const r = (st.results || []).find((x) => x.key === k)?.rec;
    return r ? { service: r.service, chatId: r.chatId, title: r.title, url: r.url } : null;
  });
  const all = [...refs, ...missing.filter(Boolean)];
  await op({ type: 'moveChat', chats: all, folderId: v || null });
  toast(t('movedN', [String(all.length)]));
});
$('bulkExport').addEventListener('click', async () => {
  const keys = (st.selected.size ? [...st.selected] : visibleChats().map((c) => c.key)).filter((k) => st.indexed.has(k));
  const format = $('bulkFormat').value;
  const chats = [];
  for (const k of keys) {
    const rec = await getChat(k);
    if (rec) chats.push({ ...rec, title: st.org.chats[k]?.title || rec.title });
  }
  if (!chats.length) return toast(t('notIndexed'));
  const date = new Date().toISOString().slice(0, 10);
  download(new Blob([exportZip(chats, format, labels())], { type: 'application/zip' }), `ai-chats-${date}.zip`, 'application/zip');
  toast(t('exportedN', [String(chats.length)]));
});

// ---------- prompts ----------

function renderPrompts() {
  const ul = $('promptList');
  ul.replaceChildren();
  if (!st.prompts.length) {
    ul.append(h('li', { class: 'empty' }, h('p', {}, t('noPromptsYet')), h('button', { type: 'button', class: 'btn small', onclick: () => savePrompts([...samplePrompts(LOCALE.startsWith('ru') ? 'ru' : 'en')]) }, t('addSamples'))));
  }
  for (const p of st.prompts) {
    const active = st.promptId === p.id;
    ul.append(h('li', {}, h('button', { type: 'button', class: `prow${active ? ' active' : ''}`, 'aria-current': active ? 'true' : null, onclick: () => ((st.promptId = p.id), renderPrompts()) }, h('strong', {}, p.title), h('span', { class: 'muted small' }, p.body.slice(0, 90)))));
  }
  const p = st.prompts.find((x) => x.id === st.promptId);
  const form = $('promptForm');
  if (form.dataset.for !== (st.promptId || 'new')) {
    form.dataset.for = st.promptId || 'new';
    $('pTitle').value = p ? p.title : '';
    $('pBody').value = p ? p.body : '';
  }
  $('pDelete').hidden = !p;
  showVars();
}
function showVars() {
  const vars = extractVars($('pBody').value);
  $('pVars').textContent = vars.length ? `${t('variables')}: ${vars.map((v) => `{{${v}}}`).join(', ')}` : '';
}
$('pBody').addEventListener('input', showVars);
async function savePrompts(list) {
  st.prompts = normalizePrompts(list);
  await chrome.storage.local.set({ prompts: st.prompts });
  renderPrompts();
}
$('promptForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!$('pBody').value.trim()) return toast(t('promptEmpty'));
  const id = st.promptId || undefined;
  const next = savePrompt(st.prompts, { id, title: $('pTitle').value, body: $('pBody').value });
  if (!id) st.promptId = next[0].id;
  $('promptForm').dataset.for = '';
  await savePrompts(next);
  toast(t('saved'));
});
$('pDelete').addEventListener('click', async () => {
  if (!st.promptId) return;
  if (!(await confirmDlg(t('delete'), t('confirmDeletePrompt'), t('delete')))) return;
  const next = deletePrompt(st.prompts, st.promptId);
  st.promptId = null;
  $('promptForm').dataset.for = '';
  await savePrompts(next);
});
$('newPrompt').addEventListener('click', () => {
  st.promptId = null;
  $('promptForm').dataset.for = '';
  renderPrompts();
  $('pTitle').focus();
});

// ---------- settings ----------

const FEATURE_LABEL = { messages: 'featureMessages', prompts: 'featurePrompts', sidebar: 'featureSidebar' };

async function saveSettings() {
  await chrome.storage.local.set({ settings: st.settings });
}

function healthLine(id) {
  const hl = st.health[id];
  if (!st.granted[id]) return h('p', { class: 'muted small' }, t('healthOff'));
  if (!hl) return h('p', { class: 'muted small' }, t('healthUnknown'));
  if (hl.status === 'degraded') return h('p', { class: 'warnbox small' }, t('siteChanged', [hl.broken.map((b) => t(FEATURE_LABEL[b] || b)).join(', ')]), ` (${shortDate(hl.at, LOCALE)})`);
  return h('p', { class: 'small ok-t' }, t('healthOk', [shortDate(hl.at, LOCALE)]), hl.sidebar ? '' : ` ${t('sidebarNotSeen')}`);
}

function renderSettings() {
  const box = $('siteSettings');
  box.replaceChildren();
  for (const s of SERVICES) {
    const on = !!st.granted[s.id];
    const ss = st.settings.services[s.id];
    const sw = (key, label) => {
      const input = h('input', {
        type: 'checkbox',
        role: 'switch',
        checked: ss[key],
        'data-service': s.id,
        'data-setting': key,
        onchange: async (e) => {
          ss[key] = e.target.checked;
          await saveSettings();
          toast(t('saved'));
        },
      });
      return h('label', { class: 'switch' }, input, h('span', {}, label));
    };
    box.append(
      h(
        'div',
        { class: 'site-card' },
        h(
          'div',
          { class: 'site-head' },
          h('span', { class: 'dot', style: `--c:${s.color}` }),
          h('strong', {}, s.name),
          h('span', { class: 'muted' }, s.host),
          h('span', { class: 'spacer' }),
          h('span', { class: on ? 'ok-t small' : 'muted small' }, on ? t('siteEnabled') : t('siteDisabled')),
          h('button', { type: 'button', class: `btn small${on ? '' : ' primary'}`, onclick: async () => (on ? await revokeService(s.id) : await requestService(s.id), await refresh()) }, on ? t('disableSite') : t('enableSite', [s.name])),
        ),
        sw('index', t('settingIndex')),
        sw('panel', t('settingPanel')),
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'muted small' }, t('inIndexN', [String(st.counts[s.id] || 0)])),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              disabled: !st.counts[s.id],
              onclick: async () => {
                if (!(await confirmDlg(t('clearIndex'), t('confirmClearIndex', [s.name]), t('delete')))) return;
                await send({ type: 'index:clear', service: s.id });
                toast(t('deleted'));
                await refresh();
              },
            },
            t('clearIndex'),
          ),
        ),
        healthLine(s.id),
      ),
    );
  }
  const total = Object.values(st.counts).reduce((a, b) => a + b, 0);
  $('dataStats').textContent = t('dataStats', [String(Object.keys(st.org.chats).length), String(total), String(st.org.folders.length), String(st.prompts.length)]);
}

$('exportBackup').addEventListener('click', () => {
  const b = makeBackup(st.org, st.prompts, st.settings);
  download(JSON.stringify(b, null, 2), `ai-chat-organizer-backup-${b.exportedAt.slice(0, 10)}.json`, 'application/json');
});
$('importBackup').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const r = parseBackup(await file.text());
  if (!r.ok) return toast(t('importFailed'));
  if (!(await confirmDlg(t('importJson'), t('confirmImport'), t('importJson')))) return;
  await send({ type: 'org:replace', org: r.org });
  await chrome.storage.local.set({ prompts: r.prompts, settings: r.settings });
  toast(t('imported'));
});
$('forgetHistory').addEventListener('click', async () => {
  if (!(await confirmDlg(t('forgetHistory'), t('confirmForgetHistory'), t('delete')))) return;
  await send({ type: 'index:clear', forget: true });
  toast(t('deleted'));
  await refresh();
});
$('clearAll').addEventListener('click', async () => {
  if (!(await confirmDlg(t('clearAll'), t('confirmClearAll'), t('delete')))) return;
  await send({ type: 'index:clear' });
  await send({ type: 'org:replace', org: null });
  await chrome.storage.local.set({ prompts: [] });
  await chrome.storage.local.remove('health');
  toast(t('deleted'));
  await refresh();
});

async function selectorsInfo() {
  try {
    const cfg = await (await fetch(chrome.runtime.getURL('config/selectors.json'))).json();
    $('selectorsInfo').textContent = t('selectorsVersion', [String(cfg.version), cfg.updated || '']);
  } catch {
    $('selectorsInfo').textContent = '';
  }
}

// ---------- banner, views ----------

function renderBanner() {
  const b = $('banner');
  const broken = SERVICES.filter((s) => st.granted[s.id] && st.health[s.id] && st.health[s.id].status === 'degraded');
  b.replaceChildren();
  if (broken.length) {
    b.className = 'banner warnbox';
    for (const s of broken) b.append(h('p', {}, h('strong', {}, `${s.name}: `), t('siteChanged', [st.health[s.id].broken.map((x) => t(FEATURE_LABEL[x] || x)).join(', ')])));
    b.hidden = false;
  } else b.hidden = true;
}

function setView(v) {
  st.view = v;
  for (const btn of document.querySelectorAll('.vbtn')) btn.setAttribute('aria-pressed', String(btn.getAttribute('data-view') === v));
  $('chatsView').hidden = v !== 'chats';
  $('promptsView').hidden = v !== 'prompts';
  $('settingsView').hidden = v !== 'settings';
  $('side').classList.toggle('dim', v !== 'chats');
  if (location.hash !== `#${v}`) history.replaceState(null, '', v === 'chats' ? location.pathname + location.search : `#${v}`);
  render();
}
for (const btn of document.querySelectorAll('.vbtn')) btn.addEventListener('click', () => setView(btn.getAttribute('data-view')));

function render() {
  const focusKey = document.activeElement && document.activeElement.closest('[data-key]') ? document.activeElement.closest('[data-key]').getAttribute('data-key') : null;
  const focusClass = document.activeElement ? document.activeElement.className : '';
  renderBanner();
  renderSide();
  if (st.view === 'chats') renderList();
  if (st.view === 'prompts') renderPrompts();
  if (st.view === 'settings') renderSettings();
  if (focusKey) {
    const row = document.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
    const el = row && (row.querySelector(`.${String(focusClass).split(' ')[0] || 'title'}`) || row.querySelector('a'));
    if (el) /** @type {HTMLElement} */ (el).focus();
  }
  document.body.dataset.ready = '1';
}

async function refresh() {
  await load();
  if (st.query) await runSearch();
  else render();
}

let searchTimer = 0;
$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
});
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (st.view !== 'chats') setView('chats');
  runSearch();
});
$('addFolder').addEventListener('click', () => folderDialog(null));
$('addTag').addEventListener('click', () => tagDialog(null));

let changeTimer = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(refresh, 120);
});
chrome.permissions.onAdded.addListener(() => refresh());
chrome.permissions.onRemoved.addListener(() => refresh());

(async () => {
  await load();
  selectorsInfo();
  const params = new URLSearchParams(location.search);
  const view = location.hash.replace('#', '');
  if (['prompts', 'settings'].includes(view)) setView(view);
  if (params.get('q')) {
    $('q').value = params.get('q');
    await runSearch();
  } else render();
})();

