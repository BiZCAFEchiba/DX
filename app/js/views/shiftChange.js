/**
 * シフト交代依頼画面 - 3つのモード(シフト交代・募集・緊急)をタブ切り替え
 */
var ShiftChangeView = (function () {
  var container;
  var currentTab = 'assign'; // 'assign', 'recruit', 'trouble'
  var shiftAgents = [];

  function init(el) {
    container = el;
    render();
  }

  function render(data) {
    if (!container) {
      container = document.getElementById('main-content');
    }
    if (!container) return;

    // 初回のみ承認者リストを取得
    if (shiftAgents.length === 0) {
      API.getShiftAgents().then(function(res) {
        if (res.ok && res.data) {
          shiftAgents = res.data;
          render(data); // 再描画
        }
      }).catch(function(){});
    }

    var html = '<div class=\"card shadow-sm\">';
    html += '<div class=\"card-header\"><span class=\"icon\">🔄</span> シフト変更・交代依頼</div>';
    
    // タブ切り替え
    html += '<div style=\"display:flex; border-bottom:1px solid var(--gray-200); margin-bottom:16px;\">';
    html += renderTab('assign', '🔄 シフト交代');
    html += renderTab('recruit', '📢 募集をかける');
    html += renderTab('trouble', '🚨 緊急連絡');
    html += '</div>';

    html += '<div id=\"shift-change-content\">';
    if (currentTab === 'assign') html += renderAssignForm(data);
    else if (currentTab === 'recruit') html += renderRecruitForm(data);
    else if (currentTab === 'trouble') html += renderTroubleForm(data);
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;
    attachEvents();
  }

  function renderTab(id, label) {
    var active = (currentTab === id);
    var style = 'flex:1; text-align:center; padding:10px; cursor:pointer; font-size:0.85rem; transition:0.2s;';
    if (active) style += ' border-bottom:3px solid var(--primary); color:var(--primary); font-weight:bold;';
    else style += ' color:var(--gray-500);';
    return '<div class=\"tab-item\" data-tab=\"' + id + '\" style=\"' + style + '\">' + label + '</div>';
  }

  // --- ① シフト交代フォーム ---
  function renderAssignForm(data) {
    var isAutoFill = !!(data && data.date);
    var html = '<div style=\"padding:0 16px 16px;\">';
    html += '<p style=\"font-size:0.8rem; color:var(--gray-500); margin-bottom:12px;\">カレンダーから選択したシフトを交代するために使用します。承認を得ると確定します。</p>';
    
    html += renderField('交代する日', '<input type=\"date\" id=\"sc-date\" class=\"form-control\" value=\"' + (isAutoFill ? data.date : todayInput()) + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    html += renderField('今の担当者', '<input type=\"text\" id=\"sc-orig-staff\" class=\"form-control\" value=\"' + (isAutoFill ? data.originalStaff : '') + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    html += renderField('時間', '<input type=\"text\" id=\"sc-orig-time\" class=\"form-control\" value=\"' + (isAutoFill ? data.originalTime : '') + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    
    // 承認者（G列フラグありスタッフから選択、いなければ全スタッフ）
    var approverDropdown = '<select id=\"sc-agent-staff\" class=\"form-control\" style=\"width:100%; padding:10px;\">';
    if (shiftAgents.length > 0) {
      shiftAgents.forEach(function(n) {
        approverDropdown += '<option value=\"' + n + '\">' + n + '</option>';
      });
    } else {
      approverDropdown += '<option value=\"\">読み込み中...</option>';
    }
    approverDropdown += '</select>';
    html += renderField('承認者', approverDropdown);
    
    html += renderField('交代の理由', '<textarea id=\"sc-reason\" class=\"form-control\" rows=\"3\" placeholder=\"例: 体調不良のため、バスの遅延のため等\"></textarea>');
    html += '<label style=\"display:flex; align-items:center; gap:8px; font-size:0.9rem; margin-top:8px;\"><input type=\"checkbox\" id=\"sc-notify-agent\" checked> 承認者本人へ通知する</label>';
    html += '<button id=\"sc-submit-assign\" class=\"btn btn-primary\" style=\"width:100%; margin-top:16px;\">交代を承認依頼する</button>';
    html += '</div>';
    return html;
  }

  // --- ② 募集フォーム ---
  function renderRecruitForm(data) {
    var isAutoFill = !!(data && data.date);
    var html = '<div style=\"padding:0 16px 16px;\">';
    html += '<p style=\"font-size:0.8rem; color:var(--gray-500); margin-bottom:12px;\">代わりの人を募集する場合に使用します。承認されるまでカレンダーに「募集中」と表示されます。</p>';
    html += renderField('募集する日', '<input type=\"date\" id=\"sc-date\" class=\"form-control\" value=\"' + (isAutoFill ? data.date : todayInput()) + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    html += renderField('あなたの名前', '<input type=\"text\" id=\"sc-orig-staff\" class=\"form-control\" value=\"' + (isAutoFill ? data.originalStaff : '') + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    html += renderField('募集する時間', '<input type=\"text\" id=\"sc-orig-time\" class=\"form-control\" value=\"' + (isAutoFill ? data.originalTime : '') + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    html += renderField('募集の理由', '<textarea id=\"sc-reason\" class=\"form-control\" rows=\"2\"></textarea>');
    html += '<button id=\"sc-submit-recruit\" class=\"btn\" style=\"width:100%; margin-top:16px; background:#eab308; color:#fff;\">募集を開始する</button>';
    html += '</div>';
    return html;
  }

  // --- ③ 緊急連絡フォーム ---
  function renderTroubleForm(data) {
    var isAutoFill = !!(data && data.date);
    var html = '<div style=\"padding:0 16px 16px;\">';
    html += '<p style=\"font-size:0.8rem; color:var(--gray-500); margin-bottom:12px;\">当日の遅刻・欠勤などのトラブルを報告します。🚨マーク付きで即座に通知されます。</p>';
    html += renderField('日付', '<input type=\"date\" id=\"sc-date\" class=\"form-control\" value=\"' + (isAutoFill ? data.date : todayInput()) + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    html += renderField('名前', '<input type=\"text\" id=\"sc-orig-staff\" class=\"form-control\" value=\"' + (isAutoFill ? data.originalStaff : '') + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    html += renderField('時間 (抜ける時間)', '<input type=\"text\" id=\"sc-orig-time\" class=\"form-control\" value=\"' + (isAutoFill ? data.originalTime : '') + '\"' + (isAutoFill ? ' readonly style=\"background:var(--gray-100);\"' : '') + '>');
    html += renderField('理由 (遅延など)', '<textarea id=\"sc-reason\" class=\"form-control\" rows=\"2\"></textarea>');
    html += '<button id=\"sc-submit-trouble\" class=\"btn\" style=\"width:100%; margin-top:16px; background:#ef4444; color:#fff;\">🚨 緊急報告を送信</button>';
    html += '</div>';
    return html;
  }

  function renderField(label, inputHtml) {
    return '<div style=\"margin-bottom:12px;\"><label style=\"font-size:0.85rem; color:var(--gray-600); display:block; margin-bottom:4px;\">' + label + '</label>' + inputHtml + '</div>';
  }

  function attachEvents() {
    container.querySelectorAll('.tab-item').forEach(function(el) {
      el.addEventListener('click', function() {
        currentTab = el.dataset.tab;
        render();
      });
    });

    var submitAssign = container.querySelector('#sc-submit-assign');
    if (submitAssign) {
      submitAssign.addEventListener('click', function() {
        var params = getParams();
        if(!params.date || !params.originalStaff || !params.agentStaff || !params.reason) { showToast('入力が不足しています。必ず理由を入力してください。', true); return; }
        submitAssign.disabled = true; submitAssign.textContent = '送信中...';
        
        var payload = {
          date: params.date,
          originalStaff: params.originalStaff,
          originalTime: params.originalTime,
          agentStaff: params.agentStaff,
          reason: params.reason,
          notifyAgent: container.querySelector('#sc-notify-agent').checked
        };

        API.notifyShiftChange(payload)
          .then(function(res) { if(res.ok) { showToast('承認依頼を送信しました'); } else { throw new Error(); }})
          .catch(function() { showToast('送信エラー', true); })
          .finally(function() { submitAssign.disabled = false; submitAssign.textContent = '交代を承認依頼する'; });
      });
    }

    var submitRecruit = container.querySelector('#sc-submit-recruit');
    if (submitRecruit) {
      submitRecruit.addEventListener('click', function() {
        var params = getParams();
        if(!params.date || !params.originalStaff || !params.originalTime || !params.reason) { showToast('理由を入力してください', true); return; }
        submitRecruit.disabled = true; submitRecruit.textContent = '送信中...';
        API.requestShiftRecruitment({ date: params.date, originalStaff: params.originalStaff, originalTime: params.originalTime, reason: params.reason })
          .then(function(res) { if(res.ok) { showToast('募集を開始しました'); } else { throw new Error(); }})
          .catch(function() { showToast('募集エラー', true); })
          .finally(function() { submitRecruit.disabled = false; submitRecruit.textContent = '募集を開始する'; });
      });
    }

    var submitTrouble = container.querySelector('#sc-submit-trouble');
    if (submitTrouble) {
      submitTrouble.addEventListener('click', function() {
        var params = getParams();
        if(!params.date || !params.originalStaff || !params.originalTime || !params.reason) { showToast('入力が不足しています', true); return; }
        if(!confirm('緊急報告を送信します。よろしいですか？')) return;
        submitTrouble.disabled = true; submitTrouble.textContent = '送信中...';
        API.notifyShiftTrouble({ date: params.date, staffName: params.originalStaff, start: params.originalTime.split('-')[0], end: params.originalTime.split('-')[1], reason: params.reason })
          .then(function(res) { if(res.ok) { showToast('緊急報告を送信しました'); } else { throw new Error(); }})
          .catch(function() { showToast('送信エラー', true); })
          .finally(function() { submitTrouble.disabled = false; submitTrouble.textContent = '🚨 緊急報告を送信'; });
      });
    }
  }

  function getParams() {
    return {
      date: container.querySelector('#sc-date').value,
      originalStaff: container.querySelector('#sc-orig-staff').value,
      originalTime: container.querySelector('#sc-orig-time').value,
      agentStaff: container.querySelector('#sc-agent-staff') ? container.querySelector('#sc-agent-staff').value : '',
      reason: container.querySelector('#sc-reason').value
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
