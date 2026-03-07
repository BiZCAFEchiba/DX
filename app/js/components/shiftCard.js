// ============================================================
// components/shiftCard.js - シフト表示カード
// ============================================================
var ShiftCard = (function () {

  function render(dayData, onEdit) {
    var displayDate = formatDisplayDate(dayData.date, dayData.dayOfWeek);

    var html = '<div class="card">';
    html += '<div class="card-header"><span class="icon">📅</span>' + displayDate + '</div>';

    if (!dayData.staff || dayData.staff.length === 0) {
      html += '<div class="empty-state"><span class="text">シフトなし</span></div>';
    } else {
      html += '<ul class="shift-list">';
      dayData.staff.forEach(function (s, idx) {
        html += '<li class="shift-item" style="display:flex;align-items:center;justify-content:space-between;">';
        html += '<div>';
        html += '<div class="shift-name-time">';
        html += '<span class="shift-name">' + escHtml(s.name) + '</span>';
        html += '<span class="shift-time">' + s.start + '〜' + s.end + '</span>';
        html += '</div>';
        if (s.tasks && s.tasks.length > 0) {
          html += '<div class="shift-tasks">📋 ' + escHtml(s.tasks.join(' / ')) + '</div>';
        }
        html += '</div>';
        html += '<button class="btn-edit-shift" data-idx="' + idx + '" style="flex-shrink:0;margin-left:8px;padding:6px 12px;background:var(--gray-100);border:none;border-radius:6px;font-size:0.85rem;cursor:pointer;">変更</button>';
        html += '</li>';
      });
      html += '</ul>';
    }

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
