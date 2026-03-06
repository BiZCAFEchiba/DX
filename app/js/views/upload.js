// ============================================================
// views/upload.js - PDFアップロード画面
// ============================================================
var UploadView = (function () {
  var parsedShifts = null;

  function render() {
    Nav.render('upload');
    parsedShifts = null;

    var main = document.getElementById('main-content');
    main.innerHTML =
      '<h2 style="font-size:1.1rem;font-weight:700;margin-bottom:12px;">PDF\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9</h2>' +
      '<div class="upload-zone" id="upload-zone">' +
        '<span class="icon">\uD83D\uDCC4</span>' +
        '<span class="text">PDF\u30D5\u30A1\u30A4\u30EB\u3092\u30BF\u30C3\u30D7\u3057\u3066\u9078\u629E<br>\u307E\u305F\u306F\u30C9\u30E9\u30C3\u30B0\uFF06\u30C9\u30ED\u30C3\u30D7</span>' +
        '<input type="file" accept=".pdf" id="file-input">' +
      '</div>' +
      '<div id="upload-status"></div>' +
      '<div id="upload-result"></div>';

    var zone = document.getElementById('upload-zone');
    var fileInput = document.getElementById('file-input');

    zone.addEventListener('click', function () { fileInput.click(); });

    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', function () {
      zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files.length > 0) {
        handleFile(fileInput.files[0]);
      }
    });
  }

  function handleFile(file) {
    if (file.type !== 'application/pdf') {
      Toast.show('PDF\u30D5\u30A1\u30A4\u30EB\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044', 'error');
      return;
    }

    var status = document.getElementById('upload-status');
    status.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><span>PDF\u3092\u89E3\u6790\u4E2D...</span></div>';
    document.getElementById('upload-result').innerHTML = '';

    var reader = new FileReader();
    reader.onload = function () {
      var base64 = reader.result.split(',')[1];
      API.uploadPdf(base64, file.name)
        .then(function (res) {
          status.innerHTML = '';
          if (res.success) {
            parsedShifts = res.data.shifts;
            renderResult(res.data);
          } else {
            status.innerHTML = '<div class="card" style="color:var(--error);">\u274C ' + (res.error || '\u89E3\u6790\u306B\u5931\u6557\u3057\u307E\u3057\u305F') + '</div>';
          }
        })
        .catch(function (err) {
          status.innerHTML = '<div class="card" style="color:var(--error);">\u274C \u901A\u4FE1\u30A8\u30E9\u30FC: ' + err.message + '</div>';
        });
    };
    reader.readAsDataURL(file);
  }

  function renderResult(data) {
    var result = document.getElementById('upload-result');
    var html = '<div class="card upload-result">';
    html += '<div class="card-header"><span class="icon">\u2705</span>\u89E3\u6790\u6210\u529F \u2014 ' + data.parsedDays + '\u65E5\u5206</div>';

    data.shifts.forEach(function (day) {
      var parts = day.date.split('-');
      html += '<div class="upload-day-summary">' +
        '<span>' + parseInt(parts[1]) + '/' + parseInt(parts[2]) + '(' + day.dayOfWeek + ')</span>' +
        '<span>' + day.staff.length + '\u540D</span>' +
        '</div>';
    });

    html += '<button class="btn btn-primary" id="btn-save-shifts" style="margin-top:16px;">\u30B7\u30D5\u30C8\u3092\u4FDD\u5B58\u3059\u308B</button>';
    html += '</div>';
    result.innerHTML = html;

    document.getElementById('btn-save-shifts').addEventListener('click', saveShifts);
  }

  function saveShifts() {
    if (!parsedShifts) return;

    var btn = document.getElementById('btn-save-shifts');
    btn.disabled = true;
    btn.textContent = '\u4FDD\u5B58\u4E2D...';

    API.saveParsedShifts(parsedShifts)
      .then(function (res) {
        if (res.success) {
          Toast.show(res.data.savedDays + '\u65E5\u5206\u306E\u30B7\u30D5\u30C8\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F', 'success');
          btn.textContent = '\u4FDD\u5B58\u5B8C\u4E86 \u2705';
          parsedShifts = null;
        } else {
          Toast.show(res.error || '\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F', 'error');
          btn.disabled = false;
          btn.textContent = '\u30B7\u30D5\u30C8\u3092\u4FDD\u5B58\u3059\u308B';
        }
      })
      .catch(function (err) {
        Toast.show('\u901A\u4FE1\u30A8\u30E9\u30FC: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '\u30B7\u30D5\u30C8\u3092\u4FDD\u5B58\u3059\u308B';
      });
  }

  return { render: render };
})();
