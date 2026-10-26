# Firefox Add-ons (AMO) — listing and review notes (AI Chat Organizer)

Upload `dist/ai-chat-organizer-<version>-firefox.zip` (built by `npm run zip:firefox`).
Add-on ID: `ai-chat-organizer@ddvdvt.github.io`. Minimum version: Firefox 140.0 (Android: 142.0).
The Russian listing texts can be reused from `listing.ru.md`; the UI is localized (ru, en, kk).

## Name

AI Chat Organizer — folders, search, export

## Summary (≤ 250 characters)

Folders, tags, pins and local full-text search for your AI chats, plus export to Markdown, HTML and PDF. Works on ChatGPT, Claude and Gemini. Everything stays in your browser: no account, no server, site access only for the sites you enable.

## Description

Hundreds of AI chats and no way to find the one you need? This add-on adds a small panel to ChatGPT, Claude and Gemini:

- Folders (nested), pins and colored tags for chats; drag a chat from the site's sidebar onto a folder or use the folder button that appears on hover.
- Local full-text search across the chats you have opened, with highlighted snippets.
- Export a chat to Markdown (code blocks, tables and formulas kept), standalone HTML, JSON, text or PDF (print); bulk export of many chats as a ZIP.
- Prompt library with {{variables}}.
- One organizer page for all three services.

Privacy: no account, analytics or ads, and no network requests. The add-on never calls the chat services' APIs; it only reads the chat you open on the page. All data stays in your browser.

Note: the add-on is not affiliated with OpenAI, Anthropic or Google.

## Categories

- Social & Communication
- Search Tools

## Tags

chatgpt, claude, gemini, folders, export, markdown, search

## Homepage / support

- Homepage: https://ddvdvt.github.io/
- Privacy policy: https://ddvdvt.github.io/privacy/ai-chat-organizer.html (also paste the text of `PRIVACY.md` into the AMO privacy policy field)
- License: MIT

## Data collection (data_collection_permissions)

`"required": ["none"]` — nothing is transmitted to the developer or third parties. Chat text the user opens is indexed locally (IndexedDB of the add-on) for search and export; folders, tags and settings stay in `storage.local`.

## Notes for reviewers

**Source code:** not minified, not bundled, no build step, no remote code. The package is the `extension/` folder of the repository as is; only `manifest.json` is generated for Firefox by `scripts/firefox.mjs` (service worker → event page with the same file, gecko id, `minimum_chrome_version` removed).

**Permissions:**

- `storage` — folders, tags, pins, prompts and settings (`storage.local`); `storage.session` hands a chat to the print page.
- `scripting` — `scripting.registerContentScripts` registers the content script **only** for the sites the user enabled, and injects it into already open tabs of those sites.
- Optional host permissions `https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*` — **none is requested at install.** Each is requested on its own when the user switches that site on in the popup or the organizer; switching it off removes the permission and unregisters the script (also when revoked in about:addons, via `permissions.onRemoved`).
- `web_accessible_resources` (`src/content/*.js`, `lib/*.js`, matched to the three sites only): the content script is a small classic loader that `import()`s the ES-module code of the panel from the add-on.
- The only `fetch` reads `config/selectors.json` bundled in the add-on (page-structure selectors). No network requests.

**How to test:**

1. Click the toolbar button → switch on "ChatGPT" → Firefox asks for access to chatgpt.com → Allow.
2. Open https://chatgpt.com (logged in) and any chat: a folder button appears at the right edge. Create a folder, put the chat in it, pin it.
3. "Export" → Markdown: a .md file with the chat is downloaded. Search tab: find text from the chat.
4. Toolbar button → "Organizer": all chats of the enabled services, folders, search, bulk export.

The add-on also opens a static welcome page on install and sets a static uninstall page (https://ddvdvt.github.io/); nothing is sent to them.
