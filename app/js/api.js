// ============================================================
// api.js - GAS Web App API 通信
// ============================================================
var API = (function () {
  // GAS Web App デプロイURL（デプロイ後に設定）
  var BASE_URL = '';

  function setBaseUrl(url) { BASE_URL = url; }
  function getBaseUrl() { return BASE_URL; }

  function get(params) {
    var token = Auth.getToken();
    if (token) params.token = token;

    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var url = BASE_URL + '?' + qs;
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data.success && data.error && data.error.indexOf('認証') >= 0) {
          Auth.logout();
          App.navigate('login');
        }
        return data;
      });
  }

  function post(body) {
    var token = Auth.getToken();
    if (token) body.token = token;

    return fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (!data.success && data.error && data.error.indexOf('認証') >= 0) {
        Auth.logout();
        App.navigate('login');
      }
      return data;
    });
  }

  // --- 各APIメソッド ---
  function auth(pin) {
    return get({ action: 'auth', pin: pin });
  }

  function getShifts(from, to) {
    return get({ action: 'getShifts', from: from, to: to });
  }

  function getStaff() {
    return get({ action: 'getStaff' });
  }

  function getLogs(limit) {
    return get({ action: 'getLogs', limit: limit || 30 });
  }

  function getPreview(date) {
    return get({ action: 'getPreview', date: date });
  }

  function uploadPdf(fileBase64, fileName) {
    return post({ action: 'uploadPdf', fileBase64: fileBase64, fileName: fileName });
  }

  function saveParsedShifts(shifts) {
    return post({ action: 'saveParsedShifts', shifts: shifts });
  }

  function updateStaff(name, accountId, originalName) {
    return post({ action: 'updateStaff', name: name, accountId: accountId, originalName: originalName });
  }

  function deleteStaff(name) {
    return post({ action: 'deleteStaff', name: name });
  }

  function updateShift(date, staffName, newStart, newEnd) {
    return post({ action: 'updateShift', date: date, staffName: staffName, newStart: newStart, newEnd: newEnd });
  }

  return {
    setBaseUrl: setBaseUrl, getBaseUrl: getBaseUrl,
    getShifts: getShifts, updateShift: updateShift
  };
})();
