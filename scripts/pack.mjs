// Packs extension/ into dist/ai-chat-organizer-<version>.zip for the Chrome Web Store (no
// dependencies) and verifies the archive: it opens, manifest.json is at the root, every locale is
// there, names use forward slashes, no dotfiles, tests or node_modules, every file round-trips.
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, readZip, crc32 } from '../extension/lib/zip.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'Thumbs.db') continue; // no dotfiles in the store package
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ name: relative(ext, p).split(sep).join('/'), data: new Uint8Array(readFileSync(p)) });
  }
})(ext);
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', `ai-chat-organizer-${manifest.version}.zip`);
writeFileSync(out, createZip(files));

// ---- verify ----
const entries = readZip(new Uint8Array(readFileSync(out)));
const names = entries.map((e) => e.name);
const fail = (m) => {
  console.error(`zip check failed: ${m}`);
  process.exit(1);
};
if (!names.includes('manifest.json')) fail('manifest.json is not at the root');
for (const l of readdirSync(join(ext, '_locales'))) if (!names.includes(`_locales/${l}/messages.json`)) fail(`locale ${l} missing`);
for (const n of names) {
  if (n.includes('\\')) fail(`backslash in ${n}`);
  if (/(^|\/)\./.test(n)) fail(`dotfile ${n}`);
  if (/(^|\/)(node_modules|test|e2e)\//.test(n)) fail(`dev file ${n}`);
}
for (const e of entries) {
  const src = files.find((f) => f.name === e.name);
  if (!src || crc32(e.data) !== crc32(src.data) || e.crc !== crc32(src.data)) fail(`content mismatch ${e.name}`);
}
for (const p of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, ...Object.values(manifest.icons)]) if (!names.includes(p)) fail(`${p} missing`);
const size = statSync(out).size;
console.log(`${files.length} files, ${(size / 1024).toFixed(1)} KB -> ${out} (verified)`);
