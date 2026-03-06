// ============================================================
// components/shiftCard.js - シフト表示カード
// ============================================================
var ShiftCard = (function () {

  /**
   * 日付別シフトカードのHTMLを生成
   * @param {{ date: string, dayOfWeek: string, staff: Array }} dayData
   * @param {string} [label] - カード上部のラベル (例: '今日', '明日')
   * @returns {string} HTML文字列
   */
  function render(dayData, label) {
    var displayDate = formatDisplayDate(dayData.date, dayData.dayOfWeek);
    var headerLabel = label ? label + ' \u2014 ' : '';

    var html = '<div class="card">';
    html += '<div class="card-header"><span class="icon">\uD83D\uDCC5</span>' + headerLabel + displayDate + '</div>';

    if (!dayData.staff || dayData.staff.length === 0) {
      html += '<div class="empty-state"><span class="text">\u30B7\u30D5\u30C8\u306A\u3057</span></div>';
    } else {
      html += '<ul class="shift-list">';
      dayData.staff.forEach(function (s) {
        html += '<li class="shift-item">';
        html += '<div class="shift-name-time">';
        html += '<span class="shift-name">' + escHtml(s.name) + '</span>';
        html += '<span class="shift-time">' + s.start + '\u301C' + s.end + '</span>';
        html += '</div>';
        if (s.tasks && s.tasks.length > 0) {
          html += '<div class="shift-tasks">\uD83D\uDCCB ' + escHtml(s.tasks.join(' / ')) + '</div>';
        }
        html += '</li>';
      });
      html += '</ul>';
    }

    html += '</div>';
    return html;
  }

  /**
   * YYYY-MM-DD を表示用に変換
   */
  function formatDisplayDate(dateStr, dow) {
    var parts = dateStr.split('-');
    return parseInt(parts[1]) + '\u6708' + parseInt(parts[2]) + '\u65E5\uFF08' + (dow || '') + '\uFF09';
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { render: render };
})();
