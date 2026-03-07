// ============================================================
// api.js - GAS Web App API 通信
// ============================================================
var API = (function () {
  var BASE_URL = '';

  function setBaseUrl(url) { BASE_URL = url; }

  function get(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(BASE_URL + '?' + qs)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
  }

  function post(body) {
    return fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function getShifts(from, to) {
    return get({ action: 'getShifts', from: from, to: to });
  }

  function updateShift(date, staffName, newStart, newEnd) {
    return post({ action: 'updateShift', date: date, staffName: staffName, newStart: newStart, newEnd: newEnd });
  }

  return { setBaseUrl: setBaseUrl, getShifts: getShifts, updateShift: updateShift };
})();
