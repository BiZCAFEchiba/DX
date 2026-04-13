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
      '<h3 style="font-size:0.95rem;font-weight:700;margin-bottom:8px;">\uD83C\uDFE2 Web\u4F1A\u8B70\u30EB\u30FC\u30E0\u8A2D\u5B9A</h3>' +
      '<div class="card" style="margin-bottom:16px;">' +
        '<div id="room-settings-body"><div class="loading-spinner"><div class="spinner"></div><span>\u8AAD\u307F\u8FBC\u307F\u4E2D...</span></div></div>' +
      '</div>' +
      '<h3 style="font-size:0.95rem;font-weight:700;margin-bottom:8px;">\u9001\u4FE1\u30ED\u30B0</h3>' +
      '<div id="logs-list"><div class="loading-spinner"><div class="spinner"></div><span>\u8AAD\u307F\u8FBC\u307F\u4E2D...</span></div></div>';

    document.getElementById('btn-go-reminder').addEventListener('click', function () {
      App.navigate('reminder');
    });

    API.getRoomSettings()
      .then(function (s) { renderRoomSettings(s); })
      .catch(function () {
        var el = document.getElementById('room-settings-body');
        if (el) el.innerHTML = '<div style="color:var(--error);font-size:0.85rem;">設定の取得に失敗しました</div>';
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

  // ===== ルーム設定 =====
  var blockedDates = [];   // 編集中の予約不可日セット
  var calYear = 0;
  var calMonth = 0;

  function renderRoomSettings(s) {
    var el = document.getElementById('room-settings-body');
    if (!el) return;

    blockedDates = (s.blockedDates || []).slice();
    var now = new Date();
    calYear  = now.getFullYear();
    calMonth = now.getMonth() + 1;

    el.innerHTML =
      // 受付開始日
      '<div style="margin-bottom:14px;">' +
        '<div style="font-size:0.82rem;font-weight:700;color:#555;margin-bottom:6px;">📅 予約受付開始日</div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<input type="date" id="room-open-date" class="form-input" style="flex:1;" value="' + escHtml(s.openDate || '2026-06-01') + '">' +
          '<button class="btn btn-primary btn-sm" id="btn-save-open-date">保存</button>' +
        '</div>' +
        '<div id="room-open-date-msg" style="font-size:0.78rem;min-height:1em;margin-top:4px;"></div>' +
      '</div>' +
      // 受付時間帯
      '<div style="margin-bottom:14px;">' +
        '<div style="font-size:0.82rem;font-weight:700;color:#555;margin-bottom:6px;">⏰ 予約受付時間帯</div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          '<input type="time" id="room-time-start" class="form-input" style="flex:1;" value="' + escHtml(s.timeStart || '') + '" placeholder="09:00">' +
          '<span style="color:#888;flex-shrink:0;">〜</span>' +
          '<input type="time" id="room-time-end" class="form-input" style="flex:1;" value="' + escHtml(s.timeEnd || '') + '" placeholder="21:00">' +
          '<button class="btn btn-primary btn-sm" id="btn-save-time-range">保存</button>' +
        '</div>' +
        '<div style="font-size:0.75rem;color:#888;margin-top:4px;">空欄の場合は営業時間に準じます</div>' +
        '<div id="room-time-range-msg" style="font-size:0.78rem;min-height:1em;margin-top:4px;"></div>' +
      '</div>' +
      // 予約不可期間カレンダー
      '<div>' +
        '<div style="font-size:0.82rem;font-weight:700;color:#555;margin-bottom:6px;">🚫 予約不可日</div>' +
        '<div style="font-size:0.75rem;color:#888;margin-bottom:8px;">日付をタップして不可/解除を切り替えます</div>' +
        '<div id="blocked-cal-wrap"></div>' +
        '<div id="blocked-save-row" style="margin-top:10px;display:flex;gap:8px;align-items:center;">' +
          '<button class="btn btn-primary btn-sm" id="btn-save-blocked">不可日を保存</button>' +
          '<div id="blocked-save-msg" style="font-size:0.78rem;"></div>' +
        '</div>' +
      '</div>';

    document.getElementById('btn-save-open-date').addEventListener('click', function () {
      var val = document.getElementById('room-open-date').value;
      var msg = document.getElementById('room-open-date-msg');
      if (!val) { msg.style.color = 'var(--error)'; msg.textContent = '日付を選択してください'; return; }
      msg.style.color = '#888'; msg.textContent = '保存中...';
      API.setRoomOpenDate(val)
        .then(function (res) {
          msg.style.color = res.ok ? '#16a34a' : 'var(--error)';
          msg.textContent = res.ok ? '保存しました' : (res.error || '保存失敗');
        })
        .catch(function () { msg.style.color = 'var(--error)'; msg.textContent = '通信エラー'; });
    });

    document.getElementById('btn-save-time-range').addEventListener('click', function () {
      var start = document.getElementById('room-time-start').value;
      var end   = document.getElementById('room-time-end').value;
      var msg   = document.getElementById('room-time-range-msg');
      if (!start || !end) { msg.style.color = 'var(--error)'; msg.textContent = '開始・終了を両方入力してください'; return; }
      msg.style.color = '#888'; msg.textContent = '保存中...';
      API.setRoomTimeRange(start, end)
        .then(function (res) {
          var errMsg = { invalid_time: '時刻の形式が正しくありません', start_after_end: '開始が終了より後になっています' };
          msg.style.color = res.ok ? '#16a34a' : 'var(--error)';
          msg.textContent = res.ok ? '保存しました' : (errMsg[res.error] || res.error || '保存失敗');
        })
        .catch(function () { msg.style.color = 'var(--error)'; msg.textContent = '通信エラー'; });
    });

    document.getElementById('btn-save-blocked').addEventListener('click', function () {
      var msg = document.getElementById('blocked-save-msg');
      msg.style.color = '#888'; msg.textContent = '保存中...';
      API.setRoomBlockedDates(blockedDates)
        .then(function (res) {
          msg.style.color = res.ok ? '#16a34a' : 'var(--error)';
          msg.textContent = res.ok ? '保存しました（' + blockedDates.length + '日）' : (res.error || '保存失敗');
        })
        .catch(function () { msg.style.color = 'var(--error)'; msg.textContent = '通信エラー'; });
    });

    renderBlockedCal();
  }

  function renderBlockedCal() {
    var wrap = document.getElementById('blocked-cal-wrap');
    if (!wrap) return;
    var DOW = ['日','月','火','水','木','金','土'];
    var firstDay = new Date(calYear, calMonth - 1, 1).getDay();
    var daysInMonth = new Date(calYear, calMonth, 0).getDate();

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '<button id="cal-prev" style="background:none;border:none;font-size:1.1rem;cursor:pointer;padding:4px 8px;">◀</button>' +
      '<span style="font-weight:700;font-size:0.9rem;">' + calYear + '年' + calMonth + '月</span>' +
      '<button id="cal-next" style="background:none;border:none;font-size:1.1rem;cursor:pointer;padding:4px 8px;">▶</button>' +
    '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center;">';
    DOW.forEach(function(d, i) {
      html += '<div style="font-size:0.72rem;font-weight:700;color:' + (i===0?'#e53e3e':i===6?'#3182ce':'#555') + ';padding:2px 0;">' + d + '</div>';
    });
    for (var i = 0; i < firstDay; i++) html += '<div></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var iso = calYear + '-' + pad2(calMonth) + '-' + pad2(day);
      var blocked = blockedDates.indexOf(iso) !== -1;
      var dow = (firstDay + day - 1) % 7;
      var baseColor = dow === 0 ? '#e53e3e' : dow === 6 ? '#3182ce' : '#333';
      var style = blocked
        ? 'background:#e53e3e;color:#fff;border-radius:50%;font-weight:700;'
        : 'color:' + baseColor + ';';
      html += '<div data-iso="' + iso + '" style="cursor:pointer;padding:5px 2px;font-size:0.82rem;' + style + '">' + day + '</div>';
    }
    html += '</div>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-iso]').forEach(function(cell) {
      cell.addEventListener('click', function() {
        var iso = cell.getAttribute('data-iso');
        var idx = blockedDates.indexOf(iso);
        if (idx === -1) blockedDates.push(iso);
        else blockedDates.splice(idx, 1);
        renderBlockedCal();
      });
    });
    document.getElementById('cal-prev').addEventListener('click', function() {
      calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; } renderBlockedCal();
    });
    document.getElementById('cal-next').addEventListener('click', function() {
      calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; } renderBlockedCal();
    });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

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
