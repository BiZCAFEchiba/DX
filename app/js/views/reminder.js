// ============================================================
// views/reminder.js - 手動リマインド送信画面
// ============================================================
var ReminderView = (function () {

  function render() {
    Nav.render('settings');

    var tomorrow = new Date(Date.now() + 86400000);
    var defaultDate = formatISO(tomorrow);

    var main = document.getElementById('main-content');
    main.innerHTML =
      '<h2 style="font-size:1.1rem;font-weight:700;margin-bottom:12px;">\u30EA\u30DE\u30A4\u30F3\u30C9\u9001\u4FE1</h2>' +
      '<div class="card">' +
        '<div class="form-group">' +
          '<label class="form-label">\u9001\u4FE1\u5BFE\u8C61\u65E5\u3092\u9078\u629E:</label>' +
          '<input type="date" class="form-input" id="reminder-date" value="' + defaultDate + '">' +
        '</div>' +
        '<button class="btn btn-outline" id="btn-preview">\u30D7\u30EC\u30D3\u30E5\u30FC\u3092\u8868\u793A</button>' +
      '</div>' +
      '<div id="reminder-preview"></div>';

    document.getElementById('btn-preview').addEventListener('click', loadPreview);
    // 初回自動表示
    loadPreview();
  }

  function loadPreview() {
    var dateStr = document.getElementById('reminder-date').value;
    if (!dateStr) {
      Toast.show('\u65E5\u4ED8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044', 'error');
      return;
    }

    var preview = document.getElementById('reminder-preview');
    preview.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>\u8AAD\u307F\u8FBC\u307F\u4E2D...</span></div>';

    API.getPreview(dateStr)
      .then(function (res) {
        if (!res.success) {
          preview.innerHTML = '<div class="card" style="color:var(--error);">' + (res.error || '\u53D6\u5F97\u5931\u6557') + '</div>';
          return;
        }

        var d = res.data;
        if (!d.hasShift) {
          preview.innerHTML = '<div class="card"><div class="empty-state"><span class="icon">\uD83D\uDCC5</span><span class="text">' + d.message + '</span></div></div>';
          return;
        }

        var html = '<div class="card">';
        html += '<div class="card-header"><span class="icon">\uD83D\uDCE8</span>\u9001\u4FE1\u30D7\u30EC\u30D3\u30E5\u30FC</div>';
        html += '<div class="preview-box">' + escHtml(d.messagePreview) + '</div>';
        html += '<p style="font-size:0.85rem;color:var(--gray-500);margin-top:12px;">\u23E9 ' + d.staffCount + '\u540D\u306B\u30E1\u30F3\u30B7\u30E7\u30F3\u9001\u4FE1\u3055\u308C\u307E\u3059</p>';
        html += '<button class="btn btn-primary" id="btn-send" style="margin-top:16px;">\uD83D\uDCE8 LINE WORKS\u306B\u9001\u4FE1</button>';
        html += '<p style="font-size:0.8rem;color:var(--warning);margin-top:8px;text-align:center;">\u26A0\uFE0F \u9001\u4FE1\u5F8C\u306F\u53D6\u308A\u6D88\u305B\u307E\u305B\u3093</p>';
        html += '</div>';

        preview.innerHTML = html;

        document.getElementById('btn-send').addEventListener('click', function () {
          doSend(dateStr);
        });
      })
      .catch(function (err) {
        preview.innerHTML = '<div class="card" style="color:var(--error);">\u901A\u4FE1\u30A8\u30E9\u30FC: ' + err.message + '</div>';
      });
  }

  function doSend(dateStr) {
    var btn = document.getElementById('btn-send');
    btn.disabled = true;
    btn.textContent = '\u9001\u4FE1\u4E2D...';

    API.sendReminder(dateStr)
      .then(function (res) {
        if (res.success) {
          Toast.show(res.data.message, 'success');
          btn.textContent = '\u9001\u4FE1\u5B8C\u4E86 \u2705';
        } else {
          Toast.show(res.error || '\u9001\u4FE1\u306B\u5931\u6557\u3057\u307E\u3057\u305F', 'error');
          btn.disabled = false;
          btn.textContent = '\uD83D\uDCE8 LINE WORKS\u306B\u9001\u4FE1';
        }
      })
      .catch(function (err) {
        Toast.show('\u901A\u4FE1\u30A8\u30E9\u30FC: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '\uD83D\uDCE8 LINE WORKS\u306B\u9001\u4FE1';
      });
  }

  function formatISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  return { render: render };
})();
