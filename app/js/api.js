// ============================================================
// api.js - GAS Web App API 通信
// ============================================================
var API = (function () {
  var BASE_URL = '';
  var MEETING_URL = '';

  function setBaseUrl(url) { BASE_URL = url; }
  function setMeetingUrl(url) { MEETING_URL = url; }

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

  function meetingGet(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(MEETING_URL + '?' + qs)
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
  }

  function meetingPost(body) {
    return fetch(MEETING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    })
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
  }

  function getShifts(from, to) {
    return get({ action: 'getShifts', from: from, to: to });
  }

  function getStaff() {
    return get({ action: 'getStaff' });
  }

  function updateShift(date, origName, newName, newStart, newEnd) {
    return post({ action: 'updateShift', date: date, origName: origName, newName: newName, newStart: newStart, newEnd: newEnd });
  }

  function addShift(date, dayOfWeek, staffName, start, end) {
    return post({ action: 'addShift', date: date, dayOfWeek: dayOfWeek, staffName: staffName, start: start, end: end });
  }

  function deleteShift(date, staffName) {
    return post({ action: 'deleteShift', date: date, staffName: staffName });
  }

  // ===== ミーティング API =====
  function getMeetings() {
    return meetingGet({ page: 'calendar', action: 'getMeetings' });
  }

  function getMeetingAttendance(date) {
    return meetingGet({ page: 'calendar', action: 'getMeetingAttendance', date: date });
  }

  function getMeetingStaffList() {
    return meetingGet({ page: 'calendar', action: 'getStaffList' });
  }

  function saveMeetingAttendance(meetingDate, staffName, status, reason) {
    return meetingPost({ page: 'calendar', action: 'attendanceSave',
      meetingDate: meetingDate, staffName: staffName, status: status, reason: reason || '' });
  }

  function getRoomSettings() {
    return get({ action: 'roomSettings' });
  }

  function setRoomTimeRange(start, end) {
    return get({ action: 'roomSettings', set: 'timeRange', start: start, end: end });
  }

  function setRoomOpenDate(openDate) {
    return get({ action: 'roomSettings', set: 'openDate', openDate: openDate });
  }

  function setRoomBlockedDates(dates) {
    return get({ action: 'roomSettings', set: 'blockedDates', dates: JSON.stringify(dates) });
  }

  function notifyShiftChange(params) {
    params.page = 'calendar';
    params.action = 'notifyShiftChange';
    return meetingPost(params);
  }

  function getShiftAgents() {
    return meetingGet({ page: 'calendar', action: 'getShiftAgents' });
  }

  function getShiftShortage(date) {
    return get({ action: 'getShiftShortage', date: date });
  }

  function getInPersonMeetups(from, to) {
    return get({ action: 'getInPersonMeetups', from: from, to: to });
  }

  function getDeclines(from, to) {
    return get({ action: 'getDeclines', from: from, to: to });
  }

  function notifyShiftFill(params) {
    params.page = 'calendar';
    params.action = 'notifyShiftFill';
    return meetingPost(params);
  }

  function notifyShiftTrouble(params) {
    params.page = 'calendar';
    params.action = 'notifyShiftTrouble';
    return meetingPost(params);
  }

  function requestShiftRecruitment(params) {
    params.page = 'calendar';
    params.action = 'requestShiftRecruitment';
    return meetingPost(params);
  }

  function approveShiftRecruitment(params) {
    params.page = 'calendar';
    params.action = 'approveShiftRecruitment';
    return meetingPost(params);
  }

  function respondRecruitment(recruitId, staffName, response) {
    return post({ action: 'respondRecruitment', recruitId: recruitId, staffName: staffName, response: response });
  }

  function remindRecruitment(recruitId) {
    return post({ action: 'remindRecruitment', recruitId: recruitId });
  }

  function getLastModified() {
    return get({ action: 'getLastModified' });
  }

  return {
    setBaseUrl: setBaseUrl, setMeetingUrl: setMeetingUrl,
    getShifts: getShifts, getStaff: getStaff,
    updateShift: updateShift, addShift: addShift, deleteShift: deleteShift,
    notifyShiftChange: notifyShiftChange, getShiftAgents: getShiftAgents,
    getShiftShortage: getShiftShortage, getInPersonMeetups: getInPersonMeetups,
    getDeclines: getDeclines, notifyShiftFill: notifyShiftFill,
    notifyShiftTrouble: notifyShiftTrouble, requestShiftRecruitment: requestShiftRecruitment, approveShiftRecruitment: approveShiftRecruitment,
    respondRecruitment: respondRecruitment,
    remindRecruitment: remindRecruitment,
    getLastModified: getLastModified,
    getMeetings: getMeetings, getMeetingAttendance: getMeetingAttendance,
    getMeetingStaffList: getMeetingStaffList, saveMeetingAttendance: saveMeetingAttendance,
    getRoomSettings: getRoomSettings, setRoomTimeRange: setRoomTimeRange, setRoomOpenDate: setRoomOpenDate, setRoomBlockedDates: setRoomBlockedDates
  };
})();
