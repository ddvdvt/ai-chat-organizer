import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, toText, toSafeHtml, escapeMd } from '../extension/lib/convert.js';
import { el } from './helpers/dom.js';

const md = (html, o) => toMarkdown(el(html), o);

test('paragraphs, emphasis, inline code, links', () => {
  assert.equal(md('<div><p>Hello <strong>bold</strong> and <em>it</em></p><p>Use <code>a`b</code> <a href="https://x.example/a(b)">here</a></p></div>'), 'Hello **bold** and *it*\n\nUse ``a`b`` [here](<https://x.example/a(b)>)');
  assert.equal(md('<p><a href="javascript:alert(1)">bad</a> <a href="/rel">rel</a></p>'), 'bad rel');
  assert.equal(md('<p><b> spaced </b>x</p>'), '**spaced** x');
});

test('escaping keeps literal markdown characters literal', () => {
  assert.equal(escapeMd('2*3 = 6, snake_case, _x_, `tick`, <div>'), '2\\*3 = 6, snake_case, \\_x\\_, \\`tick\\`, \\<div>');
});

test('headings, hr, blockquote', () => {
  assert.equal(md('<div><h2>Title <em>x</em></h2><hr><blockquote><p>a</p><p>b</p></blockquote></div>'), '## Title *x*\n\n---\n\n> a\n>\n> b');
});

test('code blocks keep exact text and language; fences grow around backticks', () => {
  assert.equal(md('<pre><code class="language-js">const a = 1;\n\n  if (a &lt; 2) {}\n</code></pre>'), '```js\nconst a = 1;\n\n  if (a < 2) {}\n```');
  assert.equal(md('<pre><code>```inner```</code></pre>'), '````\n```inner```\n````');
  assert.equal(md('<pre><code>x</code></pre>', { langOf: () => 'rust' }), '```rust\nx\n```');
  assert.equal(md('<pre><code>   </code></pre>'), '');
});

test('nested lists with start numbers and multi-paragraph items', () => {
  assert.equal(md('<ol start="3"><li>three</li><li><p>four</p><ul><li>a</li><li>b<ul><li>deep</li></ul></li></ul></li></ol>'), '3. three\n4. four\n   - a\n   - b\n     - deep');
});

test('tables: header row, escaped pipes, padding of short rows', () => {
  assert.equal(md('<table><tr><th>A</th><th>B</th></tr><tr><td>1 | 2</td></tr><tr><td><p>x</p><p>y</p></td><td>z</td></tr></table>'), '| A | B |\n| --- | --- |\n| 1 \\| 2 |  |\n| x<br>y | z |');
  assert.equal(toText(el('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>')), 'A\tB\n1\t2');
});

test('maths: KaTeX annotation, data-math, display blocks', () => {
  const katex = '<p>x <span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">a^2</annotation></math></span><span class="katex-html">a2</span></span> y</p>';
  assert.equal(md(katex), 'x $a^2$ y');
  assert.equal(md('<div><div class="katex-display"><span class="katex"><annotation encoding="application/x-tex">\\int f</annotation></span></div></div>'), '$$\n\\int f\n$$');
  assert.equal(md('<div><p>see <span class="math-inline" data-math="E=mc^2">E</span></p><div class="math-block" data-math="x+y"></div></div>'), 'see $E=mc^2$\n\n$$\nx+y\n$$');
});

test('pre-wrap user text keeps line breaks; images become placeholders', () => {
  assert.equal(md('<div class="whitespace-pre-wrap">line 1\nline *2*</div>'), 'line 1  \nline \\*2\\*');
  assert.equal(toText(el('<div class="whitespace-pre-wrap">line 1\nline 2</div>')), 'line 1\nline 2');
  assert.equal(md('<p>pic <img src="https://x/y.png" alt="cat"> <img src="data:x"></p>'), 'pic [image: cat] [image]');
});

test('skip option drops elements; buttons and scripts are always dropped', () => {
  const html = '<div><p>keep</p><div class="copy">Copy</div><button>Copy code</button><script>x()</script><p hidden>h</p></div>';
  assert.equal(md(html, { skip: (n) => (n.getAttribute('class') || '').includes('copy') }), 'keep');
});

test('custom elements act as blocks', () => {
  assert.equal(md('<message-content><div class="markdown"><p>a</p><code-block><pre><code>b</code></pre></code-block></div></message-content>'), 'a\n\n```\nb\n```');
});

test('plain text: no markup, links with addresses', () => {
  assert.equal(toText(el('<div><h3>T</h3><p><strong>b</strong> <a href="https://e.x/">site</a></p><ul><li>a</li></ul><pre><code class="language-py">x = 1</code></pre></div>')), 'T\n\nb site (https://e.x/)\n- a\n\nx = 1');
});

test('safe HTML: whitelist only, attributes dropped, links sanitised', () => {
  const out = toSafeHtml(el('<div><p onclick="x()" style="color:red" class="c">Hi <b>there</b><img src="https://t.example/p.gif" alt="a"></p><a href="javascript:alert(1)">j</a><a href="https://ok.example/?a=1&amp;b=2">ok</a><iframe src="https://e"></iframe><script>alert(1)</script><style>p{}</style><span>s</span><table><tr><td colspan="2">c</td></tr></table></div>'));
  assert.equal(out, '<p>Hi <strong>there</strong><span class="img">[image: a]</span></p>j<a href="https://ok.example/?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">ok</a>s<table><tr><td colspan="2">c</td></tr></table>');
  assert.ok(!/on\w+=|style=|<script|<iframe|javascript:/i.test(out));
});

test('safe HTML: code language kept, text escaped, maths as code', () => {
  assert.equal(toSafeHtml(el('<div><pre><code class="language-html hljs">&lt;b&gt;"x"&lt;/b&gt;</code></pre><span class="math-inline" data-math="a<b">x</span></div>')), '<pre><code class="language-html">&lt;b&gt;&quot;x&quot;&lt;/b&gt;</code></pre><code class="math">a&lt;b</code>');
});
