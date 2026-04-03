// ============================================================
// components/shiftCard.js - シフト表示カード
// ============================================================
var ShiftCard = (function () {

  // 同一人物の複数シフトをグループ化する
  function groupByName(staff) {
    var map = {};
    var order = [];
    staff.forEach(function (s, idx) {
      if (!map[s.name]) {
        map[s.name] = { name: s.name, segments: [] };
        order.push(s.name);
      }
      map[s.name].segments.push({ start: s.start, end: s.end, tasks: s.tasks || [], status: s.status || '', idx: idx });
    });
    order.forEach(function (name) {
      map[name].segments.sort(function (a, b) { return a.start.localeCompare(b.start); });
    });
    return order.map(function (name) { return map[name]; });
  }

  // \"HH:MM\" → 分に変換
  function toMin(t) {
    var p = String(t || '0:0').split(':');
    return parseInt(p[0]) * 60 + parseInt(p[1]);
  }

  // 分 → \"Xh\" or \"Xh Ym\" 表示
  function fmtBreak(min) {
    if (min <= 0) return '';
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h > 0 && m > 0) return h + 'h' + m + 'm';
    if (h > 0) return h + 'h';
    return m + 'm';
  }

  function render(dayData) {
    var displayDate = formatDisplayDate(dayData.date, dayData.dayOfWeek);

    var html = '<div class=\"card\">';
    html += '<div class=\"card-header\"><span class=\"icon\">📅</span>' + displayDate + '</div>';

    if (!dayData.staff || dayData.staff.length === 0) {
      html += '<div class=\"empty-state\"><span class=\"text\">シフトなし</span></div>';
    } else {
      var groups = groupByName(dayData.staff);
      html += '<ul class=\"shift-list\">';
      groups.forEach(function (g) {
        var isSplit = g.segments.length > 1;
        html += '<li class=\"shift-item shift-line' + (isSplit ? ' shift-line--split' : '') + '\">';

        // 名前
        html += '<div class=\"shift-line-name\">' + escHtml(g.name) + '</div>';

        // セグメント群
        html += '<div class=\"shift-line-body\">';
        g.segments.forEach(function (seg, si) {
          // 前のセグメントとの休憩時間
          if (si > 0) {
            var breakMin = toMin(seg.start) - toMin(g.segments[si - 1].end);
            var breakLabel = fmtBreak(breakMin);
            html += '<div class=\"shift-break\">';
            if (breakLabel) html += '<span class=\"shift-break-label\">☕' + breakLabel + '</span>';
            html += '</div>';
          }

          html += '<div class=\"shift-segment\">';
          html += '<div class=\"shift-segment-time\">' + seg.start + '〜' + seg.end + '</div>';
          if (seg.tasks.length > 0) {
            html += '<div class=\"shift-tasks\">📋 ' + escHtml(seg.tasks.join(' / ')) + '</div>';
          }
          
          // 募集中ステータス表示
          if (seg.status === '募集中') {
            html += '<div style=\"color:#eab308; font-size:0.85rem; font-weight:bold; margin-top:2px;\">🚨 募集中</div>';
          }

          html += '<div class=\"shift-segment-btns\">';
          html += '<button class=\"btn-edit-shift\" data-idx=\"' + seg.idx + '\">編集</button>';
          html += '<button class=\"btn-delete-shift\" data-idx=\"' + seg.idx + '\">削除</button>';
          
          // 募集中でないなら「交代依頼」ボタンを表示
          if (seg.status !== '募集中') {
            html += '<button class=\"btn-request-change\" data-idx=\"' + seg.idx + '\" style=\"padding:4px 8px; background:#3b82f6; color:#fff; border:none; border-radius:5px; font-size:0.78rem; cursor:pointer;\">🔄 交代依頼</button>';
          }
          
          // 募集中なら「引受ける」ボタンを表示
          if (seg.status === '募集中') {
            html += '<button class=\"btn-approve-shift\" data-idx=\"' + seg.idx + '\" style=\"padding:4px 8px; background:#eab308; color:#fff; border:none; border-radius:5px; font-size:0.78rem; cursor:pointer;\">引受ける</button>';
          }

          html += '</div>';
          html += '</div>';
        });
        html += '</div>'; // shift-line-body

        html += '</li>';
      });
      html += '</ul>';
    }

    html += '<button class=\"btn-add-shift\" style=\"width:100%;margin-top:12px;padding:10px;background:var(--gray-100);border:none;border-radius:8px;font-size:0.95rem;cursor:pointer;\">＋ スタッフを追加</button>';
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
