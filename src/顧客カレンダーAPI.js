// ============================================================
// 顧客カレンダーAPI.js - お客様向け営業時間カレンダーデータ提供
// ============================================================

/**
 * 指定年月の営業カレンダーデータを返す
 * 貸切がある日は1時間バッファを加味した営業時間に変更して返す
 *
 * @param {number} year
 * @param {number} month - 1-indexed
 * @returns {Array<{
 *   date: string,        // YYYY-MM-DD
 *   isOpen: boolean,
 *   open: string|null,   // HH:mm
 *   close: string|null,  // HH:mm
 *   isKashikiri: boolean,
 *   kashikiriTime: string|null, // HH:mm〜HH:mm
 *   note: string|null
 * }>}
 */
function getCustomerCalendarData_(year, month, nocache) {
  // GAS CacheService で1時間キャッシュ（スプシ・カレンダーAPI呼び出しを省略）
  const cacheKey = 'customerCal_' + year + '_' + month;
  const cache = CacheService.getScriptCache();
  if (!nocache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        Logger.log('顧客カレンダー: キャッシュヒット ' + year + '/' + month);
        return JSON.parse(cached);
      } catch (e) {}
    }
  } else {
    cache.remove(cacheKey);
    Logger.log('顧客カレンダー: キャッシュクリア ' + year + '/' + month);
  }

  const results = [];
  const daysInMonth = new Date(year, month, 0).getDate();

  // Meetup予定シートから当月の貸切イベントを取得
  const kashikiriMap = buildKashikiriMap_(year, month);

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dateISO = formatDateToISO_(date);
    const normalHours = getBusinessHours(date);

    if (!normalHours) {
      results.push({ date: dateISO, isOpen: false, open: null, close: null, isKashikiri: false, kashikiriTime: null, note: '定休日' });
      continue;
    }

    const kashikiriList = kashikiriMap[dateISO] || [];
    if (kashikiriList.length === 0) {
      results.push({ date: dateISO, isOpen: true, open: normalHours.start, close: normalHours.end, isKashikiri: false, kashikiriTime: null, note: null, period: normalHours.period || null });
      continue;
    }

    // 貸切あり: 最初の貸切で時間調整（複数貸切は1件目を優先）
    const k = kashikiriList[0];
    const adjusted = adjustHoursForKashikiri_(normalHours.start, normalHours.end, k.start, k.end);
    results.push({
      date: dateISO,
      isOpen: adjusted.isOpen,
      open: adjusted.open,
      close: adjusted.close,
      isKashikiri: true,
      kashikiriTime: k.start + '〜' + k.end,
      note: adjusted.note,
      period: normalHours.period || null
    });
  }

  // 結果をキャッシュ（最大6時間だが1時間に設定）
  try { cache.put(cacheKey, JSON.stringify(results), 3600); } catch (e) {
    Logger.log('カレンダーキャッシュ保存失敗: ' + e.message);
  }

  return results;
}

/**
 * Meetup予定シートから指定年月の貸切イベントをマップで返す
 * 店舗ミーティングシートの予定も前後1時間バッファ付きで追加する
 * @returns {{ [dateISO: string]: Array<{start: string, end: string, company: string}> }}
 */
function buildKashikiriMap_(year, month) {
  const map = {};

  // ① Meetup予定シートの貸切
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_MEETUP);
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const dateVal = row[0];
        if (!dateVal) continue;
        const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
        if (isNaN(d.getTime())) continue;
        if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;

        const kind = String(row[3]).trim();
        if (!kind.includes('貸切')) continue;

        const dateISO = formatDateToISO_(d);
        const timeStr = String(row[2]).trim();
        const company = String(row[1]).trim();
        const timeParts = timeStr.split(/\s*~\s*/);
        if (timeParts.length < 2) continue;

        if (!map[dateISO]) map[dateISO] = [];
        map[dateISO].push({ start: timeParts[0].trim(), end: timeParts[1].trim(), company: company });
      }
    }
  } catch (e) {
    Logger.log('buildKashikiriMap_ Meetup取得エラー: ' + e.message);
  }

  // ② 店舗ミーティングシートの予定（前後1時間バッファ付きで貸切扱い）
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const mSheet = ss.getSheetByName(SHEET_MEETING);
    if (mSheet && mSheet.getLastRow() > 1) {
      const data = mSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const dateVal = row[0];
        if (!dateVal) continue;
        const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
        if (isNaN(d.getTime())) continue;
        if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;

        const startStr = String(row[1]).trim(); // HH:mm
        const endStr   = String(row[2]).trim(); // HH:mm
        if (!startStr || !endStr) continue;

        // 前後1時間バッファ
        const startMin = timeToMin_(startStr);
        const endMin   = timeToMin_(endStr);
        const bufStart = minToTime_(Math.max(0, startMin - 60));
        const bufEnd   = minToTime_(endMin + 60);

        const dateISO = formatDateToISO_(d);
        if (!map[dateISO]) map[dateISO] = [];
        map[dateISO].push({ start: bufStart, end: bufEnd, company: '店舗ミーティング' });
      }
    }
  } catch (e) {
    Logger.log('buildKashikiriMap_ 店舗ミーティング取得エラー: ' + e.message);
  }

  return map;
}

/**
 * 貸切による営業時間調整
 * - 午前〜昼の貸切: 開店 = 貸切終了 + 1時間
 * - 昼〜夕方の貸切: 閉店 = 貸切開始 - 1時間
 *
 * @param {string} normalOpen  - "HH:mm"
 * @param {string} normalClose - "HH:mm"
 * @param {string} kStart      - "HH:mm"
 * @param {string} kEnd        - "HH:mm"
 */
function adjustHoursForKashikiri_(normalOpen, normalClose, kStart, kEnd) {
  const openMin   = timeToMin_(normalOpen);
  const closeMin  = timeToMin_(normalClose);
  const kStartMin = timeToMin_(kStart);
  const kEndMin   = timeToMin_(kEnd);
  const midMin    = (openMin + closeMin) / 2;

  if (kStartMin <= openMin || kStartMin < midMin) {
    // 午前中〜昼の貸切 → 終了後1時間後から営業
    const newOpenMin = kEndMin + 60;
    if (newOpenMin >= closeMin) {
      return { isOpen: false, open: null, close: null, note: '終日貸切' };
    }
    return { isOpen: true, open: minToTime_(newOpenMin), close: normalClose, note: null };
  } else {
    // 昼〜夕方の貸切 → 開始1時間前に閉店
    const newCloseMin = kStartMin - 60;
    if (newCloseMin <= openMin) {
      return { isOpen: false, open: null, close: null, note: '終日貸切' };
    }
    return { isOpen: true, open: normalOpen, close: minToTime_(newCloseMin), note: null };
  }
}

/**
 * 指定日のMeetup予定を顧客向けに返す
 * Meetup予定シート + 企業IDマスターを結合して返す
 * @param {string} dateISO - YYYY-MM-DD
 * @returns {Array<{
 *   company: string,
 *   time: string,
 *   kind: string,
 *   gradYear: string,
 *   theme: string,
 *   imageUrl: string,
 *   industry: string
 * }>}
 */
function getMeetupsForCustomer_(dateISO) {
  if (!dateISO) return [];

  // 15分キャッシュ
  var cacheKey = 'meetupsCustomer_' + dateISO;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_MEETUP);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    var masterMap = loadCompanyIdMaster_();

    var numCols = Math.max(sheet.getLastColumn(), 8);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();
    var results = [];

    for (var i = 0; i < data.length; i++) {
      var dateVal = data[i][0];
      if (!dateVal) continue;
      var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
      if (isNaN(d.getTime())) continue;
      if (formatDateToISO_(d) !== dateISO) continue;

      var company   = String(data[i][1] || '').trim();
      var time      = String(data[i][2] || '').trim();
      var kind      = String(data[i][3] || '').trim();
      var remaining = calcMeetupRemaining_(String(data[i][4] || '')); // E列: "X/Y"
      var gradYear  = String(data[i][6] || '').trim(); // G列
      var imageUrl  = String(data[i][7] || '').trim(); // H列

      var masterInfo = masterMap[company] || {};

      results.push({
        company:   company,
        time:      time,
        kind:      kind,
        remaining: remaining,
        gradYear:  gradYear,
        theme:     masterInfo.theme    || '',
        imageUrl:  imageUrl,
        industry:  masterInfo.industry || ''
      });
    }

    try { cache.put(cacheKey, JSON.stringify(results), 900); } catch (e) {}
    return results;
  } catch (e) {
    Logger.log('getMeetupsForCustomer_ エラー: ' + e.message);
    return [];
  }
}

function timeToMin_(timeStr) {
  const p = String(timeStr).split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

function minToTime_(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
