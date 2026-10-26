// Firefox: loads the REAL Firefox build (scripts/firefox.mjs, nothing patched except the brand-site
// BASE so the welcome tab stays on 127.0.0.1) and checks: the background starts, no site access and
// no content scripts at install, popup / organizer / print open without errors and show their empty
// states; then a real click on a site switch in the popup asks Firefox for that one host
// (permissions.request; the pref extensions.webextOptionalPermissionPrompts=false answers the prompt
// "Allow" in automation), the content script is registered for it, and switching it off revokes both.
// No web page of the chat services is visited.
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { writeUnpacked } from '../scripts/firefox.mjs';
import { startFirefox } from './firefox-harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>brand</title>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = /** @type {any} */ (server.address()).port;

const work = await mkdtemp(join(tmpdir(), 'aco-ff-real-'));
const extDir = writeUnpacked(join(work, 'extension'));
const brand = join(extDir, 'lib', 'brand.js');
await writeFile(brand, (await readFile(brand, 'utf8')).replace(/export const BASE = '[^']*';/, `export const BASE = 'http://127.0.0.1:${port}/brand/';`));
const manifest = JSON.parse(await readFile(join(extDir, 'manifest.json'), 'utf8'));
const ff = await startFirefox({ extDir, addonId: manifest.browser_specific_settings.gecko.id, prefs: { 'extensions.webextOptionalPermissionPrompts': false } });

let code = 0;
try {
  const helper = await ff.open('src/organizer/organizer.html');
  await ff.waitFor(helper, () => document.body.dataset.ready);
  const state = () => ff.bg(async (b) => ({ scripts: (await b.chrome.scripting.getRegisteredContentScripts()).map((s) => s.id), origins: (await b.chrome.permissions.getAll()).origins }));
  assert.deepEqual(await state(), { scripts: [], origins: [] }, 'no site access at install');
  console.log('ok - background started; no host access and no content scripts at install');

  for (const [path, check] of [
    ['src/popup/popup.html', async (p) => assert.equal((await p.$$('#sites input[type=checkbox]:checked')).length, 0)],
    ['src/organizer/organizer.html', async (p) => assert.match(await p.$eval('#empty', (e) => e.textContent), /Включите сайты/)],
    ['src/print/print.html?key=none&noprint=1', async (p) => assert.match(await p.$eval('#doc', (e) => e.textContent), /Чат не найден/)],
  ]) {
    const p = await ff.open(path);
    await ff.waitFor(p, () => document.body.dataset.ready, undefined, 10000);
    await check(p);
    await p.close();
    console.log(`ok - ${path.split('?')[0]} opens, empty state shown`);
  }

  const popup = await ff.open('src/popup/popup.html');
  await ff.waitFor(popup, () => document.body.dataset.ready === '1');
  await ff.front(popup);
  await popup.click('#sites li:first-child input[type=checkbox]');
  await ff.waitFor(popup, () => document.querySelector('#sites li:first-child input[type=checkbox]').checked && !document.querySelector('#sites li:first-child input').disabled);
  let st = await state();
  for (let i = 0; i < 20 && !st.scripts.length; i++) {
    await sleep(250);
    st = await state();
  }
  assert.deepEqual(st, { scripts: ['aco-chatgpt'], origins: ['https://chatgpt.com/*'] });
  console.log('ok - switch in the popup: Firefox grants that one host, the content script is registered for it');

  await popup.click('#sites li:first-child input[type=checkbox]');
  await ff.waitFor(popup, () => !document.querySelector('#sites li:first-child input[type=checkbox]').checked);
  st = await state();
  for (let i = 0; i < 20 && st.scripts.length; i++) {
    await sleep(250);
    st = await state();
  }
  assert.deepEqual(st, { scripts: [], origins: [] });
  console.log('ok - switching it off revokes the host and unregisters the content script');

  assert.deepEqual(await ff.errors(), []);
  console.log('ok - no errors\n# real-load pass');
} catch (e) {
  code = 1;
  console.error('not ok -', e && e.stack ? e.stack : e, await ff.errors().catch(() => []));
} finally {
  await ff.close();
  server.close();
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
process.exit(code);
