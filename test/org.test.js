import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as O from '../extension/lib/org.js';

const A = { service: 'chatgpt', chatId: '6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b', title: 'Cron', url: 'https://chatgpt.com/c/6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b' };
const B = { service: 'claude', chatId: '0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40', title: 'Python' };
const C = { service: 'gemini', chatId: '1a2b3c4d5e6f7a8b', title: 'Проценты' };

function withFolders() {
  let s = O.emptyState();
  const work = O.addFolder(s, 'Работа');
  s = work.state;
  const client = O.addFolder(s, 'Клиент А', work.id, '#ef4444');
  s = client.state;
  const study = O.addFolder(s, 'Учёба');
  return { s: study.state, work: work.id, client: client.id, study: study.id };
}

test('folders: one level of nesting, names cleaned, limits', () => {
  const { s, work, client } = withFolders();
  assert.equal(s.folders.length, 3);
  assert.equal(s.folders.find((f) => f.id === client).parentId, work);
  assert.equal(O.addFolder(s, 'deep', client).error, 'depth');
  assert.equal(O.addFolder(s, '   ').error, 'empty');
  assert.equal(O.addFolder(s, 'x', 'missing').error, 'parent');
  const long = O.addFolder(s, 'a'.repeat(100));
  assert.equal(long.state.folders.at(-1).name.length, O.MAX_NAME);
  assert.deepEqual(O.folderTree(s).map((f) => [f.name, f.children.map((c) => c.name)]), [['Работа', ['Клиент А']], ['Учёба', []]]);
  assert.equal(O.folderPath(s, client), 'Работа / Клиент А');
});

test('updateFolder: rename, colour, re-parent rules', () => {
  const { s, work, client, study } = withFolders();
  let t = O.updateFolder(s, client, { name: 'Клиент Б', color: '#10B981' });
  const c = t.folders.find((f) => f.id === client);
  assert.equal(c.name, 'Клиент Б');
  assert.equal(c.color, '#10b981');
  t = O.updateFolder(t, work, { parentId: study });
  assert.equal(t.folders.find((f) => f.id === work).parentId, null, 'a folder with children cannot become a child');
  t = O.updateFolder(t, client, { parentId: null });
  assert.equal(t.folders.find((f) => f.id === client).parentId, null);
  assert.equal(O.updateFolder(s, 'nope', { name: 'x' }), s);
});

test('chats: move, pin, tag, rename; empty records are dropped', () => {
  const { s: s0, client, work } = withFolders();
  let s = O.moveChat(s0, A, client);
  assert.equal(s.chats[`chatgpt:${A.chatId}`].folderId, client);
  assert.equal(s.chats[`chatgpt:${A.chatId}`].title, 'Cron');
  s = O.pinChat(s, B);
  assert.equal(s.chats[`claude:${B.chatId}`].pinned, true);
  assert.equal(O.chatKey('claude', B.chatId) in O.pinChat(s, B).chats, false, 'unpinning an otherwise empty chat removes it');
  const tag = O.addTag(s, 'важное');
  s = O.tagChat(tag.state, C, tag.id);
  assert.deepEqual(s.chats[`gemini:${C.chatId}`].tags, [tag.id]);
  assert.equal(O.addTag(s, 'ВАЖНОЕ').id, tag.id, 'tags are unique case-insensitively');
  s = O.renameChat(s, A, '  Cron — расписание ');
  assert.equal(s.chats[`chatgpt:${A.chatId}`].title, 'Cron — расписание');
  assert.equal(O.moveChat(s, A, 'missing'), s);
  assert.deepEqual(O.filterChats(s, { folderId: work }).map((c) => c.chatId), [A.chatId], 'top folder includes subfolders');
  assert.deepEqual(O.filterChats(s, { folderId: work, includeSub: false }), []);
  assert.deepEqual(O.folderCounts(s), { [client]: 1, [work]: 1 });
});

test('deleting a folder unsorts its chats and removes subfolders', () => {
  const { s: s0, work, client } = withFolders();
  let s = O.moveChat(s0, A, client);
  s = O.pinChat(O.moveChat(s, B, work), B, true);
  s = O.deleteFolder(s, work);
  assert.equal(s.folders.length, 1);
  assert.equal(s.chats[`chatgpt:${A.chatId}`], undefined, 'A had nothing else: forgotten');
  assert.equal(s.chats[`claude:${B.chatId}`].folderId, null, 'B is pinned: kept, unsorted');
});

test('deleting a tag removes it from chats', () => {
  const t = O.addTag(O.emptyState(), 'x');
  let s = O.tagChat(t.state, A, t.id);
  s = O.pinChat(O.tagChat(s, B, t.id), B, true);
  s = O.deleteTag(s, t.id);
  assert.equal(s.tags.length, 0);
  assert.equal(s.chats[`chatgpt:${A.chatId}`], undefined);
  assert.deepEqual(s.chats[`claude:${B.chatId}`].tags, []);
});

test('upsertChat records history only when asked, keeps organisation', () => {
  let s = O.upsertChat(O.emptyState(), A, { seen: true, now: 1000 });
  assert.equal(s.chats[`chatgpt:${A.chatId}`].seenAt, 1000);
  const same = O.upsertChat(s, A, { seen: false });
  assert.equal(same, s, 'no change → same object');
  s = O.upsertChat(s, { ...A, title: 'New title' }, { now: 2000 });
  assert.equal(s.chats[`chatgpt:${A.chatId}`].title, 'New title');
  assert.equal(s.chats[`chatgpt:${A.chatId}`].seenAt, 1000);
  s = O.upsertChat(s, { ...A, title: '' });
  assert.equal(s.chats[`chatgpt:${A.chatId}`].title, 'New title', 'empty title never overwrites');
  assert.equal(O.upsertChat(s, { service: 'x', chatId: 'abcd' }), s);
  assert.equal(O.upsertChat(s, { service: 'claude', chatId: '../../x' }), s);
});

test('forgetHistory keeps organised chats only', () => {
  let s = O.upsertChat(O.emptyState(), A, { seen: true });
  s = O.upsertChat(s, B, { seen: true });
  s = O.pinChat(s, B, true);
  s = O.forgetHistory(s, 'claude');
  assert.equal(Object.keys(s.chats).length, 2, 'other service untouched');
  s = O.forgetHistory(s);
  assert.deepEqual(Object.keys(s.chats), [`claude:${B.chatId}`]);
  assert.equal(s.chats[`claude:${B.chatId}`].seenAt, 0);
});

test('sorting and views: pinned first, recent by time, service filter', () => {
  let s = O.upsertChat(O.emptyState(), A, { seen: true, now: 10 });
  s = O.upsertChat(s, B, { seen: true, now: 30 });
  s = O.upsertChat(s, C, { seen: true, now: 20 });
  s = O.pinChat(s, A, true);
  assert.deepEqual(O.filterChats(s).map((c) => c.service), ['chatgpt', 'claude', 'gemini']);
  assert.deepEqual(O.filterChats(s, { folderId: 'recent' }).map((c) => c.service), ['claude', 'gemini', 'chatgpt']);
  assert.deepEqual(O.filterChats(s, { folderId: 'pinned' }).map((c) => c.service), ['chatgpt']);
  assert.deepEqual(O.filterChats(s, { services: ['gemini'] }).map((c) => c.service), ['gemini']);
  assert.equal(O.filterChats(s, { folderId: 'unsorted' }).length, 3);
});

test('applyOp dispatches serialisable operations', () => {
  let { state, result } = O.applyOp(O.emptyState(), { type: 'addFolder', name: 'F' });
  assert.ok(result.id);
  state = O.applyOp(state, { type: 'moveChat', chats: [A, B], folderId: result.id }).state;
  assert.equal(O.filterChats(state, { folderId: result.id }).length, 2);
  state = O.applyOp(state, { type: 'pinChat', chat: C, pinned: true }).state;
  state = O.applyOp(state, { type: 'removeChat', chat: C }).state;
  assert.equal(Object.keys(state.chats).length, 2);
  state = O.applyOp(state, { type: 'reorderFolder', id: result.id, dir: 1 }).state;
  assert.equal(O.applyOp(state, { type: 'bogus' }).state, state);
  assert.equal(O.applyOp(state, null).state, state);
});

test('reorderFolder swaps siblings', () => {
  const { s, work, study } = withFolders();
  const t = O.reorderFolder(s, study, -1);
  assert.deepEqual(O.folderTree(t).map((f) => f.id), [study, work]);
  assert.deepEqual(O.folderTree(O.reorderFolder(t, study, -1)).map((f) => f.id), [study, work], 'already first');
});

test('normalizeState repairs untrusted input', () => {
  const raw = {
    folders: [
      { id: 'a', name: 'A', parentId: null, color: 'red' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' },
      { id: 'a', name: 'dup' },
      { id: 'bad id!', name: 'x' },
      { id: 'd', name: '   ' },
    ],
    tags: [{ id: 't', name: 'T', color: '#123456' }, { id: 't', name: 'dup' }],
    chats: {
      x: { service: 'claude', chatId: 'ABCD1234', title: 'x\u0000y', folderId: 'c', tags: ['t', 'zz', 't'], url: 'javascript:1', pinned: 1 },
      y: { service: 'evil', chatId: 'abcd1234' },
      z: { service: 'gemini', chatId: '<script>' },
    },
  };
  const s = O.normalizeState(raw);
  assert.deepEqual(s.folders.map((f) => [f.id, f.parentId]), [['a', null], ['b', 'a'], ['c', null]]);
  assert.equal(s.folders[0].color, O.COLORS[0]);
  assert.equal(s.tags.length, 1);
  assert.deepEqual(Object.keys(s.chats), ['claude:abcd1234']);
  const c = s.chats['claude:abcd1234'];
  assert.equal(c.title, 'x y');
  assert.equal(c.folderId, 'c');
  assert.deepEqual(c.tags, ['t']);
  assert.equal(c.url, 'https://claude.ai/chat/abcd1234');
  assert.equal(c.pinned, true);
  assert.deepEqual(O.normalizeState(null), O.emptyState());
});
