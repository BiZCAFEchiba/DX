// ============================================================
// components/modal.js - モーダル・トースト
// ============================================================
var Modal = (function () {

  function show(html) {
    var overlay = document.getElementById('modal-overlay');
    var container = document.getElementById('modal-container');
    container.innerHTML = html;
    overlay.hidden = false;

    overlay.addEventListener('click', function handler(e) {
      if (e.target === overlay) {
        close();
        overlay.removeEventListener('click', handler);
      }
    });
  }

  function close() {
    document.getElementById('modal-overlay').hidden = true;
    document.getElementById('modal-container').innerHTML = '';
  }

  return { show: show, close: close };
})();

var Toast = (function () {
  function show(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(function () { el.remove(); }, 300);
    }, 3000);
  }

  return { show: show };
})();
