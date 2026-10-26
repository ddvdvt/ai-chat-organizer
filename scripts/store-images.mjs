// Renders the Chrome Web Store images into store/:
//   screenshot-1..5.png (1280×800), promo-small.png (440×280), promo-marquee.png (1400×560).
// The extension UI is real (loaded unpacked into the installed Chromium); chat pages are the local
// fixtures from e2e/fixtures (fictional content, no third-party logos) served by e2e/harness.mjs.
// Run: node scripts/store-images.mjs      (REVIEW_DIR=<dir> also saves raw light/dark UI shots)
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startFixtureServer, prepareExtension, chromeArgs, EXE, ROOT } from '../e2e/harness.mjs';
import { hideScrollbars, dataUrl, fileDataUrl, browserWindow, stage, render, promo } from './store-kit.mjs';

const OUT = join(ROOT, 'store');
const REVIEW = process.env.REVIEW_DIR;

const GPT = '/c/6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b';
const GPT2 = '/c/7a2b3c4d-1e2f-4a5b-9c8d-2e3f4a5b6c7d';
const CL1 = '/chat/0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40';
const CL2 = '/chat/1e2d3c4b-5a6f-4e7d-9c8b-0f9e8d7c6b51';
const GE1 = '/app/1a2b3c4d5e6f7a8b';
const GE2 = '/app/2b3c4d5e6f7a8b9c';

const { server, port, url } = await startFixtureServer();
const ext = await prepareExtension(port);
const context = await chromium.launchPersistentContext(ext.profile, {
  executablePath: EXE,
  headless: false,
  colorScheme: 'light',
  locale: 'ru-RU',
  deviceScaleFactor: 1,
  viewport: { width: 1280, height: 800 },
  args: [...chromeArgs(ext.extDir), '--lang=ru'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The test copy runs on *.localhost; show the real host names in the screenshots (text only). */
async function realHosts(p) {
  await p.evaluate(() => {
    const map = { 'chatgpt.localhost': 'chatgpt.com', 'claude.localhost': 'claude.ai', 'gemini.localhost': 'gemini.google.com' };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      let v = n.nodeValue.replace(/http:\/\/([a-z]+\.localhost):\d+/g, 'https://$1');
      for (const [a, b] of Object.entries(map)) v = v.split(a).join(b);
      if (v !== n.nodeValue) n.nodeValue = v;
    }
  });
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 20 && !context.pages().some((p) => p.url().includes('/brand/')); i++) await wait(200);
  for (const p of context.pages()) if (p.url().includes('/brand/')) await p.close();
  const icon = await fileDataUrl(join(ROOT, 'extension', 'icons', 'icon128.png'));

  const helper = await context.newPage();
  await helper.goto(extUrl('src/organizer/organizer.html'));
  const op = (o) => helper.evaluate((x) => chrome.runtime.sendMessage({ type: 'org:op', op: x }), o);
  const indexed = (k) => helper.evaluate(async (key) => !!(await (await import('/src/shared/db.js')).getChat(key)), k);

  // ---- seed: open six chats (indexing), folders, tags, pins, prompts ----
  const page = await context.newPage();
  await page.setViewportSize({ width: 1164, height: 591 });
  for (const [svc, path, key] of [
    ['chatgpt', GPT2, 'chatgpt:7a2b3c4d-1e2f-4a5b-9c8d-2e3f4a5b6c7d'],
    ['claude', CL1, 'claude:0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40'],
    ['claude', CL2, 'claude:1e2d3c4b-5a6f-4e7d-9c8b-0f9e8d7c6b51'],
    ['gemini', GE2, 'gemini:2b3c4d5e6f7a8b9c'],
    ['gemini', GE1, 'gemini:1a2b3c4d5e6f7a8b'],
    ['chatgpt', GPT, 'chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b'],
  ]) {
    await page.goto(url(svc, path));
    for (let i = 0; i < 60 && !(await indexed(key)); i++) await wait(250);
  }
  const F = {};
  for (const [name, parent, color] of [['Работа', null, '#3b82f6'], ['Клиент «Север»', 'Работа', '#ef4444'], ['Учёба', null, '#10b981'], ['Личное', null, '#f59e0b']]) {
    F[name] = (await op({ type: 'addFolder', name, parentId: parent ? F[parent] : null, color })).result.id;
  }
  const T = {};
  for (const [name, color] of [['важное', '#ef4444'], ['код', '#8b5cf6']]) T[name] = (await op({ type: 'addTag', name, color })).result.id;
  const ref = (service, chatId, title) => ({ service, chatId, title });
  const plan = [
    [ref('chatgpt', '6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b'), 'Работа', true, ['код']],
    [ref('chatgpt', '7a2b3c4d-1e2f-4a5b-9c8d-2e3f4a5b6c7d'), 'Учёба', false, ['код']],
    [ref('chatgpt', '8b3c4d5e-2f3a-4b6c-8d9e-3f4a5b6c7d8e', 'План поездки на выходные'), 'Личное', false, []],
    [ref('chatgpt', '9c4d5e6f-3a4b-4c7d-9e0f-4a5b6c7d8e9f', 'Письмо арендодателю о ремонте'), 'Личное', false, ['важное']],
    [ref('chatgpt', '0d5e6f7a-4b5c-4d8e-8f0a-5b6c7d8e9f0a', 'Разбор ошибки TypeError в React'), 'Клиент «Север»', false, ['код']],
    [ref('claude', '0d1c2b3a-4f5e-4d6c-8b7a-9e8d7c6b5a40'), 'Работа', false, ['код']],
    [ref('claude', '1e2d3c4b-5a6f-4e7d-9c8b-0f9e8d7c6b51'), 'Клиент «Север»', true, ['важное']],
    [ref('claude', '2f3e4d5c-6b7a-4f8e-8d9c-1a0f9e8d7c62', 'Сравнение тарифов хостинга'), 'Работа', false, []],
    [ref('gemini', '1a2b3c4d5e6f7a8b'), 'Учёба', true, []],
    [ref('gemini', '2b3c4d5e6f7a8b9c'), 'Личное', false, []],
    [ref('gemini', '3c4d5e6f7a8b9c0d', 'Маршрут по Чарынскому каньону'), 'Личное', false, []],
  ];
  for (const [r, folder, pinned, tags] of plan) {
    await op({ type: 'moveChat', chat: r, folderId: F[folder] });
    if (pinned) await op({ type: 'pinChat', chat: r, pinned: true });
    for (const tg of tags) await op({ type: 'tagChat', chat: r, tagId: T[tg], on: true });
  }
  await helper.evaluate(async () => {
    const { samplePrompts, normalizePrompts } = await import('/lib/prompts.js');
    const list = [...samplePrompts('ru'), { title: 'Письмо коротко и вежливо', body: 'Перепиши это письмо короче и вежливее, сохрани факты:\n\n{{текст}}' }];
    await chrome.storage.local.set({ prompts: normalizePrompts(list) });
  });
  // let the markup check of Claude and Gemini settle (12 s on a page) for the settings screenshot
  for (const [svc, path] of [['claude', CL1], ['gemini', GE1]]) {
    await page.goto(url(svc, path));
    for (let i = 0; i < 80; i++) {
      const hl = await helper.evaluate(async (x) => (await chrome.storage.local.get('health')).health?.[x], svc);
      if (hl) break;
      await wait(250);
    }
  }
  await wait(600);

  // ---- 1: chat page with the panel open ----
  await page.goto(url('chatgpt', GPT));
  await hideScrollbars(page);
  const shadow = page.locator('ai-chat-organizer-root');
  await shadow.locator('.launcher').click();
  await shadow.locator('.frow', { hasText: 'Работа' }).click();
  await shadow.locator('.frow', { hasText: 'Клиент' }).click();
  await page.mouse.move(600, 300);
  await wait(400);
  await render(
    context,
    stage({
      eyebrow: 'Органайзер ИИ-чатов · на странице чата',
      caption: 'Папки, закрепления и теги <mark>прямо рядом с чатом</mark>. Перетащите чат из списка на папку',
      body: browserWindow({ tab: 'Cron: скрипт каждые 15 минут', address: `chatgpt.com${GPT}`, page: await dataUrl(page), icon }),
    }),
    join(OUT, 'screenshot-1.png'),
  );
  if (REVIEW) await page.screenshot({ path: join(REVIEW, 'aco-panel-light.png') });

  // ---- 2: organizer, all chats ----
  const org = await context.newPage();
  await org.setViewportSize({ width: 1164, height: 591 });
  await org.goto(extUrl('src/organizer/organizer.html'));
  await org.waitForSelector('body[data-ready="1"]');
  await org.waitForSelector('#list li');
  await hideScrollbars(org);
  await wait(300);
  await render(
    context,
    stage({
      eyebrow: 'Органайзер ИИ-чатов · все чаты',
      caption: 'Чаты из трёх сервисов в одном месте: <mark>папки, теги, экспорт</mark> одного чата или всех сразу',
      body: browserWindow({ tab: 'Органайзер ИИ-чатов', page: await dataUrl(org), icon }),
    }),
    join(OUT, 'screenshot-2.png'),
  );
  if (REVIEW) await org.screenshot({ path: join(REVIEW, 'aco-organizer-light.png'), fullPage: true });

  // ---- 3: full-text search ----
  await org.fill('#q', 'пуст');
  await org.waitForSelector('#list li .snip mark');
  await wait(300);
  await render(
    context,
    stage({
      eyebrow: 'Органайзер ИИ-чатов · поиск',
      caption: 'Поиск по тексту чатов, которые вы открывали. <mark>Индекс хранится только в браузере</mark>',
      body: browserWindow({ tab: 'Органайзер ИИ-чатов', page: await dataUrl(org), icon }),
    }),
    join(OUT, 'screenshot-3.png'),
  );

  // ---- 4: export: print page + popup ----
  const tabId = await helper.evaluate(async () => (await chrome.tabs.query({})).find((t) => t.url && t.url.includes('chatgpt.localhost'))?.id);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 520 });
  await popup.goto(extUrl(`src/popup/popup.html?tabId=${tabId}`));
  await popup.waitForSelector('body[data-ready="1"]');
  await popup.waitForSelector('#here .exp button');
  await realHosts(popup);
  await wait(300);
  const popupShot = await dataUrl(popup, { fullPage: true });
  if (REVIEW) await popup.screenshot({ path: join(REVIEW, 'aco-popup-light.png'), fullPage: true });
  const pr = await context.newPage();
  await pr.setViewportSize({ width: 1164, height: 591 });
  await pr.goto(extUrl(`src/print/print.html?key=${encodeURIComponent('chatgpt:6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b')}&noprint=1`));
  await pr.waitForSelector('body[data-ready="1"]');
  await hideScrollbars(pr);
  await realHosts(pr);
  await render(
    context,
    stage({
      eyebrow: 'Органайзер ИИ-чатов · экспорт',
      caption: 'Markdown, HTML, JSON, TXT и PDF: <mark>код и таблицы сохраняются</mark> как в чате',
      body: browserWindow({ tab: 'Cron: скрипт каждые 15 минут', page: await dataUrl(pr), icon, popup: popupShot, popupWidth: 380 }),
    }),
    join(OUT, 'screenshot-4.png'),
  );
  await pr.close();

  // ---- 5: settings ----
  await org.fill('#q', '');
  await org.click('.vbtn[data-view="settings"]');
  await org.waitForSelector('#siteSettings .site-card');
  await wait(4000); // let the last markup check of the open chat tab land first (it re-renders the page)
  await realHosts(org);
  await render(
    context,
    stage({
      eyebrow: 'Органайзер ИИ-чатов · приватность',
      caption: 'Вы выбираете сайты и что запоминать. <mark>Ничего не уходит в интернет</mark>',
      body: browserWindow({ tab: 'Органайзер ИИ-чатов — настройки', page: await dataUrl(org), icon }),
    }),
    join(OUT, 'screenshot-5.png'),
  );
  if (REVIEW) await org.screenshot({ path: join(REVIEW, 'aco-settings-light.png'), fullPage: true });

  // ---- promo tiles ----
  const tile = {
    icon,
    name: 'Органайзер ИИ-чатов',
    eyebrow: 'Честные расширения',
    tagline: 'Папки, поиск и экспорт <mark>ваших ИИ-чатов</mark>',
    facts: [['Цена', '0 ₽'], ['Аккаунт', 'не нужен'], ['Реклама', '0'], ['Трекеры', '0'], ['Данные', 'на устройстве']],
  };
  await render(context, promo({ ...tile, size: 'small' }), join(OUT, 'promo-small.png'), 440, 280);
  await render(context, promo({ ...tile, size: 'marquee' }), join(OUT, 'promo-marquee.png'), 1400, 560);

  if (REVIEW) {
    // dark theme + prompts / empty states for the UX review (not store assets)
    await org.emulateMedia({ colorScheme: 'dark' });
    await org.click('.vbtn[data-view="chats"]');
    await wait(300);
    await org.screenshot({ path: join(REVIEW, 'aco-organizer-dark.png') });
    await org.click('.vbtn[data-view="prompts"]');
    await org.locator('#promptList .prow').first().click();
    await wait(200);
    await org.screenshot({ path: join(REVIEW, 'aco-prompts-dark.png') });
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.reload();
    await popup.waitForSelector('#here .exp button');
    await popup.screenshot({ path: join(REVIEW, 'aco-popup-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await wait(300);
    await shadow.locator('[data-tab="prompts"]').click();
    await wait(200);
    await page.screenshot({ path: join(REVIEW, 'aco-panel-prompts-dark.png') });
    await page.locator('#history a[href$="8b3c4d5e-2f3a-4b6c-8d9e-3f4a5b6c7d8e"]').hover();
    await shadow.locator('button.hover').click();
    await wait(200);
    await page.screenshot({ path: join(REVIEW, 'aco-hover-menu-dark.png') });
    const empty = await context.newPage();
    await empty.setViewportSize({ width: 1100, height: 700 });
    await empty.goto(extUrl('src/organizer/organizer.html'));
    await empty.evaluate(() => chrome.runtime.sendMessage({ type: 'org:replace', org: null }));
    await empty.reload();
    await empty.waitForSelector('body[data-ready="1"]');
    await wait(300);
    await empty.screenshot({ path: join(REVIEW, 'aco-organizer-empty-light.png') });
  }
  console.log('store images written to', OUT);
} finally {
  await context.close();
  server.close();
  await ext.cleanup();
}
