// ============================================================
// app.js - アプリ初期化・ルーティング
// ============================================================
var App = (function () {
  // GAS Web App デプロイURL（デプロイ後にここに設定）
  var GAS_WEB_APP_URL = '';

  var views = {
    login:        LoginView,
    dashboard:    DashboardView,
    calendar:     CalendarView,
    upload:       UploadView,
    staffManager: StaffManagerView,
    reminder:     ReminderView,
    logs:         LogsView
  };

  function init() {
    API.setBaseUrl(GAS_WEB_APP_URL);

    // Service Worker 登録
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function (err) {
        console.log('SW registration failed:', err);
      });
    }

    // ログアウトボタン
    document.getElementById('btn-logout').addEventListener('click', function () {
      Auth.logout();
      navigate('login');
    });

    // 初期画面
    if (Auth.isLoggedIn()) {
      navigate('dashboard');
    } else {
      navigate('login');
    }
  }

  function navigate(viewName) {
    // 未ログインならloginへ
    if (viewName !== 'login' && !Auth.isLoggedIn()) {
      viewName = 'login';
    }

    // 店長専用画面チェック
    var managerOnly = ['upload', 'staffManager', 'reminder', 'logs'];
    if (managerOnly.indexOf(viewName) >= 0 && !Auth.isManager()) {
      viewName = 'dashboard';
    }

    var view = views[viewName];
    if (view && view.render) {
      view.render();
    }

    // ログイン画面ではナビ・ログアウト非表示
    if (viewName === 'login') {
      Nav.hide();
      document.getElementById('btn-logout').hidden = true;
    } else {
      document.getElementById('btn-logout').hidden = false;
    }
  }

  // 起動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { navigate: navigate };
})();
