// A DOM-like wrapper over the minidom tree, enough for lib/convert.js and lib/extract.js in node:
// nodeType, nodeName, tagName, childNodes, parentElement, textContent, getAttribute, matches,
// querySelector(All), closest. Read-only.
import { parseHtml, selectAll, textOf, decodeEntities } from './minidom.js';

const cache = new WeakMap();

/** @param {any} n @param {any} root */
function wrap(n, root) {
  if (!n) return null;
  if (cache.has(n)) return cache.get(n);
  const isText = n.tag === '#text';
  const isDoc = n.tag === '#document';
  const w = {
    nodeType: isText ? 3 : isDoc ? 9 : 1,
    nodeName: isText ? '#text' : isDoc ? '#document' : n.tag.toUpperCase(),
    get tagName() {
      return isText || isDoc ? undefined : n.tag.toUpperCase();
    },
    get localName() {
      return isText || isDoc ? undefined : n.tag;
    },
    get childNodes() {
      return n.children.map((c) => wrap(c, root));
    },
    get children() {
      return n.children.filter((c) => c.tag[0] !== '#').map((c) => wrap(c, root));
    },
    get parentElement() {
      return n.parent && n.parent.tag !== '#document' ? wrap(n.parent, root) : null;
    },
    get textContent() {
      if (isText) {
        const p = n.parent;
        return p && (p.tag === 'script' || p.tag === 'style') ? n.text : decodeEntities(n.text || '');
      }
      return textOf(n);
    },
    get nodeValue() {
      return isText ? decodeEntities(n.text || '') : null;
    },
    getAttribute(k) {
      return n.attrs && k.toLowerCase() in n.attrs ? n.attrs[k.toLowerCase()] : null;
    },
    hasAttribute(k) {
      return !!n.attrs && k.toLowerCase() in n.attrs;
    },
    matches(sel) {
      return !isText && selectAll(root, sel).includes(n);
    },
    querySelectorAll(sel) {
      return selectAll(n, sel).map((c) => wrap(c, root));
    },
    querySelector(sel) {
      const r = selectAll(n, sel);
      return r.length ? wrap(r[0], root) : null;
    },
    closest(sel) {
      const set = selectAll(root, sel);
      for (let p = n; p && p.tag !== '#document'; p = p.parent) if (set.includes(p)) return wrap(p, root);
      return null;
    },
    __node: n,
  };
  cache.set(n, w);
  return w;
}

/** Parse HTML into a DOM-like document wrapper. */
export function domFromHtml(html) {
  const root = parseHtml(html);
  const doc = wrap(root, root);
  return doc;
}

/** Parse an HTML fragment and return its first element. */
export function el(html) {
  return domFromHtml(html).children[0];
}
