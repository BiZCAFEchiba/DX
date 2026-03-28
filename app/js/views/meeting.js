// ============================================================
// views/meeting.js - ミーティング一覧・出席登録画面
// ============================================================
var MeetingView = (function () {
  var meetings = [];
  var staff = [];
  var attCache = {};
  var selectedStatus = {};

  function render() {
    var main = document.getElementById('main-content');
    main.innerHTML =
      '<div style="padding:12px 8px 80px;">' +
        '<div style="font-size:1rem;font-weight:700;color:#1a3a5c;margin-bottom:12px;padding:0 4px;">🏢 店舗ミーティング</div>' +
        '<div id="mtg-view-list"><div style="text-align:center;padding:48px;color:#888;">読み込み中...</div></div>' +
      '</div>';

    Promise.all([
      API.getMeetings(),
      API.getMeetingStaffList()
    ]).then(function (results) {
      meetings = (results[0].meetings || []).sort(function (a, b) {
        return a.date.localeCompare(b.date);
      });
      staff = results[1].names || [];
      renderList();
      var today = todayISO();
      meetings.filter(function (m) { return m.date >= today; }).forEach(function (m) {
        loadAtt(m.date);
      });
    }).catch(function () {
      var el = document.getElementById('mtg-view-list');
      if (el) el.innerHTML = '<div style="text-align:center;padding:48px;color:#888;">読み込みに失敗しました</div>';
    });
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function renderList() {
    var el = document.getElementById('mtg-view-list');
    if (!el) return;
    if (!meetings.length) {
      el.innerHTML = '<div style="text-align:center;padding:48px;color:#888;">ミーティングはありません</div>';
      return;
    }
    var today = todayISO();
    var upcoming = meetings.filter(function (m) { return m.date >= today; });
    var past = meetings.filter(function (m) { return m.date < today; });
    var html = '';
    if (upcoming.length) {
      html += '<div style="font-size:0.8rem;font-weight:700;color:#1a3a5c;margin-bottom:8px;padding:0 4px;">今後のミーティング</div>';
      upcoming.forEach(function (m) { html += cardHtml(m, false); });
    }
    if (past.length) {
      html += '<div style="font-size:0.8rem;font-weight:700;color:#999;margin:16px 0 8px;padding:0 4px;">過去のミーティング</div>';
      past.forEach(function (m) { html += cardHtml(m, true); });
    }
    el.innerHTML = html;
    meetings.forEach(function (m) {
      if (attCache[m.date]) updateSummary(m.date);
    });
  }

  function cardHtml(m, isPast) {
    var d = new Date(m.date + 'T00:00:00');
    var dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    var dateLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';
    var bufStart = addMin(m.startTime, -60);
    var bufEnd   = addMin(m.endTime, 60);
    var nameOpts = '<option value="">-- 名前を選択 --</option>' +
      staff.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');

    return '<div class="meeting-card" style="margin-bottom:12px;">'
      + '<div class="meeting-card-header">'
      +   '<span style="font-size:1.1rem;">🏢</span>'
      +   '<span class="meeting-card-title">' + dateLabel + ' 店舗ミーティング</span>'
      +   '<span style="margin-left:auto;font-size:0.8rem;color:#92400e;font-weight:600;">' + esc(m.startTime) + '〜' + esc(m.endTime) + '</span>'
      + '</div>'
      + '<div class="meeting-card-body">'
      +   '<div class="meeting-time-row">⏰ ' + esc(m.startTime) + ' 〜 ' + esc(m.endTime) + '</div>'
      +   '<div class="meeting-buffer">🔒 貸切: ' + bufStart + ' 〜 ' + bufEnd + '</div>'
      +   (m.note ? '<div class="meeting-note">📝 ' + esc(m.note) + '</div>' : '')
      +   '<div class="meeting-att-summary" id="mtg-att-' + m.date + '">'
      +     (isPast ? '<span class="meeting-att-empty">読み込み中...</span>' : '<span class="meeting-att-empty">読み込み中...</span>')
      +   '</div>'
      +   (!isPast
          ? '<div class="meeting-form">'
          +   '<div class="meeting-form-title">参加を登録する</div>'
          +   '<select class="meeting-name-select" id="mtg-name-' + m.date + '" onchange="MeetingView.onNameChange(\'' + m.date + '\')">' + nameOpts + '</select>'
          +   '<div class="meeting-status-row">'
          +     '<button class="meeting-status-btn" id="mtg-attend-' + m.date + '" onclick="MeetingView.setStatus(\'' + m.date + '\',\'対面参加\')">👥 対面参加</button>'
          +     '<button class="meeting-status-btn" id="mtg-online-' + m.date + '" onclick="MeetingView.setStatus(\'' + m.date + '\',\'オンライン参加\')">💻 オンライン</button>'
          +     '<button class="meeting-status-btn" id="mtg-absent-' + m.date + '" onclick="MeetingView.setStatus(\'' + m.date + '\',\'不参加\')">❌ 不参加</button>'
          +   '</div>'
          +   '<div id="mtg-reason-wrap-' + m.date + '" style="display:none;">'
          +     '<input class="meeting-reason-input" type="text" id="mtg-reason-' + m.date + '" placeholder="不参加の理由（必須）">'
          +   '</div>'
          +   '<button class="meeting-submit-btn" id="mtg-submit-' + m.date + '" onclick="MeetingView.submit(\'' + m.date + '\')" disabled>登録する</button>'
          +   '<div class="meeting-form-msg" id="mtg-msg-' + m.date + '"></div>'
          + '</div>'
          : '')
      + '</div>'
      + '</div>';
  }

  function loadAtt(date) {
    if (attCache[date]) { updateSummary(date); restoreStatus(date); return; }
    API.getMeetingAttendance(date).then(function (res) {
      attCache[date] = res.attendances || [];
      updateSummary(date);
      restoreStatus(date);
    }).catch(function () {
      var el = document.getElementById('mtg-att-' + date);
      if (el) el.innerHTML = '<span class="meeting-att-empty">読み込み失敗</span>';
    });
  }

  function updateSummary(date) {
    var el = document.getElementById('mtg-att-' + date);
    if (!el) return;
    var atts = attCache[date] || [];
    if (!atts.length) {
      el.innerHTML = '<span class="meeting-att-empty">まだ登録がありません</span>';
      return;
    }
    var inP = atts.filter(function (a) { return a.status === '対面参加'; });
    var onl = atts.filter(function (a) { return a.status === 'オンライン参加'; });
    var abs = atts.filter(function (a) { return a.status === '不参加'; });
    var html = '';
    if (inP.length) html += '<div class="meeting-att-group"><strong>👥 対面:</strong> ' + inP.map(function (a) { return esc(a.staffName); }).join('、') + '</div>';
    if (onl.length) html += '<div class="meeting-att-group"><strong>💻 オンライン:</strong> ' + onl.map(function (a) { return esc(a.staffName); }).join('、') + '</div>';
    if (abs.length) html += '<div class="meeting-att-group"><strong>❌ 不参加:</strong> ' + abs.map(function (a) { return esc(a.staffName) + (a.reason ? '（' + esc(a.reason) + '）' : ''); }).join('、') + '</div>';
    el.innerHTML = html;
  }

  function restoreStatus(date) {
    var nameEl = document.getElementById('mtg-name-' + date);
    if (!nameEl || !nameEl.value) return;
    var mine = (attCache[date] || []).filter(function (a) { return a.staffName === nameEl.value; })[0];
    if (mine) {
      setStatus(date, mine.status, true);
      if (mine.status === '不参加') {
        var r = document.getElementById('mtg-reason-' + date);
        if (r) r.value = mine.reason || '';
      }
      var msg = document.getElementById('mtg-msg-' + date);
      if (msg) msg.innerHTML = '<span style="color:#16a34a;">✅ 登録済みです。変更して再登録できます。</span>';
    }
  }

  function onNameChange(date) {
    var nameEl = document.getElementById('mtg-name-' + date);
    var submitBtn = document.getElementById('mtg-submit-' + date);
    if (!nameEl || !submitBtn) return;
    if (!nameEl.value) {
      submitBtn.disabled = true;
      selectedStatus[date] = null;
      clearBtns(date);
      return;
    }
    submitBtn.disabled = !selectedStatus[date];
    if (attCache[date]) {
      restoreStatus(date);
    } else {
      loadAtt(date);
    }
  }

  function clearBtns(date) {
    ['attend', 'online', 'absent'].forEach(function (k) {
      var btn = document.getElementById('mtg-' + k + '-' + date);
      if (btn) btn.className = 'meeting-status-btn';
    });
  }

  function setStatus(date, status, silent) {
    selectedStatus[date] = status;
    clearBtns(date);
    var map = { '対面参加': 'attend', 'オンライン参加': 'online', '不参加': 'absent' };
    var activeBtn = document.getElementById('mtg-' + map[status] + '-' + date);
    if (activeBtn) {
      activeBtn.className = 'meeting-status-btn ' +
        (status === '対面参加' ? 's-attend' : status === 'オンライン参加' ? 's-online' : 's-absent');
    }
    var rw = document.getElementById('mtg-reason-wrap-' + date);
    if (rw) rw.style.display = status === '不参加' ? 'block' : 'none';
    var nameEl = document.getElementById('mtg-name-' + date);
    var submitBtn = document.getElementById('mtg-submit-' + date);
    if (submitBtn) submitBtn.disabled = !(nameEl && nameEl.value);
    if (!silent) {
      var msg = document.getElementById('mtg-msg-' + date);
      if (msg) msg.innerHTML = '';
    }
  }

  function submit(date) {
    var nameEl   = document.getElementById('mtg-name-' + date);
    var reasonEl = document.getElementById('mtg-reason-' + date);
    var msgEl    = document.getElementById('mtg-msg-' + date);
    var submitBtn = document.getElementById('mtg-submit-' + date);
    var name   = nameEl   ? nameEl.value.trim()   : '';
    var status = selectedStatus[date] || '';
    var reason = reasonEl ? reasonEl.value.trim() : '';
    if (!name)   { if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">名前を選択してください</span>'; return; }
    if (!status) { if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">参加区分を選択してください</span>'; return; }
    if (status === '不参加' && !reason) { if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">不参加の理由を入力してください</span>'; return; }
    if (submitBtn) submitBtn.disabled = true;
    if (msgEl) msgEl.innerHTML = '送信中...';
    API.saveMeetingAttendance(date, name, status, reason).then(function () {
      if (msgEl) msgEl.innerHTML = '<span style="color:#16a34a;">✅ 登録しました！</span>';
      attCache[date] = null;
      loadAtt(date);
      if (submitBtn) submitBtn.disabled = false;
    }).catch(function () {
      if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">送信に失敗しました</span>';
      if (submitBtn) submitBtn.disabled = false;
    });
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function addMin(timeStr, minutes) {
    var p = String(timeStr || '00:00').split(':');
    var total = parseInt(p[0] || 0) * 60 + parseInt(p[1] || 0) + minutes;
    total = Math.max(0, total);
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  return {
    render: render,
    onNameChange: onNameChange,
    setStatus: setStatus,
    submit: submit
  };
})();
