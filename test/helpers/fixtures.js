// Load an e2e fixture page as it looks after its SPA script rendered `path`: the matching
// <template> is put into [data-fixture-thread], other templates and scripts are dropped.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { domFromHtml } from './dom.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'e2e', 'fixtures');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');

export function fixtureHtml(name, path) {
  const src = readFileSync(join(DIR, `${name}.html`), 'utf8');
  const start = src.indexOf(`<template id="chat:${path}"`);
  let tpl = null;
  if (start >= 0) {
    const open = src.slice(start, src.indexOf('>', start) + 1);
    const title = /data-title="([^"]*)"/.exec(open)[1];
    const end = src.indexOf('</template>', start);
    tpl = { title, body: src.slice(start + open.length, end) };
  }
  let html = src.replace(/<template[\s\S]*?<\/template>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  if (tpl) {
    html = html.replace(/(<[^>]*data-fixture-thread[^>]*>)/, (m) => m + tpl.body);
    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${tpl.title}</title>`);
    // mark the active sidebar link like _spa.js does (class "selected", data-active, aria-current)
    html = html.replace(/<a data-fixture-link([^>]*)>/g, (m, attrs) => {
      if (!attrs.includes(`href="${path}"`)) return m;
      const withClass = /class="/.test(attrs) ? attrs.replace(/class="/, 'class="selected ') : `${attrs} class="selected"`;
      return `<a data-fixture-link data-active aria-current="page"${withClass}>`;
    });
  }
  html = html.replace(/(<[^>]*data-fixture-title[^>]*>)/, (m) => m + (tpl ? tpl.title : ''));
  return { html, title: tpl ? tpl.title : '' };
}

export function fixtureDom(name, path) {
  const { html, title } = fixtureHtml(name, path);
  return { doc: domFromHtml(html), title };
}

export function bundledConfig() {
  return JSON.parse(readFileSync(join(ROOT, 'config', 'selectors.json'), 'utf8'));
}
