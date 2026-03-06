// ============================================================
// components/nav.js - ボトムナビゲーション
// ============================================================
var Nav = (function () {
  var TABS_STAFF = [
    { id: 'dashboard', icon: '\uD83C\uDFE0', label: '\u30DB\u30FC\u30E0' },
    { id: 'calendar',  icon: '\uD83D\uDCC5', label: '\u30AB\u30EC\u30F3\u30C0\u30FC' }
  ];

  var TABS_MANAGER = [
    { id: 'dashboard',    icon: '\uD83C\uDFE0', label: '\u30DB\u30FC\u30E0' },
    { id: 'calendar',     icon: '\uD83D\uDCC5', label: '\u30AB\u30EC\u30F3\u30C0\u30FC' },
    { id: 'upload',       icon: '\uD83D\uDCE4', label: '\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9' },
    { id: 'staffManager', icon: '\uD83D\uDC65', label: '\u30B9\u30BF\u30C3\u30D5' },
    { id: 'settings',     icon: '\u2699\uFE0F', label: '\u7BA1\u7406' }
  ];

  var currentTab = 'dashboard';

  function render(activeTab) {
    currentTab = activeTab || currentTab;
    var nav = document.getElementById('bottom-nav');
    var tabs = Auth.isManager() ? TABS_MANAGER : TABS_STAFF;

    nav.innerHTML = '';
    nav.hidden = false;

    tabs.forEach(function (tab) {
      var btn = document.createElement('button');
      btn.className = 'nav-item' + (tab.id === currentTab ? ' active' : '');
      btn.innerHTML = '<span class="nav-icon">' + tab.icon + '</span><span>' + tab.label + '</span>';
      btn.addEventListener('click', function () {
        if (tab.id === 'settings') {
          App.navigate('logs');
        } else {
          App.navigate(tab.id);
        }
      });
      nav.appendChild(btn);
    });
  }

  function hide() {
    document.getElementById('bottom-nav').hidden = true;
  }

  return { render: render, hide: hide };
})();
