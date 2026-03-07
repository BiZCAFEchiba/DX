// ============================================================
// main.gs - エントリーポイント（Sheets統合版）
// ============================================================

/**
 * メイン処理 - タイムトリガーから毎日12:00に呼び出される
 *
 * 統合後の動作:
 *   2. 「スタッフ」シートからマッピングを取得
 *   3. LINE WORKSへメンション付きリマインド送信
 *   4. 「送信ログ」シートに結果を記録
 *   5. 「シフト不足」チェック（5日後）を行い、不足時はアラート送信
 *
 * フォールバック:
 *   Sheetsにデータがない場合は従来通りDriveのPDFから解析を試みる
 */
/**
 * LINE WORKSからのCallbackリクエストを処理する
 * @param {Object} e - POSTリクエストイベント
 */
function doPost(e) {
  try {
    // Webhookの到達を物理的に確認するための初期ログ
    writeLogToSheets_('POST受信', 0, 'raw', 'info', 'doPost triggered');
    handleWebhook(e);
  } catch (err) {
    writeLogToSheets_('doPost致命的エラー', 0, 'raw', 'error', err.message);
  }
}

/**
 * HTTP GETリクエストを処理する
 * ?page=yuchi で誘致フォームを表示
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.page === 'yuchi') {
    var template = HtmlService.createTemplateFromFile('誘致フォーム');
    template.staffName = e.parameter.name || '';
    template.preselected = e.parameter.companies || '';
    return template.evaluate()
      .setTitle('誘致情報入力')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return ContentService.createTextOutput('Shift Reminder Bot is active.');
}

/**
 * 翌日のシフトリマインドを送信する（トリガー実行用 entry point）
 * 実行推奨時間: 12:00頃
 */
function triggerShiftReminder() {
  initChannelId_();
  Logger.log('=== シフトリマインド 実行開始 ===');

  const now = new Date();
  const nextBusinessDay = findNextBusinessDay_(now);
  const targetISO = formatDateToISO_(nextBusinessDay);
  const targetDisplay = Utilities.formatDate(nextBusinessDay, TIMEZONE, 'M月d日(E)');

  Logger.log('次営業日判定: ' + targetDisplay + ' (' + targetISO + ')');

  // 今日が定休日の場合でも、次営業日のリマインドを送る
  // ただし、既にその日向けに送信済みの場合はスキップ
  if (isAlreadySent_(targetISO, 'auto')) {
    Logger.log(targetDisplay + ' 向けのリマインドは送信済みのためスキップします。');
    return;
  }

  // 今日が営業日、かつターゲットが明日でない場合（＝連休前）のみ早期送信
  // または、今日が定休日の場合はターゲットに向けて送信
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowISO = formatDateToISO_(tomorrow);

  // --- Step 1: Sheetsからシフトデータを取得 ---
  let shiftData = getShiftsFromSheets_(targetISO);

  // --- Step 2: Sheetsにデータがなければ、PDFから従来方式でフォールバック ---
  if (shiftData.length === 0) {
    Logger.log('Sheetsにシフトデータなし。PDFフォールバックを試行...');
    shiftData = getShiftsFromPdfFallback_(tomorrow);
  }

  if (shiftData.length === 0) {
    var errorMsg = '翌日（' + targetDisplay + '）のシフト情報が見つかりませんでした。';
    Logger.log(errorMsg);
    writeLogToSheets_(tomorrowISO, 0, 'auto', 'skip', 'シフトデータなし');
    // 重要：データがない場合は通知して気付かせる
    // notifyError(errorMsg); 
    Logger.log('=== リマインド送信 終了 ===');
    return;
  }

  Logger.log('シフト情報取得: ' + shiftData.length + '名');

  // --- Step 2.5: 本日の確認状況をリセット（重複防止） ---
  resetAcknowledgment_(targetISO);

  // --- Step 2.6: Meetup重複チェック（対面開催のみ、設定ONの場合） ---
  if (isMeetupNotificationEnabled_()) {
    var dayMeetups = getMeetupsForDay_(nextBusinessDay);
    // 対面・貸切のみに絞り込む（オンライン除外）
    var inPersonMeetups = dayMeetups.filter(function(m) {
      return m.kind && (m.kind.indexOf('対面') !== -1 || m.kind.indexOf('貸切') !== -1);
    });
    if (inPersonMeetups.length > 0) {
      Logger.log('当日対面Meetup件数: ' + inPersonMeetups.length);
      shiftData = shiftData.map(function(staff) {
        var overlapping = findOverlappingMeetups_(staff.start, staff.end, inPersonMeetups);
        if (overlapping.length > 0) {
          Logger.log('Meetup重複: ' + staff.name + ' → ' + overlapping.length + '件');
          return { name: staff.name, start: staff.start, end: staff.end, tasks: staff.tasks, meetups: overlapping };
        }
        return staff;
      });
    }
  } else {
    Logger.log('Meetup重複通知: OFF（設定シートで無効化されています）');
  }

  // --- Step 3: LINE WORKSにリマインド送信 ---
  var tomorrowParams = {
    displayStr: targetDisplay,
    dateObj: nextBusinessDay
  };
  var success = sendLineWorksReminder(shiftData, tomorrowParams);

  // --- Step 4: 送信ログを記録 ---
  writeLogToSheets_(targetISO, shiftData.length, 'auto',
    success ? 'success' : 'error',
    success ? '正常送信' : '送信失敗'
  );

  if (!success) {
    notifyError('リマインド送信に失敗しました。\n対象日: ' + tomorrow.displayStr);
  }

  Logger.log('=== リマインド送信 完了 ===');
}

/**
 * シフト不足アラートを送信する（トリガー実行用 entry point）
 * 実行推奨時間: 12:01頃
 */
function triggerShortageAlert() {
  Logger.log('=== シフト不足アラート チェック開始 ===');
  checkAndSendShortageAlert_();
  Logger.log('=== チェック 完了 ===');
}

/**
 * 未確認者への追っかけリマインドを送信する（トリガー実行用 entry point）
 * 実行推奨時間: 17:00頃
 */
function triggerFollowUpReminder() {
  Logger.log('=== 未確認者への追っかけリマインド チェック開始 ===');

  const now = new Date();
  const nextBusinessDay = findNextBusinessDay_(now);
  const targetISO = formatDateToISO_(nextBusinessDay);
  const targetDisplay = Utilities.formatDate(nextBusinessDay, TIMEZONE, 'M月d日(E)');

  Logger.log('ターゲット日: ' + targetDisplay + ' (' + targetISO + ')');

  // 既にメインのリマインドが送信されていない場合は追っかけない
  if (!isAlreadySent_(targetISO, 'auto')) {
    Logger.log(targetDisplay + ' 向けのリマインドがまだ送信されていないため終了します。');
    return;
  }

  // 翌日のシフト名簿を取得
  const shiftData = getShiftsFromSheets_(targetISO);
  if (shiftData.length === 0) {
    Logger.log('翌日のシフトデータがないため終了');
    return;
  }

  // 未確認者を抽出
  const unconfirmedStaff = [];
  for (const staff of shiftData) {
    if (!isAcknowledgedBySheet_(targetISO, staff.name)) {
      unconfirmedStaff.push(staff);
      Logger.log('未確認判定: ' + staff.name);
    }
  }

  if (unconfirmedStaff.length === 0) {
    // 全員確認済み → ありがとうは確認ボタン押下時にリアルタイム送信済みのためここでは送らない
    Logger.log('全員確認済みのためリマインド不要。');
    resetAcknowledgment_(targetISO);
    return;
  }

  // スタッフマッピングを取得（名前 -> 送信用ID 変換用）
  const mappings = loadStaffMappingFromSheets_();
  const sendMap = mappings ? mappings.send : {};

  let text = '【シフト未確認リマインド】\n';
  text += '以下のスタッフの皆さん、明日のシフト確認をお願いします！\n\n';

  for (const staff of unconfirmedStaff) {
    const userId = sendMap[staff.name];
    if (userId) {
      text += '<m userId="' + userId + '">  ' + staff.start + '〜' + staff.end + '\n';
    } else {
      text += '▶ ' + staff.name + '  ' + staff.start + '〜' + staff.end + ' (要ID登録)\n';
    }
  }

  text += '\n確認したら、12:00のメッセージの【確認しました】ボタンを押してください。';

  // 送信
  const token = getLineWorksAccessToken();
  if (!token) return;

  const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
  const body = {
    content: {
      type: 'text',
      text: text
    }
  };

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  Logger.log('追っかけリマインド送信完了');

  // 確認サイクル終了 → 当日分の確認状況をリセット
  resetAcknowledgment_(targetISO);
}

/**
 * 指定日のシフト登録者全員が確認済みかどうかを判定する
 * @param {string} dateISO - YYYY-MM-DD
 * @returns {boolean}
 */
function checkAllConfirmed_(dateISO) {
  const shiftData = getShiftsFromSheets_(dateISO);
  if (shiftData.length === 0) return false;
  for (const staff of shiftData) {
    if (!isAcknowledgedBySheet_(dateISO, staff.name)) return false;
  }
  return true;
}

/**
 * 全員確認済み時にランダムな多言語ありがとうメッセージをグループに送信する
 */
function sendAllConfirmedMessage_() {
  const messages = [
    'ありがとう！',   // 日本語
    'Thank you!',     // 英語
    '감사합니다！',    // 韓国語
    '谢谢！',          // 中国語
    'شكراً！',         // アラビア語
    '¡Gracias!',      // スペイン語
    'Merci !',         // フランス語
    'Obrigado!',       // ポルトガル語
    'Danke!',          // ドイツ語
    'Grazie!'          // イタリア語
  ];

  const text = messages[Math.floor(Math.random() * messages.length)];

  const token = getLineWorksAccessToken();
  if (!token) return;

  const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'text', text: text } }),
    muteHttpExceptions: true
  });

  Logger.log('全員確認メッセージ送信: ' + text);
}

/**
 * シートの「確認状況」列を見て確認済みか判定する
 */
function isAcknowledgedBySheet_(dateISO, staffName) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SHIFTS);
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date ? formatDateToISO_(data[i][0]) : String(data[i][0]);
      const rowName = String(data[i][2]).trim();
      const status = String(data[i][8] || ''); // I列: 確認状況

      if (rowDate === dateISO && rowName === staffName) {
        return status.includes('確認済み');
      }
    }
  } catch (e) {
    Logger.log('シート確認失敗: ' + e.message);
  }
  return false;
}

/**
 * 指定日の確認状況をすべてリセット（空にする）
 * @param {string} dateISO - YYYY-MM-DD
 */
function resetAcknowledgment_(dateISO) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SHIFTS);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date ? formatDateToISO_(data[i][0]) : String(data[i][0]);
      if (rowDate === dateISO) {
        // I列（9列目）を空にする
        sheet.getRange(i + 1, 9).setValue('');
      }
    }
    Logger.log('確認状況をリセットしました: ' + dateISO);
  } catch (e) {
    Logger.log('リセット失敗: ' + e.message);
  }
}

/**
 * 確認済みかどうかを判定 (Properties版)
 */
function isAcknowledged_(dateStr, userId) {
  const props = PropertiesService.getScriptProperties();
  const key = 'CONFIRM_' + dateStr + '_' + userId;
  const val = props.getProperty(key);
  Logger.log('確認状態チェック: key=' + key + ', value=' + val);
  return val === 'true';
}

/**
 * 全スタッフに個別でID登録依頼メッセージを送信する（管理者がGASエディタから手動実行）
 */
function requestNameRegistration() {
  const mappings = loadStaffMappingFromSheets_();
  if (!mappings) {
    Logger.log('スタッフ情報の読み込み失敗');
    return;
  }

  const sendMap = mappings.send; // { 名前: 送信用ID }
  let successCount = 0;
  let failCount = 0;

  for (const name in sendMap) {
    const userId = sendMap[name];
    const message = name + ' さん\n\nシフト確認システムの登録をお願いします。\nこのメッセージにご自身のフルネームをスペースなしで返信してください。\n\n例）' + name + '\n\n※1回送るだけで登録完了です。';
    const success = sendLineWorksMessage(userId, message);
    if (success) {
      Logger.log('送信成功: ' + name);
      successCount++;
    } else {
      Logger.log('送信失敗: ' + name);
      failCount++;
    }
    Utilities.sleep(500); // API制限対策
  }

  Logger.log('登録依頼完了: 成功=' + successCount + '名 / 失敗=' + failCount + '名');
}

/**
 * メイン処理（互換性のために維持）
 */
function main() {
  triggerShiftReminder();
  triggerShortageAlert();
  // triggerFollowUpReminder(); // 17:00に別途実行される
}

// ============================================================
// Sheets 連携関数
// ============================================================

/**
 * Sheetsの「シフト」シートから指定日のシフトを取得
 * @param {string} dateISO - YYYY-MM-DD
 * @returns {Array<{ name: string, start: string, end: string, tasks: string[] }>}
 */
function getShiftsFromSheets_(dateISO) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SHIFTS);
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var rawDate = data[i][0];
      if (!rawDate) continue;

      var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d.getTime())) continue;

      var rowISO = formatDateToISO_(d);
      if (rowISO !== dateISO) continue;

      var tasks = [];
      if (data[i][5]) {
        tasks = String(data[i][5]).split(' / ').filter(function (t) { return t.trim(); });
      }

      results.push({
        name: String(data[i][2]).trim(),
        start: formatCellTime_(data[i][3]),
        end: formatCellTime_(data[i][4]),
        tasks: tasks
      });
    }

    // 開始時間順にソート
    results.sort(function (a, b) { return a.start.localeCompare(b.start); });
    return results;
  } catch (e) {
    Logger.log('Sheets読み取りエラー: ' + e.message);
    return [];
  }
}

/**
 * セルの値を "HH:mm" 形式の時刻文字列に変換する
 * Google Sheetsは時刻のみのセルをDate型(1899年)で保持するため変換が必要
 */
function formatCellTime_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, TIMEZONE, 'HH:mm');
  }
  // 文字列の場合はそのまま返す
  return String(val).trim();
}


/**
 * 指定日の指定方法での送信が既に成功しているかログを確認
 * @param {string} dateISO - YYYY-MM-DD
 * @param {string} method - 'auto' or 'manual'
 * @returns {boolean}
 */
function isAlreadySent_(dateISO, method) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      const logDate = data[i][1] instanceof Date ? formatDateToISO_(data[i][1]) : String(data[i][1]);
      const logMethod = data[i][3];
      const logResult = data[i][4];

      if (logDate === dateISO && logMethod === method && logResult === 'success') {
        return true;
      }
    }
  } catch (e) {
    Logger.log('送信済みチェックエラー: ' + e.message);
  }
  return false;
}

/**
 * 送信ログをSheetsに記録する
 * 100行を超えたら古い行を削除して最新50行のみ残す
 */
function writeLogToSheets_(dateStr, staffCount, method, result, detail) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_LOGS);
      sheet.getRange(1, 1, 1, 6).setValues([['送信日時', '対象日', 'スタッフ数', '送信方法', '結果', '詳細']]);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    }
    sheet.appendRow([new Date(), dateStr, staffCount, method, result, detail]);

    // 200行超えたら古い行を削除して最新100行だけ残す（ヘッダー除く）
    var lastRow = sheet.getLastRow();
    if (lastRow > 201) { // ヘッダー1行 + データ200行
      var deleteCount = lastRow - 101; // ヘッダー1行 + 最新100行 を残す
      sheet.deleteRows(2, deleteCount);
    }
  } catch (e) {
    Logger.log('ログ書き込みエラー: ' + e.message);
  }
}

/**
 * PDFフォールバック: 従来のDrive PDF解析で翌日シフトを取得
 * 複数PDFがある場合は全ファイルのデータを結合して返す
 */
function getShiftsFromPdfFallback_(tomorrow) {
  var pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) return [];

  var allShiftData = [];

  for (var i = 0; i < pdfFiles.length; i++) {
    var pdfFile = pdfFiles[i];
    Logger.log('PDFフォールバック処理中: ' + pdfFile.getName());

    var shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) continue;

    var shiftData = parseShiftData(shiftText, tomorrow);
    if (shiftData.length === 0) continue;

    // 全PDFのデータを結合
    allShiftData = allShiftData.concat(shiftData);
    // 処理済みPDFをゴミ箱に移動
    trashPdfFile(pdfFile);
  }

  // 開始時間順でソート
  allShiftData.sort(function(a, b) { return a.start.localeCompare(b.start); });
  return allShiftData;
}

// ============================================================
// ユーティリティ
// ============================================================

/**
 * Date を YYYY-MM-DD 形式に変換
 */
function formatDateToISO_(d) {
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
}

/**
 * テスト用 - 手動実行でPDF解析結果を確認
 */
function testParsePdf() {
  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    Logger.log('PDFなし');
    return;
  }

  for (var i = 0; i < pdfFiles.length; i++) {
    var pdfFile = pdfFiles[i];
    Logger.log('--- ' + pdfFile.getName() + ' ---');

    var text = extractTextFromPdf(pdfFile);
    if (!text) {
      Logger.log('テキスト抽出失敗');
      continue;
    }
    Logger.log('抽出テキスト:\n' + text);

    var tomorrow = getTomorrow();
    var data = parseShiftData(text, tomorrow);
    Logger.log('シフトデータ: ' + JSON.stringify(data, null, 2));

    var result = buildReminderMessage(data, tomorrow);
    Logger.log('送信メッセージ:\n' + result.messageText);
  }
}

/**
 * テスト用 - Sheets読み取りを確認
 */
function testSheetsRead() {
  loadStaffMappingFromSheets_();
  Logger.log('STAFF_MAPPING: ' + JSON.stringify(STAFF_MAPPING));

  var tomorrow = getTomorrow();
  var tomorrowISO = formatDateToISO_(tomorrow.dateObj);
  var data = getShiftsFromSheets_(tomorrowISO);
  Logger.log('翌日シフト (' + tomorrowISO + '): ' + JSON.stringify(data, null, 2));
}

/**
 * タイムトリガーを設定する（初回のみ手動実行）
 */
function setupTrigger() {
  // 既存のmainトリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 毎日12:00に実行するトリガーを作成
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .nearMinute(0)
    .inTimezone(TIMEZONE)
    .create();

  Logger.log('トリガー設定完了: 毎日12:00 (JST)');
}

/**
 * 前月のシフトデータを削除する（毎月1日に自動実行）
 */
function triggerDeleteLastMonthShifts() {
  Logger.log('=== 前月シフト削除 開始 ===');

  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const targetYear = lastMonth.getFullYear();
  const targetMonth = lastMonth.getMonth(); // 0-indexed

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    Logger.log('シフトシートが見つかりません');
    return;
  }

  const data = sheet.getDataRange().getValues();
  let deleteCount = 0;

  // 後ろから削除（行ずれ防止）
  for (let i = data.length - 1; i >= 1; i--) {
    const rawDate = data[i][0];
    if (!rawDate) continue;
    const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (isNaN(d.getTime())) continue;

    if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
      sheet.deleteRow(i + 1);
      deleteCount++;
    }
  }

  const label = targetYear + '年' + (targetMonth + 1) + '月';
  Logger.log(label + ' のシフトデータを ' + deleteCount + ' 件削除しました。');
  writeLogToSheets_(label, deleteCount, 'auto', 'success', '前月シフト自動削除');

  Logger.log('=== 前月シフト削除 完了 ===');
}

/**
 * シフト不足アラートを送信する (5日後対象)
 */
function checkAndSendShortageAlert_() {
  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + SHIFT_SHORTAGE_ALERT_DAYS); // 5日後

  Logger.log('シフト不足チェック対象日: ' + formatDateToISO_(targetDate));

  const shortageSlots = checkShiftShortageForDate(targetDate);

  if (shortageSlots.length > 0) {
    const dateStr = Utilities.formatDate(targetDate, TIMEZONE, 'M月d日(E)'); // 例: 2月19日(水)

    let msg = '🚨 【シフト不足のお知らせ】\n';
    msg += dateStr + ' のシフトが不足しています！\n\n';
    msg += '不足時間帯: ' + shortageSlots.join(', ') + '\n';
    msg += '該当するスタッフの方はご協力をお願いします！';

    sendLineWorksGroupMessage(msg);
    Logger.log('シフト不足アラート送信: ' + dateStr);
  } else {
    Logger.log('シフト不足なし');
  }
}

// ============================================================
// スプレッドシートメニューから呼び出す関数
// ============================================================

/**
 * メニュー: PDF解析 → シート取込
 * DriveフォルダのPDFを解析し、シフトデータを「シフト」シートに書き込む
 */
function menuParsePdf() {
  const ui = SpreadsheetApp.getUi();

  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    ui.alert('PDFが見つかりません', 'Driveフォルダ内にPDFファイルがありません。', ui.ButtonSet.OK);
    return;
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SHIFTS);
    sheet.getRange(1, 1, 1, 8).setValues([['日付', '曜日', 'スタッフ名', '開始時刻', '終了時刻', '業務内容', '登録日時', '登録元']]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  // 重複チェック用の既存データを取得
  const existingData = sheet.getDataRange().getValues();
  const shiftCache = new Set();
  for (let j = 1; j < existingData.length; j++) {
    const d = existingData[j][0] instanceof Date ? formatDateToISO_(existingData[j][0]) : String(existingData[j][0]);
    const name = String(existingData[j][2]).trim();
    const startTime = formatCellTime_(existingData[j][3]);

    // キー: 日付|名前|開始時刻
    const key = d + '|' + name + '|' + startTime;
    shiftCache.add(key);
  }

  let totalImported = 0;
  let totalSkipped = 0;
  let registeredCountTotal = 0;
  let processedFileNames = [];

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    const fileName = pdfFile.getName();
    Logger.log('--- PDF処理開始: ' + fileName + ' ---');

    const shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) {
      Logger.log('テキスト抽出失敗: ' + fileName);
      continue;
    }

    // テキストから全日付ブロックを抽出
    const allShifts = parseAllShiftsFromText_(shiftText);
    let fileImported = 0;
    let fileSkipped = 0;

    // カレンダー登録（重複はカレンダー側でもチェックされる）
    const calendarCount = registerShiftsToCalendar(allShifts);
    registeredCountTotal += calendarCount;

    for (const entry of allShifts) {
      const dateStr = entry.date;
      const dayOfWeek = entry.dayOfWeek;

      for (const staff of entry.shifts) {
        // 重複チェック
        const key = dateStr + '|' + staff.name + '|' + staff.start;
        if (shiftCache.has(key)) {
          fileSkipped++;
          continue;
        }

        const tasks = staff.tasks.length > 0 ? staff.tasks.join(' / ') : '';
        sheet.appendRow([
          dateStr,
          dayOfWeek,
          staff.name,
          staff.start,
          staff.end,
          tasks,
          new Date(),
          'pdf_import'
        ]);
        shiftCache.add(key);
        fileImported++;
      }
    }

    // 処理済みファイルをゴミ箱へ
    pdfFile.setTrashed(true);
    processedFileNames.push(fileName);

    totalImported += fileImported;
    totalSkipped += fileSkipped;
    Logger.log('結果: ' + fileName + ' -> 新規:' + fileImported + '件, 重複スキップ:' + fileSkipped + '件');
  }

  // 結果表示
  if (processedFileNames.length > 0) {
    let msg = processedFileNames.length + ' 個のファイルを処理し、ゴミ箱へ移動しました。\n\n';
    msg += '・新規取込: ' + totalImported + ' 件\n';
    msg += '・重複のためスキップ: ' + totalSkipped + ' 件\n';
    msg += '・カレンダー登録/更新: ' + registeredCountTotal + ' 件';
    ui.alert('PDF取込結果', msg, ui.ButtonSet.OK);
  } else {
    ui.alert('処理対象なし', 'PDFファイルが見つからないか、解析に失敗しました。', ui.ButtonSet.OK);
  }
}

/**
 * PDF全文から全日付のシフトを抽出する（menuParsePdf用）
 */
function parseAllShiftsFromText_(text) {
  const lines = text.split('\n');
  const results = [];
  let currentBlock = null;
  let currentDateStr = null;
  let currentDayOfWeek = null;

  for (const line of lines) {
    const dateMatch = line.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*[（(](.)[）)]/);
    if (dateMatch) {
      // 前のブロックを処理
      if (currentBlock && currentDateStr) {
        const shifts = parseStaffLines(currentBlock);
        if (shifts.length > 0) {
          results.push({ date: currentDateStr, dayOfWeek: currentDayOfWeek, shifts: shifts });
        }
      }
      // YYYY-MM-DD形式
      currentDateStr = dateMatch[1] + '-' + String(dateMatch[2]).padStart(2, '0') + '-' + String(dateMatch[3]).padStart(2, '0');
      currentDayOfWeek = dateMatch[4]; // 曜日 (月, 火, ...) 
      currentBlock = [];
      continue;
    }
    if (currentBlock !== null) {
      currentBlock.push(line);
    }
  }
  // 最後のブロック
  if (currentBlock && currentDateStr) {
    const shifts = parseStaffLines(currentBlock);
    if (shifts.length > 0) {
      results.push({ date: currentDateStr, dayOfWeek: currentDayOfWeek, shifts: shifts });
    }
  }

  return results;
}

/**
 * メニュー: リマインド手動送信
 * 12:00基準で次のシフト日を自動判定して送信する
 * - 12:00より前 → 当日のシフトをリマインド
 * - 12:00以降 → 翌日のシフトをリマインド
 */
function menuSendReminder() {
  const ui = SpreadsheetApp.getUi();

  // スタッフマッピングを最新化
  loadStaffMappingFromSheets_();

  const now = new Date();
  const hour = parseInt(Utilities.formatDate(now, TIMEZONE, 'H'));

  let initialTarget;
  if (hour < 12) {
    // 12時前 → 当日（ただし当日が休みなら次営業日）
    const hours = getBusinessHours(now);
    initialTarget = hours ? now : findNextBusinessDay_(now);
  } else {
    // 12時以降 → 翌日以降の最初の営業日
    initialTarget = findNextBusinessDay_(now);
  }

  const targetDate = initialTarget;
  const targetISO = formatDateToISO_(targetDate);
  const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][targetDate.getDay()];
  const displayStr = targetDate.getFullYear() + '年' + (targetDate.getMonth() + 1) + '月' + targetDate.getDate() + '日（' + dayOfWeek + '）';

  const tomorrow = {
    formatted: Utilities.formatDate(targetDate, TIMEZONE, 'yyyy年MM月dd日'),
    dateObj: targetDate,
    displayStr: displayStr
  };

  // シフトデータ取得
  var shiftData = getShiftsFromSheets_(targetISO);

  if (shiftData.length === 0) {
    // PDFフォールバック
    shiftData = getShiftsFromPdfFallback_(tomorrow);
  }

  if (shiftData.length === 0) {
    ui.alert('シフトなし', displayStr + ' のシフトデータが見つかりません。\n\n「シフト」シートにデータを入力するか、PDFをアップロードしてください。', ui.ButtonSet.OK);
    return;
  }

  // 確認ダイアログ
  const confirmMsg = displayStr + ' のリマインドを送信します。\n\n' +
    'スタッフ数: ' + shiftData.length + '名\n' +
    'よろしいですか？';

  const response = ui.alert('リマインド送信確認', confirmMsg, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) {
    ui.alert('キャンセルしました。');
    return;
  }

  // 送信
  const success = sendLineWorksReminder(shiftData, tomorrow);

  writeLogToSheets_(targetISO, shiftData.length, 'manual',
    success ? 'success' : 'error',
    success ? '手動送信' : '手動送信失敗'
  );

  if (success) {
    ui.alert('送信完了', displayStr + ' のリマインドを送信しました。\n(' + shiftData.length + '名)', ui.ButtonSet.OK);
  } else {
    ui.alert('送信失敗', 'リマインドの送信に失敗しました。\nGASの実行ログを確認してください。', ui.ButtonSet.OK);
  }
}

/**
 * 設定シートの「Meetup重複通知」チェックボックスがONか判定する
 * キーが見つからない場合はON（true）を返す
 * @returns {boolean}
 */
function isMeetupNotificationEnabled_() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return true;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'Meetup重複通知') {
        return data[i][1] === true || String(data[i][1]).toUpperCase() === 'TRUE';
      }
    }
  } catch (e) {
    Logger.log('Meetup通知設定取得エラー: ' + e.message);
  }
  return true; // キーが見つからない場合はONとして扱う
}

/**
 * 週始めMeetup共有を送信する（トリガー実行用 entry point）
 * 実行推奨: 毎週月曜9時（fetchMeetupScheduleが8時に翌週データを更新した後）
 */
function triggerWeeklyMeetupShare() {
  Logger.log('=== 週次Meetup共有 実行開始 ===');

  var result = getMeetupsForWeek_();
  var meetups = result.meetups;
  var weekStart = result.weekStart;
  var weekEnd = result.weekEnd;

  if (meetups.length === 0) {
    Logger.log('今週のMeetup予定はありません');
    Logger.log('=== 週次Meetup共有 完了 ===');
    return;
  }

  var message = buildWeeklyMeetupMessage_(meetups, weekStart, weekEnd);
  var success = sendLineWorksGroupMessage(message);
  Logger.log(success ? '週次Meetup共有送信成功: ' + meetups.length + '件' : '週次Meetup共有送信失敗');
  Logger.log('=== 週次Meetup共有 完了 ===');
}

/**
 * 指定日のMeetup予定一覧をスプレッドシートから取得する
 * @param {Date} targetDate
 * @returns {Array<{ company: string, time: string, kind: string, reserveId: string|null, description: string|null, url: string|null }>}
 */
function getMeetupsForDay_(targetDate) {
  var targetISO = formatDateToISO_(targetDate);
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_MEETUP);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    var data = sheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var dateVal = data[i][0];
      if (!dateVal) continue;
      var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
      if (isNaN(d.getTime())) continue;
      if (formatDateToISO_(d) !== targetISO) continue;

      results.push({
        company: String(data[i][1]).trim(),
        time: String(data[i][2]).trim(),
        kind: String(data[i][3]).trim()
      });
    }
    return results;
  } catch (e) {
    Logger.log('getMeetupsForDay_ エラー: ' + e.message);
    return [];
  }
}

/**
 * シフト時間とMeetup時間の重複をチェックする
 * 重複条件: shiftStart < meetupEnd AND meetupStart < shiftEnd
 * @param {string} shiftStart - "HH:mm"
 * @param {string} shiftEnd   - "HH:mm"
 * @param {Array}  meetups    - getMeetupsForDay_() の戻り値
 * @returns {Array} 重複するMeetupの配列
 */
function findOverlappingMeetups_(shiftStart, shiftEnd, meetups) {
  if (!meetups || meetups.length === 0) return [];

  var shiftStartDate = stringToDate_(shiftStart);
  var shiftEndDate = stringToDate_(shiftEnd);

  return meetups.filter(function(m) {
    // "10:00 ~ 11:00" 形式をパース
    var parts = m.time.split(/\s*~\s*/);
    if (parts.length < 2) return false;
    var meetupStart = stringToDate_(parts[0].trim());
    var meetupEnd = stringToDate_(parts[1].trim());
    return shiftStartDate < meetupEnd && meetupStart < shiftEndDate;
  });
}

/**
 * メニュー: スタッフ更新
 * 「スタッフ」シートからSTAFF_MAPPINGを再読み込みする
 */
function menuRefreshStaff() {
  const ui = SpreadsheetApp.getUi();
  loadStaffMappingFromSheets_();

  const staffNames = Object.keys(STAFF_MAPPING);
  if (staffNames.length === 0) {
    ui.alert('スタッフ更新', '「スタッフ」シートにデータがありません。\n\nA列: スタッフ名、B列: LINE WORKS ID、C列: 有効(TRUE/FALSE) を入力してください。', ui.ButtonSet.OK);
    return;
  }

  let list = '';
  for (const name of staffNames) {
    list += '・' + name + ' → ' + STAFF_MAPPING[name] + '\n';
  }
  ui.alert('スタッフ更新完了', staffNames.length + '名のスタッフを読み込みました。\n\n' + list, ui.ButtonSet.OK);
}
