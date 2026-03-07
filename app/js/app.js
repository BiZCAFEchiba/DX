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

    document.querySelectorAll('#bottom-nav .nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#bottom-nav .nav-item').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        if (btn.dataset.tab === 'calendar') {
          CalendarView.render();
        } else if (btn.dataset.tab === 'shift-change') {
          ShiftChangeView.render();
        }
      });
    });

    CalendarView.render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
