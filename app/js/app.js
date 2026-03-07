// ============================================================
// app.js - アプリ初期化
// ============================================================
var App = (function () {
  var GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzm2gjYNZPZKFXPW-jtOTWDK6_tKEbIsS01gYFGmaPNPQWo1mZuUaYEDmJk6zWxqFaS/exec';

  function init() {
    API.setBaseUrl(GAS_WEB_APP_URL);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }

    CalendarView.render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
