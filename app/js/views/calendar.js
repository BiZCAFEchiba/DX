// ============================================================
// views/calendar.js - シフトカレンダー画面
// ============================================================
var CalendarView = (function () {
  var currentYear, currentMonth, selectedDate, shiftDates, selectedName, allStaff;
  // 店舗ミーティングデータ
  var meetingByDate = {};   // { 'YYYY-MM-DD': { rowIndex, startTime, endTime, note } }
  var meetingStaff = [];    // スタッフ名リスト
  var attendanceCache = {}; // { 'YYYY-MM-DD': [...] }
  var selectedMtgStatus = {};  // { 'YYYY-MM-DD': status }
  var meetingStaffLoaded = false;
  // 対面Meetupデータ
  var inPersonMeetupByDate = {}; // { 'YYYY-MM-DD': [{company, time, kind}] }

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
      loadMonth(); loadMeetings(); loadInPersonMeetups();
    });
    document.getElementById('cal-next').addEventListener('click', function () {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
      loadMonth(); loadMeetings(); loadInPersonMeetups();
    });
    document.getElementById('cal-name-filter').addEventListener('change', function () {
      selectedName = this.value;
      renderGrid();
      loadDayDetail();
    });

    // スタッフ: キャッシュ即表示 → バックグラウンド更新
    var cachedStaff = localStorage.getItem('cache_staff');
    if (cachedStaff) {
      try {
        allStaff = JSON.parse(cachedStaff);
        populateNameFilter();
      } catch (e) {}
    }
    API.getStaff().then(function (res) {
      if (res.success && res.data.staff) {
        allStaff = res.data.staff.filter(function (s) { return s.active; }).map(function (s) { return s.name; });
        localStorage.setItem('cache_staff', JSON.stringify(allStaff));
        populateNameFilter();
      }
    }).catch(function () {});

    loadMonth();
    loadMeetings();
    loadInPersonMeetups();
  }

  function loadMeetings() {
    API.getMeetings().then(function (res) {
      meetingByDate = {};
      var rows = res.rows || [];
      rows.forEach(function (r) {
        if (r.date) meetingByDate[r.date] = r;
      });
      renderGrid();
    }).catch(function () {});

    if (!meetingStaffLoaded) {
      API.getMeetingStaffList().then(function (res) {
        meetingStaff = res.names || [];
        meetingStaffLoaded = true;
      }).catch(function () {});
    }
  }

  function loadInPersonMeetups() {
    var from = currentYear + '-' + pad(currentMonth + 1) + '-01';
    var lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    var to = currentYear + '-' + pad(currentMonth + 1) + '-' + pad(lastDay);
    API.getInPersonMeetups(from, to).then(function (res) {
      inPersonMeetupByDate = res.meetups || {};
      renderGrid();
    }).catch(function () {});
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

  function applyShifts(shifts) {
    shiftDates = {};
    var nameSet = {};
    shifts.forEach(function (s) {
      shiftDates[s.date] = s;
      s.staff.forEach(function (st) { nameSet[st.name] = true; });
    });
    if (allStaff.length === 0) {
      allStaff = Object.keys(nameSet).sort();
      populateNameFilter();
    }
    renderGrid();
    loadDayDetail();
  }

  function loadMonth() {
    var from = currentYear + '-' + pad(currentMonth + 1) + '-01';
    var lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    var to = currentYear + '-' + pad(currentMonth + 1) + '-' + pad(lastDay);
    var cacheKey = 'cache_shifts_' + currentYear + '_' + pad(currentMonth + 1);

    document.getElementById('cal-title').textContent = currentYear + '年' + (currentMonth + 1) + '月';

    // キャッシュがあれば即表示
    var cached = localStorage.getItem(cacheKey);
    if (cached) {
      try { applyShifts(JSON.parse(cached)); } catch (e) {}
    }

    // バックグラウンドで最新取得・更新
    API.getShifts(from, to)
      .then(function (res) {
        if (res.success && res.data.shifts) {
          localStorage.setItem(cacheKey, JSON.stringify(res.data.shifts));
          applyShifts(res.data.shifts);
        } else if (!cached) {
          renderGrid();
        }
      })
      .catch(function () { if (!cached) renderGrid(); });
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
      var myShift = !!(selectedName && hasShift);
      if (myShift) classes += ' my-shift';
      
      // 曜日のクラス (0:日, 6:土)
      var dowIdx = new Date(dateStr + 'T00:00:00').getDay();
      if (dowIdx === 0) classes += ' dow-sun';
      if (dowIdx === 6) classes += ' dow-sat';

      // 募集中ステータスの有無
      if (dayData && dayData.staff && dayData.staff.some(function(s){ return s.status === '募集中'; })) {
        classes += ' has-recruit';
      }

      var hasShortageFlag = !!(dayData && dayData.shortages && dayData.shortages.length > 0);
      if (hasShortageFlag) classes += ' has-shortage';

      var hasMeeting = !!meetingByDate[dateStr];
      var hasInPerson = !!(inPersonMeetupByDate[dateStr] && inPersonMeetupByDate[dateStr].length > 0);
      if (hasMeeting) classes += ' has-meeting';
      if (hasInPerson) classes += ' has-inperson';
      var badges = '';
      if (hasShortageFlag) badges += '<span class="shortage-badge">不足</span>';
      if (hasInPerson) badges += '<span class="inperson-badge">対面</span>';
      if (hasMeeting) badges += '<span class="meeting-badge">MTG</span>';
      html += '<div class="' + classes + '" data-date="' + dateStr + '">' +
        '<span class="day-num">' + d + '</span>' +
        '<div class="day-badges">' + badges + '</div>' +
        '</div>';
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

    // 店舗ミーティングカードを挿入
    var meeting = meetingByDate[selectedDate];
    if (meeting) {
      var mtgEl = document.createElement('div');
      mtgEl.id = 'meeting-card-wrap';
      mtgEl.innerHTML = buildMeetingCard(meeting);
      detail.insertBefore(mtgEl, detail.firstChild);
      initMeetingCard(meeting);
    }

    // 対面Meetupカードを挿入（最上部）
    var inPersonMeetups = inPersonMeetupByDate[selectedDate];
    if (inPersonMeetups && inPersonMeetups.length > 0) {
      var ipEl = document.createElement('div');
      ipEl.className = 'inperson-meetup-card';
      ipEl.innerHTML =
        '<div class="inperson-meetup-header">🏢 対面Meetup</div>' +
        inPersonMeetups.map(function (m) {
          return '<div class="inperson-meetup-row">' +
            '<span class="inperson-meetup-company">' + m.company + '</span>' +
            (m.time ? '<span class="inperson-meetup-time">' + m.time + '</span>' : '') +
            '</div>';
        }).join('');
      detail.insertBefore(ipEl, detail.firstChild);
    }

    detail.querySelectorAll('.btn-edit-shift').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = filtered.staff[parseInt(btn.dataset.idx)];
        App.openShiftChange({
          mode: 'edit',
          date: filtered.date,
          originalStaff: s.name,
          originalTime: s.start + '-' + s.end
        });
      });
    });

    detail.querySelectorAll('.btn-approve-shift').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = filtered.staff[parseInt(btn.dataset.idx)];
        openApproveModal(filtered, s);
      });
    });

    detail.querySelectorAll('.btn-request-change').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = filtered.staff[parseInt(btn.dataset.idx)];
        App.openShiftChange({
          mode: 'assign',
          date: filtered.date,
          originalStaff: s.name,
          originalTime: s.start + '-' + s.end
        });
      });
    });

    detail.querySelectorAll('.btn-recruit-shift').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = filtered.staff[parseInt(btn.dataset.idx)];
        App.openShiftChange({
          mode: 'recruit',
          date: filtered.date,
          originalStaff: s.name,
          originalTime: s.start + '-' + s.end
        });
      });
    });

    detail.querySelectorAll('.btn-delete-shift').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = filtered.staff[parseInt(btn.dataset.idx)];
        if (!confirm(s.name + ' のシフトを削除しますか？')) return;
        removeFromLocal(filtered.date, s.name);
        showToast('削除しました');
        loadDayDetail();
        renderGrid();
        API.deleteShift(filtered.date, s.name)
          .then(function (res) {
            if (!res.success) {
              showToast('エラー: ' + (res.error || '削除に失敗しました'), true);
              loadMonth();
            }
          })
          .catch(function () { showToast('通信エラー', true); loadMonth(); });
      });
    });

    detail.querySelector('.btn-add-shift').addEventListener('click', function () {
      openAddModal(dayData);
    });

    // シフト不足表示（APIなし・同期）
    renderShortages(detail, dayData);
  }

  function renderShortages(detail, dayData) {
    var shortages = dayData.shortages;
    if (!shortages || shortages.length === 0) return;

    var html = '<div id="shortage-section" style="margin-top:12px; padding:12px; background:#fef3c7; border:1px solid #fbbf24; border-radius:10px;">';
    html += '<div style="font-size:0.85rem; font-weight:bold; color:#d97706; margin-bottom:8px;">⚠️ シフト不足時間帯</div>';
    shortages.forEach(function(slot) {
      html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">';
      html += '<span style="font-size:0.9rem; color:#92400e; font-weight:500;">' + slot + '</span>';
      html += '<button class="btn-shortage-fill" data-slot="' + slot + '" style="font-size:0.8rem; padding:5px 14px; background:#f59e0b; color:#fff; border:none; border-radius:6px; cursor:pointer;">シフトに入る</button>';
      html += '</div>';
    });
    html += '</div>';

    detail.insertAdjacentHTML('beforeend', html);

    detail.querySelectorAll('.btn-shortage-fill').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var parts = btn.dataset.slot.split('〜');
        openShortageModal(dayData, parts[0], parts[1]);
      });
    });
  }

  function openShortageModal(dayData, start, end) {
    var overlay = document.getElementById('modal-overlay');
    var container = document.getElementById('modal-container');

    container.innerHTML =
      '<div class="modal-title">⚠️ シフト補充</div>' +
      '<div style="margin-bottom:12px;font-size:0.85rem;color:var(--gray-500);">' +
        dayData.date.replace(/-/g, '/') + '（' + (dayData.dayOfWeek || getDow(dayData.date)) + '）' +
      '</div>' +
      '<div style="margin-bottom:12px;">' +
        '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">スタッフ名</label>' +
        staffSelectHtml('shortage-name', '') +
      '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">開始時刻</label>' +
          timeSelectHtml('shortage-start', start) +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">終了時刻</label>' +
          timeSelectHtml('shortage-end', end) +
        '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="shortage-cancel">キャンセル</button>' +
        '<button class="btn btn-primary" id="shortage-save">追加して承認者に通知</button>' +
      '</div>';

    overlay.hidden = false;

    document.getElementById('shortage-cancel').addEventListener('click', function() { overlay.hidden = true; });
    document.getElementById('shortage-save').addEventListener('click', function() {
      var name = document.getElementById('shortage-name').value;
      var s    = document.getElementById('shortage-start').value;
      var e    = document.getElementById('shortage-end').value;
      if (!name) { showToast('名前を選択してください', true); return; }

      var dow = dayData.dayOfWeek || getDow(dayData.date);
      addToLocal(dayData.date, dow, name, s, e);
      overlay.hidden = true;
      showToast('追加しました');
      loadDayDetail(); renderGrid();
      API.addShift(dayData.date, dow, name, s, e)
        .then(function(res) {
          if (!res.success) { removeFromLocal(dayData.date, name); showToast('エラー: ' + (res.error || '追加失敗'), true); loadDayDetail(); renderGrid(); return; }
          API.notifyShiftFill({ date: dayData.date, staffName: name, start: s, end: e }).catch(function () {});
        })
        .catch(function() { removeFromLocal(dayData.date, name); showToast('通信エラー', true); loadDayDetail(); renderGrid(); });
    });
  }

  function timeSelectHtml(id, defaultValue) {
    var defH = defaultValue ? parseInt(defaultValue.split(':')[0]) : 10;
    var defM = defaultValue ? parseInt(defaultValue.split(':')[1]) : 0;
    defM = Math.floor(defM / 10) * 10;
    var html = '<select id="' + id + '" style="width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:8px;font-size:1rem;">';
    for (var h = 0; h < 24; h++) {
      for (var m = 0; m < 60; m += 10) {
        var t = (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
        var sel = (h === defH && m === defM) ? ' selected' : '';
        html += '<option value="' + t + '"' + sel + '>' + t + '</option>';
      }
    }
    html += '</select>';
    return html;
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

      addToLocal(dayData.date, dayData.dayOfWeek, name, start, end);
      overlay.hidden = true;
      showToast('追加しました');
      loadDayDetail(); renderGrid();
      API.addShift(dayData.date, dayData.dayOfWeek, name, start, end)
        .then(function (res) {
          if (!res.success) { removeFromLocal(dayData.date, name); showToast('エラー: ' + (res.error || '追加に失敗しました'), true); loadDayDetail(); renderGrid(); return; }
          API.notifyShiftFill({ date: dayData.date, staffName: name, start: start, end: end }).catch(function () {});
        })
        .catch(function () { removeFromLocal(dayData.date, name); showToast('通信エラー', true); loadDayDetail(); renderGrid(); });
    });
  }

  function openApproveModal(dayData, shift) {
    var overlay = document.getElementById('modal-overlay');
    var container = document.getElementById('modal-container');
    container.innerHTML =
      '<div class="modal-title">シフト交代の引受け</div>' +
      '<div style="margin-bottom:12px;font-size:0.85rem;color:var(--gray-500);">元の担当: ' + shift.name + '　' + dayData.date.replace(/-/g, '/') + '</div>' +
      '<div style="margin-bottom:12px;">' +
        '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">あなたの名前</label>' +
        staffSelectHtml('approve-name', '') +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">開始時刻</label>' +
          timeSelectHtml('approve-start', shift.start) +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--gray-500);display:block;margin-bottom:4px;">終了時刻</label>' +
          timeSelectHtml('approve-end', shift.end) +
        '</div>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn" id="approve-cancel">キャンセル</button><button class="btn" style="background:#eab308;color:#fff;" id="approve-save">引受ける</button></div>';

    overlay.hidden = false;
    document.getElementById('approve-cancel').addEventListener('click', function () { overlay.hidden = true; });
    document.getElementById('approve-save').addEventListener('click', function () {
      var agent = document.getElementById('approve-name').value;
      var newStart = document.getElementById('approve-start').value;
      var newEnd   = document.getElementById('approve-end').value;
      if (!agent) { showToast('名前を選択してください', true); return; }
      var btn = document.getElementById('approve-save'); btn.disabled = true; btn.textContent = '送信中...';
      API.approveShiftRecruitment({ date: dayData.date, originalStaff: shift.name, originalTime: newStart + '-' + newEnd, agentStaff: agent })
        .then(function(res) {
          overlay.hidden = true;
          if (res.ok) {
            updateLocal(dayData.date, shift.name, agent, newStart, newEnd);
            shiftDates[dayData.date].staff.forEach(function(s) { if(s.name===agent) { s.status = ''; } });
            showToast('引受け完了しました！'); loadDayDetail(); renderGrid();
          } else { throw new Error(res.error || 'エラー'); }
        }).catch(function(err) { overlay.hidden = true; showToast('エラー: ' + err.message, true); });
    });
  }

  // ローカルデータ更新ヘルパー
  function updateLocal(date, origName, newName, newStart, newEnd) {
    if (!shiftDates[date]) return;
    shiftDates[date].staff.forEach(function (s) {
      if (s.name === origName) { s.name = newName; s.start = newStart; s.end = newEnd; }
    });
  }

  function syncShiftCache() {
    var cacheKey = 'cache_shifts_' + currentYear + '_' + pad(currentMonth + 1);
    var shifts = Object.keys(shiftDates).map(function (k) { return shiftDates[k]; });
    localStorage.setItem(cacheKey, JSON.stringify(shifts));
  }

  function removeFromLocal(date, name) {
    if (!shiftDates[date]) return;
    shiftDates[date].staff = shiftDates[date].staff.filter(function (s) { return s.name !== name; });
    syncShiftCache();
  }

  function addToLocal(date, dow, name, start, end) {
    if (!shiftDates[date]) {
      shiftDates[date] = { date: date, dayOfWeek: dow, staff: [] };
    }
    shiftDates[date].staff.push({ name: name, start: start, end: end, tasks: [] });
    shiftDates[date].staff.sort(function (a, b) { return a.start.localeCompare(b.start); });
    syncShiftCache();
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

  // ===== ミーティングカード =====

  function addMtgMin(timeStr, minutes) {
    var p = String(timeStr || '00:00').split(':');
    var total = parseInt(p[0] || 0) * 60 + parseInt(p[1] || 0) + minutes;
    total = Math.max(0, total);
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  function buildMeetingCard(m) {
    var nameOpts = '<option value="">-- 名前を選択 --</option>'
      + meetingStaff.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');

    return '<div class="meeting-card">'
      + '<div class="meeting-card-header">'
      +   '<span style="font-size:1.2rem;">🏢</span>'
      +   '<span class="meeting-card-title">店舗ミーティング</span>'
      + '</div>'
      + '<div class="meeting-card-body">'
      +   '<div class="meeting-time-row">⏰ ' + esc(m.startTime) + ' 〜 ' + esc(m.endTime) + '</div>'
      +   (m.note ? '<div class="meeting-note">📝 ' + esc(m.note) + '</div>' : '')
      +   '<div class="meeting-att-summary" id="mtg-att-summary">読み込み中...</div>'
      +   '<div class="meeting-form">'
      +     '<div class="meeting-form-title">参加を登録する</div>'
      +     '<select class="meeting-name-select" id="mtg-name-sel" onchange="CalendarView.onMtgNameChange()">'
      +       nameOpts
      +     '</select>'
      +     '<div class="meeting-status-row">'
      +       '<button class="meeting-status-btn" id="mtg-btn-attend" onclick="CalendarView.selectMtgStatus(\'対面参加\')">👥 対面参加</button>'
      +       '<button class="meeting-status-btn" id="mtg-btn-online" onclick="CalendarView.selectMtgStatus(\'オンライン参加\')">💻 オンライン</button>'
      +       '<button class="meeting-status-btn" id="mtg-btn-absent" onclick="CalendarView.selectMtgStatus(\'不参加\')">❌ 不参加</button>'
      +     '</div>'
      +     '<div id="mtg-reason-wrap" style="display:none;">'
      +       '<input class="meeting-reason-input" type="text" id="mtg-reason" placeholder="不参加の理由（必須）">'
      +     '</div>'
      +     '<button class="meeting-submit-btn" id="mtg-submit-btn" onclick="CalendarView.submitMtgAttendance()" disabled>登録する</button>'
      +     '<div class="meeting-form-msg" id="mtg-form-msg"></div>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function initMeetingCard(meeting) {
    var date = meeting.date;
    // 参加状況をロード
    if (attendanceCache[date]) {
      renderAttSummary(date);
    } else {
      API.getMeetingAttendance(date).then(function (res) {
        attendanceCache[date] = res.attendances || [];
        renderAttSummary(date);
        restoreMyStatus(date);
      }).catch(function () {
        var el = document.getElementById('mtg-att-summary');
        if (el) el.innerHTML = '<span class="meeting-att-empty">読み込み失敗</span>';
      });
    }
  }

  function renderAttSummary(date) {
    var el = document.getElementById('mtg-att-summary');
    if (!el) return;
    var atts = attendanceCache[date] || [];
    if (atts.length === 0) {
      el.innerHTML = '<span class="meeting-att-empty">まだ登録がありません</span>';
      return;
    }
    var inPerson = atts.filter(function (a) { return a.status === '対面参加'; });
    var online   = atts.filter(function (a) { return a.status === 'オンライン参加'; });
    var absent   = atts.filter(function (a) { return a.status === '不参加'; });
    var html = '<div class="meeting-att-summary">';
    if (inPerson.length) html += '<div class="meeting-att-group"><strong>👥 対面:</strong> ' + inPerson.map(function (a) { return esc(a.staffName); }).join('、') + '</div>';
    if (online.length)   html += '<div class="meeting-att-group"><strong>💻 オンライン:</strong> ' + online.map(function (a) { return esc(a.staffName); }).join('、') + '</div>';
    if (absent.length)   html += '<div class="meeting-att-group"><strong>❌ 不参加:</strong> ' + absent.map(function (a) { return esc(a.staffName) + (a.reason ? '（' + esc(a.reason) + '）' : ''); }).join('、') + '</div>';
    html += '</div>';
    el.innerHTML = html;
  }

  function restoreMyStatus(date) {
    var nameEl = document.getElementById('mtg-name-sel');
    if (!nameEl || !nameEl.value) return;
    var mine = (attendanceCache[date] || []).filter(function (a) { return a.staffName === nameEl.value; })[0];
    if (mine) {
      selectMtgStatus(mine.status, true);
      if (mine.status === '不参加') {
        var r = document.getElementById('mtg-reason'); if (r) r.value = mine.reason || '';
      }
      var msg = document.getElementById('mtg-form-msg');
      if (msg) msg.innerHTML = '<span style="color:#16a34a;">✅ 登録済みです。変更して再登録できます。</span>';
    }
  }

  function onMtgNameChange() {
    var nameEl = document.getElementById('mtg-name-sel');
    var submitBtn = document.getElementById('mtg-submit-btn');
    if (!nameEl || !submitBtn) return;
    if (!nameEl.value) { submitBtn.disabled = true; return; }

    // 既存登録を確認
    var date = selectedDate;
    var mine = (attendanceCache[date] || []).filter(function (a) { return a.staffName === nameEl.value; })[0];
    if (mine) {
      selectMtgStatus(mine.status, true);
      if (mine.status === '不参加') {
        var r = document.getElementById('mtg-reason'); if (r) r.value = mine.reason || '';
      }
      var msg = document.getElementById('mtg-form-msg');
      if (msg) msg.innerHTML = '<span style="color:#16a34a;">✅ 登録済みです。変更して再登録できます。</span>';
    } else {
      // リセット
      ['attend','online','absent'].forEach(function (k) {
        var b = document.getElementById('mtg-btn-' + k); if (b) b.className = 'meeting-status-btn';
      });
      var rw = document.getElementById('mtg-reason-wrap'); if (rw) rw.style.display = 'none';
      var msg2 = document.getElementById('mtg-form-msg'); if (msg2) msg2.textContent = '';
      delete selectedMtgStatus[date];
    }
    submitBtn.disabled = !selectedMtgStatus[date] && !mine;
  }

  function selectMtgStatus(status, silent) {
    var date = selectedDate;
    selectedMtgStatus[date] = status;
    var classMap = { '対面参加': 's-attend', 'オンライン参加': 's-online', '不参加': 's-absent' };
    var keyMap   = { '対面参加': 'attend',   'オンライン参加': 'online',   '不参加': 'absent' };
    ['attend','online','absent'].forEach(function (k) {
      var b = document.getElementById('mtg-btn-' + k); if (b) b.className = 'meeting-status-btn';
    });
    var key = keyMap[status];
    if (key) { var btn = document.getElementById('mtg-btn-' + key); if (btn) btn.className = 'meeting-status-btn ' + classMap[status]; }
    var rw = document.getElementById('mtg-reason-wrap'); if (rw) rw.style.display = status === '不参加' ? 'block' : 'none';
    var nameEl = document.getElementById('mtg-name-sel');
    var submitBtn = document.getElementById('mtg-submit-btn');
    if (submitBtn && nameEl && nameEl.value) submitBtn.disabled = false;
  }

  function submitMtgAttendance() {
    var nameEl    = document.getElementById('mtg-name-sel');
    var reasonEl  = document.getElementById('mtg-reason');
    var msgEl     = document.getElementById('mtg-form-msg');
    var submitBtn = document.getElementById('mtg-submit-btn');
    var date = selectedDate;
    var name   = nameEl ? nameEl.value : '';
    var status = selectedMtgStatus[date] || '';
    var reason = reasonEl ? reasonEl.value.trim() : '';

    if (!name)   { if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">名前を選択してください</span>'; return; }
    if (!status) { if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">参加区分を選択してください</span>'; return; }
    if (status === '不参加' && !reason) { if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">不参加の理由を入力してください</span>'; return; }

    if (submitBtn) submitBtn.disabled = true;
    if (msgEl) msgEl.innerHTML = '<span style="color:#6b7280;">登録中...</span>';

    API.saveMeetingAttendance(date, name, status, reason)
      .then(function (res) {
        if (res.ok) {
          var atts = attendanceCache[date] || [];
          var idx = -1;
          atts.forEach(function (a, i) { if (a.staffName === name) idx = i; });
          var entry = { staffName: name, status: status, reason: reason };
          if (idx >= 0) atts[idx] = entry; else atts.push(entry);
          attendanceCache[date] = atts;
          renderAttSummary(date);
          if (msgEl) msgEl.innerHTML = '<span style="color:#16a34a;">✅ ' + esc(status) + ' で登録しました</span>';
        } else {
          if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">❌ ' + esc(res.error || 'エラー') + '</span>';
        }
        if (submitBtn) submitBtn.disabled = false;
      })
      .catch(function () {
        if (msgEl) msgEl.innerHTML = '<span style="color:#dc2626;">❌ 通信エラー</span>';
        if (submitBtn) submitBtn.disabled = false;
      });
  }

  return {
    render: render,
    onMtgNameChange: onMtgNameChange,
    selectMtgStatus: selectMtgStatus,
    submitMtgAttendance: submitMtgAttendance
  };
})();
