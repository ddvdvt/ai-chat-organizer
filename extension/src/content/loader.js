// Classic content script (MV3 content scripts can't be ES modules): load the module once.
// Registered only for the chat sites the user enabled in the popup.
(() => {
  try {
    if (globalThis.__aiChatOrganizerLoaded) return;
    globalThis.__aiChatOrganizerLoaded = true;
    import(chrome.runtime.getURL('src/content/main.js'))
      .then((m) => m.start())
      .catch(() => {
        /* never break the host page */
      });
  } catch {
    /* ignore */
  }
})();
