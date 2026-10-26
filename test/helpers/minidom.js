// Test helper copied from marketplace-buyer (same author, MIT).
// A tiny, tolerant HTML tree + CSS selector matcher. Used where no DOM exists: in the
// service worker (background price checks of server-rendered pages) and in node tests.
// Supports: tag, #id, .class, [attr], [attr=v], [attr^=v], [attr$=v], [attr*=v], [attr~=v],
// descendant (" ") and child (">") combinators, selector lists (","). Pure.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
/** Decode HTML entities. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const MAX_NODES = 200000;

/**
 * @typedef {{tag: string, attrs: Record<string,string>, children: MiniNode[], parent: MiniNode|null, text?: string}} MiniNode
 */

function parseAttrs(s) {
  /** @type {Record<string,string>} */
  const out = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/**
 * Parse HTML into a tree. Never throws; malformed markup is closed tolerantly.
 * @param {string} html
 * @returns {MiniNode} the document root (tag "#document")
 */
export function parseHtml(html) {
  /** @type {MiniNode} */
  const root = { tag: '#document', attrs: {}, children: [], parent: null };
  const src = String(html || '');
  let cur = root;
  let i = 0;
  let count = 0;
  const pushText = (t) => {
    if (t) cur.children.push({ tag: '#text', attrs: {}, children: [], parent: cur, text: t });
  };
  while (i < src.length && count < MAX_NODES) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      pushText(src.slice(i));
      break;
    }
    if (lt > i) pushText(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const end = src.indexOf('>', lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(src.slice(lt, lt + 100000));
    if (!m) {
      pushText('<');
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      // closing tag: pop to the matching open element if there is one
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    count++;
    const selfClose = /\/\s*$/.test(m[3]);
    /** @type {MiniNode} */
    const node = { tag, attrs: parseAttrs(m[3].replace(/\/\s*$/, '')), children: [], parent: cur };
    cur.children.push(node);
    if (RAW.has(tag)) {
      const close = src.toLowerCase().indexOf(`</${tag}`, i);
      const end = close < 0 ? src.length : close;
      const raw = src.slice(i, end);
      if (raw) node.children.push({ tag: '#text', attrs: {}, children: [], parent: node, text: raw });
      const gt = close < 0 ? -1 : src.indexOf('>', close);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    if (!VOID.has(tag) && !selfClose) cur = node;
  }
  return root;
}

/** Text content of a node (entities decoded except inside script/style). */
export function textOf(node) {
  if (node.tag === '#text') {
    const p = node.parent;
    return p && (p.tag === 'script' || p.tag === 'style') ? node.text || '' : decodeEntities(node.text || '');
  }
  let s = '';
  for (const c of node.children) s += textOf(c);
  return s;
}

// ---- selectors ----

function splitTop(s, sep) {
  const parts = [];
  let depth = 0;
  let q = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parse one compound selector like `div.a#b[x^="y"]`. Returns null if unsupported. */
function parseCompound(s) {
  const c = { tag: '', id: '', classes: [], attrs: [] };
  const re = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/y;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m || m.index !== i || !m[0]) return null;
    if (m[1]) c.tag = m[1] === '*' ? '' : m[1].toLowerCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || '', value: m[6] ?? m[7] ?? m[8] ?? '' });
    i = re.lastIndex;
  }
  return c;
}

/** @returns {{steps: {comb: string, c: any}[]}|null} */
function parseComplex(s) {
  const tokens = s.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
  const steps = [];
  let comb = ' ';
  for (const t of tokens) {
    if (t === '>') {
      comb = '>';
      continue;
    }
    const c = parseCompound(t);
    if (!c) return null;
    steps.push({ comb, c });
    comb = ' ';
  }
  return steps.length ? { steps } : null;
}

function matchCompound(n, c) {
  if (n.tag.startsWith('#')) return false;
  if (c.tag && n.tag !== c.tag) return false;
  if (c.id && n.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const cls = (n.attrs.class || '').split(/\s+/);
    for (const k of c.classes) if (!cls.includes(k)) return false;
  }
  for (const a of c.attrs) {
    const v = n.attrs[a.name];
    if (v === undefined) return false;
    switch (a.op) {
      case '':
        break;
      case '=':
        if (v !== a.value) return false;
        break;
      case '^=':
        if (!a.value || !v.startsWith(a.value)) return false;
        break;
      case '$=':
        if (!a.value || !v.endsWith(a.value)) return false;
        break;
      case '*=':
        if (!a.value || !v.includes(a.value)) return false;
        break;
      case '~=':
        if (!v.split(/\s+/).includes(a.value)) return false;
        break;
      case '|=':
        if (v !== a.value && !v.startsWith(a.value + '-')) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

// Like the DOM: ancestors may lie outside the element the query starts from.
function matchSteps(n, steps, idx) {
  if (!matchCompound(n, steps[idx].c)) return false;
  if (idx === 0) return true;
  let p = n.parent;
  if (steps[idx].comb === '>') return !!p && matchSteps(p, steps, idx - 1);
  while (p && p.tag !== '#document') {
    if (matchSteps(p, steps, idx - 1)) return true;
    p = p.parent;
  }
  return false;
}

const cache = new Map();
function compile(sel) {
  if (cache.has(sel)) return cache.get(sel);
  const list = splitTop(String(sel), ',').map(parseComplex);
  const compiled = list.every(Boolean) ? list : null;
  if (cache.size > 500) cache.clear();
  cache.set(sel, compiled);
  return compiled;
}

/**
 * querySelectorAll on a mini tree (document order). Unsupported selectors return [].
 * @param {MiniNode} root
 * @param {string} sel
 * @returns {MiniNode[]}
 */
export function selectAll(root, sel) {
  const compiled = compile(sel);
  if (!compiled) return [];
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (c.tag[0] === '#') continue;
      if (compiled.some((x) => matchSteps(c, x.steps, x.steps.length - 1))) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}
