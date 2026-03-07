// ============================================================
// views/calendar.js - シフトカレンダー画面
// ============================================================
var CalendarView = (function () {
  var currentYear, currentMonth, selectedDate, shiftDates, selectedName, allStaff;

  function render() {
    var now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    selectedDate = formatISO(now);
    shiftDates = {};
    selectedName = '';
    allStaff = [];

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

    API.getStaff().then(function (res) {
      if (res.success && res.data.staff) {
        allStaff = res.data.staff.filter(function (s) { return s.active; }).map(function (s) { return s.name; });
        populateNameFilter();
      }
    }).catch(function () {});

    loadMonth();
  }

  function populateNameFilter() {
    var sel = document.getElementById('cal-name-filter');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">全員表示</option>';
    allStaff.forEach(function (n) {
      var opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      if (n === current) opt.selected = true;
      sel.appendChild(opt);
    });
    selectedName = sel.value;
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
        // スタッフシートが読み込まれていない場合のみ月内スタッフで補完
        if (allStaff.length === 0) {
          allStaff = Object.keys(nameSet).sort();
          populateNameFilter();
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
      var dow = getDow(selectedDate);
      dayData = { date: selectedDate, dayOfWeek: dow, staff: [] };
    }

    var filtered = selectedName
      ? { date: dayData.date, dayOfWeek: dayData.dayOfWeek, staff: dayData.staff.filter(function (s) { return s.name === selectedName; }) }
      : dayData;

    detail.innerHTML = ShiftCard.render(filtered);

    detail.querySelectorAll('.btn-edit-shift').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openEditModal(filtered, parseInt(btn.dataset.idx));
      });
    });

    detail.querySelectorAll('.btn-delete-shift').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = filtered.staff[parseInt(btn.dataset.idx)];
        if (!confirm(s.name + ' のシフトを削除しますか？')) return;
        API.deleteShift(filtered.date, s.name)
          .then(function (res) {
            if (res.success) {
              removeFromLocal(filtered.date, s.name);
              showToast('削除しました');
              loadDayDetail();
              renderGrid();
            } else {
              showToast('エラー: ' + (res.error || '削除に失敗しました'), true);
            }
          })
          .catch(function () { showToast('通信エラー', true); });
      });
    });

    detail.querySelector('.btn-add-shift').addEventListener('click', function () {
      openAddModal(dayData);
    });
  }

  // 全スタッフ名を収集（月内の全データから）
  function allStaffNames() {
    var names = {};
    Object.values(shiftDates).forEach(function (d) {
      d.staff.forEach(function (s) { names[s.name] = true; });
    });
    return Object.keys(names).sort();
  }

  function staffSelectHtml(id, selectedValue) {
    var names = allStaff.length > 0 ? allStaff : allStaffNames();
    var html = '<select id="' + id + '" style="width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:8px;font-size:1rem;box-sizing:border-box;">';
    html += '<option value="">選択してください</option>';
    names.forEach(function (n) {
      html += '<option value="' + n + '"' + (n === selectedValue ? ' selected' : '') + '>' + n + '</option>';
    });
    html += '</select>';
    return html;
  }

  function openEditModal(dayData, staffIdx) {
    var s = dayData.staff[staffIdx];
    var overlay = document.getElementById('modal-overlay');
    var container = document.getElementById('modal-container');

    container.innerHTML =
      '<div class="modal-title">シフト編集</div>' +
      '<div style="margin-bottom:12px;font-size:0.85rem;color:var(--gray-500);">' +
        dayData.date.replace(/-/g, '/') + '（' + dayData.dayOfWeek + '）' +
      '</div>' +
      '<div style="margin-bottom:12px;">' +
        '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">スタッフ名</label>' +
        staffSelectHtml('edit-name', s.name) +
      '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
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

    document.getElementById('edit-cancel').addEventListener('click', function () { overlay.hidden = true; });
    document.getElementById('edit-save').addEventListener('click', function () {
      var newName = document.getElementById('edit-name').value.trim();
      var newStart = document.getElementById('edit-start').value;
      var newEnd = document.getElementById('edit-end').value;
      if (!newName || !newStart || !newEnd) { showToast('全項目を入力してください', true); return; }

      var saveBtn = document.getElementById('edit-save');
      saveBtn.disabled = true; saveBtn.textContent = '保存中...';

      API.updateShift(dayData.date, s.name, newName, newStart, newEnd)
        .then(function (res) {
          overlay.hidden = true;
          if (res.success) {
            updateLocal(dayData.date, s.name, newName, newStart, newEnd);
            if (newName !== s.name) {
              ShiftChangeView.setPending({ date: dayData.date, start: newStart, end: newEnd, from: s.name, to: newName });
            }
            showToast('変更しました');
            loadDayDetail(); renderGrid();
          } else {
            showToast('エラー: ' + (res.error || '変更に失敗しました'), true);
          }
        })
        .catch(function () { overlay.hidden = true; showToast('通信エラー', true); });
    });
  }

  function openAddModal(dayData) {
    var overlay = document.getElementById('modal-overlay');
    var container = document.getElementById('modal-container');

    container.innerHTML =
      '<div class="modal-title">スタッフを追加</div>' +
      '<div style="margin-bottom:12px;font-size:0.85rem;color:var(--gray-500);">' +
        dayData.date.replace(/-/g, '/') + '（' + dayData.dayOfWeek + '）' +
      '</div>' +
      '<div style="margin-bottom:12px;">' +
        '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">スタッフ名</label>' +
        staffSelectHtml('add-name', '') +
      '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">開始時刻</label>' +
          '<input id="add-start" type="time" style="width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:8px;font-size:1rem;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">終了時刻</label>' +
          '<input id="add-end" type="time" style="width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:8px;font-size:1rem;">' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="add-cancel">キャンセル</button>' +
        '<button class="btn btn-primary" id="add-save">追加</button>' +
      '</div>';

    overlay.hidden = false;

    document.getElementById('add-cancel').addEventListener('click', function () { overlay.hidden = true; });
    document.getElementById('add-save').addEventListener('click', function () {
      var name = document.getElementById('add-name').value.trim();
      var start = document.getElementById('add-start').value;
      var end = document.getElementById('add-end').value;
      if (!name || !start || !end) { showToast('全項目を入力してください', true); return; }

      var saveBtn = document.getElementById('add-save');
      saveBtn.disabled = true; saveBtn.textContent = '追加中...';

      API.addShift(dayData.date, dayData.dayOfWeek, name, start, end)
        .then(function (res) {
          overlay.hidden = true;
          if (res.success) {
            addToLocal(dayData.date, dayData.dayOfWeek, name, start, end);
            showToast('追加しました');
            loadDayDetail(); renderGrid();
          } else {
            showToast('エラー: ' + (res.error || '追加に失敗しました'), true);
          }
        })
        .catch(function () { overlay.hidden = true; showToast('通信エラー', true); });
    });
  }

  // ローカルデータ更新ヘルパー
  function updateLocal(date, origName, newName, newStart, newEnd) {
    if (!shiftDates[date]) return;
    shiftDates[date].staff.forEach(function (s) {
      if (s.name === origName) { s.name = newName; s.start = newStart; s.end = newEnd; }
    });
  }

  function removeFromLocal(date, name) {
    if (!shiftDates[date]) return;
    shiftDates[date].staff = shiftDates[date].staff.filter(function (s) { return s.name !== name; });
  }

  function addToLocal(date, dow, name, start, end) {
    if (!shiftDates[date]) {
      shiftDates[date] = { date: date, dayOfWeek: dow, staff: [] };
    }
    shiftDates[date].staff.push({ name: name, start: start, end: end, tasks: [] });
    shiftDates[date].staff.sort(function (a, b) { return a.start.localeCompare(b.start); });
  }

  function getDow(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
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
