// ============================================================
// auth.js - 認証管理
// ============================================================
var Auth = (function () {
  function isLoggedIn() { return true; }
  function getToken() { return null; }
  function isManager() { return true; }
  function login() {}
  function logout() {}

  return { isLoggedIn: isLoggedIn, getToken: getToken, isManager: isManager, login: login, logout: logout };
})();
