// Local full-text search over indexed chats. Pure: normalisation, query parsing, matching,
// ranking and highlighted snippets (as segments, so the UI never needs innerHTML).

/**
 * Lower-case, "ё" → "е", unify quotes/dashes, collapse whitespace. Keeps string length stable
 * enough for snippets (one char in → one char out, except NFKC on rare compatibility chars).
 * @param {string} s
 */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[‘’“”«»]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ');
}

/**
 * Parse a query: words, "quoted phrases", -excluded words.
 * @param {string} q
 * @returns {{terms: string[], phrases: string[], exclude: string[]}}
 */
export function parseQuery(q) {
  const src = normalize(q).slice(0, 500);
  const phrases = [];
  const rest = src.replace(/"([^"]+)"/g, (_, p) => {
    const t = p.trim();
    if (t) phrases.push(t);
    return ' ';
  });
  const terms = [];
  const exclude = [];
  for (const w of rest.split(' ')) {
    const word = w.replace(/^[^\p{L}\p{N}#+.-]+|[^\p{L}\p{N}#+]+$/gu, '');
    if (!word) continue;
    if (w.startsWith('-') && word.replace(/^-+/, '')) exclude.push(word.replace(/^-+/, ''));
    else terms.push(word.replace(/^-+/, ''));
  }
  return { terms: [...new Set(terms)].slice(0, 12), phrases: phrases.slice(0, 5), exclude: [...new Set(exclude)].slice(0, 5) };
}

export function isEmptyQuery(pq) {
  return !pq.terms.length && !pq.phrases.length;
}

function countOcc(hay, needle, max = 50) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0 && n < max) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

/**
 * Score a document; 0 = no match. All terms and phrases must occur (in title or body).
 * @param {{title: string, body: string}} doc normalised title and body
 * @param {{terms: string[], phrases: string[], exclude: string[]}} pq
 */
export function scoreDoc(doc, pq) {
  if (isEmptyQuery(pq)) return 0;
  const title = doc.title || '';
  const body = doc.body || '';
  let score = 0;
  for (const t of [...pq.terms, ...pq.phrases]) {
    const inTitle = countOcc(title, t, 5);
    const inBody = countOcc(body, t);
    if (!inTitle && !inBody) return 0;
    const wordStart = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}`, 'u').test(title) ? 4 : 0;
    score += inTitle * 10 + wordStart + Math.min(inBody, 20) + (pq.phrases.includes(t) ? 5 : 0);
  }
  for (const x of pq.exclude) if (title.includes(x) || body.includes(x)) return 0;
  return score;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Highlighted snippet around the first hit, as segments. The original text is used for display;
 * matching runs on its normalised copy (same length for practically all chat text).
 * @param {string} text original text
 * @param {{terms: string[], phrases: string[]}} pq
 * @param {number} [radius]
 * @returns {Array<{text: string, hit: boolean}>}
 */
export function snippet(text, pq, radius = 80) {
  const src = String(text || '').replace(/\s+/g, ' ');
  const norm = normalize(src);
  const same = norm.length === src.length;
  const needles = [...pq.phrases, ...pq.terms].filter(Boolean).sort((a, b) => b.length - a.length);
  let first = -1;
  for (const n of needles) {
    const i = norm.indexOf(n);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  if (!same || first < 0) {
    const t = src.slice(0, radius * 2);
    return [{ text: t + (src.length > t.length ? '…' : ''), hit: false }];
  }
  let start = Math.max(0, first - radius);
  let end = Math.min(src.length, first + radius * 1.5);
  if (start > 0) {
    const sp = src.indexOf(' ', start);
    if (sp > 0 && sp < first) start = sp + 1;
  }
  if (end < src.length) {
    const sp = src.lastIndexOf(' ', end);
    if (sp > first) end = sp;
  }
  // mark all hits inside the window
  const marks = new Array(end - start).fill(false);
  const win = norm.slice(start, end);
  for (const n of needles) {
    let i = win.indexOf(n);
    while (i >= 0) {
      for (let k = i; k < i + n.length && k < marks.length; k++) marks[k] = true;
      i = win.indexOf(n, i + n.length);
    }
  }
  /** @type {Array<{text: string, hit: boolean}>} */
  const segs = [];
  if (start > 0) segs.push({ text: '…', hit: false });
  let cur = '';
  let curHit = marks[0];
  for (let k = 0; k < marks.length; k++) {
    if (marks[k] !== curHit) {
      if (cur) segs.push({ text: cur, hit: curHit });
      cur = '';
      curHit = marks[k];
    }
    cur += src[start + k];
  }
  if (cur) segs.push({ text: cur, hit: curHit });
  if (end < src.length) segs.push({ text: '…', hit: false });
  return segs;
}

/**
 * Search indexed records.
 * @param {Array<{key: string, service: string, title: string, search: string, text?: string, indexedAt?: number}>} records
 *   `search` is the normalised title + body (see searchText)
 * @param {string} query
 * @param {{limit?: number, services?: string[]}} [o]
 * @returns {Array<{key: string, score: number}>}
 */
export function search(records, query, o = {}) {
  const pq = parseQuery(query);
  if (isEmptyQuery(pq)) return [];
  const out = [];
  for (const r of records) {
    if (o.services && o.services.length && !o.services.includes(r.service)) continue;
    const score = scoreDoc({ title: normalize(r.title), body: r.search || '' }, pq);
    if (score > 0) out.push({ key: r.key, score, at: r.indexedAt || 0 });
  }
  out.sort((a, b) => b.score - a.score || b.at - a.at);
  return out.slice(0, o.limit ?? 100).map(({ key, score }) => ({ key, score }));
}

/**
 * Normalised searchable body of a chat (all message texts).
 * @param {Array<{text: string}>} messages
 */
export function searchText(messages) {
  return normalize(messages.map((m) => m.text).join('\n'));
}

/**
 * Original text of the message with the first hit (for the snippet), or the first message.
 * @param {Array<{text: string}>} messages @param {string} query
 */
export function bestMessageText(messages, query) {
  const pq = parseQuery(query);
  const needles = [...pq.phrases, ...pq.terms];
  for (const m of messages) {
    const n = normalize(m.text);
    if (needles.some((x) => n.includes(x))) return m.text;
  }
  return messages[0]?.text || '';
}
