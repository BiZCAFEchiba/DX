// ============================================================
// views/shiftChange.js - シフト交代フォーマット生成画面
// ============================================================
var ShiftChangeView = (function () {

  function render() {
    var main = document.getElementById('main-content');
    main.innerHTML =
      '<div class="card">' +
        '<div class="card-header"><span class="icon">🔄</span>シフト交代フォーマット</div>' +
        '<div class="form-group">' +
          '<label class="form-label">交代日</label>' +
          '<input id="sc-date" type="date" class="form-input">' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">交代時間</label>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<input id="sc-start" type="time" class="form-input" style="flex:1;">' +
            '<span style="color:var(--gray-500);">〜</span>' +
            '<input id="sc-end" type="time" class="form-input" style="flex:1;">' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">交代スタッフ</label>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<select id="sc-from" class="form-input" style="flex:1;"></select>' +
            '<span style="color:var(--gray-500);">→</span>' +
            '<select id="sc-to" class="form-input" style="flex:1;"></select>' +
          '</div>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">交代理由</label>' +
          '<textarea id="sc-reason" class="form-input" rows="3" placeholder="〇〇のため" style="resize:none;"></textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">承認者</label>' +
          '<input id="sc-approver" type="text" class="form-input" placeholder="店長代理">' +
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

    loadStaffSelects();

    document.getElementById('sc-generate').addEventListener('click', generate);
    document.getElementById('sc-copy').addEventListener('click', copyText);
  }

  function loadStaffSelects() {
    API.getStaff().then(function (res) {
      if (!res.success || !res.data.staff) return;
      var names = res.data.staff.filter(function (s) { return s.active; }).map(function (s) { return s.name; });
      ['sc-from', 'sc-to'].forEach(function (id) {
        var sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '<option value="">選択してください</option>';
        names.forEach(function (n) {
          var opt = document.createElement('option');
          opt.value = n; opt.textContent = n;
          sel.appendChild(opt);
        });
      });
    }).catch(function () {});
  }

  function generate() {
    var dateVal = document.getElementById('sc-date').value;
    var start = document.getElementById('sc-start').value;
    var end = document.getElementById('sc-end').value;
    var from = document.getElementById('sc-from').value;
    var to = document.getElementById('sc-to').value;
    var reason = document.getElementById('sc-reason').value.trim();
    var approver = document.getElementById('sc-approver').value.trim();

    if (!dateVal || !start || !end || !from || !to || !reason || !approver) {
      showToast('すべての項目を入力してください', true);
      return;
    }
    if (from === to) {
      showToast('交代前後のスタッフが同じです', true);
      return;
    }

    var parts = dateVal.split('-');
    var dateDisplay = parts[0] + '.' + parts[1] + '.' + parts[2];

    var text =
      '【交代日】\n' + dateDisplay + '\n' +
      '【交代時間】\n' + start + '-' + end + '\n' +
      '【交代スタッフ】\n' + from + '→' + to + '\n' +
      '【交代理由】\n' + reason + '\n' +
      '【承認者】\n' + approver;

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

  return { render: render };
})();
