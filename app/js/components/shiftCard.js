// ============================================================
// components/shiftCard.js - シフト表示カード
// ============================================================
var ShiftCard = (function () {

  function render(dayData) {
    var displayDate = formatDisplayDate(dayData.date, dayData.dayOfWeek);

    var html = '<div class="card">';
    html += '<div class="card-header"><span class="icon">📅</span>' + displayDate + '</div>';

    if (!dayData.staff || dayData.staff.length === 0) {
      html += '<div class="empty-state"><span class="text">シフトなし</span></div>';
    } else {
      html += '<ul class="shift-list">';
      dayData.staff.forEach(function (s, idx) {
        html += '<li class="shift-item" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div class="shift-name-time">';
        html += '<span class="shift-name">' + escHtml(s.name) + '</span>';
        html += '<span class="shift-time">' + s.start + '〜' + s.end + '</span>';
        html += '</div>';
        if (s.tasks && s.tasks.length > 0) {
          html += '<div class="shift-tasks">📋 ' + escHtml(s.tasks.join(' / ')) + '</div>';
        }
        html += '</div>';
        html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
        html += '<button class="btn-edit-shift" data-idx="' + idx + '" style="padding:6px 10px;background:var(--gray-100);border:none;border-radius:6px;font-size:0.82rem;cursor:pointer;">編集</button>';
        html += '<button class="btn-delete-shift" data-idx="' + idx + '" style="padding:6px 10px;background:#fee2e2;color:#991b1b;border:none;border-radius:6px;font-size:0.82rem;cursor:pointer;">削除</button>';
        html += '</div>';
        html += '</li>';
      });
      html += '</ul>';
    }

    html += '<button class="btn-add-shift" style="width:100%;margin-top:12px;padding:10px;background:var(--gray-100);border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;">＋ スタッフを追加</button>';
    html += '</div>';
    return html;
  }

  function formatDisplayDate(dateStr, dow) {
    var parts = dateStr.split('-');
    return parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日（' + (dow || '') + '）';
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { render: render };
})();
