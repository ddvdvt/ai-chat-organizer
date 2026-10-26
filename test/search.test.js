import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseQuery, scoreDoc, snippet, search, searchText, bestMessageText } from '../extension/lib/search.js';

test('normalize: case, ё, quotes, whitespace', () => {
  assert.equal(normalize('  Ёлка  «Новый»\nГОД — ok '), ' елка "новый" год - ok ');
});

test('parseQuery: terms, phrases, exclusions, dedupe', () => {
  assert.deepEqual(parseQuery('cron  "каждые 15 минут" -windows Cron c++'), { terms: ['cron', 'c++'], phrases: ['каждые 15 минут'], exclude: ['windows'] });
  assert.deepEqual(parseQuery('   '), { terms: [], phrases: [], exclude: [] });
  assert.deepEqual(parseQuery('(sql)?').terms, ['sql']);
});

test('scoreDoc: all terms required, title weighs more, exclusions', () => {
  const doc = { title: normalize('Cron в Linux'), body: normalize('запуск каждые 15 минут через cron') };
  assert.ok(scoreDoc(doc, parseQuery('cron минут')) > 0);
  assert.equal(scoreDoc(doc, parseQuery('cron windows')), 0);
  assert.equal(scoreDoc(doc, parseQuery('cron -linux')), 0);
  assert.ok(scoreDoc(doc, parseQuery('linux')) > scoreDoc(doc, parseQuery('минут')));
  assert.ok(scoreDoc(doc, parseQuery('"каждые 15"')) > 0);
  assert.equal(scoreDoc(doc, parseQuery('"15 каждые"')), 0);
  assert.equal(scoreDoc(doc, parseQuery('')), 0);
});

test('search ranks and filters by service', () => {
  const recs = [
    { key: 'chatgpt:1', service: 'chatgpt', title: 'Cron', search: normalize('cron cron расписание'), indexedAt: 1 },
    { key: 'claude:2', service: 'claude', title: 'Python', search: normalize('немного про cron'), indexedAt: 2 },
    { key: 'gemini:3', service: 'gemini', title: 'Плов', search: normalize('рис морковь'), indexedAt: 3 },
  ];
  assert.deepEqual(search(recs, 'cron').map((r) => r.key), ['chatgpt:1', 'claude:2']);
  assert.deepEqual(search(recs, 'cron', { services: ['claude'] }).map((r) => r.key), ['claude:2']);
  assert.deepEqual(search(recs, 'морковь рис').map((r) => r.key), ['gemini:3']);
  assert.deepEqual(search(recs, ''), []);
  assert.equal(search(recs, 'cron', { limit: 1 }).length, 1);
});

test('snippet highlights hits as segments, with ellipses', () => {
  const text = `${'Начало длинного текста '.repeat(10)}тут CRON запускает задачу, cron снова ${'хвост '.repeat(30)}`;
  const segs = snippet(text, parseQuery('cron'), 40);
  assert.equal(segs[0].text, '…');
  assert.equal(segs.at(-1).text, '…');
  assert.deepEqual(segs.filter((s) => s.hit).map((s) => s.text), ['CRON', 'cron']);
  const plain = snippet('короткий текст', parseQuery('нет'), 40);
  assert.deepEqual(plain, [{ text: 'короткий текст', hit: false }]);
});

test('searchText and bestMessageText', () => {
  const msgs = [{ text: 'Привет' }, { text: 'Ответ про Ёжика' }];
  assert.equal(searchText(msgs), 'привет ответ про ежика');
  assert.equal(bestMessageText(msgs, 'ежик'), 'Ответ про Ёжика');
  assert.equal(bestMessageText(msgs, 'zzz'), 'Привет');
  assert.equal(bestMessageText([], 'x'), '');
});
