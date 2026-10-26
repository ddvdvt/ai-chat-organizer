// Rendered chat message (DOM) → Markdown, plain text and sanitised HTML. Pure: works on any
// DOM-like tree (nodeType, nodeName, childNodes, getAttribute, textContent), so the same code runs
// in the content script on the real page and in node tests. Code blocks keep their exact text and
// language, tables become GFM tables, KaTeX/MathML/data-math formulas become $TeX$.

/**
 * @typedef {object} ConvertOptions
 * @property {(el: any) => boolean} [skip]     elements to ignore (buttons, hidden labels…)
 * @property {(pre: any) => string} [langOf]   language label for a <pre> without language-* class
 */

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'SVG', 'svg', 'CANVAS', 'IFRAME', 'INPUT', 'SELECT', 'TEXTAREA', 'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'MATH-FIELD']);

export const LIMITS = { messageChars: 200_000 };

const tag = (n) => String(n.nodeName || '').toUpperCase();
const cls = (n) => (n.getAttribute && n.getAttribute('class')) || '';
const hasClass = (n, c) => cls(n).split(/\s+/).includes(c);
const isElement = (n) => n && n.nodeType === 1;
const isText = (n) => n && n.nodeType === 3;
/** Custom elements (Gemini's <message-content>, <code-block>…) behave like blocks. */
const isBlock = (n) => BLOCK_TAGS.has(tag(n)) || tag(n).includes('-') || isMathBlock(n);
const isPreWrap = (n) => /\bwhitespace-pre(-wrap|-line)?\b|\bpre-wrap\b/.test(cls(n));

function children(n) {
  return n.childNodes ? Array.from(n.childNodes) : [];
}

function skipped(n, o) {
  if (!isElement(n)) return false;
  if (DROP_TAGS.has(tag(n)) || DROP_TAGS.has(n.nodeName)) return true;
  if (n.getAttribute('hidden') !== null && n.getAttribute('hidden') !== undefined) return true;
  try {
    return !!(o.skip && o.skip(n));
  } catch {
    return false;
  }
}

// ---------- maths ----------

function texOf(n) {
  const dm = n.getAttribute && n.getAttribute('data-math');
  if (dm) return dm.trim();
  const ann = n.querySelector && n.querySelector('annotation[encoding="application/x-tex"]');
  if (ann) return String(ann.textContent || '').trim();
  return '';
}
function isMathBlock(n) {
  if (!isElement(n)) return false;
  if (hasClass(n, 'katex-display') || hasClass(n, 'math-block')) return !!texOf(n);
  if (tag(n) === 'MATH' && n.getAttribute('display') === 'block') return !!texOf(n);
  return false;
}
function isMathInline(n) {
  if (!isElement(n)) return false;
  return (hasClass(n, 'katex') || hasClass(n, 'math-inline') || tag(n) === 'MATH' || (n.getAttribute('data-math') && !hasClass(n, 'math-block'))) && !!texOf(n);
}

// ---------- markdown / text ----------

/** Escape characters that would turn plain text into Markdown syntax. */
export function escapeMd(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/([*`~])/g, '\\$1')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace('_', '\\_'))
    .replace(/<(?=[A-Za-z/!])/g, '\\<');
}

function fenceFor(text, min = 3) {
  const runs = String(text).match(/`+/g) || [];
  const longest = runs.reduce((a, r) => Math.max(a, r.length), 0);
  return '`'.repeat(Math.max(min, longest + 1));
}

function inlineCode(text) {
  const t = String(text).replace(/\n/g, ' ');
  const runs = t.match(/`+/g) || [];
  const f = '`'.repeat(runs.reduce((a, r) => Math.max(a, r.length), 0) + 1);
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
  return `${f}${pad}${t}${pad}${f}`;
}

/** Wrap inline text with a marker, keeping outer spaces outside: " a " → " **a** ". */
function wrap(s, mark) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return m && m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : s;
}

function safeHref(href) {
  const h = String(href || '').trim();
  return /^(https?:|mailto:)/i.test(h) ? h : '';
}

function langClass(n) {
  if (!n || !n.getAttribute) return '';
  const m = /(?:^|\s)(?:language|lang)-([A-Za-z0-9+#._-]{1,20})/.exec(cls(n));
  return m ? m[1].toLowerCase() : '';
}

function preParts(pre, o) {
  const code = (pre.querySelector && pre.querySelector('code')) || pre;
  let lang = langClass(code) || langClass(pre);
  if (!lang && o.langOf) {
    try {
      lang = o.langOf(pre) || '';
    } catch {
      lang = '';
    }
  }
  const text = String(code.textContent || '').replace(/\u00a0/g, ' ').replace(/\n+$/, '');
  return { lang, text };
}

/**
 * Inline content of a node as Markdown (or plain text).
 * @param {any} n @param {any} o @param {{plain: boolean, pre: boolean}} ctx
 */
function inline(n, o, ctx) {
  if (isText(n)) {
    let t = String(n.nodeValue ?? n.textContent ?? '').replace(/\u00a0/g, ' ');
    if (ctx.pre) {
      t = t.replace(/\r\n?/g, '\n');
      return ctx.plain ? t : t.split('\n').map(escapeMd).join('  \n');
    }
    t = t.replace(/\s+/g, ' ');
    return ctx.plain ? t : escapeMd(t);
  }
  if (!isElement(n) || skipped(n, o)) return '';
  if (isMathInline(n) || isMathBlock(n)) return ctx.plain ? texOf(n) : `$${texOf(n)}$`;
  const T = tag(n);
  const kids = (c = ctx) => children(n).map((k) => inline(k, o, c)).join('');
  switch (T) {
    case 'BR':
      return ctx.plain ? '\n' : '  \n';
    case 'IMG': {
      const alt = String(n.getAttribute('alt') || '').trim();
      return alt ? `[image: ${alt}]` : '[image]';
    }
    case 'STRONG':
    case 'B':
      return ctx.plain ? kids() : wrap(kids(), '**');
    case 'EM':
    case 'I':
      return ctx.plain ? kids() : wrap(kids(), '*');
    case 'DEL':
    case 'S':
    case 'STRIKE':
      return ctx.plain ? kids() : wrap(kids(), '~~');
    case 'CODE': {
      const t = String(n.textContent || '').replace(/\u00a0/g, ' ');
      return ctx.plain ? t : inlineCode(t);
    }
    case 'A': {
      const text = kids().trim();
      const href = safeHref(n.getAttribute('href'));
      if (!href) return text;
      if (ctx.plain) return text && text !== href ? `${text} (${href})` : href;
      const h = /[\s()<>]/.test(href) ? `<${href.replace(/[<>\s]/g, encodeURIComponent)}>` : href;
      return `[${text || escapeMd(href)}](${h})`;
    }
    default:
      return isPreWrap(n) ? kids({ ...ctx, pre: true }) : kids();
  }
}

/**
 * @typedef {{t: string, k: string}} Block  text + kind ('p' | 'list' | 'code' | …)
 */

/**
 * Block-level conversion.
 * @returns {Block[]}
 */
function blocks(n, o, ctx) {
  /** @type {Block[]} */
  const out = [];
  let buf = '';
  const flush = () => {
    const t = ctx.pre ? buf.replace(/^\n+|\s+$/g, '') : buf.replace(/[ \t]*\n[ \t]*/g, '\n').trim();
    if (t) out.push({ t, k: 'p' });
    buf = '';
  };
  for (const c of children(n)) {
    if (isElement(c) && skipped(c, o)) continue;
    if (isElement(c) && isBlock(c) && !(isMathInline(c) && !isMathBlock(c))) {
      flush();
      out.push(...block(c, o, ctx));
    } else {
      buf += inline(c, o, ctx);
    }
  }
  flush();
  return out;
}

function indent(text, pad) {
  return text
    .split('\n')
    .map((l, i) => (i === 0 || !l ? l : pad + l))
    .join('\n');
}

function joinBlocks(bs) {
  let s = '';
  bs.forEach((b, i) => {
    if (i) s += b.k === 'list' && bs[i - 1].k === 'p' ? '\n' : '\n\n';
    s += b.t;
  });
  return s;
}

/** @returns {Block[]} */
function block(n, o, ctx) {
  const T = tag(n);
  if (isMathBlock(n)) {
    const tex = texOf(n);
    return [{ t: ctx.plain ? tex : `$$\n${tex}\n$$`, k: 'math' }];
  }
  if (/^H[1-6]$/.test(T)) {
    const text = children(n).map((k) => inline(k, o, ctx)).join('').replace(/\s+/g, ' ').trim();
    return text ? [{ t: ctx.plain ? text : `${'#'.repeat(Number(T[1]))} ${text}`, k: 'h' }] : [];
  }
  switch (T) {
    case 'PRE': {
      const { lang, text } = preParts(n, o);
      if (!text.trim()) return [];
      if (ctx.plain) return [{ t: text, k: 'code' }];
      const f = fenceFor(text);
      return [{ t: `${f}${lang}\n${text}\n${f}`, k: 'code' }];
    }
    case 'HR':
      return [{ t: ctx.plain ? '----------' : '---', k: 'hr' }];
    case 'UL':
    case 'OL':
      return list(n, o, ctx, T === 'OL');
    case 'BLOCKQUOTE': {
      const inner = joinBlocks(blocks(n, o, ctx));
      return inner ? [{ t: inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'), k: 'quote' }] : [];
    }
    case 'TABLE':
      return table(n, o, ctx);
    default:
      return blocks(n, o, isPreWrap(n) ? { ...ctx, pre: true } : ctx);
  }
}

function list(n, o, ctx, ordered) {
  let i = Number.parseInt(n.getAttribute('start') || '1', 10);
  if (!Number.isFinite(i)) i = 1;
  const lines = [];
  for (const li of children(n)) {
    if (!isElement(li) || skipped(li, o)) continue;
    const content = tag(li) === 'LI' ? joinBlocks(blocks(li, o, ctx)) : joinBlocks(block(li, o, ctx));
    if (tag(li) !== 'LI') {
      if (content) lines.push(content);
      continue;
    }
    const marker = ordered ? `${i++}.` : '-';
    lines.push(`${marker} ${indent(content, ' '.repeat(marker.length + 1))}`.trimEnd());
  }
  return lines.length ? [{ t: lines.join('\n'), k: 'list' }] : [];
}

function rowsOf(table) {
  const rows = [];
  const visit = (n) => {
    for (const c of children(n)) {
      if (!isElement(c)) continue;
      const T = tag(c);
      if (T === 'TR') rows.push(c);
      else if (T === 'THEAD' || T === 'TBODY' || T === 'TFOOT') visit(c);
    }
  };
  visit(table);
  return rows;
}

function table(n, o, ctx) {
  const rows = rowsOf(n)
    .map((tr) =>
      children(tr)
        .filter((c) => isElement(c) && (tag(c) === 'TD' || tag(c) === 'TH'))
        .map((td) => {
          const parts = blocks(td, o, ctx).map((b) => b.t);
          const text = parts.join(ctx.plain ? ' ' : '<br>');
          return ctx.plain ? text.replace(/\s*\n\s*/g, ' ') : text.replace(/\s*\n\s*/g, '<br>').replace(/\|/g, '\\|');
        }),
    )
    .filter((r) => r.length);
  if (!rows.length) return [];
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(cols - r.length).fill('')];
  if (ctx.plain) return [{ t: rows.map((r) => pad(r).join('\t')).join('\n'), k: 'table' }];
  const line = (r) => `| ${pad(r).join(' | ')} |`;
  const out = [line(rows[0]), `|${' --- |'.repeat(cols)}`, ...rows.slice(1).map(line)];
  return [{ t: out.join('\n'), k: 'table' }];
}

function cap(s) {
  return s.length > LIMITS.messageChars ? `${s.slice(0, LIMITS.messageChars)}\n\n…` : s;
}

/**
 * DOM node → Markdown.
 * @param {any} node @param {ConvertOptions} [opts]
 */
export function toMarkdown(node, opts = {}) {
  if (!node) return '';
  const ctx = { plain: false, pre: false };
  return cap(joinBlocks(isElement(node) ? block(node, opts, ctx) : blocks(node, opts, ctx)));
}

/**
 * DOM node → plain text with paragraphs, lists and tables laid out.
 * @param {any} node @param {ConvertOptions} [opts]
 */
export function toText(node, opts = {}) {
  if (!node) return '';
  const ctx = { plain: true, pre: false };
  return cap(joinBlocks(isElement(node) ? block(node, opts, ctx) : blocks(node, opts, ctx)));
}

// ---------- sanitised HTML ----------

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Allowed output tags (input tag → output tag). Everything else is unwrapped. */
const HTML_MAP = {
  P: 'p', DIV: 'div', SECTION: 'div', ARTICLE: 'div', H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6',
  UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote', TABLE: 'table', THEAD: 'thead', TBODY: 'tbody',
  TFOOT: 'tfoot', TR: 'tr', TH: 'th', TD: 'td', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', DEL: 'del',
  S: 'del', STRIKE: 'del', SUP: 'sup', SUB: 'sub', HR: 'hr', BR: 'br', CODE: 'code', DL: 'dl', DT: 'dt', DD: 'dd',
  FIGURE: 'div', FIGCAPTION: 'p', DETAILS: 'div', SUMMARY: 'p', MARK: 'mark', KBD: 'kbd',
};
const VOID_OUT = new Set(['br', 'hr']);

function html(n, o, pre) {
  if (isText(n)) {
    const t = escapeHtml(String(n.nodeValue ?? n.textContent ?? '').replace(/\u00a0/g, ' '));
    return pre ? t.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>') : t;
  }
  if (!isElement(n) || skipped(n, o)) return '';
  if (isMathBlock(n)) return `<pre class="math"><code>${escapeHtml(texOf(n))}</code></pre>`;
  if (isMathInline(n)) return `<code class="math">${escapeHtml(texOf(n))}</code>`;
  const T = tag(n);
  if (T === 'PRE') {
    const { lang, text } = preParts(n, o);
    return `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</code></pre>`;
  }
  if (T === 'IMG') {
    const alt = String(n.getAttribute('alt') || '').trim();
    return `<span class="img">[${escapeHtml(alt ? `image: ${alt}` : 'image')}]</span>`;
  }
  const keepPre = pre || isPreWrap(n);
  const inner = children(n).map((c) => html(c, o, keepPre)).join('');
  if (T === 'A') {
    const href = safeHref(n.getAttribute('href'));
    return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${inner}</a>` : inner;
  }
  const out = HTML_MAP[T] || (T.includes('-') ? 'div' : '');
  if (!out) return inner;
  if (VOID_OUT.has(out)) return `<${out}>`;
  if (out === 'ol') {
    const start = Number.parseInt(n.getAttribute('start') || '', 10);
    return `<ol${Number.isFinite(start) && start !== 1 ? ` start="${start}"` : ''}>${inner}</ol>`;
  }
  if ((out === 'th' || out === 'td') && /^\d{1,2}$/.test(n.getAttribute('colspan') || '')) {
    return `<${out} colspan="${n.getAttribute('colspan')}">${inner}</${out}>`;
  }
  if (out === 'div' && !inner.trim()) return '';
  return `<${out}>${inner}</${out}>`;
}

/**
 * DOM node → sanitised HTML: only a fixed set of tags, no attributes except safe href,
 * language-* on code, start on <ol>, colspan; images become text placeholders.
 * @param {any} node @param {ConvertOptions} [opts]
 */
export function toSafeHtml(node, opts = {}) {
  if (!node) return '';
  const s = children(node)
    .map((c) => html(c, opts, isElement(node) && isPreWrap(node)))
    .join('')
    .trim();
  return s.length > LIMITS.messageChars * 2 ? s.slice(0, LIMITS.messageChars * 2).replace(/<[^>]*$/, '') : s;
}
