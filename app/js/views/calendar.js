// ============================================================
// views/calendar.js - シフトカレンダー画面
// ============================================================
var CalendarView = (function () {
  var currentYear, currentMonth, selectedDate, shiftDates;

  function render() {
    Nav.render('calendar');

    var now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    selectedDate = formatISO(now);
    shiftDates = {};

    var main = document.getElementById('main-content');
    main.innerHTML =
      '<div class="card" id="cal-card">' +
        '<div class="cal-header">' +
          '<button class="cal-nav-btn" id="cal-prev">\u25C0</button>' +
          '<span class="cal-header-title" id="cal-title"></span>' +
          '<button class="cal-nav-btn" id="cal-next">\u25B6</button>' +
        '</div>' +
        '<div class="cal-grid" id="cal-grid"></div>' +
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

    loadMonth();
  }

  function loadMonth() {
    var from = currentYear + '-' + pad(currentMonth + 1) + '-01';
    var lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    var to = currentYear + '-' + pad(currentMonth + 1) + '-' + pad(lastDay);

    document.getElementById('cal-title').textContent = currentYear + '\u5E74' + (currentMonth + 1) + '\u6708';

    API.getShifts(from, to)
      .then(function (res) {
        shiftDates = {};
        if (res.success && res.data.shifts) {
          res.data.shifts.forEach(function (s) { shiftDates[s.date] = s; });
        }
        renderGrid();
        loadDayDetail();
      })
      .catch(function () {
        renderGrid();
      });
  }

  function renderGrid() {
    var grid = document.getElementById('cal-grid');
    var dows = ['\u6708', '\u706B', '\u6C34', '\u6728', '\u91D1', '\u571F', '\u65E5'];
    var html = '';

    dows.forEach(function (d) {
      html += '<div class="cal-dow">' + d + '</div>';
    });

    var firstDay = new Date(currentYear, currentMonth, 1).getDay();
    // 月曜始まり: 0=月 ... 6=日
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
      if (shiftDates[dateStr]) classes += ' has-shift';

      html += '<div class="' + classes + '" data-date="' + dateStr + '">' + d + '</div>';
    }

    grid.innerHTML = html;

    // クリックイベント
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

    if (dayData) {
      detail.innerHTML = ShiftCard.render(dayData);
    } else {
      var parts = selectedDate.split('-');
      detail.innerHTML =
        '<div class="card"><div class="card-header"><span class="icon">\uD83D\uDCC5</span>' +
        parseInt(parts[1]) + '\u6708' + parseInt(parts[2]) + '\u65E5</div>' +
        '<div class="empty-state"><span class="text">\u30B7\u30D5\u30C8\u30C7\u30FC\u30BF\u306A\u3057</span></div></div>';
    }
  }

  function formatISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  return { render: render };
})();
