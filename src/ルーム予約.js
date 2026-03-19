// ============================================================
// ルーム予約.js - Web会議ルーム予約システム
// ============================================================

var SHEET_ROOM_RESERVATIONS = 'ルーム予約';
var SHEET_ROOM_USERS        = 'ルーム利用者';
var SHEET_SHIRU_PASS        = '知るパスID';
var ROOM_CHECKIN_MODE_KEY   = 'ROOM_CHECKIN_MODE'; // 'both' or 'staff'
var ROOM_NO_SHOW_AFTER_MIN  = 15;  // 開始後N分でno_show判定
var ROOM_CHECKIN_BEFORE_MIN = 10;  // 開始N分前からチェックイン可
var ROOM_MAX_DAYS_AHEAD     = 14;
var ROOM_WARNING_THRESHOLD  = 2;   // ノーショーN回でスタッフ通知
var ROOM_RESTRICT_THRESHOLD = 3;   // ノーショーN回で予約制限
var SHIRU_PASS_VALID_DAYS_DEFAULT = 14; // 知るパスID有効期間デフォルト（日）
var ROOM_MAX_HOURS_DEFAULT        = 2;  // 知るパスID毎の予約上限時間デフォルト（時間）

// ===== ヘルパー =====

function getRoomSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_ROOM_RESERVATIONS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ROOM_RESERVATIONS);
    sheet.getRange(1, 1, 1, 13).setValues([[
      '予約ID','申請日時','予約日','開始時刻','終了時刻',
      '利用人数','利用目的','氏名','連絡先','ステータス',
      'スタッフメモ','更新日時','チェックイン日時'
    ]]);
    sheet.getRange(1, 1, 1, 13).setFontWeight('bold');
  }
  return sheet;
}

function getRoomUsersSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_ROOM_USERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ROOM_USERS);
    sheet.getRange(1, 1, 1, 4).setValues([['連絡先','ノーショー回数','最終ノーショー日','制限フラグ']]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  return sheet;
}

function generateRoomId_(date) {
  var rand = ('0000' + Math.floor(Math.random() * 10000)).slice(-4);
  return 'R-' + date.replace(/-/g,'') + '-' + Utilities.formatDate(new Date(), TIMEZONE, 'HHmmss') + '-' + rand;
}

function roomTimeToMin_(hhmm) {
  var p = String(hhmm).split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

function roomMinToTime_(min) {
  return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2);
}

function roomTimesOverlap_(s1, e1, s2, e2) {
  return roomTimeToMin_(s1) < roomTimeToMin_(e2) && roomTimeToMin_(s2) < roomTimeToMin_(e1);
}

function readAllRoomReservations_() {
  var data = getRoomSheet_().getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({
      rowIndex:    i + 1,
      id:          String(data[i][0]),
      appliedAt:   data[i][1] instanceof Date ? Utilities.formatDate(data[i][1], TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") : String(data[i][1] || ''),
      date:        data[i][2] instanceof Date ? Utilities.formatDate(data[i][2], TIMEZONE, 'yyyy-MM-dd') : String(data[i][2] || ''),
      start:       data[i][3] instanceof Date ? Utilities.formatDate(data[i][3], TIMEZONE, 'HH:mm') : String(data[i][3] || ''),
      end:         data[i][4] instanceof Date ? Utilities.formatDate(data[i][4], TIMEZONE, 'HH:mm') : String(data[i][4] || ''),
      people:      Number(data[i][5] || 1),
      purpose:     String(data[i][6] || ''),
      name:        String(data[i][7] || ''),
      status:      String(data[i][8] || ''),
      updatedAt:   data[i][9] instanceof Date ? Utilities.formatDate(data[i][9], TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") : String(data[i][9] || ''),
      checkedInAt: data[i][10] instanceof Date ? Utilities.formatDate(data[i][10], TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX") : String(data[i][10] || ''),
      shiruPassId: String(data[i][11] || '')
    });
  }
  return rows;
}

// ===== 営業時間スロット生成 =====

function getRoomSlots_(dateStr) {
  try {
    var d = new Date(dateStr + 'T00:00:00+09:00');
    var hours = getBusinessHours(d);
    if (!hours) return [];
    var slots = [];
    var sMin = roomTimeToMin_(hours.start);
    var eMin = roomTimeToMin_(hours.end);
    for (var m = sMin; m + 15 <= eMin; m += 15) {
      slots.push({ start: roomMinToTime_(m), end: roomMinToTime_(m + 15) });
    }
    return slots;
  } catch(e) { return []; }
}

// ===== 空き状況取得 =====

function getRoomAvailability_(dateStr) {
  var slots = getRoomSlots_(dateStr);
  if (!slots.length) return { date: dateStr, closed: true, slots: [], checkinMode: getRoomCheckinMode_() };

  var actives = readAllRoomReservations_().filter(function(r) {
    return r.date === dateStr &&
           (r.status === 'approved' || r.status === 'pending' || r.status === 'checked_in');
  });

  var now = new Date();
  var todayStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var isToday = dateStr === todayStr;

  return {
    date: dateStr,
    closed: false,
    checkinMode: getRoomCheckinMode_(),
    slots: slots.map(function(slot) {
      var occupied = actives.some(function(r) {
        return roomTimesOverlap_(slot.start, slot.end, r.start, r.end);
      });
      var past = isToday && roomTimeToMin_(slot.start) < nowMin;
      return { start: slot.start, end: slot.end, available: !occupied && !past };
    })
  };
}

// ===== 知るパスID管理 =====

function getShiruPassSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_SHIRU_PASS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SHIRU_PASS);
    sheet.getRange(1, 1, 1, 4).setValues([['ID', '発行日時', '有効期限', 'メモ']]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  return sheet;
}

function generateShiruPassId_() {
  // 6桁英数字（紛らわしい文字を除く: 0,O,1,I,L）
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var id = '';
  for (var i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function getShiruPassValidDays_() {
  var v = parseInt(PropertiesService.getScriptProperties().getProperty('SHIRU_PASS_VALID_DAYS') || '');
  return isNaN(v) || v <= 0 ? SHIRU_PASS_VALID_DAYS_DEFAULT : v;
}

function setShiruPassValidDays_(days) {
  var d = parseInt(days);
  if (isNaN(d) || d <= 0) return { ok: false, error: 'invalid_days' };
  PropertiesService.getScriptProperties().setProperty('SHIRU_PASS_VALID_DAYS', String(d));
  return { ok: true, days: d };
}

function getRoomMaxHours_() {
  var v = parseFloat(PropertiesService.getScriptProperties().getProperty('ROOM_MAX_HOURS') || '');
  return isNaN(v) || v <= 0 ? ROOM_MAX_HOURS_DEFAULT : v;
}

function setRoomMaxHours_(hours) {
  var h = parseFloat(hours);
  if (isNaN(h) || h <= 0) return { ok: false, error: 'invalid_hours' };
  PropertiesService.getScriptProperties().setProperty('ROOM_MAX_HOURS', String(h));
  return { ok: true, hours: h };
}

// 知るパスIDが現在使用中の予約合計分数（未来 or 本日の終了前の approved のみ）
function getUsedMinutesByShiruPass_(shiruPassId) {
  var now = new Date();
  var nowStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm');
  var reservations = readAllRoomReservations_();
  var total = 0;
  reservations.forEach(function(r) {
    if (String(r.shiruPassId || '').toUpperCase() !== String(shiruPassId).toUpperCase()) return;
    if (r.status !== 'approved' && r.status !== 'checked_in') return;
    // 終了時刻がまだ過ぎていないものだけカウント
    var endStr = r.date + ' ' + r.end;
    if (endStr > nowStr) {
      total += roomTimeToMin_(r.end) - roomTimeToMin_(r.start);
    }
  });
  return total;
}

function renewShiruPassId_(id) {
  if (!id) return { ok: false, error: 'missing_id' };
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var days = getShiruPassValidDays_();
  var newExpiry = new Date(now.getTime() + days * 86400000);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() === String(id).toUpperCase()) {
      sheet.getRange(i + 1, 3).setValue(newExpiry); // C列: 有効期限
      return { ok: true, id: String(data[i][0]), expiry: Utilities.formatDate(newExpiry, TIMEZONE, 'yyyy-MM-dd') };
    }
  }
  return { ok: false, error: 'not_found' };
}

function issueShiruPassId_(note) {
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var days = getShiruPassValidDays_();
  var expiry = new Date(now.getTime() + days * 86400000);

  // ID重複チェック（既存IDと被らないように再生成）
  var existingIds = data.slice(1).map(function(r) { return String(r[0]); });
  var id;
  var tries = 0;
  do {
    id = generateShiruPassId_();
    tries++;
  } while (existingIds.indexOf(id) !== -1 && tries < 100);

  var expiryStr = Utilities.formatDate(expiry, TIMEZONE, 'yyyy-MM-dd');
  sheet.appendRow([id, now, expiry, note || '']);
  return { ok: true, id: id, expiry: expiryStr, days: days };
}

function validateShiruPassId_(id) {
  if (!id) return { valid: false, reason: 'missing' };
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var nowTime = new Date().getTime();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() === String(id).toUpperCase()) {
      var expiry = data[i][2] instanceof Date ? data[i][2] : new Date(data[i][2]);
      if (isNaN(expiry.getTime())) return { valid: false, reason: 'invalid_data' };
      if (expiry.getTime() < nowTime) {
        return { valid: false, reason: 'expired', expiry: Utilities.formatDate(expiry, TIMEZONE, 'yyyy-MM-dd') };
      }
      return { valid: true, expiry: Utilities.formatDate(expiry, TIMEZONE, 'yyyy-MM-dd') };
    }
  }
  return { valid: false, reason: 'not_found' };
}

function getShiruPassList_() {
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var expiry = data[i][2] instanceof Date ? data[i][2] : new Date(data[i][2]);
    rows.push({
      id:        String(data[i][0]),
      issuedAt:  data[i][1] instanceof Date ? Utilities.formatDate(data[i][1], TIMEZONE, 'yyyy-MM-dd HH:mm') : String(data[i][1]),
      expiry:    isNaN(expiry.getTime()) ? '' : Utilities.formatDate(expiry, TIMEZONE, 'yyyy-MM-dd'),
      expired:   isNaN(expiry.getTime()) ? true : expiry.getTime() < now.getTime(),
      note:      String(data[i][3] || '')
    });
  }
  return { ok: true, passes: rows.reverse() }; // 新しい順
}

// ===== 予約申請 =====

function reserveRoom_(p) {
  if (!p.date || !p.start || !p.end || !p.name) return { ok: false, error: 'missing_params' };

  // 知るパスIDの検証
  var passResult = validateShiruPassId_(p.shiruPassId || '');
  if (!passResult.valid) {
    var errMap = { missing: 'shiru_pass_required', not_found: 'shiru_pass_invalid', expired: 'shiru_pass_expired' };
    return { ok: false, error: errMap[passResult.reason] || 'shiru_pass_invalid' };
  }

  var now = new Date();
  var todayStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
  var maxDate  = Utilities.formatDate(new Date(now.getTime() + ROOM_MAX_DAYS_AHEAD * 86400000), TIMEZONE, 'yyyy-MM-dd');
  if (p.date < todayStr || p.date > maxDate) return { ok: false, error: 'date_out_of_range' };

  var sMin = roomTimeToMin_(p.start), eMin = roomTimeToMin_(p.end);
  if (eMin <= sMin)            return { ok: false, error: 'invalid_time' };
  if (eMin - sMin > 120)       return { ok: false, error: 'too_long' };
  if ((eMin - sMin) % 15 !== 0) return { ok: false, error: 'invalid_slot' };

  var conflict = readAllRoomReservations_().some(function(r) {
    return r.date === p.date &&
           (r.status === 'approved' || r.status === 'checked_in') &&
           roomTimesOverlap_(p.start, p.end, r.start, r.end);
  });
  if (conflict) return { ok: false, error: 'time_conflict' };

  // 知るパスID毎の予約合計時間クォータチェック
  var maxMinutes = Math.round(getRoomMaxHours_() * 60);
  var requestedMin = eMin - sMin;
  var usedMin = getUsedMinutesByShiruPass_(p.shiruPassId);
  if (usedMin + requestedMin > maxMinutes) {
    var remainMin = Math.max(0, maxMinutes - usedMin);
    return { ok: false, error: 'quota_exceeded', remainMin: remainMin, maxHours: getRoomMaxHours_() };
  }

  var id = generateRoomId_(p.date);
  getRoomSheet_().appendRow([
    id, now, p.date, p.start, p.end,
    1, p.purpose || '', p.name,
    'approved', now, '', p.shiruPassId || ''
  ]);

  return { ok: true, id: id };
}

// ===== キャンセル（顧客用） =====

function cancelRoom_(id) {
  if (!id) return { ok: false, error: 'missing_params' };
  var r = readAllRoomReservations_().find(function(r) { return r.id === id; });
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status !== 'approved') return { ok: false, error: 'cannot_cancel' };

  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  if (r.date === todayStr) return { ok: false, error: 'cannot_cancel_today' };

  var sheet = getRoomSheet_();
  sheet.getRange(r.rowIndex, 9).setValue('cancelled');
  sheet.getRange(r.rowIndex, 10).setValue(new Date());
  return { ok: true };
}

// ===== チェックイン =====

function checkInRoom_(id, contact, isStaff) {
  if (!id) return { ok: false, error: 'missing_params' };
  var r = readAllRoomReservations_().find(function(r) { return r.id === id; });
  if (!r) return { ok: false, error: 'not_found' };

  if (!isStaff && r.contact !== contact) return { ok: false, error: 'unauthorized' };
  if (r.status !== 'approved' && r.status !== 'pending') return { ok: false, error: 'cannot_checkin' };

  if (!isStaff) {
    var now = new Date();
    var todayStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
    if (r.date !== todayStr) return { ok: false, error: 'not_today' };
    var nowMin   = now.getHours() * 60 + now.getMinutes();
    var startMin = roomTimeToMin_(r.start);
    if (nowMin < startMin - ROOM_CHECKIN_BEFORE_MIN) return { ok: false, error: 'too_early' };
    if (nowMin > startMin + ROOM_NO_SHOW_AFTER_MIN)  return { ok: false, error: 'too_late' };
  }

  var sheet = getRoomSheet_();
  sheet.getRange(r.rowIndex, 9).setValue('checked_in');
  sheet.getRange(r.rowIndex, 10).setValue(new Date());
  sheet.getRange(r.rowIndex, 11).setValue(new Date());
  return { ok: true };
}

// ===== 予約一覧（スタッフ用） =====

function getRoomList_(dateStr) {
  return readAllRoomReservations_()
    .filter(function(r) { return r.date === dateStr; })
    .sort(function(a, b) { return roomTimeToMin_(a.start) - roomTimeToMin_(b.start); });
}

// ===== マイ予約（顧客用） =====

function getMyRoomReservations_(contact) {
  if (!contact) return [];
  var todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  return readAllRoomReservations_()
    .filter(function(r) { return r.contact === contact && r.date >= todayStr; })
    .map(function(r) {
      return { id: r.id, date: r.date, start: r.start, end: r.end,
               people: r.people, purpose: r.purpose, name: r.name,
               status: r.status, appliedAt: r.appliedAt, checkedInAt: r.checkedInAt };
    })
    .sort(function(a, b) { return a.date.localeCompare(b.date) || a.start.localeCompare(b.start); });
}

// ===== ステータス更新（スタッフ用） =====

function updateRoomStatus_(id, status, memo) {
  if (!id || !status) return { ok: false, error: 'missing_params' };
  var valid = ['approved','rejected','cancelled','no_show','checked_in'];
  if (valid.indexOf(status) === -1) return { ok: false, error: 'invalid_status' };

  var r = readAllRoomReservations_().find(function(r) { return r.id === id; });
  if (!r) return { ok: false, error: 'not_found' };

  var sheet = getRoomSheet_();
  sheet.getRange(r.rowIndex, 9).setValue(status);
  sheet.getRange(r.rowIndex, 10).setValue(new Date());
  if (status === 'checked_in' && !r.checkedInAt) sheet.getRange(r.rowIndex, 11).setValue(new Date());

  return { ok: true };
}

// ===== チェックインモード =====

function getRoomCheckinMode_() {
  return PropertiesService.getScriptProperties().getProperty(ROOM_CHECKIN_MODE_KEY) || 'both';
}

function setRoomCheckinMode_(mode) {
  if (mode !== 'both' && mode !== 'staff') return { ok: false, error: 'invalid_mode' };
  PropertiesService.getScriptProperties().setProperty(ROOM_CHECKIN_MODE_KEY, mode);
  return { ok: true, mode: mode };
}

// ===== ノーショー管理 =====

function getRoomUserInfo_(contact) {
  var data = getRoomUsersSheet_().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === contact) {
      return { noShowCount: Number(data[i][1] || 0), restricted: data[i][3] === true };
    }
  }
  return { noShowCount: 0, restricted: false };
}

function incrementRoomNoShow_(contact, date) {
  var sheet = getRoomUsersSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === contact) {
      var count = Number(data[i][1] || 0) + 1;
      sheet.getRange(i + 1, 2).setValue(count);
      sheet.getRange(i + 1, 3).setValue(date);
      if (count >= ROOM_RESTRICT_THRESHOLD) {
        sheet.getRange(i + 1, 4).setValue(true);
        notifyRoomRestriction_(contact, count);
      } else if (count >= ROOM_WARNING_THRESHOLD) {
        notifyRoomNoShow_(contact, count);
      }
      return;
    }
  }
  sheet.appendRow([contact, 1, date, false]);
}

function notifyRoomNoShow_(contact, count) {
  try {
    sendLineWorksGroupMessage('【ルーム予約】ノーショー通知\n連絡先: ' + contact + '\n累計: ' + count + '回');
  } catch(e) {}
}

function notifyRoomRestriction_(contact, count) {
  try {
    sendLineWorksGroupMessage('【ルーム予約】予約制限\n連絡先: ' + contact + '\nノーショー: ' + count + '回\nスタッフアプリから解除できます。');
  } catch(e) {}
}

// ===== 利用者管理（スタッフ用） =====

function getRoomUserList_() {
  var data = getRoomUsersSheet_().getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({ contact: String(data[i][0]), noShowCount: Number(data[i][1] || 0),
                lastNoShowDate: String(data[i][2] || ''), restricted: data[i][3] === true });
  }
  return rows.sort(function(a, b) { return b.noShowCount - a.noShowCount; });
}

function updateRoomUser_(contact, restricted, resetCount) {
  var sheet = getRoomUsersSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== contact) continue;
    if (resetCount) {
      sheet.getRange(i + 1, 2).setValue(0);
      sheet.getRange(i + 1, 3).setValue('');
      sheet.getRange(i + 1, 4).setValue(false);
    } else if (restricted !== undefined) {
      sheet.getRange(i + 1, 4).setValue(restricted);
    }
    return { ok: true };
  }
  return { ok: false, error: 'not_found' };
}

// ===== 自動ノーショー判定（タイムトリガー: 30分おき） =====

function triggerRoomNoShowCheck() {
  var now = new Date();
  var todayStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');
  var nowMin   = now.getHours() * 60 + now.getMinutes();

  var targets = readAllRoomReservations_().filter(function(r) {
    return r.date === todayStr &&
           (r.status === 'approved' || r.status === 'pending') &&
           !r.checkedInAt &&
           roomTimeToMin_(r.start) + ROOM_NO_SHOW_AFTER_MIN <= nowMin;
  });

  targets.forEach(function(r) {
    updateRoomStatus_(r.id, 'no_show', 'AUTO');
    Logger.log('ノーショー: ' + r.id + ' ' + r.name);
  });
  if (targets.length) Logger.log('ノーショー判定: ' + targets.length + '件');
}
