import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, serviceForUrl, chatIdFromUrl, chatKey, parseChatKey, chatUrl, safeChatUrl, originPattern, isServiceId } from '../extension/lib/services.js';

test('three services with exact hosts', () => {
  assert.deepEqual(SERVICES.map((s) => s.host), ['chatgpt.com', 'claude.ai', 'gemini.google.com']);
  assert.equal(originPattern('claude'), 'https://claude.ai/*');
  assert.equal(originPattern('nope'), '');
  assert.ok(isServiceId('gemini'));
  assert.ok(!isServiceId('bard'));
});

test('serviceForUrl matches exact hosts only', () => {
  assert.equal(serviceForUrl('https://chatgpt.com/c/123'), 'chatgpt');
  assert.equal(serviceForUrl('https://claude.ai/chat/x'), 'claude');
  assert.equal(serviceForUrl('https://gemini.google.com/app'), 'gemini');
  assert.equal(serviceForUrl('https://evilchatgpt.com/c/1'), null);
  assert.equal(serviceForUrl('https://chatgpt.com.evil.io/c/1'), null);
  assert.equal(serviceForUrl('ftp://chatgpt.com/'), null);
  assert.equal(serviceForUrl('not a url'), null);
});

test('chat ids from URLs of each service', () => {
  const g = '6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b';
  assert.equal(chatIdFromUrl('chatgpt', `https://chatgpt.com/c/${g}`), g);
  assert.equal(chatIdFromUrl('chatgpt', `https://chatgpt.com/g/g-p-abc123-project/c/${g}?model=x`), g);
  assert.equal(chatIdFromUrl('chatgpt', `/c/${g.toUpperCase()}`), g, 'lower-cased');
  assert.equal(chatIdFromUrl('chatgpt', 'https://chatgpt.com/'), null);
  assert.equal(chatIdFromUrl('chatgpt', `https://claude.ai/c/${g}`), null, 'other host');
  assert.equal(chatIdFromUrl('claude', `https://claude.ai/chat/${g}`), g);
  assert.equal(chatIdFromUrl('claude', 'https://claude.ai/new'), null);
  assert.equal(chatIdFromUrl('gemini', 'https://gemini.google.com/app/1a2b3c4d5e6f7a8b'), '1a2b3c4d5e6f7a8b');
  assert.equal(chatIdFromUrl('gemini', 'https://gemini.google.com/u/1/app/1a2b3c4d5e6f7a8b?hl=ru'), '1a2b3c4d5e6f7a8b');
  assert.equal(chatIdFromUrl('gemini', 'https://gemini.google.com/gem/coding-partner/1a2b3c4d5e6f'), '1a2b3c4d5e6f');
  assert.equal(chatIdFromUrl('gemini', 'https://gemini.google.com/app'), null);
  assert.equal(chatIdFromUrl('gemini', '/app/zz'), null);
});

test('custom patterns from config, invalid ones ignored', () => {
  assert.equal(chatIdFromUrl('claude', 'https://claude.ai/t/abcd1234', ['(', '/t/([a-z0-9]+)']), 'abcd1234');
});

test('keys and URLs', () => {
  assert.equal(chatKey('claude', 'abc'), 'claude:abc');
  assert.deepEqual(parseChatKey('gemini:1a2b'), { service: 'gemini', chatId: '1a2b' });
  assert.equal(parseChatKey('x:1'), null);
  assert.equal(chatUrl('chatgpt', 'abc-1'), 'https://chatgpt.com/c/abc-1');
  assert.equal(chatUrl('gemini', 'ab12'), 'https://gemini.google.com/app/ab12');
  assert.equal(chatUrl('claude', '../x'), '');
  const id = '6f1e2a3b-0c4d-4e5f-8a9b-1c2d3e4f5a6b';
  assert.equal(safeChatUrl('chatgpt', id, `https://chatgpt.com/g/g-1/c/${id}?x=1#y`), `https://chatgpt.com/g/g-1/c/${id}`);
  assert.equal(safeChatUrl('claude', 'abcd1234abcd1234', 'javascript:alert(1)'), 'https://claude.ai/chat/abcd1234abcd1234');
  assert.equal(safeChatUrl('claude', 'abcd1234abcd1234', 'https://evil.example/chat/abcd1234abcd1234'), 'https://claude.ai/chat/abcd1234abcd1234');
});
