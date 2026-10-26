// E2E smoke test: the unpacked extension in the locally installed Chromium, on LOCAL fixture
// pages that mimic chatgpt.com, claude.ai and gemini.google.com (see e2e/harness.mjs). No real
// third-party site is contacted.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startFixtureServer, prepareExtension, chromeArgs, EXE } from './harness.mjs';
import { readZip } from '../extension/lib/zip.js';

const GPT = '/c/6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b';
const GPT2 = '/c/7a2b3c4d-1e2f-4a5b-9c8d-2e3f4a5b6c7d';
const CLAUDE = '/chat/0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40';
const GEMINI = '/app/1a2b3c4d5e6f7a8b';
const BROKEN = '/chat/9f9f9f9f-0000-4000-8000-000000000001';

if (!existsSync(EXE)) {
  console.error(`Chromium not found at ${EXE}. Set CHROMIUM_PATH.`);
  process.exit(1);
}

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

/** Poll until fn() returns a truthy value. */
async function until(fn, what, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout: ${what} (${last && last.message ? last.message : JSON.stringify(last)})`);
}

const { server, port, url } = await startFixtureServer();
const ext = await prepareExtension(port);
const context = await chromium.launchPersistentContext(ext.profile, {
  executablePath: EXE,
  headless: false,
  acceptDownloads: true,
  viewport: { width: 1280, height: 800 },
  locale: 'ru-RU',
  args: [...chromeArgs(ext.extDir), '--lang=ru'],
});

/** errors on our own pages (popup, organizer, print) */
const pageErrors = [];
function watch(page, label) {
  page.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(`${label}: ${m.text()}`));
  return page;
}

let exitCode = 0;
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;

  // helper page inside the extension for storage / IndexedDB checks
  const helper = watch(await context.newPage(), 'helper');
  await helper.goto(extUrl('src/organizer/organizer.html'));
  const storage = (key) => helper.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
  const indexed = (key) => helper.evaluate(async (k) => (await import('/src/shared/db.js')).getChat(k), key);

  await step('fresh install opens the welcome page of the brand site', async () => {
    const welcome = `http://127.0.0.1:${port}/brand/welcome/ai-chat-organizer.html`;
    const found = await until(() => context.pages().find((p) => p.url() === welcome), 'welcome tab');
    await found.close();
  });

  await step('content script registered only for the granted sites', async () => {
    const ids = await until(async () => {
      const r = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort());
      return r.length === 3 && r;
    }, 'registered scripts');
    assert.deepEqual(ids, ['aco-chatgpt', 'aco-claude', 'aco-gemini']);
  });

  const page = await context.newPage();
  await page.goto(url('chatgpt', GPT));
  const shadow = page.locator('ai-chat-organizer-root');

  await step('ChatGPT page: panel button injected in a shadow root, page markup untouched', async () => {
    await shadow.locator('.launcher').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-message-author-role]').count(), 2);
    assert.equal(await page.evaluate(() => document.body.querySelectorAll('ai-chat-organizer-root').length), 0, 'host lives outside <body>');
  });

  await step('opened chat is indexed locally: Markdown with code, table and maths', async () => {
    const rec = await until(() => indexed('chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b'), 'indexed chat');
    assert.equal(rec.title, 'Cron: скрипт каждые 15 минут');
    assert.equal(rec.messages.length, 2);
    assert.match(rec.messages[1].md, /```bash\n# каждые 15 минут/);
    assert.match(rec.messages[1].md, /\| Минуты \| 0–59 \| `\*\/15` \|/);
    assert.match(rec.messages[1].md, /\$60 \/ 15 = 4\$/);
    const org = await storage('org');
    assert.ok(org.chats['chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b'].seenAt > 0);
  });

  await step('panel: create folder, file the current chat, pin it', async () => {
    await shadow.locator('.launcher').click();
    await shadow.locator('.drawer').waitFor();
    await shadow.locator('.newf input').fill('Работа');
    await shadow.locator('.newf button').click();
    const folderId = await until(async () => (await storage('org'))?.folders?.find((f) => f.name === 'Работа')?.id, 'folder created');
    await until(async () => (await shadow.locator('.cur select option').count()) >= 2, 'folder in select');
    await shadow.locator('.cur select').selectOption(folderId);
    await until(async () => (await storage('org')).chats['chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b'].folderId === folderId, 'chat moved');
    await shadow.locator('.cur .pin').click();
    await until(async () => (await storage('org')).chats['chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b'].pinned, 'pinned');
  });

  await step('panel: export current chat as Markdown (download from the page)', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), shadow.locator('.exp button[data-format="md"]').click()]);
    assert.equal(dl.suggestedFilename(), 'Cron скрипт каждые 15 минут.md');
    const text = await readFile(await dl.path(), 'utf8');
    assert.match(text, /^# Cron: скрипт каждые 15 минут\n/);
    assert.match(text, /## Вы\n\nКак запускать скрипт/);
    assert.match(text, /```bash\n# каждые 15 минут, вывод — в лог\n\*\/15 \* \* \* \* \/home\/user\/backup\.sh >> \/var\/log\/backup\.log 2>&1\n```/);
  });

  await step('panel: export HTML is standalone and sanitised', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), shadow.locator('.exp button[data-format="html"]').click()]);
    const html = await readFile(await dl.path(), 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<pre><code class="language-bash">/);
    assert.ok(!/<script|<button|onclick/i.test(html));
  });

  await step('drag a chat from the site sidebar onto a folder in the panel', async () => {
    const link = page.locator('#history a[href$="9c4d5e6f-3a4b-4c7d-9e0f-4a5b6c7d8e9f"]');
    const target = shadow.locator('.frow', { hasText: 'Работа' });
    await link.dragTo(target);
    const c = await until(async () => (await storage('org')).chats['chatgpt:9c4d5e6f-3a4b-4c7d-9e0f-4a5b6c7d8e9f'], 'dragged chat filed');
    assert.equal(c.title, 'Письмо арендодателю о ремонте');
    assert.ok(c.folderId);
  });

  await step('hover button on a sidebar link opens the "move to folder" menu', async () => {
    await shadow.locator('button.close').click();
    await page.locator('#history a[href$="8b3c4d5e-2f3a-4b6c-8d9e-3f4a5b6c7d8e"]').hover();
    await shadow.locator('button.hover').waitFor({ state: 'visible' });
    await shadow.locator('button.hover').click();
    await shadow.locator('.menu').waitFor({ state: 'visible' });
    await shadow.locator('.menu button', { hasText: 'Работа' }).click();
    const c = await until(async () => (await storage('org')).chats['chatgpt:8b3c4d5e-2f3a-4b6c-8d9e-3f4a5b6c7d8e'], 'menu move');
    assert.equal(c.title, 'План поездки на выходные');
  });

  await step('single-page navigation: the next opened chat is indexed too', async () => {
    await page.locator(`#history a[href="${GPT2}"]`).click();
    await page.waitForURL(`**${GPT2}`);
    const rec = await until(() => indexed('chatgpt:7a2b3c4d-1e2f-4a5b-9c8d-2e3f4a5b6c7d'), 'second chat indexed');
    assert.match(rec.messages[1].md, /```sql\nSELECT u\.name/);
  });

  await step('panel search finds opened chats of this site with a highlighted snippet', async () => {
    await shadow.locator('.launcher').click();
    await shadow.locator('[data-tab="search"]').click();
    await shadow.locator('input.q').fill('crontab');
    await until(async () => (await shadow.locator('.res li').count()) === 1, 'search result');
    assert.match(await shadow.locator('.res li .ct').textContent(), /Cron/);
    assert.equal(await shadow.locator('.res li mark').first().textContent(), 'crontab');
  });

  await step('prompt library: fill a {{variable}} and insert into the input box', async () => {
    await helper.evaluate(() => chrome.storage.local.set({ prompts: [{ id: 'p1', title: 'Объясни', body: 'Объясни {{тема}} простыми словами', updatedAt: 1 }] }));
    await shadow.locator('[data-tab="prompts"]').click();
    await shadow.locator('.prow', { hasText: 'Объясни' }).click();
    await shadow.locator('.fill textarea').fill('cron');
    await shadow.locator('.fill button[type=submit]').click();
    await until(async () => (await page.locator('#prompt-textarea').textContent()).includes('Объясни cron простыми словами'), 'prompt inserted');
  });

  await step('Claude and Gemini fixture chats are indexed with their titles', async () => {
    const p2 = await context.newPage();
    await p2.goto(url('claude', CLAUDE));
    const c = await until(() => indexed('claude:0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40'), 'claude indexed');
    assert.equal(c.title, 'Рефакторинг функции на Python');
    assert.match(c.messages[1].md, /```python\ndef avg_positive/);
    await p2.goto(url('gemini', GEMINI));
    const g = await until(() => indexed('gemini:1a2b3c4d5e6f7a8b'), 'gemini indexed');
    assert.equal(g.title, 'Формула сложных процентов');
    assert.match(g.messages[1].md, /\| Ежегодная \| 140 493 ₸ \|/);
    assert.ok(!g.messages[1].md.includes('content_copy'));
    await p2.close();
  });

  await step('changed markup: health turns "degraded", popup shows "site changed"', async () => {
    const p3 = await context.newPage();
    await p3.goto(url('claude', BROKEN));
    const h = await until(async () => (await storage('health'))?.claude?.status === 'degraded' && (await storage('health')).claude, 'degraded health', 25000);
    assert.deepEqual(h.broken, ['messages']);
    const tabId = await helper.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url('claude', BROKEN));
    const popup = watch(await context.newPage(), 'popup');
    await popup.goto(extUrl(`src/popup/popup.html?tabId=${tabId}`));
    await popup.waitForSelector('body[data-ready="1"]');
    assert.match(await popup.textContent('#here'), /Сайт изменил разметку/);
    assert.equal(await popup.locator('#sites input[type=checkbox]:checked').count(), 3);
    await popup.close();
    await p3.close();
  });

  await step('popup on a healthy chat: export buttons and status', async () => {
    const tabId = await helper.evaluate(async () => (await chrome.tabs.query({}))
      .find((t) => t.url && t.url.includes('chatgpt.localhost'))?.id);
    const popup = watch(await context.newPage(), 'popup');
    await popup.goto(extUrl(`src/popup/popup.html?tabId=${tabId}`));
    await popup.waitForSelector('body[data-ready="1"]');
    await popup.waitForSelector('#here .exp button');
    assert.match(await popup.textContent('#here'), /работает/);
    assert.match(await popup.textContent('#stats'), /В поиске чатов: 4/);
    await popup.close();
  });

  await step('organizer: all services, folders, full-text search, bulk zip export', async () => {
    const org = watch(await context.newPage(), 'organizer');
    await org.goto(extUrl('src/organizer/organizer.html'));
    await org.waitForSelector('body[data-ready="1"]');
    await until(async () => (await org.locator('#list li').count()) >= 6, 'chats listed');
    const badges = await org.locator('#list .badge').allTextContents();
    for (const s of ['ChatGPT', 'Claude', 'Gemini']) assert.ok(badges.includes(s), `badge ${s}`);
    assert.ok(await org.locator('#folders .nav-item', { hasText: 'Работа' }).count());
    await org.fill('#q', 'сложные проценты');
    await until(async () => (await org.locator('#list li').count()) === 1, 'search result');
    assert.match(await org.textContent('#list li .title'), /Формула сложных процентов/);
    assert.ok(await org.locator('#list li .snip mark').count());
    await org.fill('#q', '');
    await until(async () => (await org.locator('#list li').count()) >= 6, 'list back');
    const [dl] = await Promise.all([org.waitForEvent('download'), org.click('#bulkExport')]);
    const entries = readZip(new Uint8Array(await readFile(await dl.path())));
    const names = entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['chatgpt/Cron скрипт каждые 15 минут.md', 'chatgpt/Разница между JOIN в SQL.md', 'claude/Рефакторинг функции на Python.md', 'gemini/Формула сложных процентов.md']);
    // settings view: per-service opt-out switches
    await org.click('.vbtn[data-view="settings"]');
    await org.waitForSelector('#siteSettings .site-card');
    assert.equal(await org.locator('#siteSettings input[data-setting="index"]').count(), 3);
    await org.locator('#siteSettings input[data-service="gemini"][data-setting="index"]').uncheck({ force: true });
    await until(async () => (await storage('settings'))?.services?.gemini?.index === false, 'gemini indexing off');
    await org.close();
  });

  await step('print page renders the chat for "Save as PDF"', async () => {
    const pr = watch(await context.newPage(), 'print');
    await pr.goto(extUrl(`src/print/print.html?key=${encodeURIComponent('chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b')}&noprint=1`));
    await pr.waitForSelector('body[data-ready="1"]');
    assert.equal(await pr.title(), 'Cron: скрипт каждые 15 минут');
    assert.equal(await pr.locator('section.msg').count(), 2);
    assert.equal(await pr.locator('pre code.language-bash').count(), 1);
    assert.equal(await pr.locator('table th').count(), 3);
    await pr.close();
  });

  await step('no errors on the extension pages', async () => {
    assert.deepEqual(pageErrors, []);
  });

  console.log(`\n# e2e pass ${passed}`);
} catch (e) {
  exitCode = 1;
  console.error('not ok -', e && e.stack ? e.stack : e);
} finally {
  await context.close();
  server.close();
  await ext.cleanup();
}
process.exit(exitCode);
