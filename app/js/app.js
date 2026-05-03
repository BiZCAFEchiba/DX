// ============================================================
// app.js - アプリ初期化
// ============================================================
var App = (function () {
  var GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz7-u0KjsXGA8RXjD8eLHA8amJg3oesL_ahcyvbXU7TX53y_qec3MR6pClR6uj5wIPS/exec';
  // ミーティング情報は最新デプロイから取得
  var MEETING_API_URL = 'https://script.google.com/macros/s/AKfycbz7-u0KjsXGA8RXjD8eLHA8amJg3oesL_ahcyvbXU7TX53y_qec3MR6pClR6uj5wIPS/exec';

  function init() {
    API.setBaseUrl(GAS_WEB_APP_URL);
    API.setMeetingUrl(MEETING_API_URL);

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

  function openShiftChange(data) {
    document.querySelectorAll('#bottom-nav .nav-item').forEach(function (b) {
      b.classList.remove('active');
      if (b.dataset.tab === 'shift-change') b.classList.add('active');
    });
    ShiftChangeView.render(data);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { openShiftChange: openShiftChange };
})();
