// ============================================================
// views/logs.js - 送信ログ画面
// ============================================================
var LogsView = (function () {

  function render() {
    Nav.render('settings');

    var main = document.getElementById('main-content');
    main.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<h2 style="font-size:1.1rem;font-weight:700;">\u7BA1\u7406</h2>' +
      '</div>' +
      '<div class="card" style="margin-bottom:12px;">' +
        '<button class="btn btn-primary" id="btn-go-reminder" style="margin-bottom:8px;">\uD83D\uDCE8 \u624B\u52D5\u30EA\u30DE\u30A4\u30F3\u30C9\u9001\u4FE1</button>' +
      '</div>' +
      '<h3 style="font-size:0.95rem;font-weight:700;margin-bottom:8px;">\u9001\u4FE1\u30ED\u30B0</h3>' +
      '<div id="logs-list"><div class="loading-spinner"><div class="spinner"></div><span>\u8AAD\u307F\u8FBC\u307F\u4E2D...</span></div></div>';

    document.getElementById('btn-go-reminder').addEventListener('click', function () {
      App.navigate('reminder');
    });

    API.getLogs(30)
      .then(function (res) {
        if (!res.success) {
          document.getElementById('logs-list').innerHTML = '<div class="card" style="color:var(--error);">' + (res.error || '\u53D6\u5F97\u5931\u6557') + '</div>';
          return;
        }
        renderLogs(res.data.logs);
      })
      .catch(function (err) {
        document.getElementById('logs-list').innerHTML = '<div class="card" style="color:var(--error);">\u901A\u4FE1\u30A8\u30E9\u30FC</div>';
      });
  }

  function renderLogs(logs) {
    var container = document.getElementById('logs-list');

    if (logs.length === 0) {
      container.innerHTML = '<div class="card"><div class="empty-state"><span class="icon">\uD83D\uDCCB</span><span class="text">\u9001\u4FE1\u30ED\u30B0\u304C\u3042\u308A\u307E\u305B\u3093</span></div></div>';
      return;
    }

    var html = '<div class="card">';
    logs.forEach(function (log) {
      var statusIcon = log.result === 'success' ? '\u2705' :
                       log.result === 'error' ? '\u274C' : '\u2014';

      var sentAt = log.sentAt ? formatDateTime(log.sentAt) : '';
      var targetDate = log.targetDate ? formatShortDate(log.targetDate) : '';
      var badgeClass = log.method === 'auto' ? 'auto' : 'manual';
      var badgeLabel = log.method === 'auto' ? '\u81EA\u52D5' : '\u624B\u52D5';

      html += '<div class="log-item">';
      html += '<div class="log-header-row">';
      html += '<span class="log-status">' + statusIcon + '</span>';
      html += '<span>' + sentAt + '</span>';
      html += '<span class="log-badge ' + badgeClass + '">' + badgeLabel + '</span>';
      html += '</div>';
      html += '<div class="log-detail">\u2192 ' + targetDate + ' ' + log.staffCount + '\u540D';
      if (log.detail && log.detail !== '\u6B63\u5E38\u9001\u4FE1') {
        html += ' / ' + escHtml(log.detail);
      }
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;
  }

  function formatDateTime(isoStr) {
    try {
      var d = new Date(isoStr);
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return isoStr; }
  }

  function formatShortDate(dateStr) {
    var parts = dateStr.split('-');
    if (parts.length === 3) {
      var d = new Date(dateStr + 'T00:00:00');
      var dow = ['\u65E5', '\u6708', '\u706B', '\u6C34', '\u6728', '\u91D1', '\u571F'][d.getDay()];
      return parseInt(parts[1]) + '/' + parseInt(parts[2]) + '(' + dow + ')';
    }
    return dateStr;
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  return { render: render };
})();
