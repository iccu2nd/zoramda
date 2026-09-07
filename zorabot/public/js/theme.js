(function () {
  const key = 'zb_theme';
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(key, t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#0f1115' : '#eef0f4';
  }
  function toggle() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    apply(cur === 'dark' ? 'light' : 'dark');
  }
  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('themeBtn');
    if (btn) btn.addEventListener('click', toggle);
  });
  window.zbTheme = { toggle, apply };
})();
