// E2E in real Firefox: the Firefox build (scripts/firefox.mjs) in a fresh temporary profile, on
// LOCAL fixture pages that mimic chatgpt.com, claude.ai and gemini.google.com (see e2e/harness.mjs:
// the test copy serves them as http://<service>.localhost, grants those hosts at install and opens
// the panel's shadow root). Same flows as e2e/smoke.mjs, driven by puppeteer-core over WebDriver BiDi.
// No real third-party site is contacted.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startFixtureServer, prepareExtension } from './harness.mjs';
import { startFirefox } from './firefox-harness.mjs';
import { readZip } from '../extension/lib/zip.js';

const GPT = '/c/6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b';
const GPT2 = '/c/7a2b3c4d-1e2f-4a5b-9c8d-2e3f4a5b6c7d';
const CLAUDE = '/chat/0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40';
const GEMINI = '/app/1a2b3c4d5e6f7a8b';
const BROKEN = '/chat/9f9f9f9f-0000-4000-8000-000000000001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    await sleep(250);
  }
  throw new Error(`timeout: ${what} (${last && last.message ? last.message : JSON.stringify(last)})`);
}

// /csp-check: the ChatGPT fixture under a strict style policy (style-src 'self', as strict sites
// send): the panel (a <style> in its shadow root, added by the content script) must still be styled.
const { server, port, url } = await startFixtureServer(async (path, host) => {
  if (host !== 'chatgpt.localhost' || path !== '/csp-check') return null;
  const html = await readFile(join(import.meta.dirname, 'fixtures', 'chatgpt.html'), 'utf8');
  return { body: html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="style-src 'self'">`) };
});
const ext = await prepareExtension(port, { firefox: true });
const manifest = JSON.parse(await readFile(join(ext.extDir, 'manifest.json'), 'utf8'));
const ff = await startFirefox({ extDir: ext.extDir, addonId: manifest.browser_specific_settings.gecko.id });

/** Selector inside the panel's (test-only open) shadow root. */
const sh = (sel) => `ai-chat-organizer-root >>> ${sel}`;
const count = async (page, sel) => (await page.$$(sel)).length;
const text = (page, sel) => page.$eval(sel, (el) => el.textContent);
const isVisible = (page, sel) => page.$eval(sel, (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden').catch(() => false);
async function fill(page, sel, value) {
  await page.$eval(sel, (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (value) await page.type(sel, value);
}
/** Newest file in the profile's downloads folder that appeared after `before`. */
async function newDownload(before) {
  return until(async () => {
    const f = (await readdir(ff.downloads)).find((x) => !before.has(x) && !x.endsWith('.part'));
    if (!f) return null;
    await sleep(300);
    return { name: f, path: join(ff.downloads, f) };
  }, 'download');
}

let exitCode = 0;
try {
  const helper = await ff.open('src/organizer/organizer.html');
  await ff.waitFor(helper, () => document.body.dataset.ready);
  const storage = (key) => helper.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
  const indexed = (key) => helper.evaluate(async (k) => (await import('/src/shared/db.js')).getChat(k), key);
  const openExt = async (path) => {
    const p = await ff.open(path);
    await ff.waitFor(p, () => document.body.dataset.ready === '1');
    return p;
  };

  await step('fresh install opens the welcome page of the brand site', async () => {
    const found = await ff.findPage((u) => u === `http://127.0.0.1:${port}/brand/welcome/ai-chat-organizer.html`, 15000);
    assert.ok(found, 'welcome tab');
    await found.close();
  });

  await step('content script registered only for the granted sites (scripting.registerContentScripts in Firefox)', async () => {
    const ids = await until(async () => {
      const r = await ff.bg(async (b) => (await b.chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort());
      return r.length === 3 && r;
    }, 'registered scripts');
    assert.deepEqual(ids, ['aco-chatgpt', 'aco-claude', 'aco-gemini']);
  });

  const page = await ff.open(url('chatgpt', GPT));
  await page.setViewport({ width: 1280, height: 800 });

  await step('ChatGPT page: panel button injected in a shadow root (module loaded by the content script), page markup untouched', async () => {
    await until(() => page.$(sh('.launcher')), 'launcher');
    assert.equal(await count(page, '[data-message-author-role]'), 2);
    assert.equal(await page.evaluate(() => document.body.querySelectorAll('ai-chat-organizer-root').length), 0, 'host lives outside <body>');
    assert.equal(await page.$eval(sh('.launcher'), (el) => getComputedStyle(el).display), 'flex', 'panel styled');
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
    await page.click(sh('.launcher'));
    await until(() => isVisible(page, sh('.drawer')), 'drawer');
    await fill(page, sh('.newf input'), 'Работа');
    await page.click(sh('.newf button'));
    const folderId = await until(async () => (await storage('org'))?.folders?.find((f) => f.name === 'Работа')?.id, 'folder created');
    await until(async () => (await count(page, sh('.cur select option'))) >= 2, 'folder in select');
    await page.select(sh('.cur select'), folderId);
    await until(async () => (await storage('org')).chats['chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b'].folderId === folderId, 'chat moved');
    await page.click(sh('.cur .pin'));
    await until(async () => (await storage('org')).chats['chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b'].pinned, 'pinned');
  });

  await step('panel: export current chat as Markdown (download from the page)', async () => {
    const before = new Set(await readdir(ff.downloads));
    await page.click(sh('.exp button[data-format="md"]'));
    const dl = await newDownload(before);
    assert.equal(dl.name, 'Cron скрипт каждые 15 минут.md');
    const md = await readFile(dl.path, 'utf8');
    assert.match(md, /^# Cron: скрипт каждые 15 минут\n/);
    assert.match(md, /## Вы\n\nКак запускать скрипт/);
    assert.match(md, /```bash\n# каждые 15 минут, вывод — в лог\n\*\/15 \* \* \* \* \/home\/user\/backup\.sh >> \/var\/log\/backup\.log 2>&1\n```/);
  });

  await step('panel: export HTML is standalone and sanitised', async () => {
    const before = new Set(await readdir(ff.downloads));
    await page.click(sh('.exp button[data-format="html"]'));
    const html = await readFile((await newDownload(before)).path, 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<pre><code class="language-bash">/);
    assert.ok(!/<script|<button|onclick/i.test(html));
  });

  await step('drag a chat from the site sidebar onto a folder in the panel', async () => {
    // HTML5 drag and drop: the drag events are dispatched in the page (WebDriver pointer actions do
    // not start a native drag session); the panel's handlers are the ones a real drag reaches.
    await page.evaluate(() => {
      const link = document.querySelector('#history a[href$="9c4d5e6f-3a4b-4c7d-9e0f-4a5b6c7d8e9f"]');
      const root = document.querySelector('ai-chat-organizer-root').shadowRoot;
      const target = [...root.querySelectorAll('.frow')].find((el) => el.textContent.includes('Работа'));
      const dt = new DataTransfer();
      dt.setData('text/uri-list', link.href);
      link.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      link.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
    });
    const c = await until(async () => (await storage('org')).chats['chatgpt:9c4d5e6f-3a4b-4c7d-9e0f-4a5b6c7d8e9f'], 'dragged chat filed');
    assert.equal(c.title, 'Письмо арендодателю о ремонте');
    assert.ok(c.folderId);
  });

  await step('hover button on a sidebar link opens the "move to folder" menu', async () => {
    await page.click(sh('button.close'));
    await page.hover('#history a[href$="8b3c4d5e-2f3a-4b6c-8d9e-3f4a5b6c7d8e"]');
    await until(() => isVisible(page, sh('button.hover')), 'hover button');
    await page.click(sh('button.hover'));
    await until(() => isVisible(page, sh('.menu')), 'menu');
    await page.click(sh('.menu button::-p-text(Работа)'));
    const c = await until(async () => (await storage('org')).chats['chatgpt:8b3c4d5e-2f3a-4b6c-8d9e-3f4a5b6c7d8e'], 'menu move');
    assert.equal(c.title, 'План поездки на выходные');
  });

  await step('single-page navigation: the next opened chat is indexed too', async () => {
    await page.click(`#history a[href="${GPT2}"]`);
    await until(() => page.evaluate((p) => location.pathname === p, GPT2), 'URL changed');
    const rec = await until(() => indexed('chatgpt:7a2b3c4d-1e2f-4a5b-9c8d-2e3f4a5b6c7d'), 'second chat indexed');
    assert.match(rec.messages[1].md, /```sql\nSELECT u\.name/);
  });

  await step('panel search finds opened chats of this site with a highlighted snippet', async () => {
    await page.click(sh('.launcher'));
    await page.click(sh('[data-tab="search"]'));
    await fill(page, sh('input.q'), 'crontab');
    await until(async () => (await count(page, sh('.res li'))) === 1, 'search result');
    assert.match(await text(page, sh('.res li .ct')), /Cron/);
    assert.equal(await text(page, sh('.res li mark')), 'crontab');
  });

  await step('prompt library: fill a {{variable}} and insert into the input box', async () => {
    await helper.evaluate(() => chrome.storage.local.set({ prompts: [{ id: 'p1', title: 'Объясни', body: 'Объясни {{тема}} простыми словами', updatedAt: 1 }] }));
    await page.click(sh('[data-tab="prompts"]'));
    await until(() => page.$(sh('.prow::-p-text(Объясни)')), 'prompt row');
    await page.click(sh('.prow::-p-text(Объясни)'));
    await fill(page, sh('.fill textarea'), 'cron');
    await page.click(sh('.fill button[type=submit]'));
    await until(async () => (await text(page, '#prompt-textarea')).includes('Объясни cron простыми словами'), 'prompt inserted');
  });

  await step('panel is styled under a strict page CSP (style-src \'self\')', async () => {
    const p = await ff.open(url('chatgpt', '/csp-check'));
    await until(() => p.$(sh('.launcher')), 'launcher');
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).marginTop), '8px', "the policy is active: the page's own inline <style> is blocked");
    assert.equal(await p.$eval(sh('.launcher'), (el) => getComputedStyle(el).display), 'flex', 'panel CSS applied');
    await p.close();
  });

  await step('Claude and Gemini fixture chats are indexed with their titles', async () => {
    const p2 = await ff.open(url('claude', CLAUDE));
    const c = await until(() => indexed('claude:0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40'), 'claude indexed');
    assert.equal(c.title, 'Рефакторинг функции на Python');
    assert.match(c.messages[1].md, /```python\ndef avg_positive/);
    await p2.goto(url('gemini', GEMINI), { waitUntil: 'load' });
    const g = await until(() => indexed('gemini:1a2b3c4d5e6f7a8b'), 'gemini indexed');
    assert.equal(g.title, 'Формула сложных процентов');
    assert.match(g.messages[1].md, /\| Ежегодная \| 140 493 ₸ \|/);
    assert.ok(!g.messages[1].md.includes('content_copy'));
    await p2.close();
  });

  await step('changed markup: health turns "degraded", popup shows "site changed"', async () => {
    const p3 = await ff.open(url('claude', BROKEN));
    const h = await until(async () => (await storage('health'))?.claude?.status === 'degraded' && (await storage('health')).claude, 'degraded health', 25000);
    assert.deepEqual(h.broken, ['messages']);
    const tabId = await helper.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url('claude', BROKEN));
    const popup = await openExt(`src/popup/popup.html?tabId=${tabId}`);
    assert.match(await text(popup, '#here'), /Сайт изменил разметку/);
    assert.equal(await count(popup, '#sites input[type=checkbox]:checked'), 3);
    await popup.close();
    await p3.close();
  });

  await step('popup on a healthy chat: export buttons and status', async () => {
    const tabId = await helper.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes('chatgpt.localhost'))?.id);
    const popup = await openExt(`src/popup/popup.html?tabId=${tabId}`);
    await until(() => popup.$('#here .exp button'), 'export buttons');
    assert.match(await text(popup, '#here'), /работает/);
    assert.match(await text(popup, '#stats'), /В поиске чатов: 4/);
    await popup.close();
  });

  await step('organizer: all services, folders, full-text search, bulk zip export', async () => {
    const org = await openExt('src/organizer/organizer.html');
    await until(async () => (await count(org, '#list li')) >= 6, 'chats listed');
    const badges = await org.$$eval('#list .badge', (l) => l.map((x) => x.textContent));
    for (const s of ['ChatGPT', 'Claude', 'Gemini']) assert.ok(badges.includes(s), `badge ${s}`);
    assert.ok(await org.$('#folders .nav-item::-p-text(Работа)'));
    await fill(org, '#q', 'сложные проценты');
    await until(async () => (await count(org, '#list li')) === 1, 'search result');
    assert.match(await text(org, '#list li .title'), /Формула сложных процентов/);
    assert.ok(await count(org, '#list li .snip mark'));
    await fill(org, '#q', '');
    await until(async () => (await count(org, '#list li')) >= 6, 'list back');
    const before = new Set(await readdir(ff.downloads));
    await org.click('#bulkExport');
    const entries = readZip(new Uint8Array(await readFile((await newDownload(before)).path)));
    assert.deepEqual(entries.map((e) => e.name).sort(), ['chatgpt/Cron скрипт каждые 15 минут.md', 'chatgpt/Разница между JOIN в SQL.md', 'claude/Рефакторинг функции на Python.md', 'gemini/Формула сложных процентов.md']);
    await org.click('.vbtn[data-view="settings"]');
    await until(() => org.$('#siteSettings .site-card'), 'site cards');
    assert.equal(await count(org, '#siteSettings input[data-setting="index"]'), 3);
    await org.$eval('#siteSettings input[data-service="gemini"][data-setting="index"]', (el) => el.click());
    await until(async () => (await storage('settings'))?.services?.gemini?.index === false, 'gemini indexing off');
    await org.close();
  });

  await step('print page renders the chat for "Save as PDF" (storage.session hand-over too)', async () => {
    const pr = await openExt(`src/print/print.html?key=${encodeURIComponent('chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b')}&noprint=1`);
    assert.equal(await pr.title(), 'Cron: скрипт каждые 15 минут');
    assert.equal(await count(pr, 'section.msg'), 2);
    assert.equal(await count(pr, 'pre code.language-bash'), 1);
    assert.equal(await count(pr, 'table th'), 3);
    await pr.close();
    // the panel's "PDF" hands the chat over through storage.session (print:<job>)
    const ok = await ff.bg(async (b) => {
      await b.chrome.storage.session.set({ 'print:jobe2e': { service: 'chatgpt', chatId: 'x', title: 'Session', url: 'https://chatgpt.com/c/x', messages: [{ role: 'user', md: 'hi', text: 'hi', html: '<p>hi</p>' }] } });
      return (await b.chrome.storage.session.get('print:jobe2e'))['print:jobe2e'].title;
    });
    assert.equal(ok, 'Session');
    const ps = await openExt('src/print/print.html?job=jobe2e&noprint=1');
    assert.equal(await ps.title(), 'Session');
    await ps.close();
  });

  await step('no errors in the background, extension pages and content scripts', async () => {
    assert.deepEqual(await ff.errors(), []);
  });

  console.log(`\n# e2e pass ${passed}`);
} catch (e) {
  exitCode = 1;
  console.error('not ok -', e && e.stack ? e.stack : e);
  console.error('collected errors:', await ff.errors().catch(() => []));
} finally {
  await ff.close();
  server.close();
  await ext.cleanup();
}
process.exit(exitCode);
