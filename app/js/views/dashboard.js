// ============================================================
// views/dashboard.js - ダッシュボード画面
// ============================================================
var DashboardView = (function () {

  function render() {
    document.getElementById('btn-logout').hidden = false;
    Nav.render('dashboard');

    var main = document.getElementById('main-content');
    main.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>\u8AAD\u307F\u8FBC\u307F\u4E2D...</span></div>';

    var today = new Date();
    var tomorrow = new Date(today.getTime() + 86400000);
    var from = formatISO(today);
    var to = formatISO(tomorrow);

    API.getShifts(from, to)
      .then(function (res) {
        if (!res.success) {
          main.innerHTML = '<div class="empty-state"><span class="icon">\u26A0\uFE0F</span><span class="text">' + (res.error || '\u30C7\u30FC\u30BF\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F') + '</span></div>';
          return;
        }

        var shifts = res.data.shifts;
        var todayStr = from;
        var tomorrowStr = to;

        var todayData = shifts.find(function (s) { return s.date === todayStr; });
        var tomorrowData = shifts.find(function (s) { return s.date === tomorrowStr; });

        var html = '';

        // 今日のシフト
        if (todayData) {
          html += ShiftCard.render(todayData, '\u4ECA\u65E5');
        } else {
          html += '<div class="card"><div class="card-header"><span class="icon">\uD83D\uDCC5</span>\u4ECA\u65E5</div>' +
            '<div class="empty-state"><span class="text">\u30B7\u30D5\u30C8\u30C7\u30FC\u30BF\u306A\u3057</span></div></div>';
        }

        // 明日のシフト
        if (tomorrowData) {
          html += ShiftCard.render(tomorrowData, '\u660E\u65E5');
        } else {
          html += '<div class="card"><div class="card-header"><span class="icon">\uD83D\uDCC5</span>\u660E\u65E5</div>' +
            '<div class="empty-state"><span class="text">\u30B7\u30D5\u30C8\u30C7\u30FC\u30BF\u306A\u3057</span></div></div>';
        }

        // 店長のみ: ステータスカード
        if (Auth.isManager()) {
          html += '<div class="status-card on">' +
            '\u2705 \u81EA\u52D5\u30EA\u30DE\u30A4\u30F3\u30C9: ON\u3000\u6B21\u56DE\u9001\u4FE1: \u660E\u65E5 12:00' +
            '</div>';
        }

        main.innerHTML = html;
      })
      .catch(function (err) {
        main.innerHTML = '<div class="empty-state"><span class="icon">\u26A0\uFE0F</span><span class="text">\u901A\u4FE1\u30A8\u30E9\u30FC: ' + err.message + '</span></div>';
      });
  }

  function formatISO(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  return { render: render };
})();
