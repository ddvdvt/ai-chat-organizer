// Loads the REAL, unmodified extension/ folder (as a user would) and checks: the service worker
// starts, no site access and no content scripts at install, popup and organizer open without
// console errors and show their empty states. No web page is visited.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { EXE, ROOT } from './harness.mjs';

if (!existsSync(EXE)) {
  console.error(`Chromium not found at ${EXE}. Set CHROMIUM_PATH.`);
  process.exit(1);
}
const extDir = join(ROOT, 'extension');
const profile = await mkdtemp(join(tmpdir(), 'aco-real-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: EXE,
  headless: false,
  locale: 'ru-RU',
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--renderer-process-limit=2', '--lang=ru'],
});
// the welcome tab of the brand site must not be fetched from the network in tests
await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));

let code = 0;
const errors = [];
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const state = await sw.evaluate(async () => ({
    scripts: (await chrome.scripting.getRegisteredContentScripts()).length,
    origins: (await chrome.permissions.getAll()).origins,
  }));
  assert.deepEqual(state, { scripts: 0, origins: [] }, 'no site access at install');
  console.log('ok - service worker started; no host access and no content scripts at install');

  for (const [path, check] of [
    ['src/popup/popup.html', async (p) => assert.equal(await p.locator('#sites input[type=checkbox]:checked').count(), 0)],
    ['src/organizer/organizer.html', async (p) => assert.match(await p.textContent('#empty'), /Включите сайты/)],
    ['src/print/print.html?key=none&noprint=1', async (p) => assert.match(await p.textContent('#doc'), /Чат не найден/)],
  ]) {
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(`${path}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${path}: ${m.text()}`));
    await p.goto(`chrome-extension://${extId}/${path}`);
    await p.waitForSelector('body[data-ready]', { timeout: 10000 });
    await check(p);
    await p.close();
    console.log(`ok - ${path.split('?')[0]} opens, empty state shown`);
  }
  assert.deepEqual(errors, []);
  console.log('ok - no console errors\n# real-load pass');
} catch (e) {
  code = 1;
  console.error('not ok -', e && e.stack ? e.stack : e, errors);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(code);
