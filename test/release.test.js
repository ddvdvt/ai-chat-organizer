// Release checks: brand-site links, manifest fields required by the Chrome Web Store,
// locales, permissions actually used by the code, no remote code, no network requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, SLUG, brandUrls, welcomeUrlFor } from '../extension/lib/brand.js';
import { SERVICES, originPattern, PROTO } from '../extension/lib/services.js';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const read = (p) => readFileSync(join(EXT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const LOCALES = readdirSync(join(EXT, '_locales'));

/** @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(EXT);
const jsHtml = files.filter((f) => /\.(js|html)$/.test(f));
const code = jsHtml.map((f) => readFileSync(f, 'utf8')).join('\n');

/** Which code proves that a permission is used. */
const USAGE = {
  storage: /chrome\.storage\.(local|session)\./,
  scripting: /chrome\.scripting\.registerContentScripts/,
};

test('brand URLs are built from one BASE', () => {
  assert.equal(SLUG, 'ai-chat-organizer');
  assert.match(BASE, /^https:\/\/.+\/$/);
  const u = brandUrls();
  assert.equal(u.welcome, `${BASE}welcome/ai-chat-organizer.html`);
  assert.equal(u.bye, `${BASE}bye/ai-chat-organizer.html`);
  assert.equal(u.privacy, `${BASE}privacy/ai-chat-organizer.html`);
  assert.equal(u.other, `${BASE}#ai-chat-organizer`);
});

test('welcome page opens only on a fresh install', () => {
  assert.equal(welcomeUrlFor('install'), `${BASE}welcome/ai-chat-organizer.html`);
  for (const r of ['update', 'chrome_update', 'shared_module_update', undefined]) assert.equal(welcomeUrlFor(r), null);
});

test('service worker wires the welcome and uninstall pages', () => {
  const sw = read(manifest.background.service_worker);
  assert.match(sw, /from '\.\.\/lib\/brand\.js'/);
  assert.match(sw, /welcomeUrlFor\(details/);
  assert.match(sw, /setUninstallURL\(brandUrls\(\)\.bye\)/);
});

test('"other extensions" links go to the brand site, no placeholders left', () => {
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    assert.ok(!html.includes('https://github.com/'), `${f} still links to the github.com placeholder`);
    for (const m of html.matchAll(/<a [^>]*data-i18n="otherExtensions"[^>]*>/g)) assert.match(m[0], /data-brand-link="other"/, f);
  }
  for (const page of ['src/popup/popup.html', 'src/organizer/organizer.html']) assert.match(read(page), /data-brand-link="other"/, page);
});

test('manifest: CWS fields', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.homepage_url, BASE, 'homepage_url must equal BASE from lib/brand.js');
  assert.equal(manifest.default_locale, 'ru');
  assert.equal(manifest.content_security_policy, undefined, 'default CSP');
  assert.equal(manifest.content_scripts, undefined, 'content scripts are registered only after the user enables a site');
  for (const size of ['16', '32', '48', '128']) {
    const png = readFileSync(join(EXT, manifest.icons[size]));
    assert.equal(png.readUInt32BE(16), Number(size), `icon ${size} width`);
    assert.equal(png.readUInt32BE(20), Number(size), `icon ${size} height`);
  }
});

test('manifest: minimal permissions, each one used; hosts optional and exactly the three services', () => {
  assert.deepEqual([...manifest.permissions].sort(), Object.keys(USAGE).sort());
  for (const p of manifest.permissions) assert.match(code, USAGE[p], `permission ${p} unused`);
  assert.equal(manifest.host_permissions, undefined, 'no host permissions at install');
  assert.equal(PROTO, 'https');
  const hosts = SERVICES.map((s) => originPattern(s.id));
  assert.deepEqual(manifest.optional_host_permissions, hosts);
  assert.equal(manifest.web_accessible_resources.length, 1);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, hosts);
  assert.match(code, /chrome\.permissions\.request\(/);
});

test('no network requests: only bundled files are fetched', () => {
  for (const f of jsHtml) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bfetch\(([^)]*)\)/g)) assert.match(m[1], /^chrome\.runtime\.getURL\(/, `${f}: fetch of ${m[1]}`);
    assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(src), `${f}: network API`);
  }
});

test('locales: ru and en complete, CWS length limits', () => {
  assert.deepEqual(LOCALES.sort(), ['en', 'ru']);
  const all = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
  const keys = Object.keys(all.ru).sort();
  const used = new Set([...code.matchAll(/data-i18n(?:-[a-z]+)?="([A-Za-z0-9_]+)"/g), ...code.matchAll(/\bt\('([A-Za-z0-9_]+)'[,)]/g)].map((m) => m[1]));
  for (const m of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
  for (const k of ['featureMessages', 'featurePrompts', 'featureSidebar', 'noMessages']) used.add(k); // looked up dynamically
  for (const l of LOCALES) {
    assert.deepEqual(Object.keys(all[l]).sort(), keys, `${l} keys`);
    for (const k of used) assert.ok(all[l][k], `${l}: missing ${k}`);
    assert.ok([...all[l].extName.message].length <= 75, `${l} name too long`);
    assert.ok([...all[l].extShortName.message].length <= 12, `${l} short_name too long`);
    assert.ok([...all[l].extDescription.message].length <= 132, `${l} description too long`);
    assert.ok(!/ChatGPT|Claude|Gemini|OpenAI|Anthropic|Google/i.test(all[l].extName.message + all[l].extShortName.message), `${l}: no third-party trademarks in the name`);
  }
  for (const k of keys) assert.ok(used.has(k), `unused locale key ${k}`);
});

test('no remote code, eval or debug leftovers', () => {
  for (const f of jsHtml) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/<script[^>]+src="https?:/.test(src), `${f}: remote script`);
    assert.ok(!/<link[^>]+href="https?:/.test(src), `${f}: remote stylesheet`);
    assert.ok(!/\beval\(|new Function\(|debugger;/.test(src), `${f}: eval/debugger`);
    assert.ok(!/console\.log\(/.test(src), `${f}: console.log`);
    assert.ok(!/\b(TODO|FIXME)\b/.test(src) || f.endsWith('brand.js'), `${f}: TODO left`);
  }
});

test('content script is closed-shadow, never edits the page outside its host', () => {
  const panel = read('src/content/panel.js');
  assert.match(panel, /const SHADOW_MODE = 'closed';/);
  const main = read('src/content/main.js');
  assert.ok(!/innerHTML/.test(panel + main), 'no innerHTML in the content script');
});
