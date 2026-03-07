// ============================================================
// views/shiftChange.js - シフト交代フォーマット生成画面
// ============================================================
var ShiftChangeView = (function () {
  var pending = null; // カレンダーからセットされるデータ

  function setPending(data) {
    pending = data;
  }

  function render() {
    var main = document.getElementById('main-content');

    if (!pending) {
      main.innerHTML =
        '<div class="card">' +
          '<div class="card-header"><span class="icon">🔄</span>シフト交代フォーマット</div>' +
          '<div class="empty-state">' +
            '<div class="icon">📅</div>' +
            '<div class="text">カレンダーでシフトを変更すると<br>ここにフォーマットが自動作成されます</div>' +
          '</div>' +
        '</div>';
      return;
    }

    var parts = pending.date.split('-');
    var dateDisplay = parts[0] + '.' + parts[1] + '.' + parts[2];

    main.innerHTML =
      '<div class="card">' +
        '<div class="card-header"><span class="icon">🔄</span>シフト交代フォーマット</div>' +
        '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:0.9rem;">' +
          '<tr><td style="padding:8px 0;color:var(--gray-500);width:80px;">交代日</td>' +
              '<td style="padding:8px 0;font-weight:600;">' + dateDisplay + '</td></tr>' +
          '<tr><td style="padding:8px 0;color:var(--gray-500);">交代時間</td>' +
              '<td style="padding:8px 0;font-weight:600;">' + pending.start + '〜' + pending.end + '</td></tr>' +
          '<tr><td style="padding:8px 0;color:var(--gray-500);">交代</td>' +
              '<td style="padding:8px 0;font-weight:600;">' + pending.from + ' → ' + pending.to + '</td></tr>' +
        '</table>' +
        '<div class="form-group">' +
          '<label class="form-label">交代理由</label>' +
          '<textarea id="sc-reason" class="form-input" rows="3" placeholder="〇〇のため" style="resize:none;"></textarea>' +
        '</div>' +
        '<button class="btn btn-primary" id="sc-generate">フォーマットを生成</button>' +
      '</div>' +
      '<div id="sc-result" style="display:none;">' +
        '<div class="card">' +
          '<div class="card-header"><span class="icon">📋</span>コピー用テキスト</div>' +
          '<div id="sc-output" style="background:var(--gray-100);border-radius:8px;padding:16px;font-size:0.9rem;white-space:pre-wrap;line-height:1.8;margin-bottom:12px;"></div>' +
          '<button class="btn btn-outline" id="sc-copy">コピーする</button>' +
        '</div>' +
      '</div>';

    document.getElementById('sc-generate').addEventListener('click', function () { generate(dateDisplay); });
    document.getElementById('sc-copy').addEventListener('click', copyText);
  }

  function generate(dateDisplay) {
    var reason = document.getElementById('sc-reason').value.trim();
    if (!reason) {
      showToast('交代理由を入力してください', true);
      return;
    }

    var text =
      '【交代日】\n' + dateDisplay + '\n' +
      '【交代時間】\n' + pending.start + '-' + pending.end + '\n' +
      '【交代スタッフ】\n' + pending.from + '→' + pending.to + '\n' +
      '【交代理由】\n' + reason + '\n' +
      '【承認者】\n店長代理';

    document.getElementById('sc-output').textContent = text;
    document.getElementById('sc-result').style.display = 'block';
    document.getElementById('sc-result').scrollIntoView({ behavior: 'smooth' });
  }

  function copyText() {
    var text = document.getElementById('sc-output').textContent;
    navigator.clipboard.writeText(text).then(function () {
      showToast('コピーしました');
    }).catch(function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('コピーしました');
    });
  }

  function showToast(msg, isError) {
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    toast.className = 'toast ' + (isError ? 'error' : 'success');
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3000);
  }

  return { render: render, setPending: setPending };
})();
