// Fixture helper: a tiny single-page app. The thread for the current path comes from
// <template id="chat:/path">; clicking a sidebar link swaps the thread and pushes history,
// like the real services do (no reload, the URL changes).
(function () {
  const thread = document.querySelector('[data-fixture-thread]');
  const suffix = document.body.getAttribute('data-title-suffix') || '';
  const home = document.body.getAttribute('data-home-title') || 'New chat';
  function show(path) {
    const tpl = document.getElementById('chat:' + path);
    thread.innerHTML = tpl ? tpl.innerHTML : '';
    document.title = tpl ? tpl.getAttribute('data-title') + suffix : home;
    document.querySelectorAll('[data-fixture-link]').forEach(function (a) {
      const on = a.getAttribute('href') === path;
      a.classList.toggle('selected', on);
      if (on) a.setAttribute('data-active', '');
      else a.removeAttribute('data-active');
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const t = document.querySelector('[data-fixture-title]');
    if (t) t.textContent = tpl ? tpl.getAttribute('data-title') : '';
  }
  document.addEventListener('click', function (e) {
    const a = e.target.closest && e.target.closest('a[data-fixture-link]');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    history.pushState({}, '', a.getAttribute('href'));
    show(a.getAttribute('href'));
  });
  window.addEventListener('popstate', function () {
    show(location.pathname);
  });
  show(location.pathname);
})();
