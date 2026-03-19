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
        '<div class="login-title">BiZCAFE</div>' +
        '<div class="login-subtitle">\u30B7\u30D5\u30C8\u30EA\u30DE\u30A4\u30F3\u30C9</div>' +
        '<div class="card" style="width:100%;max-width:320px;">' +
          '<div class="form-label" style="text-align:center;margin-bottom:12px;">PIN\u30B3\u30FC\u30C9\u3092\u5165\u529B</div>' +
          '<input id="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"' +
            ' style="width:100%;font-size:2rem;letter-spacing:0.5em;text-align:center;border:2px solid var(--gray-300);' +
            'border-radius:8px;padding:12px 8px;box-sizing:border-box;-webkit-text-security:disc;" placeholder="\u25CF\u25CF\u25CF\u25CF">' +
          '<div class="login-error" id="login-error"></div>' +
          '<button class="btn btn-primary" id="btn-login" style="margin-top:16px;">\u30ED\u30B0\u30A4\u30F3</button>' +
        '</div>' +
      '</div>';

    var pinInput = document.getElementById('pin-input');
    pinInput.focus();
    pinInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doLogin();
    });

    document.getElementById('btn-login').addEventListener('click', doLogin);
  }

  function doLogin() {
    var pin = document.getElementById('pin-input').value.trim();

    if (pin.length < 4) {
      document.getElementById('login-error').textContent = '4\u6841\u306EPIN\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044';
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
