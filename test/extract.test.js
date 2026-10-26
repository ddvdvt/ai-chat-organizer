// Extraction on the local fixture pages that mimic each service's DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDom, bundledConfig } from './helpers/fixtures.js';
import { serviceConfig } from '../extension/lib/selectors.js';
import { extractMessages, extractTitle, probe, linkInfo, selectUnion, selectFirst, fingerprint, isStreaming } from '../extension/lib/extract.js';
import { el } from './helpers/dom.js';

const CFG = bundledConfig();
const GPT = '/c/6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b';
const CLAUDE = '/chat/0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40';
const GEMINI = '/app/1a2b3c4d5e6f7a8b';

function load(service, path) {
  const { doc, title } = fixtureDom(service, path);
  const cfg = serviceConfig(CFG, service);
  const messages = extractMessages(doc, cfg);
  return { doc, cfg, title, messages };
}

test('ChatGPT fixture: roles, code with language, table, nested list, KaTeX, link', () => {
  const { doc, cfg, title, messages } = load('chatgpt', GPT);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(messages[0].md, 'Как запускать скрипт backup.sh каждые 15 минут?  \nИ как проверить, что cron его действительно запускает?');
  const a = messages[1].md;
  assert.ok(a.includes('```bash\n# каждые 15 минут, вывод — в лог\n*/15 * * * * /home/user/backup.sh >> /var/log/backup.log 2>&1\n```'), a);
  assert.ok(!/Копировать код/.test(a), 'copy button removed');
  assert.ok(a.includes('| Поле | Значения | Пример |\n| --- | --- | --- |\n| Минуты | 0–59 | `*/15` |'));
  assert.ok(a.includes('| `1-5` \\| будни |'), 'pipe escaped');
  assert.ok(a.includes('2. Убедитесь, что скрипт исполняемый:\n   - `chmod +x backup.sh`\n   - первая строка — `#!/bin/bash`'));
  assert.ok(a.includes('Частота запусков в час: $60 / 15 = 4$.'));
  assert.ok(!a.includes('60/15=4'), 'aria-hidden KaTeX HTML dropped');
  assert.ok(a.includes('[man 5 crontab](https://man7.org/linux/man-pages/man5/crontab.5.html)'));
  assert.ok(messages[1].html.includes('<pre><code class="language-bash">'));
  assert.ok(messages[1].text.includes('Минуты\t0–59\t*/15'));
  assert.equal(extractTitle(doc, cfg, title, messages), 'Cron: скрипт каждые 15 минут');
  assert.deepEqual(probe(doc, cfg, true), { onChat: true, sidebar: true, messages: true, input: true });
});

test('Claude fixture: label next to code block becomes the fence language, not text', () => {
  const { doc, cfg, title, messages } = load('claude', CLAUDE);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(messages[0].text, 'Упрости функцию, она считает среднее только по положительным числам:\ndef avg(xs): ...');
  const a = messages[1].md;
  assert.ok(a.startsWith('Вот компактный вариант с генератором и защитой от пустого списка:\n\n```python\ndef avg_positive(xs: list[float]) -> float:\n    pos = [x for x in xs if x > 0]\n'), a);
  assert.ok(!/\n\npython\n\n/.test(a), 'label not duplicated');
  assert.ok(!a.includes('Копировать'));
  assert.ok(a.includes('- деление на ноль больше *невозможно*;'));
  assert.ok(a.endsWith('> Правило: функция должна делать одну вещь.'));
  assert.equal(extractTitle(doc, cfg, `${title} - Claude`, messages), 'Рефакторинг функции на Python');
});

test('Gemini fixture: custom elements, data-math, table-block, code-block label, icon text dropped', () => {
  const { doc, cfg, title, messages } = load('gemini', GEMINI);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(messages[0].md, 'Как посчитать сложные проценты по вкладу?\n\nСумма 100 000, ставка 12% годовых, 3 года.');
  const a = messages[1].md;
  assert.ok(a.startsWith('Используйте формулу $A = P(1 + r/n)^{nt}$, где:\n- **P** — начальная сумма;'), a);
  assert.ok(a.includes('| Капитализация | Итог через 3 года |\n| --- | --- |\n| Ежегодная | 140 493 ₸ |'));
  assert.ok(a.includes('```python\nP, r, n, t = 100_000, 0.12, 12, 3\nprint(round(P * (1 + r / n) ** (n * t)))\n```'));
  assert.ok(!a.includes('content_copy') && !/\n\nPython\n\n/.test(a));
  assert.ok(a.endsWith('$$\n\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}\n$$'));
  // Gemini's document title is just "Gemini": the selected sidebar item gives the title
  assert.equal(extractTitle(doc, cfg, 'Gemini', messages), title);
});

test('title falls back to the first user message', () => {
  const cfg = serviceConfig(CFG, 'gemini');
  const doc = el('<div></div>');
  const msgs = [{ role: 'user', md: '', html: '', text: 'Очень длинный вопрос '.repeat(10) }];
  const t = extractTitle(doc, cfg, 'Gemini', msgs);
  assert.ok(t.length <= 80 && t.endsWith('…') && t.startsWith('Очень длинный вопрос'));
  assert.equal(extractTitle(doc, cfg, 'Gemini', []), '');
});

test('second chat of each fixture (SPA templates) also parses', () => {
  assert.equal(load('chatgpt', '/c/7a2b3c4d-1e2f-4a5b-9c8d-2e3f4a5b6c7d').messages[1].md.split('```sql')[1].trim().split('\n')[0], 'SELECT u.name, o.total');
  assert.equal(load('claude', '/chat/1e2d3c4b-5a6f-4e7d-9c8b-0f9e8d7c6b51').messages[1].md.split('\n')[0], '1. Пустое состояние — первая встреча с продуктом.');
  assert.equal(load('gemini', '/app/2b3c4d5e6f7a8b9c').messages.length, 2);
});

test('new-chat page: no messages, probe still sees sidebar and input', () => {
  const { doc, cfg, messages } = load('chatgpt', '/');
  assert.equal(messages.length, 0);
  assert.deepEqual(probe(doc, cfg, false), { onChat: false, sidebar: true, messages: false, input: true });
});

test('changed markup: nothing matches, extraction degrades to empty, never throws', () => {
  const cfg = serviceConfig(CFG, 'claude');
  const doc = el('<div><div class="renamed-message">hi</div><nav><a href="/somewhere">x</a></nav></div>');
  assert.deepEqual(extractMessages(doc, cfg), []);
  assert.deepEqual(probe(doc, cfg, true), { onChat: true, sidebar: false, messages: false, input: false });
});

test('sidebar links resolve to chat references', () => {
  const { doc, cfg } = load('gemini', GEMINI);
  const links = selectUnion(doc, cfg.sidebarLink);
  const infos = links.map((a) => linkInfo(a, 'gemini', cfg, 'https://gemini.google.com/app'));
  assert.equal(infos.length, 4);
  assert.deepEqual(infos[1], { chatId: '2b3c4d5e6f7a8b9c', url: 'https://gemini.google.com/app/2b3c4d5e6f7a8b9c', title: 'Рецепт плова на 6 человек' });
  assert.equal(linkInfo(el('<a href="/settings">S</a>'), 'gemini', cfg, 'https://gemini.google.com/'), null);
  assert.equal(linkInfo(el('<a>no href</a>'), 'gemini', cfg, 'https://gemini.google.com/'), null);
});

test('selector helpers tolerate invalid selectors', () => {
  const doc = el('<div><p class="a">1</p><p class="b">2</p></div>');
  assert.equal(selectUnion(doc, ['p.a', 'p.b']).length, 2);
  assert.equal(selectFirst(doc, ['p.zzz', 'p.b']).textContent, '2');
  assert.equal(selectFirst(doc, []), null);
});

test('streaming detection and fingerprint', () => {
  const cfg = serviceConfig(CFG, 'chatgpt');
  assert.ok(isStreaming(el('<div><button data-testid="stop-button"></button></div>'), cfg));
  assert.ok(!isStreaming(el('<div></div>'), cfg));
  const a = [{ role: 'user', md: 'a' }];
  assert.equal(fingerprint(a), fingerprint([{ role: 'user', md: 'a' }]));
  assert.notEqual(fingerprint(a), fingerprint([{ role: 'user', md: 'b' }]));
});
