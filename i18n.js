/* FrontRow VR · Shared i18n utility
 * Usage: call initI18n(translations, i18nMap) with page-specific data.
 * i18nMap: array of {s: CSSselector, k: translationKey, html?: true}
 * data-i18n="key" on any element: updated automatically by setLang()
 * data-i18n-html on element with data-i18n: uses innerHTML instead of textContent
 */
(function () {
  window.initI18n = function (translations, i18nMap) {
    window.setLang = function (lang) {
      var t = translations[lang];
      if (!t) return;
      document.documentElement.lang = lang;
      localStorage.setItem('lang', lang);
      // Selector-based map
      if (i18nMap) {
        i18nMap.forEach(function (item) {
          var el = document.querySelector(item.s);
          if (!el || t[item.k] === undefined) return;
          if (item.html) el.innerHTML = t[item.k];
          else el.textContent = t[item.k];
        });
      }
      // data-i18n attribute approach (for JS-generated content)
      document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var key = el.getAttribute('data-i18n');
        if (t[key] === undefined) return;
        if (el.hasAttribute('data-i18n-html')) el.innerHTML = t[key];
        else el.textContent = t[key];
      });
      // Update toggle button label
      var btn = document.getElementById('langToggle');
      if (btn) btn.textContent = lang === 'es' ? 'EN' : 'ES';
    };
    // Init on DOMContentLoaded (fires after any per-page DOMContentLoaded listeners)
    document.addEventListener('DOMContentLoaded', function () {
      window.setLang(localStorage.getItem('lang') || 'es');
    });
  };
})();
