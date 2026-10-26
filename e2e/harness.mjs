// Shared e2e / store-image harness: a local server that plays chatgpt.com, claude.ai and
// gemini.google.com with the fixture pages, and a temporary copy of the extension adapted to it.
//
// Test-only changes in the COPY (never in the real extension):
// - service hosts become chatgpt.localhost / claude.localhost / gemini.localhost over http
//   (Chrome resolves *.localhost to the loopback; real hosts would need TLS and HSTS-safe names),
// - those hosts are granted at install (permission prompts can't be clicked in automation),
// - the panel's shadow root is open so Playwright can reach inside it,
// - the brand-site BASE points at the local server.
import { createServer } from 'node:http';
import { readFile, cp, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'e2e', 'fixtures');
export const EXE =
  process.env.CHROMIUM_PATH ||
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe');

export const HOSTS = { chatgpt: 'chatgpt.localhost', claude: 'claude.localhost', gemini: 'gemini.localhost' };
const REAL = { chatgpt: 'chatgpt.com', claude: 'claude.ai', gemini: 'gemini.google.com' };

/** Start the fixture server. Extra routes: (path) => {body, type} | null */
export async function startFixtureServer(extra) {
  const server = createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || '').split(':')[0];
      const path = decodeURIComponent((req.url || '/').split('?')[0]);
      if (path.includes('..')) throw new Error('bad path');
      let body = null;
      let type = 'text/html; charset=utf-8';
      const x = extra ? await extra(path, host) : null;
      if (x) ({ body, type = type } = x);
      else if (path === '/_spa.js') {
        body = await readFile(join(FIX, '_spa.js'));
        type = 'text/javascript; charset=utf-8';
      } else if (path.startsWith('/brand/')) body = '<!doctype html><title>brand</title>';
      else if (host === HOSTS.claude && path.startsWith('/chat/9f9f9f9f')) body = await readFile(join(FIX, 'claude-broken.html'));
      else {
        const svc = Object.entries(HOSTS).find(([, h]) => h === host);
        if (svc) body = await readFile(join(FIX, `${svc[0]}.html`));
      }
      if (body === null) throw new Error('404');
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = /** @type {any} */ (server.address()).port;
  return { server, port, url: (svc, path) => `http://${HOSTS[svc]}:${port}${path}` };
}

/**
 * Copy and adapt the extension (see the header comment). firefox: start from the Firefox build
 * (scripts/firefox.mjs) instead of extension/.
 */
export async function prepareExtension(port, { openShadow = true, firefox = false } = {}) {
  const work = await mkdtemp(join(tmpdir(), 'aco-e2e-'));
  const extDir = join(work, 'extension');
  if (firefox) (await import('../scripts/firefox.mjs')).writeUnpacked(extDir);
  else await cp(join(ROOT, 'extension'), extDir, { recursive: true });
  const patch = async (rel, fn) => {
    const f = join(extDir, rel);
    const before = await readFile(f, 'utf8');
    const after = fn(before);
    if (after === before) throw new Error(`test patch did not apply: ${rel}`);
    await writeFile(f, after);
  };
  await patch('lib/services.js', (s) => {
    let out = s.replace("export const PROTO = 'https';", "export const PROTO = 'http';");
    for (const [id, h] of Object.entries(HOSTS)) out = out.replace(`host: '${REAL[id]}'`, `host: '${h}'`);
    return out;
  });
  if (openShadow) await patch('src/content/panel.js', (s) => s.replace("const SHADOW_MODE = 'closed';", "const SHADOW_MODE = 'open';"));
  await patch('lib/brand.js', (s) => s.replace(/export const BASE = '[^']*';/, `export const BASE = 'http://127.0.0.1:${port}/brand/';`));
  await patch('manifest.json', (s) => {
    const m = JSON.parse(s);
    const hosts = Object.values(HOSTS).map((h) => `http://${h}/*`);
    m.optional_host_permissions = hosts;
    m.host_permissions = hosts;
    m.web_accessible_resources[0].matches = hosts;
    return JSON.stringify(m, null, 2);
  });
  return { work, extDir, profile: join(work, 'profile'), cleanup: () => rm(work, { recursive: true, force: true }).catch(() => {}) };
}

/** Chromium args for loading the extension, low on resources. */
export function chromeArgs(extDir) {
  return [
    '--headless=new',
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--renderer-process-limit=3',
    '--host-resolver-rules=MAP *.localhost 127.0.0.1',
  ];
}
