import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdownDoc, toTextDoc, toJsonDoc, toHtmlDoc, exportChat, fileName, uniqueNames, exportZip, mimeOf, FORMATS } from '../extension/lib/exportfmt.js';
import { readZip } from '../extension/lib/zip.js';
import { fixtureDom, bundledConfig } from './helpers/fixtures.js';
import { serviceConfig } from '../extension/lib/selectors.js';
import { extractMessages } from '../extension/lib/extract.js';

const NOW = new Date('2026-10-26T10:00:00Z');
const L = { user: 'Вы', untitled: 'Без названия', exported: 'Экспортировано', source: 'Источник', locale: 'ru' };

function chat() {
  const { doc } = fixtureDom('chatgpt', '/c/6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b');
  return {
    service: 'chatgpt',
    chatId: '6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b',
    title: 'Cron: скрипт каждые 15 минут',
    url: 'https://chatgpt.com/c/6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b',
    messages: extractMessages(doc, serviceConfig(bundledConfig(), 'chatgpt')),
  };
}

test('Markdown document: title, source line, role headings, faithful body', () => {
  const md = toMarkdownDoc(chat(), L, NOW);
  assert.ok(md.startsWith('# Cron: скрипт каждые 15 минут\n\n> ChatGPT · Источник: <https://chatgpt.com/c/6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b> · Экспортировано: 26 октября 2026'), md.slice(0, 200));
  assert.ok(md.includes('\n\n## Вы\n\nКак запускать скрипт'));
  assert.ok(md.includes('\n\n## ChatGPT\n\nОткройте таблицу'));
  assert.ok(md.includes('```bash\n# каждые 15 минут'));
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('text document', () => {
  const t = toTextDoc(chat(), L, NOW);
  assert.ok(t.startsWith('Cron: скрипт каждые 15 минут\n============================\nChatGPT · https://chatgpt.com/c/'));
  assert.ok(t.includes('\n\nВы:\n---\nКак запускать'));
  assert.ok(!t.includes('**') && !t.includes('```'));
});

test('JSON document', () => {
  const j = JSON.parse(toJsonDoc(chat(), NOW));
  assert.equal(j.format, 'ai-chat-organizer/1');
  assert.equal(j.exportedAt, '2026-10-26T10:00:00.000Z');
  assert.equal(j.messages.length, 2);
  assert.deepEqual(Object.keys(j.messages[0]), ['role', 'markdown', 'text']);
});

test('HTML document is standalone, escaped and locked down by CSP', () => {
  const c = chat();
  c.title = 'Cron <script>alert(1)</script>';
  const h = toHtmlDoc(c, L, NOW);
  assert.ok(h.startsWith('<!doctype html>'));
  assert.ok(h.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`));
  assert.ok(h.includes('<title>Cron &lt;script&gt;alert(1)&lt;/script&gt;</title>'));
  assert.ok(!/<script/i.test(h.replace(/&lt;script/g, '')));
  assert.ok(h.includes('<section class="msg user"><p class="who">Вы</p>'));
  assert.ok(h.includes('<pre><code class="language-bash">'));
  assert.ok(h.includes('@media print'));
  assert.ok(!/https?:\/\/(?!chatgpt\.com|man7\.org)/.test(h.replace(/http:\/\/www\.w3\.org[^"]*/g, '')), 'no external resources');
});

test('exportChat dispatches all formats; unknown throws', () => {
  for (const f of FORMATS) assert.ok(exportChat(chat(), f, L, NOW).length > 100, f);
  assert.throws(() => exportChat(chat(), 'pdf'));
  assert.equal(mimeOf('md'), 'text/markdown;charset=utf-8');
});

test('file names are safe on every OS', () => {
  assert.equal(fileName('Cron: скрипт / каждые 15? минут', 'md'), 'Cron скрипт каждые 15 минут.md');
  assert.equal(fileName('...', 'txt'), 'chat.txt');
  assert.equal(fileName('CON', 'md', 'x'), 'x.md');
  assert.equal(fileName('a'.repeat(200), 'md'), `${'a'.repeat(80)}.md`);
  assert.equal(fileName(' trailing. ', 'json'), 'trailing.json');
  assert.deepEqual(uniqueNames(['a.md', 'A.md', 'a.md', 'b']), ['a.md', 'A (2).md', 'a (3).md', 'b']);
});

test('bulk zip: one file per chat, grouped by service, unique names', () => {
  const a = chat();
  const b = { ...chat(), chatId: 'other' };
  const g = { ...chat(), service: 'gemini', chatId: '1a2b3c4d', title: '' };
  const entries = readZip(exportZip([a, b, g], 'md', L, NOW));
  assert.deepEqual(entries.map((e) => e.name), ['chatgpt/Cron скрипт каждые 15 минут.md', 'chatgpt/Cron скрипт каждые 15 минут (2).md', 'gemini/1a2b3c4d.md']);
  assert.match(new TextDecoder().decode(entries[2].data), /^# Без названия/);
});
