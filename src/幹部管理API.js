// ============================================================
// 幹部管理API.js - 幹部向けWebAppバックエンド
// ============================================================

/**
 * 幹部管理APIのPOSTリクエストをディスパッチする
 * doPost から page==='kanbu' のときに呼ばれる
 */
function handleKanbuApi_(body) {
  try {
    const action = body.action;
    if (action === 'uploadPdf')           return kanbuUploadPdf_(body.fileName, body.fileData);
    if (action === 'listPdfs')            return kanbuListPdfs_();
    if (action === 'deletePdf')           return kanbuDeletePdf_(body.fileId);
    if (action === 'importShifts')        return kanbuImportShifts_();
    if (action === 'getPeriodSettings')   return kanbuGetPeriodSettings_();
    if (action === 'savePeriodSetting')   return kanbuSavePeriodSetting_(body.rowIndex, body.startDate, body.kind);
    if (action === 'deletePeriodSetting') return kanbuDeletePeriodSetting_(body.rowIndex);
    if (action === 'getMeetings')         return kanbuGetMeetings_();
    if (action === 'saveMeeting')         return kanbuSaveMeeting_(body.rowIndex, body.date, body.startTime, body.endTime, body.note, body.notifyAll !== false);
    if (action === 'deleteMeeting')       return kanbuDeleteMeeting_(body.rowIndex);
    if (action === 'getStaffList')        return kanbuGetStaffList_();
    if (action === 'getAttendance')       return kanbuGetAttendance_(body.meetingDate);
    if (action === 'saveAttendance')      return kanbuSaveAttendance_(body.meetingDate, body.staffName, body.status, body.reason);
    if (action === 'remindMeeting')       return kanbuRemindMeeting_(body.rowIndex, body.notifyAll !== false);
    return { ok: false, error: 'unknown_action' };
  } catch (e) {
    Logger.log('幹部API エラー: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ── PDF管理 ───────────────────────────────────────────────

/**
 * base64エンコードされたPDFをDriveフォルダに保存する
 */
function kanbuUploadPdf_(fileName, base64Data) {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const decoded = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(decoded, MimeType.PDF, fileName);
  const file = folder.createFile(blob);
  return { ok: true, fileId: file.getId(), fileName: file.getName() };
}

/**
 * Driveフォルダ内のPDF一覧を返す
 */
function kanbuListPdfs_() {
  const files = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  const list = files.map(function(f) {
    return {
      id:   f.getId(),
      name: f.getName(),
      date: Utilities.formatDate(f.getLastUpdated(), TIMEZONE, 'yyyy/MM/dd HH:mm')
    };
  });
  return { ok: true, files: list };
}

/**
 * 指定PDFをゴミ箱へ移動（削除）する
 */
function kanbuDeletePdf_(fileId) {
  DriveApp.getFileById(fileId).setTrashed(true);
  return { ok: true };
}

// ── シフト取り込み ────────────────────────────────────────

/**
 * DriveフォルダのPDFをすべて解析してシートに取り込み、カレンダーも同期する
 * @returns {{ ok, imported, skipped, calendarCount, files }}
 */
function kanbuImportShifts_() {
  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    return { ok: false, error: 'PDFが見つかりません。先にPDFをアップロードしてください。' };
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SHIFTS);
    sheet.getRange(1, 1, 1, 8).setValues([
      ['日付', '曜日', 'スタッフ名', '開始時刻', '終了時刻', '業務内容', '登録日時', '登録元']
    ]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  // 重複チェック用キャッシュ
  const existingData = sheet.getDataRange().getValues();
  const shiftCache = new Set();
  for (let j = 1; j < existingData.length; j++) {
    const d = existingData[j][0] instanceof Date
      ? formatDateToISO_(existingData[j][0])
      : String(existingData[j][0]);
    const name = String(existingData[j][2]).trim();
    const startTime = formatCellTime_(existingData[j][3]);
    shiftCache.add(d + '|' + name + '|' + startTime);
  }

  let totalImported = 0;
  let totalSkipped  = 0;
  let calendarCount = 0;
  const processedFiles = [];

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    const shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) {
      Logger.log('テキスト抽出失敗: ' + pdfFile.getName());
      continue;
    }

    const allShifts = parseAllShiftsFromPdf_(pdfFile, shiftText);

    // カレンダーに登録（重複はカレンダー側でチェック）
    calendarCount += registerShiftsToCalendar(allShifts);

    // シートに書き込み
    for (const entry of allShifts) {
      for (const staff of entry.shifts) {
        const key = entry.date + '|' + staff.name + '|' + staff.start;
        if (shiftCache.has(key)) {
          totalSkipped++;
          continue;
        }
        const tasks = staff.tasks.length > 0 ? staff.tasks.join(' / ') : '';
        sheet.appendRow([
          entry.date, entry.dayOfWeek, staff.name,
          staff.start, staff.end, tasks,
          new Date(), 'web_import'
        ]);
        shiftCache.add(key);
        totalImported++;
      }
    }
    processedFiles.push(pdfFile.getName());
  }

  return {
    ok:            true,
    imported:      totalImported,
    skipped:       totalSkipped,
    calendarCount: calendarCount,
    files:         processedFiles
  };
}

// ── カレンダー同期 ────────────────────────────────────────

/**
 * シフトシートの今日以降のデータをGoogleカレンダーに同期する
 */
function kanbuSyncCalendar_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) return { ok: false, error: 'シフトシートが見つかりません' };

  const data = sheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groupedShifts = {};

  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][0];
    if (!rawDate) continue;
    const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (isNaN(date.getTime()) || date < today) continue;

    const dateStr = Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
    if (!groupedShifts[dateStr]) groupedShifts[dateStr] = [];
    const tasks = data[i][5] ? String(data[i][5]).split(' / ').filter(Boolean) : [];
    groupedShifts[dateStr].push({
      name:  String(data[i][2]).trim(),
      start: formatCellTime_(data[i][3]),
      end:   formatCellTime_(data[i][4]),
      tasks: tasks
    });
  }

  const allShifts = Object.keys(groupedShifts).map(function(dateStr) {
    return { date: dateStr, shifts: groupedShifts[dateStr] };
  });

  if (allShifts.length === 0) return { ok: true, count: 0 };
  const count = registerShiftsToCalendar(allShifts);
  return { ok: true, count: count };
}

// ── 期間設定 ──────────────────────────────────────────────

/**
 * 期間設定シートの一覧を返す
 */
function kanbuGetPeriodSettings_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PERIOD_SETTINGS);
  if (!sheet) return { ok: true, rows: [] };

  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0] || !data[i][1]) continue;
    const start = data[i][0] instanceof Date
      ? Utilities.formatDate(data[i][0], TIMEZONE, 'yyyy-MM-dd')
      : String(data[i][0]);
    rows.push({ rowIndex: i + 1, startDate: start, kind: String(data[i][1]).trim() });
  }
  return { ok: true, rows: rows };
}

/**
 * 期間設定を保存する（新規追加 or 既存更新）
 * @param {number} rowIndex - 既存行番号（1行目=ヘッダー）、0なら新規追加
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} kind - '授業期間' or 'ターム休み'
 */
function kanbuSavePeriodSetting_(rowIndex, startDate, kind) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_PERIOD_SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PERIOD_SETTINGS);
    sheet.getRange(1, 1, 1, 2).setValues([['開始日', '種別']]);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }

  const dateVal = new Date(startDate + 'T00:00:00+09:00');

  if (rowIndex > 0) {
    // 既存行を更新
    sheet.getRange(rowIndex, 1).setValue(dateVal);
    sheet.getRange(rowIndex, 2).setValue(kind);
    sheet.getRange(rowIndex, 1).setNumberFormat('yyyy/M/d');
  } else {
    // 新規追加してから開始日順にソート
    sheet.appendRow([dateVal, kind]);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('yyyy/M/d');
    if (sheet.getLastRow() > 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).sort(1);
    }
  }

  // 変更を Script Properties に自動反映（アプリ再起動不要）
  try { syncHoursToProperties_(); } catch (e) { Logger.log('syncHoursToProperties_ error: ' + e.message); }

  return { ok: true };
}

/**
 * 期間設定の指定行を削除する
 */
function kanbuDeletePeriodSetting_(rowIndex) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_PERIOD_SETTINGS);
  if (!sheet) return { ok: false, error: 'シートが見つかりません' };
  sheet.deleteRow(rowIndex);

  // 変更を Script Properties に自動反映
  try { syncHoursToProperties_(); } catch (e) { Logger.log('syncHoursToProperties_ error: ' + e.message); }

  return { ok: true };
}

// ── 店舗ミーティング ──────────────────────────────────────

/**
 * 店舗ミーティング一覧を返す（日付昇順）
 */
function kanbuGetMeetings_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_MEETING);
  if (!sheet) return { ok: true, rows: [] };

  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const d = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
    if (isNaN(d.getTime())) continue;
    const fmtTime = function(v) {
      if (v instanceof Date) return Utilities.formatDate(v, TIMEZONE, 'HH:mm');
      return String(v || '').trim();
    };
    rows.push({
      rowIndex:  i + 1,
      date:      Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd'),
      startTime: fmtTime(data[i][1]),
      endTime:   fmtTime(data[i][2]),
      note:      String(data[i][3] || '').trim()
    });
  }
  return { ok: true, rows: rows };
}

/**
 * 店舗ミーティングを保存する（新規追加 or 既存更新）
 * @param {number} rowIndex - 0なら新規追加、>0なら行更新
 * @param {string} date      - YYYY-MM-DD
 * @param {string} startTime - HH:mm
 * @param {string} endTime   - HH:mm
 * @param {string} note
 */
function kanbuSaveMeeting_(rowIndex, date, startTime, endTime, note, notifyAll) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_MEETING);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MEETING);
    sheet.getRange(1, 1, 1, 4).setValues([['実施日', '開始時刻', '終了時刻', 'メモ']]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }

  const dateVal = new Date(date + 'T00:00:00+09:00');

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1).setValue(dateVal);
    sheet.getRange(rowIndex, 2).setValue(startTime);
    sheet.getRange(rowIndex, 3).setValue(endTime);
    sheet.getRange(rowIndex, 4).setValue(note || '');
    sheet.getRange(rowIndex, 1).setNumberFormat('yyyy/M/d');
  } else {
    sheet.appendRow([dateVal, startTime, endTime, note || '']);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('yyyy/M/d');
    if (sheet.getLastRow() > 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).sort(1);
    }
  }

  // 顧客カレンダーキャッシュをクリア（当月・翌月分）
  const cache = CacheService.getScriptCache();
  const d = new Date(date);
  cache.remove('customerCal_' + d.getFullYear() + '_' + (d.getMonth() + 1));

  // 新規追加時のみ通知・カレンダー登録
  if (rowIndex === 0) {
    const notified = notifyAll !== false
      ? notifyMeetingToLineWorks_(date, startTime, endTime, note)
      : false;
    const calCount = registerMeetingToCalendar_(date, startTime, endTime, note);
    return { ok: true, notified: notified, calendarCount: calCount };
  }

  return { ok: true };
}

// ── 店舗ミーティング通知・カレンダー登録 ─────────────────

/**
 * 店舗ミーティングをLINE WORKSグループに@allメンションで通知する
 */
function notifyMeetingToLineWorks_(date, startTime, endTime, note) {
  try {
    initChannelId_();
    const token = getLineWorksAccessToken();
    if (!token) {
      Logger.log('店舗ミーティング通知: トークン取得失敗');
      return false;
    }

    const d = new Date(date + 'T00:00:00+09:00');
    const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    const dateLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';
    const bufStart = meetingAddMinutes_(startTime, -60);
    const bufEnd   = meetingAddMinutes_(endTime, 60);

    let text = '📢 【店舗ミーティングのお知らせ】\n\n';
    text += '📅 ' + dateLabel + '\n';
    text += '⏰ ' + startTime + ' 〜 ' + endTime + '\n';
    if (note) text += '📝 ' + note + '\n';
    text += '\n🔒 前後1時間（' + bufStart + ' 〜 ' + bufEnd + '）は貸切対応となります。\nよろしくお願いします！';

    const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
    const body = {
      content: {
        type: 'text',
        text: text,
        mentionedList: [{ type: 'all' }]
      }
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    Logger.log('店舗ミーティング通知: HTTP ' + code);
    return code === 200 || code === 201;
  } catch (e) {
    Logger.log('店舗ミーティング通知エラー: ' + e.message);
    return false;
  }
}

/**
 * 店舗ミーティングをGoogleカレンダーに登録する（全スタッフをゲストに追加）
 */
function registerMeetingToCalendar_(date, startTime, endTime, note) {
  try {
    const startDate = buildDateTime_(date, startTime);
    const endDate   = buildDateTime_(date, endTime);
    if (!startDate || !endDate) return 0;

    const title = '🏢 店舗ミーティング' + (note ? '（' + note + '）' : '');
    const calendar = CalendarApp.getDefaultCalendar();

    // 重複チェック
    if (isDuplicateEvent_(calendar, title, startDate, endDate)) {
      Logger.log('店舗ミーティング カレンダー: 重複スキップ');
      return 0;
    }

    // 全スタッフのメールアドレスを取得
    const emailMap = loadStaffEmailMap_();
    const emails = Object.values(emailMap).filter(function(e) { return e; }).join(',');

    const opts = {
      description: '店舗ミーティング\n時間: ' + startTime + ' 〜 ' + endTime
        + (note ? '\nメモ: ' + note : '')
        + '\n\n※この時間の前後1時間はお客様カレンダーで貸切表示されます。'
    };
    if (emails) {
      opts.guests = emails;
      opts.sendInvites = false;
    }

    calendar.createEvent(title, startDate, endDate, opts);
    Logger.log('店舗ミーティング カレンダー登録完了: ' + date + ' ' + startTime + '〜' + endTime);
    return 1;
  } catch (e) {
    Logger.log('店舗ミーティング カレンダー登録エラー: ' + e.message);
    return 0;
  }
}

// ── スタッフ名・参加確認 ──────────────────────────────────

/**
 * スタッフ名一覧を返す（スタッフシートA列から）
 */
function kanbuGetStaffList_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_STAFF);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, names: [] };
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const names = data.map(function(row) { return String(row[0]).trim(); }).filter(Boolean);
  return { ok: true, names: names };
}

/**
 * 指定日のミーティング参加状況一覧を返す
 * @param {string} meetingDate - YYYY-MM-DD
 */
function kanbuGetAttendance_(meetingDate) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MEETING_ATTENDANCE);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, attendances: [] };
  const data = sheet.getDataRange().getValues();
  const attendances = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const d = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
    if (isNaN(d.getTime())) continue;
    if (Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') !== meetingDate) continue;
    attendances.push({
      staffName: String(data[i][1]).trim(),
      status:    String(data[i][2]).trim(),
      reason:    String(data[i][3] || '').trim()
    });
  }
  return { ok: true, attendances: attendances };
}

/**
 * ミーティング参加状況を保存する（同一日・スタッフ名でupsert）
 * @param {string} meetingDate - YYYY-MM-DD
 * @param {string} staffName
 * @param {string} status - '対面参加' | 'オンライン参加' | '不参加'
 * @param {string} reason - 不参加の場合は必須
 */
function kanbuSaveAttendance_(meetingDate, staffName, status, reason) {
  if (!meetingDate || !staffName || !status) return { ok: false, error: '必須パラメータが不足しています' };
  if (status === '不参加' && !reason) return { ok: false, error: '不参加の場合は理由を入力してください' };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_MEETING_ATTENDANCE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MEETING_ATTENDANCE);
    sheet.getRange(1, 1, 1, 5).setValues([['実施日', 'スタッフ名', '参加区分', '理由', '登録日時']]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  }

  // 既存行を探してupsert
  if (sheet.getLastRow() > 1) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      const d = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
      if (isNaN(d.getTime())) continue;
      if (Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd') === meetingDate
          && String(data[i][1]).trim() === staffName) {
        sheet.getRange(i + 1, 3).setValue(status);
        sheet.getRange(i + 1, 4).setValue(reason || '');
        sheet.getRange(i + 1, 5).setValue(new Date());
        return { ok: true };
      }
    }
  }

  const dateVal = new Date(meetingDate + 'T00:00:00+09:00');
  sheet.appendRow([dateVal, staffName, status, reason || '', new Date()]);
  sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('yyyy/M/d');
  return { ok: true };
}

/**
 * ミーティングを再リマインド送信する（参加状況付き）
 * @param {number} rowIndex - 店舗ミーティングシートの行番号
 * @param {boolean} notifyAll - @allメンションをつけるか
 */
function kanbuRemindMeeting_(rowIndex, notifyAll) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const mSheet = ss.getSheetByName(SHEET_MEETING);
  if (!mSheet || rowIndex < 2) return { ok: false, error: 'ミーティングが見つかりません' };
  const row = mSheet.getRange(rowIndex, 1, 1, 4).getValues()[0];
  if (!row[0]) return { ok: false, error: 'ミーティングが見つかりません' };

  const d = row[0] instanceof Date ? row[0] : new Date(row[0]);
  const dateISO  = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
  const startTime = String(row[1]).trim();
  const endTime   = String(row[2]).trim();
  const note      = String(row[3] || '').trim();

  const attendanceRes = kanbuGetAttendance_(dateISO);
  const attendances = attendanceRes.attendances || [];

  const notified = kanbuSendRemindMessage_(dateISO, startTime, endTime, note, attendances, notifyAll);
  return { ok: true, notified: notified };
}

/**
 * リマインドメッセージを送信する（参加状況付き）
 */
function kanbuSendRemindMessage_(dateISO, startTime, endTime, note, attendances, notifyAll) {
  try {
    initChannelId_();
    const token = getLineWorksAccessToken();
    if (!token) { Logger.log('リマインド: トークン取得失敗'); return false; }

    const d = new Date(dateISO + 'T00:00:00+09:00');
    const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    const dateLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';
    const bufStart = meetingAddMinutes_(startTime, -60);
    const bufEnd   = meetingAddMinutes_(endTime, 60);

    let text = '📢 【店舗ミーティング リマインド】\n\n';
    text += '📅 ' + dateLabel + '\n';
    text += '⏰ ' + startTime + ' 〜 ' + endTime + '\n';
    if (note) text += '📝 ' + note + '\n';
    text += '\n🔒 前後1時間（' + bufStart + ' 〜 ' + bufEnd + '）は貸切対応となります。';

    if (attendances.length > 0) {
      const inPerson = attendances.filter(function(a) { return a.status === '対面参加'; }).map(function(a) { return a.staffName; });
      const online   = attendances.filter(function(a) { return a.status === 'オンライン参加'; }).map(function(a) { return a.staffName; });
      const absent   = attendances.filter(function(a) { return a.status === '不参加'; });
      text += '\n\n📊 【現在の参加状況】';
      if (inPerson.length > 0) text += '\n👥 対面: ' + inPerson.join('、');
      if (online.length > 0)   text += '\n💻 オンライン: ' + online.join('、');
      if (absent.length > 0)   text += '\n❌ 不参加: ' + absent.map(function(a) { return a.staffName + (a.reason ? '（' + a.reason + '）' : ''); }).join('、');
    } else {
      text += '\n\n⚠️ まだ参加登録がありません。スタッフアプリから登録してください。';
    }

    const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
    const bodyObj = { content: { type: 'text', text: text } };
    if (notifyAll) bodyObj.content.mentionedList = [{ type: 'all' }];

    const response = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify(bodyObj), muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    Logger.log('リマインド送信: HTTP ' + code);
    return code === 200 || code === 201;
  } catch (e) {
    Logger.log('リマインド送信エラー: ' + e.message);
    return false;
  }
}

/**
 * 時刻文字列（HH:mm）に分を加減算する
 */
function meetingAddMinutes_(timeStr, minutes) {
  const parts = timeStr.split(':');
  let total = parseInt(parts[0]) * 60 + parseInt(parts[1]) + minutes;
  total = Math.max(0, total);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

/**
 * 店舗ミーティングの指定行を削除する
 */
function kanbuDeleteMeeting_(rowIndex) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MEETING);
  if (!sheet) return { ok: false, error: 'シートが見つかりません' };
  const row = sheet.getRange(rowIndex, 1).getValue();
  sheet.deleteRow(rowIndex);

  // キャッシュクリア
  if (row instanceof Date) {
    const cache = CacheService.getScriptCache();
    cache.remove('customerCal_' + row.getFullYear() + '_' + (row.getMonth() + 1));
  }
  return { ok: true };
}
