// ============================================================
// ルーム予約.js - Web会議ルーム予約システム
// ============================================================

var SHEET_ROOM_RESERVATIONS = 'ルーム予約';
var SHEET_ROOM_USERS        = 'ルーム利用者';
var SHEET_SHIRU_PASS        = '知るパスID';
var SHEET_SIRU_POINTS       = '知るパスポイント';
var ROOM_CHECKIN_MODE_KEY   = 'ROOM_CHECKIN_MODE'; // 'both' or 'staff'

// ===== 知るパスポイント =====
// シート列: デバイスID | 合計ポイント | 最終更新 | mcs最終 | shiruru最終 | meetup最終 | pickup最終

var SIRU_POINT_VALUES  = { mcs: 1, shiruru: 2, meetup: 5, pickup: 7 };
var SIRU_POINT_LABELS  = { mcs: 'MCS', shiruru: 'SHIRURU', meetup: 'Meetup', pickup: 'Pickup Meetup' };
var SIRU_POINT_MAX     = 10;   // GOLD取得に必要なポイント
var SIRU_POINT_COOLDOWN_MS = 60 * 60 * 1000; // 同種スタンプの再スキャン制限: 1時間

function getSiruPointSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_SIRU_POINTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SIRU_POINTS);
    sheet.getRange(1, 1, 1, 7).setValues([['デバイスID', '合計ポイント', '最終更新', 'mcs最終', 'shiruru最終', 'meetup最終', 'pickup最終']]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  return sheet;
}

/**
 * ポイント加算（1時間クールダウン付き）
 * @returns {{ ok, total, added, cooldown, nextAt? }}
 */
function addSiruPoint_(deviceId, type) {
  if (!deviceId || !SIRU_POINT_VALUES[type]) return { ok: false, error: 'invalid' };
  var pts  = SIRU_POINT_VALUES[type];
  var now  = new Date();
  var sheet = getSiruPointSheet_();
  var data  = sheet.getDataRange().getValues();
  var colMap = { mcs: 4, shiruru: 5, meetup: 6, pickup: 7 }; // 1-indexed
  var col = colMap[type];

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(deviceId)) continue;

    // クールダウンチェック
    var lastVal = data[i][col - 1]; // 0-indexed
    if (lastVal) {
      var last = lastVal instanceof Date ? lastVal : new Date(lastVal);
      if (!isNaN(last.getTime()) && (now.getTime() - last.getTime()) < SIRU_POINT_COOLDOWN_MS) {
        var nextAt = new Date(last.getTime() + SIRU_POINT_COOLDOWN_MS);
        return { ok: false, cooldown: true, nextAt: Utilities.formatDate(nextAt, TIMEZONE, 'HH:mm') };
      }
    }

    var current = parseInt(data[i][1]) || 0;
    var newTotal = current + pts;
    sheet.getRange(i + 1, 2).setValue(newTotal);
    sheet.getRange(i + 1, 3).setValue(now);
    sheet.getRange(i + 1, col).setValue(now);
    return { ok: true, total: newTotal, added: pts };
  }

  // 新規デバイス
  var row = [deviceId, pts, now, '', '', '', ''];
  row[col - 1] = now; // 該当種別の最終スキャン日時
  sheet.appendRow(row);
  return { ok: true, total: pts, added: pts };
}

/** ポイント取得 */
function getSiruPoint_(deviceId) {
  if (!deviceId) return { ok: true, total: 0 };
  var sheet = getSiruPointSheet_();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(deviceId)) {
      return { ok: true, total: parseInt(data[i][1]) || 0 };
    }
  }
  return { ok: true, total: 0 };
}

/**
 * GOLD取得：10pt消費してパスを発行
 * @returns {{ ok, id, expiry, type, remainingPoints }}
 */
function claimSiruGold_(deviceId) {
  if (!deviceId) return { ok: false, error: 'invalid' };
  var sheet = getSiruPointSheet_();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(deviceId)) continue;
    var current = parseInt(data[i][1]) || 0;
    if (current < SIRU_POINT_MAX) return { ok: false, error: 'not_enough', total: current };
    var remaining = current - SIRU_POINT_MAX;
    sheet.getRange(i + 1, 2).setValue(remaining);
    sheet.getRange(i + 1, 3).setValue(new Date());
    var passResult = activateShiruPass_('gold');
    return { ok: true, id: passResult.id, expiry: passResult.expiry, type: 'gold', remainingPoints: remaining };
  }
  return { ok: false, error: 'not_enough', total: 0 };
}
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
    // 予約開始日前 or 予約不可日は空を返す
    if (dateStr < getRoomOpenDate_()) return [];
    if (isDateBlocked_(dateStr)) return [];
    var d = new Date(dateStr + 'T00:00:00+09:00');
    var hours = getBusinessHours(d);
    if (!hours) return [];
    var tr = getRoomTimeRange_();
    var useCustom = tr.start && tr.end && (!tr.startDate || dateStr >= tr.startDate);
    var sMin = roomTimeToMin_(useCustom ? tr.start : hours.start);
    var eMin = roomTimeToMin_(useCustom ? tr.end   : hours.end);
    // 営業時間の範囲内にクリップ
    sMin = Math.max(sMin, roomTimeToMin_(hours.start));
    eMin = Math.min(eMin, roomTimeToMin_(hours.end));
    var slots = [];
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
    sheet.getRange(1, 1, 1, 9).setValues([['ID', '発行日時', '有効期限', 'メモ', '種別', '初回認証日時', 'ポイント', '軽食1使用日', '軽食2使用日']]);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
  }
  return sheet;
}

var POINT_VALUES = { mcs: 1, shiruru: 2, meetup: 5, pickup: 7 };

// ===== ポイントQRトークン（月次ローテーション） =====

function computeMonthToken_(yyyyMM) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('POINT_QR_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('POINT_QR_SECRET', secret);
  }
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, secret + yyyyMM);
  return bytes.slice(0, 4).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function getCurrentPointQrToken_() {
  var now = new Date();
  return computeMonthToken_(Utilities.formatDate(now, TIMEZONE, 'yyyyMM'));
}

function isValidPointToken_(token) {
  if (!token) return false;
  var now = new Date();
  if (token === computeMonthToken_(Utilities.formatDate(now, TIMEZONE, 'yyyyMM'))) return true;
  // 月初め猶予：前月トークンも有効
  var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return token === computeMonthToken_(Utilities.formatDate(prev, TIMEZONE, 'yyyyMM'));
}

function rotatePointQrSecret_() {
  var newSecret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('POINT_QR_SECRET', newSecret);
  return getCurrentPointQrToken_();
}

// ===== ポイント付与 =====

function addShiruPoint_(id, pointType, token) {
  if (!id || !POINT_VALUES.hasOwnProperty(pointType)) return { ok: false, error: 'invalid_param' };
  if (!isValidPointToken_(token)) return { ok: false, error: 'invalid_token' };
  var pts = POINT_VALUES[pointType];
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() !== String(id).toUpperCase()) continue;
    var passType = String(data[i][4] || '').trim() || 'standard';
    if (passType !== 'standard') return { ok: false, error: 'not_standard' };
    var current = parseInt(data[i][6]) || 0;
    var newTotal = current + pts;
    sheet.getRange(i + 1, 7).setValue(newTotal);
    // 10p達成で自動GOLD昇格
    if (newTotal >= 10) {
      var goldResult = activateShiruPass_('gold');
      return { ok: true, points: newTotal, added: pts, upgraded: true, goldId: goldResult.id, goldExpiry: goldResult.expiry };
    }
    return { ok: true, points: newTotal, added: pts };
  }
  return { ok: false, error: 'not_found' };
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

/**
 * 知るパスの有効期限を計算する（初回認証日起算）
 * @param {string} type - 'standard'（30日後）or 'gold'（14日後）
 * @param {Date}   fromDate - 起算日（省略時は今日）
 */
function getShiruPassExpiry_(type, fromDate) {
  var base = fromDate instanceof Date ? fromDate : new Date();
  var d = new Date(base.getTime());
  if (type === 'gold') {
    d.setDate(d.getDate() + 14);
  } else {
    // standard: 認証日から30日後の23:59:59
    d.setDate(d.getDate() + 30);
  }
  d.setHours(23, 59, 59, 0);
  return d;
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

// ===== 予約開始日・受付時間帯設定 =====

var ROOM_OPEN_DATE_DEFAULT = '2026-06-01';

function getRoomOpenDate_() {
  return PropertiesService.getScriptProperties().getProperty('ROOM_OPEN_DATE') || ROOM_OPEN_DATE_DEFAULT;
}

function setRoomOpenDate_(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: 'invalid_date' };
  PropertiesService.getScriptProperties().setProperty('ROOM_OPEN_DATE', dateStr);
  return { ok: true, openDate: dateStr };
}

function getRoomTimeRange_() {
  var props = PropertiesService.getScriptProperties();
  return {
    start:     props.getProperty('ROOM_TIME_START')      || '',
    end:       props.getProperty('ROOM_TIME_END')        || '',
    startDate: props.getProperty('ROOM_TIME_START_DATE') || ''
  };
}

function setRoomTimeRange_(start, end, startDate) {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { ok: false, error: 'invalid_time' };
  if (roomTimeToMin_(start) >= roomTimeToMin_(end)) return { ok: false, error: 'start_after_end' };
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: 'invalid_date' };
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ROOM_TIME_START', start);
  props.setProperty('ROOM_TIME_END',   end);
  if (startDate) props.setProperty('ROOM_TIME_START_DATE', startDate);
  else props.deleteProperty('ROOM_TIME_START_DATE');
  return { ok: true, start: start, end: end, startDate: startDate || '' };
}

// ===== 予約不可日設定 =====

function getBlockedDates_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('ROOM_BLOCKED_DATES');
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function setBlockedDates_(dates) {
  if (!Array.isArray(dates)) return { ok: false, error: 'invalid' };
  var valid = dates.filter(function(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); });
  PropertiesService.getScriptProperties().setProperty('ROOM_BLOCKED_DATES', JSON.stringify(valid));
  return { ok: true, dates: valid };
}

function isDateBlocked_(dateStr) {
  return getBlockedDates_().indexOf(dateStr) !== -1;
}

function getRoomSettings_() {
  var tr = getRoomTimeRange_();
  return {
    openDate:      getRoomOpenDate_(),
    timeStart:     tr.start,
    timeEnd:       tr.end,
    timeStartDate: tr.startDate,
    maxHours:      getRoomMaxHours_(),
    blockedDates:  getBlockedDates_()
  };
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
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() === String(id).toUpperCase()) {
      var passType = String(data[i][4] || '').trim() || 'standard';
      var newExpiry = getShiruPassExpiry_(passType, new Date());
      sheet.getRange(i + 1, 3).setValue(newExpiry); // C列: 有効期限
      sheet.getRange(i + 1, 6).setValue(new Date()); // F列: 初回認証日時をリセット
      return { ok: true, id: String(data[i][0]), expiry: Utilities.formatDate(newExpiry, TIMEZONE, 'yyyy-MM-dd'), type: passType };
    }
  }
  return { ok: false, error: 'not_found' };
}

// 複数IDをまとめて更新（種別ごとに期限計算）
/**
 * 知るパスIDをキャンセル済みとしてマークする（行は残す）
 * キャンセルされたIDは顧客アプリで「Meetupキャンセルのため利用不可」と表示される
 */
function deleteShiruPassIds_(ids) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'missing_ids' };
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var deleted = [];
  var notFound = [];
  ids.forEach(function(id) {
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).toUpperCase() === String(id).toUpperCase()) {
        sheet.getRange(i + 1, 4).setValue('CANCELLED'); // note列にフラグ
        deleted.push(String(data[i][0]));
        found = true;
        break;
      }
    }
    if (!found) notFound.push(id);
  });
  return { ok: true, deleted: deleted, notFound: notFound };
}

/**
 * 期限切れの知るパスIDを行ごと削除する（CANCELLEDは対象外）
 * @param {string} type - 'standard' or 'gold' or 'all'
 * @returns {{ ok, deleted: number }}
 */
function cleanupExpiredShiruPasses_(type) {
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var deleted = 0;
  // 下から削除して行ズレを防ぐ
  for (var i = data.length - 1; i >= 1; i--) {
    var note = String(data[i][3] || '').trim();
    if (note === 'CANCELLED') continue;
    var passType = String(data[i][4] || '').trim() || 'standard';
    if (type !== 'all' && passType !== type) continue;
    var expiryRaw = data[i][2];
    var expiry = expiryRaw instanceof Date ? expiryRaw : (expiryRaw ? new Date(expiryRaw) : null);
    if (expiry && !isNaN(expiry.getTime()) && expiry < now) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  return { ok: true, deleted: deleted };
}

function bulkRenewShiruPassIds_(ids) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'missing_ids' };
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var updated = [];
  var notFound = [];
  ids.forEach(function(id) {
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).toUpperCase() === String(id).toUpperCase()) {
        var passType = String(data[i][4] || '').trim() || 'standard';
        var newExpiry = getShiruPassExpiry_(passType, now);
        sheet.getRange(i + 1, 3).setValue(newExpiry);
        sheet.getRange(i + 1, 6).setValue(now);
        updated.push({ id: String(data[i][0]), expiry: Utilities.formatDate(newExpiry, TIMEZONE, 'yyyy-MM-dd'), type: passType });
        found = true;
        break;
      }
    }
    if (!found) notFound.push(id);
  });
  return { ok: true, updated: updated, notFound: notFound };
}

/**
 * QRスキャンによる知るパス自動アクティベーション
 * 新しいIDを発行し、今日起算で有効期限をセットして返す
 * @param {string} type - 'standard' or 'gold'
 * @returns {{ ok, id, type, typeLabel, expiry }}
 */
function activateShiruPass_(type, token) {
  var passType = (type === 'gold') ? 'gold' : 'standard';
  if (token !== undefined && token !== null && token !== '') {
    if (!isValidPointToken_(token)) return { ok: false, error: 'invalid_token' };
  }
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();

  var existingIds = data.slice(1).map(function(r) { return String(r[0]); });
  var id;
  var tries = 0;
  do {
    id = generateShiruPassId_();
    tries++;
  } while (existingIds.indexOf(id) !== -1 && tries < 100);

  var expiry = getShiruPassExpiry_(passType, now);
  var expiryStr = Utilities.formatDate(expiry, TIMEZONE, 'yyyy-MM-dd');

  sheet.appendRow([id, now, expiry, 'QRスキャン', passType, now]);

  return {
    ok: true,
    id: id,
    type: passType,
    typeLabel: passType === 'gold' ? '知るパスGOLD' : '知るパス',
    expiry: expiryStr
  };
}

/**
 * 知るパスIDを発行する
 * @param {string} note  - メモ
 * @param {string} count - 発行枚数（1〜20）
 * @param {string} type  - 'standard' or 'gold'
 */
function issueShiruPassId_(note, count, type) {
  var passType = (type === 'gold') ? 'gold' : 'standard';
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var num = Math.min(Math.max(parseInt(count) || 1, 1), 20); // 最大20枚

  // 既存ID一覧（重複チェック用）
  var existingIds = data.slice(1).map(function(r) { return String(r[0]); });
  var issued = [];

  for (var n = 0; n < num; n++) {
    var id;
    var tries = 0;
    do {
      id = generateShiruPassId_();
      tries++;
    } while ((existingIds.indexOf(id) !== -1 || issued.indexOf(id) !== -1) && tries < 100);
    existingIds.push(id);
    issued.push(id);
    // 有効期限は初回認証時にセット → 発行時は空欄
    sheet.appendRow([id, now, '', note || '', passType, '']);
  }

  var typeLabel = passType === 'gold' ? '知るパスGOLD（14日）' : '知るパス（30日間）';
  return { ok: true, ids: issued, type: passType, typeLabel: typeLabel };
}

/**
 * 知るパスIDを検証する
 * 初回認証時（有効期限が未設定）: 有効期限をセットして返す（認証日起算）
 * @returns {{ valid, expiry, type, typeLabel, reason? }}
 */
function validateShiruPassId_(id) {
  if (!id) return { valid: false, reason: 'missing' };
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var nowTime = now.getTime();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() !== String(id).toUpperCase()) continue;

    var passType = String(data[i][4] || '').trim() || 'standard'; // 列5: 種別
    var typeLabel = passType === 'gold' ? '知るパスGOLD' : '知るパス';
    // キャンセル済みチェック
    if (String(data[i][3] || '').trim() === 'CANCELLED') {
      return { valid: false, reason: 'cancelled', type: passType, typeLabel: typeLabel };
    }
    var expiryRaw = data[i][2]; // 列3: 有効期限

    // 初回認証（有効期限が空）: 今日起算で期限をセット
    var expiryDate;
    if (!expiryRaw || expiryRaw === '') {
      expiryDate = getShiruPassExpiry_(passType, now);
      sheet.getRange(i + 1, 3).setValue(expiryDate); // 有効期限を書き込み
      sheet.getRange(i + 1, 6).setValue(now);        // 初回認証日時を書き込み
    } else {
      expiryDate = expiryRaw instanceof Date ? expiryRaw : new Date(expiryRaw);
    }

    if (isNaN(expiryDate.getTime())) return { valid: false, reason: 'invalid_data' };

    var expiryStr = Utilities.formatDate(expiryDate, TIMEZONE, 'yyyy-MM-dd');
    var benefitsUsed = passType === 'gold' ? (data[i][7] ? 1 : 0) + (data[i][8] ? 1 : 0) : 0;
    if (expiryDate.getTime() < nowTime) {
      return { valid: false, reason: 'expired', expiry: expiryStr, type: passType, typeLabel: typeLabel, points: parseInt(data[i][6]) || 0, benefitsUsed: benefitsUsed };
    }
    return { valid: true, expiry: expiryStr, type: passType, typeLabel: typeLabel, points: parseInt(data[i][6]) || 0, benefitsUsed: benefitsUsed };
  }
  return { valid: false, reason: 'not_found' };
}

/**
 * GOLD特典（軽食）を1回使用する
 * @param {string} goldId - GOLD パスID
 * @param {string} token  - 月次トークン
 * @returns {{ ok, used, remaining, error? }}
 */
function useMealBenefit_(goldId, token) {
  if (!goldId) return { ok: false, error: 'missing_id' };
  if (!isValidPointToken_(token)) return { ok: false, error: 'invalid_token' };
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() !== String(goldId).toUpperCase()) continue;
    var passType = String(data[i][4] || '').trim() || 'standard';
    if (passType !== 'gold') return { ok: false, error: 'not_gold' };
    var expiryRaw = data[i][2];
    if (!expiryRaw) return { ok: false, error: 'not_activated' };
    var expiryDate = expiryRaw instanceof Date ? expiryRaw : new Date(expiryRaw);
    if (isNaN(expiryDate.getTime()) || expiryDate.getTime() < now.getTime()) return { ok: false, error: 'expired' };
    var meal1 = data[i][7]; // 列8: 軽食1使用日
    var meal2 = data[i][8]; // 列9: 軽食2使用日
    var used = (meal1 ? 1 : 0) + (meal2 ? 1 : 0);
    if (used >= 2) return { ok: false, error: 'all_used' };
    if (!meal1) {
      sheet.getRange(i + 1, 8).setValue(now);
    } else {
      sheet.getRange(i + 1, 9).setValue(now);
    }
    return { ok: true, used: used + 1, remaining: 2 - (used + 1) };
  }
  return { ok: false, error: 'not_found' };
}

function getShiruPassList_() {
  var sheet = getShiruPassSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var expiryRaw = data[i][2];
    var expiry = expiryRaw instanceof Date ? expiryRaw : (expiryRaw ? new Date(expiryRaw) : null);
    var passType = String(data[i][4] || '').trim() || 'standard';
    var isCancelled = String(data[i][3] || '').trim() === 'CANCELLED';
    rows.push({
      id:          String(data[i][0]),
      issuedAt:    data[i][1] instanceof Date ? Utilities.formatDate(data[i][1], TIMEZONE, 'yyyy-MM-dd HH:mm') : String(data[i][1]),
      expiry:      (!expiry || isNaN(expiry.getTime())) ? '' : Utilities.formatDate(expiry, TIMEZONE, 'yyyy-MM-dd'),
      expired:     (!expiry || isNaN(expiry.getTime())) ? false : expiry.getTime() < now.getTime(),
      activated:   !(!expiry || isNaN(expiry.getTime())),
      cancelled:   isCancelled,
      note:        String(data[i][3] || ''),
      type:         passType,
      typeLabel:    passType === 'gold' ? '知るパスGOLD' : '知るパス',
      points:       parseInt(data[i][6]) || 0,
      benefitsUsed: passType === 'gold' ? (data[i][7] ? 1 : 0) + (data[i][8] ? 1 : 0) : 0
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
  var daysAhead = 60;
  var maxDate  = Utilities.formatDate(new Date(now.getTime() + daysAhead * 86400000), TIMEZONE, 'yyyy-MM-dd');
  if (p.date < todayStr || p.date > maxDate) return { ok: false, error: 'date_out_of_range' };
  if (p.date < getRoomOpenDate_()) return { ok: false, error: 'date_out_of_range' };
  if (isDateBlocked_(p.date)) return { ok: false, error: 'date_blocked' };

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

// ===== 過去予約行削除（タイムトリガー: 毎日深夜） =====

// GASエディターから手動実行してトリガーを登録する
function setupRoomCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'cleanupPastRoomReservations') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cleanupPastRoomReservations').timeBased().atHour(3).everyDays(1).create();
  Logger.log('cleanupPastRoomReservations トリガーを登録しました（毎日3時）');
}

function cleanupPastRoomReservations() {
  var sheet = getRoomSheet_();
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var nowStr = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm');

  // 下から削除してインデックスずれを防ぐ
  for (var i = data.length - 1; i >= 1; i--) {
    if (!data[i][0]) continue;
    var dateVal = data[i][2];
    var endVal  = data[i][4];
    var dateStr = dateVal instanceof Date ? Utilities.formatDate(dateVal, TIMEZONE, 'yyyy-MM-dd') : String(dateVal || '');
    var endStr  = endVal  instanceof Date ? Utilities.formatDate(endVal,  TIMEZONE, 'HH:mm')      : String(endVal  || '');
    if (!dateStr || !endStr) continue;
    var endDtStr = dateStr + ' ' + endStr;
    if (endDtStr < nowStr) {
      sheet.deleteRow(i + 1);
    }
  }
  Logger.log('cleanupPastRoomReservations 完了');
}
