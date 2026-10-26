# Chrome Web Store — Privacy practices & review notes (AI Chat Organizer)

Copy each block into the matching field of the CWS developer dashboard.
`BASE` = the brand site address from `extension/lib/brand.js` (currently `https://ddvdvt.github.io/`).

## Single purpose

AI Chat Organizer helps the user organise and export their own conversations on AI chat sites (chatgpt.com, claude.ai, gemini.google.com): folders, pins and tags for chats, local search over the chats the user has opened, and export of a chat to Markdown/HTML/JSON/TXT/PDF.

## Permission justifications

**storage**
`chrome.storage.local` keeps the user's folders, tags, pins, chat titles/URLs, saved prompts and settings on the device. `chrome.storage.session` hands one chat to the extension's own print page ("Save as PDF") and is cleared when the browser closes. Nothing is synced or sent anywhere.

**scripting**
Used to register the extension's bundled content script (`chrome.scripting.registerContentScripts`) only for the chat sites the user has enabled, and to inject it into tabs of such a site that were already open at the moment of enabling (`chrome.scripting.executeScript` with the bundled file `src/content/loader.js`). No code strings, no remote code.

**Optional host permissions: https://chatgpt.com/\*, https://claude.ai/\*, https://gemini.google.com/\***
None of them is granted at install. Each is requested separately (`chrome.permissions.request`) when the user turns the site on in the popup or settings, and can be revoked there. On an enabled site the content script: shows a small organizer button and panel (in a closed Shadow DOM, the site's DOM is not modified); reads the text of the conversation that is open on the screen when the user exports it, or — if the user keeps the per-site "remember opened chats for search" switch on — saves its title and text locally for search; reads the links of the site's chat list for drag-and-drop into folders; inserts a saved prompt into the input box when the user clicks it. It never calls the sites' APIs and never loads other conversations in the background.

## Remote code

No, I am not using remote code. All JavaScript is packaged with the extension; there are no remote scripts, `eval` or `new Function`, and the default extension CSP is used. The selector config `config/selectors.json` is bundled data (CSS selectors), validated at runtime; it is not downloaded.

## Data usage

What user data do you plan to collect from users now or in the future?
- **Website content** — checked: the text and titles of AI chat conversations the user opens on the enabled sites are stored **locally on the device** (IndexedDB) to provide search and export. They are never transmitted off the device.
- All other categories (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity) — **not collected**.

Note for the reviewer: the dashboard's definition of "collect" is broad; we mark "Website content" because chat text is stored locally, even though nothing leaves the device. If the policy reading is that local-only storage is not collection, this box may be left unchecked — **decision for the publisher**.

Certifications (all three checked):
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

`BASE` + `privacy/ai-chat-organizer.html` → `https://ddvdvt.github.io/privacy/ai-chat-organizer.html`

## Notes for the reviewer (test instructions)

You need an account on at least one of the supported services (a free ChatGPT, Claude or Gemini account is enough). No account for the extension itself.

1. Click the extension icon. Under "Where the extension works", switch on e.g. ChatGPT — Chrome asks for access to chatgpt.com only.
2. Open https://chatgpt.com and any conversation (ideally one with a code block and a table). A small folder button appears on the right edge of the page; click it.
3. In the panel: type a folder name, press "Create", choose the folder in the drop-down next to "Pin", click "Pin". Click "MD" next to "Export" — a Markdown file of the conversation is downloaded; "PDF" opens a print page.
4. Drag a conversation from the site's left sidebar onto the folder in the panel; or hover a sidebar item and click the small folder button that appears.
5. Click "↗" in the panel (or the "Organizer" button in the popup) to open the organizer tab: chats grouped by folder, search box (searches the text of chats you opened), bulk ".zip" export, "Prompts" and "Settings" (per-site switches, including turning off saving chat text for search).
6. Prompts: in the organizer → Prompts → "Add examples"; then on the chat page open the panel → "Prompts" → click a prompt, fill the variable and press "Insert".

After installation the extension opens one static welcome page (`BASE/welcome/ai-chat-organizer.html`); the uninstall URL is a static page (`BASE/bye/ai-chat-organizer.html`). No data or identifiers are added to these URLs.
