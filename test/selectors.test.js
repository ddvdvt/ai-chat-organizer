import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig, serviceConfig, isSafeSelector, isSafePathRegex, healthFromProbe, cleanTitle, normalizeLang, SELECTOR_KEYS } from '../extension/lib/selectors.js';
import { bundledConfig } from './helpers/fixtures.js';

test('bundled selectors.json is valid and covers all services and keys', () => {
  const cfg = bundledConfig();
  assert.deepEqual(validateConfig(cfg), { ok: true, errors: [] });
  for (const id of ['chatgpt', 'claude', 'gemini']) {
    const s = serviceConfig(cfg, id);
    for (const k of [...SELECTOR_KEYS, 'chatPath', 'titleSuffix']) assert.ok(s[k].length > 0, `${id}.${k} empty`);
    for (const k of Object.keys(cfg.services[id])) assert.equal(s[k].length, cfg.services[id][k].length, `${id}.${k} entry dropped`);
  }
});

test('schema file lists the same keys as the validator', () => {
  const schema = JSON.parse(readFileSync(new URL('../extension/config/selectors.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(schema.$defs.service.properties).sort(), [...SELECTOR_KEYS, 'chatPath', 'titleSuffix'].sort());
});

test('validator rejects unknown keys, unsafe selectors and bad regexes', () => {
  const bad = { version: 1, services: { chatgpt: { message: ['div{color:red}'], foo: [] }, bard: {} }, extra: 1 };
  const r = validateConfig(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('extra')));
  assert.ok(r.errors.some((e) => e.includes('bard')));
  assert.ok(r.errors.some((e) => e.includes('foo')));
  assert.ok(r.errors.some((e) => e.includes('message[0]')));
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig({ version: 0, services: {} }).ok, false);
  assert.equal(validateConfig({ version: 1, services: { claude: { chatPath: ['(a+)+$'] } } }).ok, false);
});

test('serviceConfig drops invalid entries and falls back to default chat paths', () => {
  const s = serviceConfig({ version: 1, services: { claude: { message: ['ok', '<x>', 5], chatPath: ['('] } } }, 'claude');
  assert.deepEqual(s.message, ['ok']);
  assert.ok(s.chatPath.length >= 1);
  assert.deepEqual(serviceConfig(null, 'gemini').input, []);
});

test('isSafeSelector / isSafePathRegex', () => {
  assert.ok(isSafeSelector("nav a[href*='/c/']"));
  for (const s of ['', 'a;b', 'a{}', '@import', 'a\nb', 'x'.repeat(301), "a[style*='url(']", 'a/*x*/']) assert.ok(!isSafeSelector(s), s);
  assert.ok(isSafePathRegex('/c/([0-9a-f-]{16,})'));
  assert.ok(!isSafePathRegex('/c/[0-9]+'), 'no capture group');
  assert.ok(!isSafePathRegex('(a)(b)'), 'two groups');
  assert.ok(!isSafePathRegex('()'), 'matches empty');
  assert.ok(!isSafePathRegex('(x+)+y'));
});

test('health: only settled probes count; sidebar never breaks a service', () => {
  assert.deepEqual(healthFromProbe({ onChat: true, sidebar: false, messages: false, input: false }), { status: 'unknown', broken: [] });
  assert.deepEqual(healthFromProbe({ settled: true, onChat: true, sidebar: false, messages: true, input: true }), { status: 'ok', broken: [] });
  assert.deepEqual(healthFromProbe({ settled: true, onChat: true, sidebar: true, messages: false, input: true }), { status: 'degraded', broken: ['messages'] });
  assert.deepEqual(healthFromProbe({ settled: true, onChat: false, sidebar: true, messages: false, input: false }), { status: 'degraded', broken: ['prompts'] });
  assert.deepEqual(healthFromProbe({ settled: true, onChat: false, sidebar: true, messages: false, input: true }), { status: 'ok', broken: [] });
});

test('cleanTitle strips service suffixes', () => {
  assert.equal(cleanTitle('Рефакторинг - Claude', [' - Claude', 'Claude']), 'Рефакторинг');
  assert.equal(cleanTitle('Claude', [' - Claude', 'Claude']), '');
  assert.equal(cleanTitle('  ChatGPT ', ['ChatGPT']), '');
  assert.equal(cleanTitle('Cron  tips', ['ChatGPT']), 'Cron tips');
});

test('normalizeLang', () => {
  assert.equal(normalizeLang('Python'), 'python');
  assert.equal(normalizeLang('  c++ Copy code'), 'c++');
  assert.equal(normalizeLang('Copy'), '');
  assert.equal(normalizeLang(''), '');
});
