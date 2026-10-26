import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVars, fillPrompt, normalizePrompts, savePrompt, deletePrompt, samplePrompts, MAX_PROMPTS } from '../extension/lib/prompts.js';
import { defaultSettings, normalizeSettings } from '../extension/lib/settings.js';
import { makeBackup, parseBackup, BACKUP_FORMAT } from '../extension/lib/backup.js';
import { emptyState, addFolder } from '../extension/lib/org.js';

test('prompt variables: order, unicode names, spaces, duplicates', () => {
  assert.deepEqual(extractVars('Hi {{name}}, {{ тема }} and {{name}} {{bad}x}} {{}}'), ['name', 'тема']);
  assert.deepEqual(extractVars('{{язык программирования}}'), ['язык программирования']);
  assert.deepEqual(extractVars(''), []);
});

test('fillPrompt replaces known values only', () => {
  assert.equal(fillPrompt('Explain {{ topic }} to {{who}}', { topic: 'cron' }), 'Explain cron to {{who}}');
  assert.equal(fillPrompt('{{a}}{{a}}', { a: '$&' }), '$&$&', 'no regex replacement patterns');
  assert.equal(fillPrompt('{{a}}', { a: '' }), '{{a}}');
});

test('prompt list: normalise, save, update, delete, limit', () => {
  const list = normalizePrompts([{ title: '', body: 'Do {{x}}' }, { body: '' }, null, { id: 'p1', title: 'T', body: 'b' }, { id: 'p1', title: 'dup', body: 'c' }]);
  assert.equal(list.length, 3);
  assert.equal(list[0].title, 'Do {{x}}');
  assert.notEqual(list[1].id, list[2].id);
  let l = savePrompt(list, { title: 'New', body: 'n' }, 5);
  assert.equal(l[0].title, 'New');
  l = savePrompt(l, { id: 'p1', title: 'Renamed', body: 'b2' }, 6);
  assert.equal(l.find((p) => p.id === 'p1').title, 'Renamed');
  assert.equal(l.length, 4);
  assert.equal(deletePrompt(l, 'p1').length, 3);
  assert.equal(savePrompt(l, { body: '   ' }), l);
  const full = normalizePrompts(Array.from({ length: MAX_PROMPTS + 5 }, (_, i) => ({ body: `p${i}` })));
  assert.equal(full.length, MAX_PROMPTS);
  assert.equal(samplePrompts('ru').length, 2);
  assert.ok(extractVars(samplePrompts('en')[1].body).includes('code'));
});

test('settings: defaults on, normalise untrusted values', () => {
  const d = defaultSettings();
  assert.deepEqual(d.services.claude, { index: true, panel: true });
  const s = normalizeSettings({ services: { gemini: { index: false, panel: 'no' }, evil: { index: true } }, exportFormat: 'exe' });
  assert.equal(s.services.gemini.index, false);
  assert.equal(s.services.gemini.panel, true);
  assert.equal(s.exportFormat, 'md');
  assert.equal(normalizeSettings({ exportFormat: 'html' }).exportFormat, 'html');
  assert.equal('evil' in s.services, false);
});

test('backup round trip and rejection of foreign files', () => {
  const org = addFolder(emptyState(), 'Работа').state;
  const b = makeBackup(org, [{ title: 'P', body: 'x' }], { exportFormat: 'txt' }, new Date('2026-01-01T00:00:00Z'));
  assert.equal(b.format, BACKUP_FORMAT);
  const r = parseBackup(JSON.stringify(b));
  assert.ok(r.ok);
  assert.equal(r.org.folders[0].name, 'Работа');
  assert.equal(r.prompts[0].body, 'x');
  assert.equal(r.settings.exportFormat, 'txt');
  assert.deepEqual(parseBackup('{'), { ok: false, error: 'json' });
  assert.deepEqual(parseBackup('{"format":"other"}'), { ok: false, error: 'format' });
  assert.deepEqual(parseBackup(5), { ok: false, error: 'size' });
});
