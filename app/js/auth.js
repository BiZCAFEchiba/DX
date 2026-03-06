// ============================================================
// auth.js - 認証管理
// ============================================================
var Auth = (function () {
  var STORAGE_KEY = 'shift_auth';

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function isLoggedIn() {
    return load() !== null;
  }

  function getToken() {
    var d = load();
    return d ? d.token : null;
  }

  function getRole() {
    var d = load();
    return d ? d.role : null;
  }

  function isManager() {
    return getRole() === 'manager';
  }

  function login(token, role) {
    save({ token: token, role: role, loginAt: Date.now() });
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    isLoggedIn: isLoggedIn,
    getToken: getToken,
    getRole: getRole,
    isManager: isManager,
    login: login,
    logout: logout
  };
})();
