// ============================================================
// views/login.js - ログイン画面
// ============================================================
var LoginView = (function () {

  function render() {
    Nav.hide();
    document.getElementById('btn-logout').hidden = true;

    var main = document.getElementById('main-content');
    main.innerHTML =
      '<div class="login-screen">' +
        '<div class="login-logo">\u2615</div>' +
        '<div class="login-title">BizCAFE</div>' +
        '<div class="login-subtitle">\u30B7\u30D5\u30C8\u30EA\u30DE\u30A4\u30F3\u30C9</div>' +
        '<div class="card" style="width:100%;max-width:320px;">' +
          '<div class="form-label" style="text-align:center;">PIN\u30B3\u30FC\u30C9\u3092\u5165\u529B</div>' +
          '<div class="pin-container" id="pin-container"></div>' +
          '<div class="login-error" id="login-error"></div>' +
          '<button class="btn btn-primary" id="btn-login" style="margin-top:16px;">\u30ED\u30B0\u30A4\u30F3</button>' +
        '</div>' +
      '</div>';

    // PIN入力欄を生成（6桁）
    var pinContainer = document.getElementById('pin-container');
    for (var i = 0; i < 6; i++) {
      var input = document.createElement('input');
      input.type = 'tel';
      input.maxLength = 1;
      input.className = 'pin-input';
      input.dataset.index = i;
      input.inputMode = 'numeric';
      input.pattern = '[0-9]*';
      pinContainer.appendChild(input);
    }

    var inputs = pinContainer.querySelectorAll('.pin-input');

    // 自動フォーカス移動
    inputs.forEach(function (inp, idx) {
      inp.addEventListener('input', function () {
        if (inp.value && idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !inp.value && idx > 0) {
          inputs[idx - 1].focus();
        }
        if (e.key === 'Enter') {
          doLogin();
        }
      });
    });

    inputs[0].focus();

    document.getElementById('btn-login').addEventListener('click', doLogin);
  }

  function doLogin() {
    var inputs = document.querySelectorAll('.pin-input');
    var pin = '';
    inputs.forEach(function (inp) { pin += inp.value; });

    if (pin.length < 4) {
      document.getElementById('login-error').textContent = 'PIN\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044';
      return;
    }

    var btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = '\u8A8D\u8A3C\u4E2D...';

    API.auth(pin)
      .then(function (res) {
        if (res.success) {
          Auth.login(res.data.token, res.data.role);
          App.navigate('dashboard');
        } else {
          document.getElementById('login-error').textContent = res.error || 'PIN\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093';
          btn.disabled = false;
          btn.textContent = '\u30ED\u30B0\u30A4\u30F3';
        }
      })
      .catch(function () {
        document.getElementById('login-error').textContent = '\u901A\u4FE1\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F';
        btn.disabled = false;
        btn.textContent = '\u30ED\u30B0\u30A4\u30F3';
      });
  }

  return { render: render };
})();
