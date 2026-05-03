// ============================================================
// shiftService.gs - シフトデータ CRUD
// ============================================================

var SHIFT_HEADERS = ['日付', '曜日', 'スタッフ名', '開始時刻', '終了時刻', '業務内容', '登録日時', '登録元'];

/**
 * シフトデータを取得する（日付範囲指定）
 * @param {string} from - 開始日 YYYY-MM-DD
 * @param {string} to   - 終了日 YYYY-MM-DD
 * @returns {{ success: boolean, data: Object }}
 */
function getShifts(from, to) {
  var sheet = getOrCreateSheet(SHEET_SHIFTS, SHIFT_HEADERS);
  var data = sheet.getDataRange().getValues();

  var fromDate = from ? new Date(from + 'T00:00:00') : new Date('2000-01-01');
  var toDate   = to   ? new Date(to + 'T23:59:59')   : new Date('2099-12-31');

  // 日付ごとにグループ化
  var dayMap = {};
  for (var i = 1; i < data.length; i++) {
    var rawDate = data[i][0];
    if (!rawDate) continue;

    var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (isNaN(d.getTime())) continue;
    if (d < fromDate || d > toDate) continue;

    var dateStr = formatDateISO(d);
    if (!dayMap[dateStr]) {
      dayMap[dateStr] = {
        date: dateStr,
        dayOfWeek: String(data[i][1]),
        staff: []
      };
    }

    dayMap[dateStr].staff.push({
      name:  String(data[i][2]),
      start: formatTimeVal(data[i][3]),
      end:   formatTimeVal(data[i][4]),
      tasks: data[i][5] ? String(data[i][5]).split(' / ') : []
    });
  }

  // 日付順にソート
  var shifts = Object.keys(dayMap).sort().map(function (k) { return dayMap[k]; });

  // 各日のスタッフを開始時間順にソート
  shifts.forEach(function (day) {
    day.staff.sort(function (a, b) { return a.start.localeCompare(b.start); });
  });

  return { success: true, data: { shifts: shifts } };
}

/**
 * 解析済みシフトをSheetsに保存する
 * @param {Array} shifts - [{ date, dayOfWeek, staff: [{ name, start, end, tasks }] }]
 * @returns {{ success: boolean, data: Object }}
 */
function saveParsedShifts(shifts) {
  if (!shifts || shifts.length === 0) {
    return { success: false, error: '保存するシフトデータがありません' };
  }

  var sheet = getOrCreateSheet(SHEET_SHIFTS, SHIFT_HEADERS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var now = new Date();
    var existingData = sheet.getDataRange().getValues();
    // 既存データの日付一覧（重複排除用）
    var existingDates = {};
    for (var i = 1; i < existingData.length; i++) {
      var rd = existingData[i][0];
      if (rd instanceof Date) {
        existingDates[formatDateISO(rd)] = true;
      }
    }

    var newRows = [];
    var savedDays = 0;
    var savedStaff = 0;

    for (var d = 0; d < shifts.length; d++) {
      var day = shifts[d];
      // 既に同じ日付のデータがある場合は削除して上書き
      if (existingDates[day.date]) {
        deleteShiftsByDate(sheet, day.date);
      }

      for (var s = 0; s < day.staff.length; s++) {
        var st = day.staff[s];
        var tasksStr = st.tasks ? st.tasks.join(' / ') : '';
        newRows.push([
          new Date(day.date + 'T00:00:00'),
          day.dayOfWeek,
          st.name,
          st.start,
          st.end,
          tasksStr,
          now,
          'pdf_upload'
        ]);
        savedStaff++;
      }
      savedDays++;
    }

    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
        .setValues(newRows);
    }

    return {
      success: true,
      data: { savedDays: savedDays, savedStaff: savedStaff }
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 指定日付のシフトデータを削除する
 */
function deleteShiftsByDate(sheet, dateStr) {
  var data = sheet.getDataRange().getValues();
  // 下の行から削除（インデックスずれ防止）
  for (var i = data.length - 1; i >= 1; i--) {
    var rd = data[i][0];
    if (rd instanceof Date && formatDateISO(rd) === dateStr) {
      sheet.deleteRow(i + 1);
    }
  }
}

/**
 * PDF をアップロードして解析する
 * @param {string} fileBase64
 * @param {string} fileName
 * @returns {{ success: boolean, data: Object }}
 */
function uploadAndParsePdf(fileBase64, fileName) {
  if (!fileBase64) {
    return { success: false, error: 'ファイルが指定されていません' };
  }

  var decoded = Utilities.base64Decode(fileBase64);
  var blob = Utilities.newBlob(decoded, 'application/pdf', fileName || 'shift.pdf');

  // PDF → Googleドキュメント変換（OCR）
  var docFile = null;
  try {
    var resource = {
      title: '_temp_pwa_ocr_' + Date.now(),
      mimeType: 'application/pdf'
    };
    docFile = Drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'ja' });
    var doc = DocumentApp.openById(docFile.id);
    var text = doc.getBody().getText();

    if (!text || text.trim().length === 0) {
      return { success: false, error: 'PDFからテキストを抽出できませんでした' };
    }

    // 全日分のシフトデータを解析
    var allShifts = parseAllShiftsFromText(text);

    return {
      success: true,
      data: {
        parsedDays: allShifts.length,
        shifts: allShifts,
        rawTextLength: text.length
      }
    };
  } catch (err) {
    return { success: false, error: 'PDF解析エラー: ' + err.message };
  } finally {
    if (docFile && docFile.id) {
      try { DriveApp.getFileById(docFile.id).setTrashed(true); } catch (e) {}
    }
  }
}

/**
 * テキストから全日分のシフトを解析する
 * @param {string} text
 * @returns {Array<{ date: string, dayOfWeek: string, staff: Array }>}
 */
function parseAllShiftsFromText(text) {
  var lines = text.split('\n');
  var results = [];
  var currentDate = null;
  var currentDow = null;
  var currentBlock = null;

  var timePattern = /(\d{1,2}:\d{2})[〜~](\d{1,2}:\d{2})/;
  var skipKeywords = ['スタッフ', '開始', '終了', '時刻', '計:'];
  var taskKeywords = ['清掃', '在報', '棚卸', '発注', '研修', 'MTG', 'ミーティング', '引継'];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var dateMatch = line.match(/(\d{4})年(\d{2})月(\d{2})日\((.)\)/);

    if (dateMatch) {
      // 前のブロックを保存
      if (currentDate && currentBlock && currentBlock.length > 0) {
        var staffList = parseStaffBlock(currentBlock, timePattern, skipKeywords, taskKeywords);
        if (staffList.length > 0) {
          results.push({ date: currentDate, dayOfWeek: currentDow, staff: staffList });
        }
      }
      currentDate = dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3];
      currentDow = dateMatch[4];
      currentBlock = [];
      continue;
    }

    if (currentBlock !== null) {
      currentBlock.push(line);
    }
  }

  // 最後のブロック
  if (currentDate && currentBlock && currentBlock.length > 0) {
    var lastStaff = parseStaffBlock(currentBlock, timePattern, skipKeywords, taskKeywords);
    if (lastStaff.length > 0) {
      results.push({ date: currentDate, dayOfWeek: currentDow, staff: lastStaff });
    }
  }

  return results;
}

/**
 * 日付ブロックの行からスタッフ情報を抽出する
 */
function parseStaffBlock(blockLines, timePattern, skipKeywords, taskKeywords) {
  var staffList = [];
  var currentStaff = null;

  for (var i = 0; i < blockLines.length; i++) {
    var trimmed = blockLines[i].trim();
    if (!trimmed) continue;

    var skip = false;
    for (var k = 0; k < skipKeywords.length; k++) {
      if (trimmed.indexOf(skipKeywords[k]) >= 0) { skip = true; break; }
    }
    if (skip) continue;

    var timeMatch = trimmed.match(timePattern);
    if (timeMatch) {
      var namePart = trimmed.substring(0, trimmed.indexOf(timeMatch[0])).replace(/[\s\u3000]+/g, '').trim();
      if (namePart) {
        currentStaff = { name: namePart, start: timeMatch[1], end: timeMatch[2], tasks: [] };

        var afterTime = trimmed.substring(trimmed.indexOf(timeMatch[0]) + timeMatch[0].length).trim();
        if (afterTime) {
          var ft = extractTaskKeywords(afterTime, taskKeywords);
          if (ft.length > 0) currentStaff.tasks = currentStaff.tasks.concat(ft);
        }
        staffList.push(currentStaff);
      }
    } else if (currentStaff) {
      var ft2 = extractTaskKeywords(trimmed, taskKeywords);
      if (ft2.length > 0) currentStaff.tasks = currentStaff.tasks.concat(ft2);
    }
  }

  staffList.sort(function (a, b) { return a.start.localeCompare(b.start); });
  return staffList;
}

/**
 * テキストから業務キーワードを抽出
 */
function extractTaskKeywords(text, taskKeywords) {
  var found = [];
  if (text.indexOf('在報') >= 0 && text.indexOf('棚卸') >= 0) {
    found.push('在報・棚卸');
  } else {
    if (text.indexOf('在報') >= 0) found.push('在報');
    if (text.indexOf('棚卸') >= 0) found.push('棚卸');
  }
  for (var i = 0; i < taskKeywords.length; i++) {
    var kw = taskKeywords[i];
    if (kw === '在報' || kw === '棚卸') continue;
    if (text.indexOf(kw) >= 0) found.push(kw);
  }
  return found;
}

/**
 * 指定日付・スタッフのシフトを更新する（名前・時刻）
 */
function updateShiftTime(date, origName, newName, newStart, newEnd) {
  if (!date || !origName || !newName || !newStart || !newEnd) {
    return { success: false, error: 'パラメータが不足しています' };
  }
  var sheet = getOrCreateSheet(SHEET_SHIFTS, SHIFT_HEADERS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = sheet.getDataRange().getValues();
    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      var rawDate = data[i][0];
      if (!rawDate) continue;
      var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d.getTime()) || formatDateISO(d) !== date) continue;
      if (String(data[i][2]).trim() !== origName) continue;
      sheet.getRange(i + 1, 3).setValue(newName);  // C列: スタッフ名
      sheet.getRange(i + 1, 4).setValue(newStart); // D列: 開始時刻
      sheet.getRange(i + 1, 5).setValue(newEnd);   // E列: 終了時刻
      updated++;
    }
    if (updated === 0) return { success: false, error: '対象のシフトが見つかりませんでした' };
    return { success: true, data: { updated: updated } };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 新規スタッフのシフトを追加する
 */
function addShift(date, dayOfWeek, staffName, start, end) {
  if (!date || !staffName || !start || !end) {
    return { success: false, error: 'パラメータが不足しています' };
  }
  var sheet = getOrCreateSheet(SHEET_SHIFTS, SHIFT_HEADERS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var dow = dayOfWeek || '';
    if (!dow) {
      var d = new Date(date + 'T00:00:00');
      dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    }
    sheet.appendRow([
      new Date(date + 'T00:00:00'), dow, staffName, start, end, '', new Date(), 'manual'
    ]);
    return { success: true, data: { added: 1 } };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 指定日付・スタッフのシフトを削除する
 */
function deleteShiftByName(date, staffName) {
  if (!date || !staffName) {
    return { success: false, error: 'パラメータが不足しています' };
  }
  var sheet = getOrCreateSheet(SHEET_SHIFTS, SHIFT_HEADERS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = sheet.getDataRange().getValues();
    var deleted = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      var rawDate = data[i][0];
      if (!rawDate) continue;
      var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d.getTime()) || formatDateISO(d) !== date) continue;
      if (String(data[i][2]).trim() !== staffName) continue;
      sheet.deleteRow(i + 1);
      deleted++;
    }
    if (deleted === 0) return { success: false, error: '対象のシフトが見つかりませんでした' };
    return { success: true, data: { deleted: deleted } };
  } finally {
    lock.releaseLock();
  }
}

// --- 出欠確認 ---

var DECLINE_HEADERS = ['日付', 'スタッフ名', '回答', '回答日時'];

/**
 * 「無理」回答を保存する（同一日付・スタッフは上書き）
 */
function saveShiftDecline(date, staffName) {
  if (!date || !staffName) return { success: false, error: 'パラメータ不足' };
  var sheet = getOrCreateSheet(SHEET_DECLINES, DECLINE_HEADERS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var rd = data[i][0];
      var d = rd instanceof Date ? rd : new Date(rd);
      if (isNaN(d.getTime())) continue;
      if (formatDateISO(d) === date && String(data[i][1]).trim() === staffName) {
        sheet.getRange(i + 1, 3).setValue('無理');
        sheet.getRange(i + 1, 4).setValue(new Date());
        return { success: true };
      }
    }
    sheet.appendRow([new Date(date + 'T00:00:00'), staffName, '無理', new Date()]);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 指定期間の出欠確認データを取得する
 * @returns {{ success: boolean, data: { declines: { 'YYYY-MM-DD': string[] } } }}
 */
function getShiftDeclines(from, to) {
  var sheet = getOrCreateSheet(SHEET_DECLINES, DECLINE_HEADERS);
  var data = sheet.getDataRange().getValues();
  var fromDate = from ? new Date(from + 'T00:00:00') : new Date('2000-01-01');
  var toDate   = to   ? new Date(to   + 'T23:59:59') : new Date('2099-12-31');
  var result = {};

  for (var i = 1; i < data.length; i++) {
    var rd = data[i][0];
    if (!rd) continue;
    var d = rd instanceof Date ? rd : new Date(rd);
    if (isNaN(d.getTime()) || d < fromDate || d > toDate) continue;
    var dateStr = formatDateISO(d);
    var name = String(data[i][1]).trim();
    if (!name) continue;
    if (!result[dateStr]) result[dateStr] = [];
    if (result[dateStr].indexOf(name) === -1) result[dateStr].push(name);
  }

  return { success: true, data: { declines: result } };
}

// --- ユーティリティ ---

/**
 * シートの時刻値を HH:MM 形式に変換
 * Sheets では時刻が 1899-12-30 基準の Date オブジェクトで返る場合がある
 */
function formatTimeVal(val) {
  if (val instanceof Date) {
    return String(val.getHours()).padStart(2, '0') + ':' + String(val.getMinutes()).padStart(2, '0');
  }
  var s = String(val).trim();
  // "13:40:00" 形式なら HH:MM だけ返す
  return s.replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');
}

/**
 * Date を YYYY-MM-DD 形式に変換
 */
function formatDateISO(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * YYYY-MM-DD から表示用文字列を生成
 */
function formatDateDisplay(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  var dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';
}
