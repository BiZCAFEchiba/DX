// ============================================================
// views/calendar.js - シフトカレンダー画面
// ============================================================
var CalendarView = (function () {
  var currentYear, currentMonth, selectedDate, shiftDates, selectedName;

  function render() {
    var now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    selectedDate = formatISO(now);
    shiftDates = {};
    selectedName = '';

    var main = document.getElementById('main-content');
    main.innerHTML =
      '<div class="card" id="cal-card">' +
        '<div class="cal-header">' +
          '<button class="cal-nav-btn" id="cal-prev">◀</button>' +
          '<span class="cal-header-title" id="cal-title"></span>' +
          '<button class="cal-nav-btn" id="cal-next">▶</button>' +
        '</div>' +
        '<div class="cal-grid" id="cal-grid"></div>' +
      '</div>' +
      '<div style="padding:4px 0 8px;">' +
        '<select id="cal-name-filter" style="width:100%;padding:10px 12px;border:1px solid var(--gray-300);border-radius:8px;font-size:0.95rem;background:#fff;">' +
          '<option value="">全員表示</option>' +
        '</select>' +
      '</div>' +
      '<div id="cal-shift-detail"></div>';

    document.getElementById('cal-prev').addEventListener('click', function () {
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
      loadMonth();
    });
    document.getElementById('cal-next').addEventListener('click', function () {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
      loadMonth();
    });
    document.getElementById('cal-name-filter').addEventListener('change', function () {
      selectedName = this.value;
      renderGrid();
      loadDayDetail();
    });

    loadMonth();
  }

  function loadMonth() {
    var from = currentYear + '-' + pad(currentMonth + 1) + '-01';
    var lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    var to = currentYear + '-' + pad(currentMonth + 1) + '-' + pad(lastDay);

    document.getElementById('cal-title').textContent = currentYear + '年' + (currentMonth + 1) + '月';

    API.getShifts(from, to)
      .then(function (res) {
        shiftDates = {};
        var nameSet = {};
        if (res.success && res.data.shifts) {
          res.data.shifts.forEach(function (s) {
            shiftDates[s.date] = s;
            s.staff.forEach(function (st) { nameSet[st.name] = true; });
          });
        }
        var sel = document.getElementById('cal-name-filter');
        if (sel) {
          var current = sel.value;
          sel.innerHTML = '<option value="">全員表示</option>';
          Object.keys(nameSet).sort().forEach(function (n) {
            var opt = document.createElement('option');
            opt.value = n; opt.textContent = n;
            if (n === current) opt.selected = true;
            sel.appendChild(opt);
          });
          selectedName = sel.value;
        }
        renderGrid();
        loadDayDetail();
      })
      .catch(function () { renderGrid(); });
  }

  function renderGrid() {
    var grid = document.getElementById('cal-grid');
    var dows = ['月', '火', '水', '木', '金', '土', '日'];
    var html = '';

    dows.forEach(function (d) { html += '<div class="cal-dow">' + d + '</div>'; });

    var firstDay = new Date(currentYear, currentMonth, 1).getDay();
    var startOffset = (firstDay + 6) % 7;
    var lastDate = new Date(currentYear, currentMonth + 1, 0).getDate();
    var todayStr = formatISO(new Date());

    for (var i = 0; i < startOffset; i++) {
      html += '<div class="cal-day empty"></div>';
    }
    for (var d = 1; d <= lastDate; d++) {
      var dateStr = currentYear + '-' + pad(currentMonth + 1) + '-' + pad(d);
      var classes = 'cal-day';
      if (dateStr === todayStr) classes += ' today';
      if (dateStr === selectedDate) classes += ' selected';

      // 名前フィルター適用時はそのスタッフがいる日だけドット表示
      var dayData = shiftDates[dateStr];
      var hasShift = dayData && dayData.staff && dayData.staff.some(function (s) {
        return !selectedName || s.name === selectedName;
      });
      if (hasShift) classes += ' has-shift';

      html += '<div class="' + classes + '" data-date="' + dateStr + '">' + d + '</div>';
    }

    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day:not(.empty)').forEach(function (el) {
      el.addEventListener('click', function () {
        selectedDate = el.dataset.date;
        renderGrid();
        loadDayDetail();
      });
    });
  }

  function loadDayDetail() {
    var detail = document.getElementById('cal-shift-detail');
    var dayData = shiftDates[selectedDate];

    if (!dayData) {
      var parts = selectedDate.split('-');
      detail.innerHTML =
        '<div class="card"><div class="card-header"><span class="icon">📅</span>' +
        parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日</div>' +
        '<div class="empty-state"><span class="text">シフトデータなし</span></div></div>';
      return;
    }

    var filtered = selectedName
      ? { date: dayData.date, dayOfWeek: dayData.dayOfWeek, staff: dayData.staff.filter(function (s) { return s.name === selectedName; }) }
      : dayData;

    detail.innerHTML = ShiftCard.render(filtered);

    // 変更ボタンにイベントを登録
    detail.querySelectorAll('.btn-edit-shift').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.idx);
        openEditModal(filtered, idx);
      });
    });
  }

  function openEditModal(dayData, staffIdx) {
    var s = dayData.staff[staffIdx];
    var overlay = document.getElementById('modal-overlay');
    var container = document.getElementById('modal-container');

    container.innerHTML =
      '<div class="modal-title">シフト変更 — ' + s.name + '</div>' +
      '<div style="margin-bottom:4px;font-size:0.85rem;color:var(--gray-500);">' +
        dayData.date.replace(/-/g, '/') + '（' + dayData.dayOfWeek + '）' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin:16px 0;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">開始時刻</label>' +
          '<input id="edit-start" type="time" value="' + s.start + '" style="width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:8px;font-size:1rem;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">終了時刻</label>' +
          '<input id="edit-end" type="time" value="' + s.end + '" style="width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:8px;font-size:1rem;">' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="edit-cancel">キャンセル</button>' +
        '<button class="btn btn-primary" id="edit-save">保存</button>' +
      '</div>';

    overlay.hidden = false;

    document.getElementById('edit-cancel').addEventListener('click', function () {
      overlay.hidden = true;
    });

    document.getElementById('edit-save').addEventListener('click', function () {
      var newStart = document.getElementById('edit-start').value;
      var newEnd = document.getElementById('edit-end').value;
      if (!newStart || !newEnd) return;

      var saveBtn = document.getElementById('edit-save');
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      API.updateShift(dayData.date, s.name, newStart, newEnd)
        .then(function (res) {
          overlay.hidden = true;
          if (res.success) {
            // ローカルデータも更新
            var orig = shiftDates[dayData.date];
            if (orig) {
              orig.staff.forEach(function (st) {
                if (st.name === s.name) { st.start = newStart; st.end = newEnd; }
              });
            }
            showToast('シフトを変更しました');
            loadDayDetail();
          } else {
            showToast('エラー: ' + (res.error || '変更に失敗しました'), true);
          }
        })
        .catch(function () {
          overlay.hidden = true;
          showToast('通信エラーが発生しました', true);
        });
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

  function formatISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  return { render: render };
})();
