// ============================================================
// components/shiftCard.js - シフト表示カード
// ============================================================
var ShiftCard = (function () {

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

  function toMin(t) {
    var p = String(t || '0:0').split(':');
    return parseInt(p[0]) * 60 + parseInt(p[1]);
  }

  function fmtBreak(min) {
    if (min <= 0) return '';
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (h > 0 && m > 0) return h + 'h' + m + 'm';
    if (h > 0) return h + 'h';
    return m + 'm';
  }

  // opts: { recruitments: [], selectedName: '', allStaff: [] }
  function render(dayData, opts) {
    var recruitments  = (opts && opts.recruitments)  ? opts.recruitments  : [];
    var selectedName  = (opts && opts.selectedName)  ? opts.selectedName  : '';
    var allStaff      = (opts && opts.allStaff)      ? opts.allStaff      : [];
    var displayDate = formatDisplayDate(dayData.date, dayData.dayOfWeek);

    var html = '<div class="card">';
    html += '<div class="card-header"><span class="icon">📅</span>' + displayDate + '</div>';

    if (!dayData.staff || dayData.staff.length === 0) {
      html += '<div class="empty-state"><span class="text">シフトなし</span></div>';
    } else {
      var groups = groupByName(dayData.staff);
      html += '<ul class="shift-list">';
      groups.forEach(function (g) {
        var isSplit = g.segments.length > 1;
        html += '<li class="shift-item shift-line' + (isSplit ? ' shift-line--split' : '') + '">';
        html += '<div class="shift-line-name">' + escHtml(g.name) + '</div>';
        html += '<div class="shift-line-body">';

        g.segments.forEach(function (seg, si) {
          if (si > 0) {
            var breakMin = toMin(seg.start) - toMin(g.segments[si - 1].end);
            var breakLabel = fmtBreak(breakMin);
            html += '<div class="shift-break">';
            if (breakLabel) html += '<span class="shift-break-label">☕' + breakLabel + '</span>';
            html += '</div>';
          }

          html += '<div class="shift-segment">';
          html += '<div class="shift-segment-time">' + seg.start + '〜' + seg.end + '</div>';
          if (seg.tasks.length > 0) {
            html += '<div class="shift-tasks">📋 ' + escHtml(seg.tasks.join(' / ')) + '</div>';
          }

          if (seg.status === '募集中') {
            html += '<div style="color:#eab308;font-size:0.85rem;font-weight:bold;margin-top:2px;">🚨 募集中</div>';

            // 対応する募集エントリを照合
            var matchRec = null;
            for (var ri = 0; ri < recruitments.length; ri++) {
              var rc = recruitments[ri];
              if (rc.staffName === g.name && rc.start === seg.start && rc.end === seg.end) { matchRec = rc; break; }
            }
            if (!matchRec) {
              for (var ri2 = 0; ri2 < recruitments.length; ri2++) {
                if (recruitments[ri2].staffName === g.name) { matchRec = recruitments[ri2]; break; }
              }
            }

            if (matchRec) {
              html += '<div class="recruit-panel" data-recruit-id="' + escHtml(matchRec.id) + '" style="margin-top:6px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">';

              // ヘッダー行（応答状況 + リマインドボタン右上）
              html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">';
              html += '<div style="flex:1;">';
              if (matchRec.available.length === 0 && matchRec.unavailable.length === 0) {
                html += '<div style="font-size:0.82rem;color:#6b7280;">まだ回答なし</div>';
              } else {
                if (matchRec.available.length > 0) {
                  html += '<div style="font-size:0.82rem;font-weight:600;color:#166534;margin-bottom:3px;">✅ 入れる（' + matchRec.available.length + '名）: ' + matchRec.available.map(function(n){ return escHtml(n); }).join('、') + '</div>';
                }
                if (matchRec.unavailable.length > 0) {
                  html += '<div style="font-size:0.82rem;font-weight:600;color:#991b1b;">❌ 入れない（' + matchRec.unavailable.length + '名）: ' + matchRec.unavailable.map(function(n){ return escHtml(n); }).join('、') + '</div>';
                }
              }
              html += '</div>';
              html += '<button class="btn-remind-recruitment" data-recruit-id="' + escHtml(matchRec.id) + '" style="flex-shrink:0;margin-left:8px;padding:4px 8px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:0.75rem;cursor:pointer;">📨 リマインド</button>';
              html += '</div>';

              // フォーム（名前選択・引き受ける・入れない）
              html += '<div>';
              html += '<select class="recruit-name-select" id="recruit-sel-' + escHtml(matchRec.id) + '" style="width:100%;padding:8px 10px;border:1px solid #fde68a;border-radius:6px;font-size:0.88rem;margin-bottom:8px;background:#fff;">';
              html += '<option value="">-- 名前を選択 --</option>';
              allStaff.forEach(function(n) {
                html += '<option value="' + escHtml(n) + '"' + (n === selectedName ? ' selected' : '') + '>' + escHtml(n) + '</option>';
              });
              html += '</select>';
              html += '<div style="display:flex;gap:8px;">';
              html += '<button class="btn-recruit-approve" data-recruit-id="' + escHtml(matchRec.id) + '" data-absent-staff="' + escHtml(matchRec.staffName) + '" data-start="' + escHtml(matchRec.start) + '" data-end="' + escHtml(matchRec.end) + '" style="flex:1;padding:8px;background:#eab308;color:#fff;border:none;border-radius:6px;font-size:0.85rem;font-weight:700;cursor:pointer;">引き受ける</button>';
              html += '<button class="btn-recruit-unavail" data-recruit-id="' + escHtml(matchRec.id) + '" style="flex:1;padding:8px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:6px;font-size:0.85rem;cursor:pointer;">❌ 入れない</button>';
              html += '</div>';
              html += '<div class="recruit-form-msg" id="recruit-msg-' + escHtml(matchRec.id) + '" style="font-size:0.8rem;margin-top:4px;"></div>';
              html += '</div>';

              html += '</div>';
            }
          }

          html += '<div class="shift-segment-btns">';
          html += '<button class="btn-edit-shift" data-idx="' + seg.idx + '">編集</button>';
          html += '<button class="btn-delete-shift" data-idx="' + seg.idx + '">削除</button>';

          if (seg.status !== '募集中') {
            html += '<button class="btn-request-change" data-idx="' + seg.idx + '" style="padding:4px 8px;background:#3b82f6;color:#fff;border:none;border-radius:5px;font-size:0.78rem;cursor:pointer;">🔄 交代</button>';
            html += '<button class="btn-recruit-shift" data-idx="' + seg.idx + '" style="padding:4px 8px;background:#f59e0b;color:#fff;border:none;border-radius:5px;font-size:0.78rem;cursor:pointer;">📢 募集</button>';
          }

          html += '</div>';
          html += '</div>';
        });

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
