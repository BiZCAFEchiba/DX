/**
 * シフト交代依頼画面 - 4つのモード(シフト交代・編集・募集・緊急)をタブ切り替え
 */
var ShiftChangeView = (function () {
  var container;
  var currentTab = 'assign'; // 'assign', 'edit', 'recruit'
  var allStaff = [];
  var approvers = []; // G列チェックのスタッフ（承認者）
  var shiftsCache = null; // 全シフトデータのキャッシュ（名前選択ごとの再取得を防ぐ）

  function init(el) {
    container = el;
    render();
  }

  function render(data) {
    if (!container) {
      container = document.getElementById('main-content');
    }
    if (!container) return;

    // スタッフリストをキャッシュまたはAPIから取得
    if (allStaff.length === 0) {
      var cached = localStorage.getItem('cache_staff');
      if (cached) {
        try {
          var parsed = JSON.parse(cached);
          allStaff = parsed.filter(function(s){ return s.active; });
          approvers = parsed.filter(function(s){ return s.isAgent; });
        } catch(e){}
      }
      API.getStaff().then(function(res) {
        if (res.success && res.data && res.data.staff) {
          var list = res.data.staff;
          allStaff = list.filter(function(s){ return s.active; });
          approvers = list.filter(function(s){ return s.isAgent; });
          localStorage.setItem('cache_staff', JSON.stringify(list));
          render(data);
        }
      }).catch(function(){});
    }

    if (data && data.mode) {
      currentTab = data.mode;
    }

    var html = '<div class="card shadow-sm">';
    html += '<div class="card-header"><span class="icon">🔄</span> シフト変更・交代依頼</div>';

    html += '<div style="display:flex; border-bottom:1px solid var(--gray-200); margin-bottom:16px; overflow-x:auto; white-space:nowrap;">';
    html += renderTab('assign', '🔄 交代');
    html += renderTab('edit', '📝 編集・延長');
    html += renderTab('recruit', '📢 募集');
    html += '</div>';

    html += '<div id="shift-change-content">';
    if (currentTab === 'assign') html += renderAssignForm(data);
    else if (currentTab === 'edit') html += renderEditForm(data);
    else if (currentTab === 'recruit') html += renderRecruitForm(data);
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
    attachEvents();
  }

  function renderTab(id, label) {
    var active = (currentTab === id);
    var style = 'flex:1; text-align:center; padding:10px; cursor:pointer; font-size:0.85rem; min-width:80px;';
    if (active) style += ' border-bottom:3px solid var(--primary); color:var(--primary); font-weight:bold;';
    else style += ' color:var(--gray-500);';
    return '<div class="tab-item" data-tab="' + id + '" style="' + style + '">' + label + '</div>';
  }

  // 10分刻みの時間選択UI
  function renderTimeSelect(id, defaultValue) {
    var html = '<select id="' + id + '" class="form-control" style="width:100%; padding:10px;">';
    var defH = defaultValue ? parseInt(defaultValue.split(':')[0]) : 10;
    var defM = defaultValue ? parseInt(defaultValue.split(':')[1]) : 0;
    defM = Math.floor(defM / 10) * 10;
    for (var h = 0; h < 24; h++) {
      for (var m = 0; m < 60; m += 10) {
        var t = (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
        var selected = (h === defH && m === defM) ? ' selected' : '';
        html += '<option value="' + t + '"' + selected + '>' + t + '</option>';
      }
    }
    html += '</select>';
    return html;
  }

  // スタッフ選択ドロップダウン（全スタッフ）
  function renderStaffSelect(id, selectedValue) {
    var html = '<select id="' + id + '" class="form-control" style="width:100%; padding:10px;">';
    html += '<option value="">選択してください</option>';
    allStaff.forEach(function(s) {
      html += '<option value="' + s.name + '"' + (s.name === selectedValue ? ' selected' : '') + '>' + s.name + '</option>';
    });
    html += '</select>';
    return html;
  }

  // 承認者表示（G列チェックのスタッフ・固定表示）
  function renderApproverField() {
    var names = approvers.length > 0
      ? approvers.map(function(s){ return s.name; }).join('、')
      : '（未設定）';
    return renderField(
      '承認者 <span style="font-size:0.75rem; color:var(--gray-400);">※自動通知されます</span>',
      '<div style="padding:10px; background:var(--gray-100); border-radius:6px; font-size:0.9rem; color:var(--gray-700);">' + names + '</div>'
    );
  }

  // --- ① シフト交代フォーム ---
  function renderAssignForm(data) {
    var isAutoFill = !!(data && data.date);
    var html = '<div style="padding:0 16px 16px;">';
    html += '<p style="font-size:0.8rem; color:var(--gray-500); margin-bottom:12px;">他のスタッフにシフトを代わってもらいます。送信するとスプシが自動更新され、通知が飛びます。</p>';

    html += renderField('交代する日', '<input type="date" id="sc-date" class="form-control" value="' + (isAutoFill ? data.date : todayInput()) + '"' + (isAutoFill ? ' readonly style="background:var(--gray-100);"' : '') + '>');
    html += renderField('名前', isAutoFill
      ? '<input type="text" id="sc-orig-staff" class="form-control" value="' + data.originalStaff + '" readonly style="background:var(--gray-100);">'
      : renderStaffSelect('sc-orig-staff', ''));

    var defStart = data && data.originalTime ? data.originalTime.split('-')[0] : '10:00';
    var defEnd   = data && data.originalTime ? data.originalTime.split('-')[1] : '14:00';
    html += '<div style="display:flex; gap:8px;">';
    html += '<div style="flex:1;">' + renderField('開始時間', renderTimeSelect('sc-new-start', defStart)) + '</div>';
    html += '<div style="flex:1;">' + renderField('終了時間', renderTimeSelect('sc-new-end', defEnd)) + '</div>';
    html += '</div>';

    html += renderField('代わりの人', renderStaffSelect('sc-agent-staff', ''));
    html += renderApproverField();
    html += renderField('交代の理由 <span style="color:#ef4444;">*</span>', '<textarea id="sc-reason" class="form-control" rows="2" placeholder="例: 体調不良のため等"></textarea>');
    html += '<button id="sc-submit-assign" class="btn btn-primary" style="width:100%; margin-top:16px;">交代を確定して通知する</button>';
    html += '</div>';
    return html;
  }

  // --- ② 編集・延長フォーム ---
  function renderEditForm(data) {
    var isAutoFill = !!(data && data.date);
    var html = '<div style="padding:0 16px 16px;">';
    html += '<p style="font-size:0.8rem; color:var(--gray-500); margin-bottom:12px;">自分のシフト時間を変更または延長します。送信するとスプシが自動更新されます。</p>';

    html += renderField('該当日', '<input type="date" id="sc-date" class="form-control" value="' + (isAutoFill ? data.date : todayInput()) + '"' + (isAutoFill ? ' readonly style="background:var(--gray-100);"' : '') + '>');
    html += renderField('名前', isAutoFill
      ? '<input type="text" id="sc-orig-staff" class="form-control" value="' + data.originalStaff + '" readonly style="background:var(--gray-100);">'
      : renderStaffSelect('sc-orig-staff', ''));

    var defStart = data && data.originalTime ? data.originalTime.split('-')[0] : '10:00';
    var defEnd   = data && data.originalTime ? data.originalTime.split('-')[1] : '14:00';
    html += '<div style="display:flex; gap:8px;">';
    html += '<div style="flex:1;">' + renderField('変更後の開始', renderTimeSelect('sc-new-start', defStart)) + '</div>';
    html += '<div style="flex:1;">' + renderField('変更後の終了', renderTimeSelect('sc-new-end', defEnd)) + '</div>';
    html += '</div>';

    html += renderField('変更事項・理由 <span style="color:#ef4444;">*</span>', '<textarea id="sc-reason" class="form-control" rows="2" placeholder="例: 30分延長します、11時開始に変更します等"></textarea>');
    html += '<button id="sc-submit-edit" class="btn btn-primary" style="width:100%; margin-top:16px; background:#6366f1;">時間を更新して通知する</button>';
    html += '</div>';
    return html;
  }

  // --- ③ 募集フォーム ---
  function renderRecruitForm(data) {
    var isAutoFill = !!(data && data.date);
    var html = '<div style="padding:0 16px 16px;">';
    html += '<p style="font-size:0.8rem; color:var(--gray-500); margin-bottom:12px;">代わりの人を募集します。カレンダーに「募集中」と表示されます。</p>';

    if (isAutoFill) {
      html += renderField('名前', '<input type="text" id="sc-orig-staff" class="form-control" value="' + data.originalStaff + '" readonly style="background:var(--gray-100);">');
      html += renderField('日付', '<input type="date" id="sc-date" class="form-control" value="' + data.date + '" readonly style="background:var(--gray-100);">');
      var defStart = data.originalTime ? data.originalTime.split('-')[0] : '10:00';
      var defEnd   = data.originalTime ? data.originalTime.split('-')[1] : '14:00';
      html += '<input type="hidden" id="sc-orig-shift-start" value="' + defStart + '"><input type="hidden" id="sc-orig-shift-end" value="' + defEnd + '">';
      html += '<div style="display:flex; gap:8px;">';
      html += '<div style="flex:1;">' + renderField('開始時間', renderTimeSelect('sc-new-start', defStart)) + '</div>';
      html += '<div style="flex:1;">' + renderField('終了時間', renderTimeSelect('sc-new-end', defEnd)) + '</div>';
      html += '</div>';
    } else {
      html += renderField('名前', renderStaffSelect('sc-orig-staff', ''));
      html += '<div id="sc-shift-select-area"></div>';
    }

    html += renderField('募集の理由 <span style="color:#ef4444;">*</span>', '<textarea id="sc-reason" class="form-control" rows="2" placeholder="例: 家庭の事情のため等"></textarea>');
    html += '<button id="sc-submit-recruit" class="btn" style="width:100%; margin-top:16px; background:#eab308; color:#fff;">募集を開始する</button>';
    html += '</div>';
    return html;
  }

  // --- ④ 緊急フォーム ---
  function renderTroubleForm(data) {
    var isAutoFill = !!(data && data.date);
    var html = '<div style="padding:0 16px 16px;">';
    html += '<p style="font-size:0.8rem; color:var(--gray-500); margin-bottom:12px;">当日の遅刻・欠勤などのトラブルを報告します。🚨マーク付きで通知されます。</p>';

    if (isAutoFill) {
      html += renderField('名前', '<input type="text" id="sc-orig-staff" class="form-control" value="' + data.originalStaff + '" readonly style="background:var(--gray-100);">');
      html += renderField('日付', '<input type="date" id="sc-date" class="form-control" value="' + data.date + '" readonly style="background:var(--gray-100);">');
      var defStart = data.originalTime ? data.originalTime.split('-')[0] : '10:00';
      var defEnd   = data.originalTime ? data.originalTime.split('-')[1] : '14:00';
      html += '<div style="display:flex; gap:8px;">';
      html += '<div style="flex:1;">' + renderField('開始時間', renderTimeSelect('sc-new-start', defStart)) + '</div>';
      html += '<div style="flex:1;">' + renderField('終了時間', renderTimeSelect('sc-new-end', defEnd)) + '</div>';
      html += '</div>';
    } else {
      html += renderField('名前', renderStaffSelect('sc-orig-staff', ''));
      html += '<div id="sc-shift-select-area"></div>';
    }

    html += renderField('理由 <span style="color:#ef4444;">*</span>', '<textarea id="sc-reason" class="form-control" rows="2" placeholder="例: 体調不良のため等"></textarea>');
    html += '<button id="sc-submit-trouble" class="btn" style="width:100%; margin-top:16px; background:#ef4444; color:#fff;">🚨 緊急報告を送信</button>';
    html += '</div>';
    return html;
  }

  // 名前選択後にシフト一覧を取得してエリアに描画（シフトデータはキャッシュ再利用）
  function loadShiftsForStaff(staffName) {
    var area = container.querySelector('#sc-shift-select-area');
    if (!area) return;

    if (!staffName) {
      area.innerHTML = '';
      return;
    }

    area.innerHTML = '<p style="font-size:0.8rem; color:var(--gray-400); padding:8px 0;">シフト読込中...</p>';

    function renderFromData(shifts) {
      var staffShifts = [];
      shifts.forEach(function(day) {
        (day.staff || []).forEach(function(s) {
          if (s.name === staffName) {
            staffShifts.push({ date: day.date, start: s.start, end: s.end });
          }
        });
      });

      if (staffShifts.length === 0) {
        area.innerHTML = '<p style="font-size:0.8rem; color:var(--gray-400); padding:4px 0;">今後60日以内のシフトが見つかりません</p>';
        return;
      }

      var selHtml = '<select id="sc-shift-select" class="form-control" style="width:100%; padding:10px;">';
      selHtml += '<option value="">シフトを選択してください</option>';
      staffShifts.forEach(function(s) {
        var d = new Date(s.date + 'T00:00:00');
        var dow = ['日','月','火','水','木','金','土'][d.getDay()];
        var label = (d.getMonth()+1) + '月' + d.getDate() + '日（' + dow + '）　' + s.start + '〜' + s.end;
        var val = s.date + '|' + s.start + '|' + s.end;
        selHtml += '<option value="' + val + '">' + label + '</option>';
      });
      selHtml += '</select>';

      var html = renderField('シフトを選択', selHtml);
      html += '<div id="sc-time-edit-area"></div>';
      area.innerHTML = html;

      area.querySelector('#sc-shift-select').addEventListener('change', function() {
        renderTimeEditArea(this.value);
      });
    }

    // キャッシュがあればAPIを叩かずに即描画
    if (shiftsCache) {
      renderFromData(shiftsCache);
      return;
    }

    var today = todayInput();
    var future = new Date();
    future.setDate(future.getDate() + 60);
    var to = future.toISOString().split('T')[0];

    API.getShifts(today, to).then(function(res) {
      if (!res.success || !res.data || !res.data.shifts) {
        area.innerHTML = '<p style="font-size:0.8rem; color:#ef4444; padding:4px 0;">シフトデータを取得できませんでした</p>';
        return;
      }
      shiftsCache = res.data.shifts;
      renderFromData(shiftsCache);
    }).catch(function() {
      area.innerHTML = '<p style="font-size:0.8rem; color:#ef4444; padding:4px 0;">シフト取得エラー</p>';
    });
  }

  // シフト選択後に日付（固定）＋時間（編集可）を描画
  function renderTimeEditArea(val) {
    var area = container.querySelector('#sc-time-edit-area');
    if (!area) return;
    if (!val) { area.innerHTML = ''; return; }

    var parts = val.split('|');
    var date = parts[0], start = parts[1], end = parts[2];
    var d = new Date(date + 'T00:00:00');
    var dow = ['日','月','火','水','木','金','土'][d.getDay()];
    var dateLabel = (d.getMonth()+1) + '月' + d.getDate() + '日（' + dow + '）';

    var html = renderField('日付', '<div style="padding:10px; background:var(--gray-100); border-radius:6px; font-size:0.9rem; color:var(--gray-700);">' + dateLabel + '</div><input type="hidden" id="sc-date" value="' + date + '"><input type="hidden" id="sc-orig-shift-start" value="' + start + '"><input type="hidden" id="sc-orig-shift-end" value="' + end + '">');
    html += '<div style="display:flex; gap:8px;">';
    html += '<div style="flex:1;">' + renderField('開始時間', renderTimeSelect('sc-new-start', start)) + '</div>';
    html += '<div style="flex:1;">' + renderField('終了時間', renderTimeSelect('sc-new-end', end)) + '</div>';
    html += '</div>';
    area.innerHTML = html;
  }

  function renderField(label, inputHtml) {
    return '<div style="margin-bottom:12px;"><label style="font-size:0.85rem; color:var(--gray-600); display:block; margin-bottom:4px;">' + label + '</label>' + inputHtml + '</div>';
  }

  function attachEvents() {
    container.querySelectorAll('.tab-item').forEach(function(el) {
      el.addEventListener('click', function() {
        currentTab = el.dataset.tab;
        render();
      });
    });

    // 募集・緊急タブ: 名前選択でシフト一覧を動的ロード
    var origStaffSel = container.querySelector('#sc-orig-staff');
    if (origStaffSel && origStaffSel.tagName === 'SELECT' && container.querySelector('#sc-shift-select-area')) {
      origStaffSel.addEventListener('change', function() {
        loadShiftsForStaff(this.value);
      });
    }

    // 交代送信
    var submitAssign = container.querySelector('#sc-submit-assign');
    if (submitAssign) {
      submitAssign.addEventListener('click', function() {
        var p = getUIParams();
        if (!p.origStaff) { showToast('名前を選択してください', true); return; }
        if (!p.agentStaff) { showToast('代わりの人を選択してください', true); return; }
        if (!p.reason.trim()) { showToast('交代の理由を入力してください', true); return; }
        submitAssign.disabled = true; submitAssign.textContent = '更新中...';

        API.notifyShiftChange({
          mode: 'assign',
          date: p.date,
          originalStaff: p.origStaff,
          originalTime: p.origTime,
          agentStaff: p.agentStaff,
          newStart: p.newStart,
          newEnd: p.newEnd,
          reason: p.reason,
          notifyGroup: true,
          notifyAgent: true
        }).then(function(res) {
          if (res.ok) { showToast('シートを更新し、交代通知を送信しました'); }
          else { throw new Error(); }
        }).catch(function() { showToast('エラーが発生しました', true); })
        .finally(function() { submitAssign.disabled = false; submitAssign.textContent = '交代を確定して通知する'; });
      });
    }

    // 編集・延長送信
    var submitEdit = container.querySelector('#sc-submit-edit');
    if (submitEdit) {
      submitEdit.addEventListener('click', function() {
        var p = getUIParams();
        if (!p.origStaff) { showToast('名前を選択してください', true); return; }
        if (!p.reason.trim()) { showToast('変更内容・理由を入力してください', true); return; }
        submitEdit.disabled = true; submitEdit.textContent = '更新中...';

        API.notifyShiftChange({
          mode: 'edit',
          date: p.date,
          originalStaff: p.origStaff,
          originalTime: p.origTime,
          agentStaff: p.origStaff,
          newStart: p.newStart,
          newEnd: p.newEnd,
          reason: p.reason,
          notifyGroup: true
        }).then(function(res) {
          if (res.ok) { showToast('シートを更新し、変更通知を送信しました'); }
          else { throw new Error(); }
        }).catch(function() { showToast('エラーが発生しました', true); })
        .finally(function() { submitEdit.disabled = false; submitEdit.textContent = '時間を更新して通知する'; });
      });
    }

    // 募集送信
    var submitRecruit = container.querySelector('#sc-submit-recruit');
    if (submitRecruit) {
      submitRecruit.addEventListener('click', function() {
        var p = getUIParams();
        if (!p.origStaff) { showToast('名前を選択してください', true); return; }
        if (!p.date) { showToast('シフトを選択してください', true); return; }
        if (!p.reason.trim()) { showToast('理由を入力してください', true); return; }
        submitRecruit.disabled = true; submitRecruit.textContent = '送信中...';
        API.requestShiftRecruitment({ date: p.date, originalStaff: p.origStaff, originalTime: p.newStart + '〜' + p.newEnd, originalStart: p.origShiftStart || p.newStart, recruitStart: p.newStart, recruitEnd: p.newEnd, reason: p.reason })
          .then(function(res) { if (res.ok) { showToast('募集を開始しました'); } else { throw new Error(); }})
          .catch(function() { showToast('募集エラー', true); })
          .finally(function() { submitRecruit.disabled = false; submitRecruit.textContent = '募集を開始する'; });
      });
    }

    // 緊急報告送信
    var submitTrouble = container.querySelector('#sc-submit-trouble');
    if (submitTrouble) {
      submitTrouble.addEventListener('click', function() {
        var p = getUIParams();
        if (!p.origStaff) { showToast('名前を選択してください', true); return; }
        if (!p.date) { showToast('シフトを選択してください', true); return; }
        if (!p.reason.trim()) { showToast('理由を入力してください', true); return; }
        if (!confirm('緊急報告を送信します。よろしいですか？')) return;
        submitTrouble.disabled = true; submitTrouble.textContent = '送信中...';
        API.notifyShiftTrouble({ date: p.date, staffName: p.origStaff, start: p.newStart, end: p.newEnd, reason: p.reason })
          .then(function(res) { if (res.ok) { showToast('緊急報告を送信しました'); } else { throw new Error(); }})
          .catch(function() { showToast('送信エラー', true); })
          .finally(function() { submitTrouble.disabled = false; submitTrouble.textContent = '🚨 緊急報告を送信'; });
      });
    }
  }

  function getUIParams() {
    var dateEl = container.querySelector('#sc-date');
    var startEl = container.querySelector('#sc-new-start');
    var endEl   = container.querySelector('#sc-new-end');
    var agentEl = container.querySelector('#sc-agent-staff');
    var reasonEl = container.querySelector('#sc-reason');
    var origShiftStartEl = container.querySelector('#sc-orig-shift-start');
    var origShiftEndEl   = container.querySelector('#sc-orig-shift-end');
    return {
      date:          dateEl   ? dateEl.value   : '',
      origStaff:     container.querySelector('#sc-orig-staff') ? container.querySelector('#sc-orig-staff').value : '',
      newStart:      startEl  ? startEl.value  : '',
      newEnd:        endEl    ? endEl.value    : '',
      origTime:      startEl && endEl ? startEl.value + '-' + endEl.value : '',
      origShiftStart: origShiftStartEl ? origShiftStartEl.value : '',
      origShiftEnd:   origShiftEndEl   ? origShiftEndEl.value   : '',
      agentStaff:    agentEl ? agentEl.value   : '',
      reason:        reasonEl ? reasonEl.value : ''
    };
  }

  function todayInput() { return new Date().toISOString().split('T')[0]; }

  function showToast(msg, isError) {
    var toast = document.createElement('div');
    toast.style = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); padding:12px 24px; border-radius:30px; color:#fff; font-size:0.9rem; z-index:10000; box-shadow:0 4px 12px rgba(0,0,0,0.15); background:' + (isError ? '#ef4444' : '#10b981');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 3000);
  }

  return { init: init, render: render };
})();
