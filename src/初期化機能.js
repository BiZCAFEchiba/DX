// ============================================================
// setup.gs - スプレッドシート初期化・メニュー追加
// ============================================================

/**
 * スプレッドシートを開いたときに実行される
 * メニュー「設定」→「初期化」を追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('ShiftReminder')
    .addItem('シート初期化', 'initSheets')
    .addItem('「設定」シート作成', 'createSettingsSheet')
    .addSeparator()
    .addItem('PDF解析 → シート取込（手動）', 'menuParsePdf')
    .addItem('PDF自動取込（即時実行）', 'autoProcessPdfFromDrive')
    .addItem('リマインド手動送信', 'menuSendReminder')
    .addSeparator()
    .addItem('スタッフ更新', 'menuRefreshStaff')
    .addItem('受信ID取得', 'requestNameRegistration')
    .addSeparator()
    .addItem('既存シフトをカレンダー同期', 'menuSyncCalendarFromSheet')
    .addSeparator()
    .addItem('自動送信（トリガー）設定', 'setupTriggers')
    .addToUi();

  ui.createMenu('Meetup管理')
    .addItem('Meetup取り込み（今日から30日分・差分追加）', 'menuFetchAllMeetups')
    .addItem('予約ID補完（F列）', 'fillMissingIds')
    .addItem('参加数・卒年を更新（E・G列）', 'menuUpdateParticipation')
    .addSeparator()
    .addItem('週次Meetupカルーセル共有（手動）', 'weeklyMeetupCarousel')
    .addSeparator()
    .addItem('企業IDマスター初期化', 'initCompanyIdMasterSheet')
    .addItem('企業マスター テーマ補完', 'menuSyncCompanyMaster')
    .addItem('企業マスター 業界をGeminiで分類', 'menuFillIndustry')
    .addSeparator()
    .addItem('Meetup企業フォーム 選択肢を更新', 'menuSyncMeetupForm')
    .addItem('Meetup企業フォーム 送信トリガー設定', 'setupMeetupFormTrigger')
    .addItem('トリガー設定（設定シートから）', 'setupTriggers')
    .addToUi();
}

/**
 * 業界が空の企業をGeminiで分類する（メニューから手動実行用）
 */
function menuFillIndustry() {
  fillIndustryWithGemini_();
  SpreadsheetApp.getUi().alert('業界の分類が完了しました。「企業IDマスター」シートを確認してください。');
}

/**
 * 企業IDマスターのテーマ空欄を補完する（メニューから手動実行用）
 */
function menuSyncCompanyMaster() {
  const cookies = loginToShirucafe_();
  if (!cookies) {
    SpreadsheetApp.getUi().alert('SHIRUCAFEへのログインに失敗しました。');
    return;
  }
  syncNewCompaniesToMaster_(cookies);
  SpreadsheetApp.getUi().alert('企業IDマスターのテーマ補完が完了しました。');
}

/**
 * メニューから呼び出すMeetup取込ラッパー（確認ダイアログ付き）
 */
function menuFetchMeetup() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'Meetup取り込み',
    '翌週1週間分のMeetup予定を「Meetup予定」シートに取り込みます。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  try {
    fetchMeetupSchedule();
    ui.alert('完了', '「Meetup予定」シートにデータを取り込みました。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', '取り込みに失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * 参加数更新ラッパー（E列のみ更新）
 */
function menuUpdateParticipation() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '参加数更新',
    '「Meetup予定」シートのE列（参加数）を更新します。\n企業IDマスターにreserveIDがある企業のみ対象です。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  try {
    updateParticipationOnly();
    ui.alert('完了', '参加数を更新しました。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', '更新に失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * 全期間Meetup取込ラッパー（60日分・確認ダイアログ付き）
 */
function menuFetchAllMeetups() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '全期間Meetup取り込み',
    '今日から60日分のMeetup予定を取込みます。\n「Meetup予定」シートを全件書き直します。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  try {
    fetchAllUpcomingMeetups();
    ui.alert('完了', '「Meetup予定」シートにデータを取り込みました。\n参加数（E列）も更新されました。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', '取り込みに失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * 今週分Meetup取込ラッパー（追記・確認ダイアログ付き）
 */
function menuFetchThisWeekMeetup() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '今週分Meetup取り込み',
    '今週分のMeetup予定を「Meetup予定」シートの末尾に追記します。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  try {
    fetchThisWeekMeetupSchedule();
    ui.alert('完了', '今週分のMeetupデータを追記しました。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', '取り込みに失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * SHIRUCAFEから卒年・テーマ・業界・フックを全行取得して上書きするラッパー
 */
function menuRefetchAllFields() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '企業詳細取得',
    '「企業IDマスター」シートのreserveIDをもとに、SHIRUCAFEから\n卒年・テーマ・業界・フックを取得してシートに書き込みます。\n\nreserveIDが空の行はスキップされます。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;
  try {
    refetchThemesFromSHIRUCAFE();
    ui.alert('完了', '企業詳細の取得が完了しました。\n「企業IDマスター」シートを確認してください。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', '取得に失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * シートの初期化を行う
 * 必要なシート（シフト, スタッフ, 送信ログ, 営業時間）を作成し、ヘッダーを設定する
 * 誤操作防止のため確認ダイアログを表示
 */
function initSheets() {
  const ui = SpreadsheetApp.getUi();

  // 確認ダイアログ 1
  const response1 = ui.alert(
    'シート初期化',
    '必要なシート（シフト、スタッフ、送信ログ、営業時間）を作成・初期化します。\n' +
    '既存の同名シートがある場合、上書きされる可能性があります。\n' +
    '実行してよろしいですか？',
    ui.ButtonSet.YES_NO
  );

  if (response1 !== ui.Button.YES) {
    ui.alert('キャンセルしました。');
    return;
  }

  // 確認ダイアログ 2 (念押し)
  const response2 = ui.alert(
    '最終確認',
    '本当に実行しますか？\nこの操作は取り消せません。',
    ui.ButtonSet.YES_NO
  );

  if (response2 !== ui.Button.YES) {
    ui.alert('キャンセルしました。');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. シフトシート
  ensureSheet_(ss, SHEET_SHIFTS, [
    ['日付', '曜日', 'スタッフ名', '開始時刻', '終了時刻', '業務内容', '登録日時', '登録元', '確認状況']
  ]);

  // 2. スタッフシート
  ensureSheet_(ss, SHEET_STAFF, [
    ['スタッフ名', 'LINE WORKS ID', '有効', '登録日', 'Googleカレンダー用メール']
  ]);

  // 3. 送信ログシート
  ensureSheet_(ss, SHEET_LOGS, [
    ['送信日時', '対象日', 'スタッフ数', '送信方法', '結果', '詳細']
  ]);

  // 4. 営業時間シート
  ensureSheet_(ss, BUSINESS_HOURS_SHEET_NAME, [
    ['曜日', '開店時間', '閉店時間', '営業日(チェックを入れる)']
  ]);

  // 5. 設定シート
  ensureSheet_(ss, SHEET_SETTINGS, [
    ['設定項目', '値', '説明'],
    ['翌日リマインド実行時間（時）', 12, 'リマインドを送信する時間（0〜23）'],
    ['追っかけリマインド実行時間（時）', 17, '未確認者へ再送する時間（0〜23）'],
    ['シフト不足アラート実行時間（時）', 12, '不足警告を送信する時間（0〜23）'],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
    ['Meetup重複通知', true, '対面MeetupをシフトリマインドのMeetupに表示する（チェック=ON）']
  ]);

  // 既存スプシにもMeetup設定行を追加（10行目）
  addMeetupNotificationSetting_();

  // 営業時間シートに初期データがない場合、曜日ごとのデフォルトを追加
  const businessSheet = ss.getSheetByName(BUSINESS_HOURS_SHEET_NAME);
  if (businessSheet && businessSheet.getLastRow() === 1) { // ヘッダーのみの場合
    const days = ['月', '火', '水', '木', '金', '土', '日'];
    const defaultData = days.map(day => [day, '10:00', '20:00', true]); // デフォルトは全日営業(true)
    businessSheet.getRange(2, 1, defaultData.length, defaultData[0].length).setValues(defaultData);
    // D列にチェックボックスを設定
    businessSheet.getRange(2, 4, defaultData.length, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireCheckbox().build()
    );
  }

  ui.alert('初期化が完了しました。');
}

/**
 * 「設定」シートのみを作成・初期化する
 */
function createSettingsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  const sheetName = SHEET_SETTINGS;
  let sheet = ss.getSheetByName(sheetName);

  if (sheet) {
    ui.alert('確認', '「' + sheetName + '」シートは既に存在します。', ui.ButtonSet.OK);
    return;
  }

  ensureSheet_(ss, sheetName, [
    ['設定項目', '値', '説明'],
    ['翌日リマインド実行時間（時）', 12, 'リマインドを送信する時間（0〜23）'],
    ['追っかけリマインド実行時間（時）', 17, '未確認者へ再送する時間（0〜23）'],
    ['シフト不足アラート実行時間（時）', 12, '不足警告を送信する時間（0〜23）'],
    ['Meetup日次更新実行時間（時）', 7, 'Meetup予定の取込・ID補完・参加数更新を毎日実行する時間（0〜23）'],
    ['週次Meetup共有実行時間（時）', 18, '毎週日曜に来週Meetupをスタッフへ共有する時間（0〜23）'],
    ['', '', ''],
    ['', '', ''],
    ['Meetup重複通知', true, '対面MeetupをシフトリマインドのMeetupに表示する（チェック=ON）']
  ]);

  addMeetupNotificationSetting_();
  ui.alert('完了', '「' + sheetName + '」シートを作成しました。', ui.ButtonSet.OK);
}

/**
 * シートが存在しない場合は作成し、ヘッダーを設定する
 * @param {Spreadsheet} ss
 * @param {string} sheetName
 * @param {Array<Array<string>>} headers
 */
function ensureSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log('シート作成: ' + sheetName);
  }

  // ヘッダーがまだない（空のシート）場合のみヘッダー書き込み
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, headers.length, headers[0].length).setValues(headers);
    sheet.getRange(1, 1, 1, headers[0].length).setFontWeight('bold');
    sheet.setFrozenRows(1);

    if (sheetName === SHEET_STAFF) {
      sheet.appendRow(['サンプル太郎', 'user_id_placeholder', true, new Date()]);
    }
  }
}

/**
 * 設定シートの10行目にMeetup重複通知チェックボックスを追加する
 * 既に存在する場合はチェックボックス設定のみ確認してスキップ
 */
function addMeetupNotificationSetting_() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return;

    // 既に設定行がある場合はチェックボックス設定だけ確認してスキップ
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'Meetup重複通知') {
        sheet.getRange(i + 1, 2).setDataValidation(
          SpreadsheetApp.newDataValidation().requireCheckbox().build()
        );
        Logger.log('Meetup重複通知: 既存設定を確認しました（' + (i + 1) + '行目）');
        return;
      }
    }

    // 9行目まで空行で埋める
    const currentRows = sheet.getLastRow();
    if (currentRows < 9) {
      const padding = [];
      for (let r = 0; r < 9 - currentRows; r++) padding.push(['', '', '']);
      sheet.getRange(currentRows + 1, 1, padding.length, 3).setValues(padding);
    }

    // 10行目に追加
    sheet.getRange(10, 1, 1, 3).setValues([[
      'Meetup重複通知',
      true,
      '対面MeetupをシフトリマインドのMeetupに表示する（チェック=ON）'
    ]]);
    sheet.getRange(10, 2).setDataValidation(
      SpreadsheetApp.newDataValidation().requireCheckbox().build()
    );
    Logger.log('Meetup重複通知設定を10行目に追加しました');
  } catch (e) {
    Logger.log('Meetup設定追加エラー: ' + e.message);
  }
}

/**
 * 設定シートのテストモード行を正しい順番に整理する
 * 順序: テストモード → Meetupテストモード → 誘致テストモード → フォーム同期
 * GASエディタから1回手動実行するか、setupTriggers() 経由で自動実行される
 */
function fixTestModeOrder() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return;

    var ORDER = ['テストモード', 'Meetupテストモード', '誘致テストモード', 'フォーム同期'];
    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(1, 1, lastRow, 3).getValues();

    // 対象行のインデックス（0-based）を収集
    var rowMap = {}; // key → { rowIdx, values }
    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][0]);
      if (ORDER.indexOf(key) !== -1) {
        rowMap[key] = { rowIdx: i, values: data[i].slice() };
      }
    }

    // 揃っていない（不足 or 順序が正しい）なら何もしない
    var foundKeys = Object.keys(rowMap);
    if (foundKeys.length < 2) return;

    // テストモード行の位置を基準に、その直後に残りを挿入
    var baseRow = rowMap['テストモード'] ? rowMap['テストモード'].rowIdx + 2 : null; // 1-indexed
    if (!baseRow) return;

    // ORDER通りに並んでいるか確認
    var positions = ORDER.map(function(k) { return rowMap[k] ? rowMap[k].rowIdx : -1; });
    var isOrdered = true;
    var last = -1;
    for (var p = 0; p < positions.length; p++) {
      if (positions[p] === -1) continue;
      if (positions[p] < last) { isOrdered = false; break; }
      last = positions[p];
    }
    if (isOrdered) {
      Logger.log('fixTestModeOrder: 既に正しい順序です');
      return;
    }

    // テストモード行はアンカーとして残し、他の3行だけ削除して直後に再挿入
    var MOVE_KEYS = ['Meetupテストモード', '誘致テストモード', 'フォーム同期'];
    var deleteRowIdxs = MOVE_KEYS
      .filter(function(k) { return rowMap[k]; })
      .map(function(k) { return rowMap[k].rowIdx + 1; }); // 1-indexed
    deleteRowIdxs.sort(function(a, b) { return b - a; }); // 後ろから削除
    deleteRowIdxs.forEach(function(r) { sheet.deleteRow(r); });

    // テストモード行の現在位置を再取得
    var newData = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
    var anchorRow = 1;
    for (var n = 0; n < newData.length; n++) {
      if (String(newData[n][0]) === 'テストモード') { anchorRow = n + 1; break; }
    }

    // アンカー直後にMOVE_KEYS順で再挿入
    MOVE_KEYS.forEach(function(k, offset) {
      if (!rowMap[k]) return;
      sheet.insertRowAfter(anchorRow + offset);
      sheet.getRange(anchorRow + offset + 1, 1, 1, 3).setValues([rowMap[k].values]);
      sheet.getRange(anchorRow + offset + 1, 2).setDataValidation(
        SpreadsheetApp.newDataValidation().requireCheckbox().build()
      );
    });

    Logger.log('fixTestModeOrder: 順序を整理しました');
  } catch (e) {
    Logger.log('fixTestModeOrder エラー: ' + e.message);
  }
}

/**
 * メニュー: 設定シートにMeetup通知設定行を追加する
 */
function menuAddMeetupSetting() {
  addMeetupNotificationSetting_();
  SpreadsheetApp.getUi().alert('完了', '設定シートの10行目にMeetup重複通知チェックボックスを追加しました。', SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 現在登録されているトリガーを全件ログ出力する（診断用）
 */
function listAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('=== 登録トリガー一覧 (' + triggers.length + '件) ===');
  triggers.forEach(function(t) {
    Logger.log('[' + t.getHandlerFunction() + '] ' + t.getTriggerSource() + ' / ' + t.getEventType() + ' / ID:' + t.getUniqueId());
  });
}

/**
 * 全トリガーを削除してから再設定する（重複解消用）
 */
function resetAllTriggers() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'トリガー全リセット',
    '全トリガーを一度削除してから再設定します。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  // 全削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  // 設定シートに基づいて全トリガーを再作成
  const results = updateTriggersFromSettings_();
  ui.alert('リセット完了', results, ui.ButtonSet.OK);
}

function setupTriggers() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    'トリガー設定',
    '設定シートの時刻に基づいて、自動送信トリガーを作成・更新します。\n実行しますか？',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  try {
    const results = updateTriggersFromSettings_();
    ui.alert('設定完了', '自動送信トリガーを作成・更新しました。\n' + results, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', 'トリガーの設定に失敗しました: ' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * 設定シートに基づいてトリガーを更新する（内部用）
 * @returns {string} 設定内容の要約
 */
function updateTriggersFromSettings_() {
  // 設定シートに不足行があれば補完
  ensureMissingSettings_([
    ['Meetup日次更新実行時間（時）', 7, 'Meetup予定の取込・ID補完・参加数更新を毎日実行する時間（0〜23）'],
    ['週次Meetup共有実行時間（時）', 18, '毎週日曜に来週Meetupをスタッフへ共有する時間（0〜23）'],
    ['テストモード', false, 'ONにするとシフトリマインドをテストグループへ送信（OFFで本番）'],
    ['Meetupテストモード', false, 'ONにするとMeetup告知をテストグループへ送信（OFFで本番）'],
    ['誘致テストモード', false, 'ONにすると誘致情報をテストグループへ送信（OFFで本番）'],
    ['フォーム同期', false, 'ONにするとMeetup企業選択フォームの選択肢を自動更新（権限がある場合のみON）']
  ]);

  // テストモード行の順序を整理
  fixTestModeOrder();

  // 既存のトリガーを削除
  ['triggerShiftReminder', 'triggerShortageAlert', 'triggerFollowUpReminder',
   'triggerDeleteLastMonthShifts', 'triggerWeeklyMeetupShare', 'weeklyMeetupCarousel',
   'dailyMeetupUpdate', 'cleanupPastMeetups', 'autoProcessPdfFromDrive',
   'fetchMeetupSchedule', 'fetchAllUpcomingMeetups', 'main'].forEach(deleteExistingTriggers_);

  // 設定シートから時間を取得
  const reminderHour   = getSettingValue_('翌日リマインド実行時間（時）', 12);
  const shortageHour   = getSettingValue_('シフト不足アラート実行時間（時）', 12);
  const followUpHour   = getSettingValue_('追っかけリマインド実行時間（時）', 17);
  const meetupHour     = getSettingValue_('Meetup日次更新実行時間（時）', 7);
  const meetupShareHour = getSettingValue_('週次Meetup共有実行時間（時）', 18);

  // シフトリマインド
  ScriptApp.newTrigger('triggerShiftReminder').timeBased().atHour(reminderHour).everyDays(1).create();
  // シフト不足アラート
  ScriptApp.newTrigger('triggerShortageAlert').timeBased().atHour(shortageHour).everyDays(1).create();
  // 追っかけリマインド
  ScriptApp.newTrigger('triggerFollowUpReminder').timeBased().atHour(followUpHour).everyDays(1).create();
  // 前月シフト自動削除（毎月1日2時）
  ScriptApp.newTrigger('triggerDeleteLastMonthShifts').timeBased().onMonthDay(1).atHour(2).create();
  // Meetup日次更新（取込→ID補完→参加数更新）
  ScriptApp.newTrigger('dailyMeetupUpdate').timeBased().atHour(meetupHour).everyDays(1).create();
  // 過去Meetup行削除（毎日0時）
  ScriptApp.newTrigger('cleanupPastMeetups').timeBased().atHour(0).everyDays(1).create();
  // 週次Meetupカルーセル共有（毎週日曜・Meetup告知Bot）
  ScriptApp.newTrigger('weeklyMeetupCarousel').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(meetupShareHour).create();

  // PDF自動取込（05:00 / 10:00 / 19:00 / 22:00 JST）
  [5, 10, 19, 22].forEach(function(hour) {
    ScriptApp.newTrigger('autoProcessPdfFromDrive').timeBased().atHour(hour).everyDays(1).inTimezone(TIMEZONE).create();
  });

  return 'リマインド(' + reminderHour + '時) / 不足警告(' + shortageHour + '時) / 追っかけ(' + followUpHour + '時)\n' +
         'Meetup日次更新(' + meetupHour + '時) / Meetupカルーセル共有(毎週日曜' + meetupShareHour + '時) / 過去削除(毎日0時)\n' +
         'PDF自動取込(5時/10時/19時/22時)';
}

/**
 * 指定した名前の既存トリガーを削除する
 */
function deleteExistingTriggers_(functionName) {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * 【テスト用】1分後に追っかけリマインドを実行するトリガーを設定する
 */
function setupTestFollowUpTrigger() {
  const ui = SpreadsheetApp.getUi();
  const now = new Date();
  const testTime = new Date(now.getTime() + 60 * 1000); // 1分後

  // 既存の追っかけトリガーを一旦削除（重複防止）
  deleteExistingTriggers_('triggerFollowUpReminder');

  // 指定時刻に1回だけ実行するトリガーを作成
  ScriptApp.newTrigger('triggerFollowUpReminder')
    .timeBased()
    .at(testTime)
    .create();

  ui.alert(
    'テスト設定完了',
    '約1分後に「追っかけリマインド」が自動実行されます。\n\n' +
    '【確認方法】\n' +
    '1. 1〜2分待機する\n' +
    '2. LINE WORKSに通知が届くか確認\n' +
    '3. 「送信ログ」シートに記録されるか確認\n\n' +
    '※テスト後は「自動送信（トリガー）設定」を再度実行して、通常の毎日17時設定に戻してください。',
    ui.ButtonSet.OK
  );
}

/**
 * 【診断用】Webhook受信フローを手動でテストする
 * GASエディタから直接実行して結果を確認する
 */
function testDiagnose() {
  Logger.log('=== 診断開始 ===');

  // 1. スプシへの書き込みテスト
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    Logger.log('スプシ接続: OK - ' + ss.getName());
    const logSheet = ss.getSheetByName(SHEET_LOGS);
    Logger.log('送信ログシート: ' + (logSheet ? 'あり' : 'なし（SHEET_LOGS=' + SHEET_LOGS + '）'));
    const staffSheet = ss.getSheetByName(SHEET_STAFF);
    Logger.log('スタッフシート: ' + (staffSheet ? 'あり / 行数=' + staffSheet.getLastRow() : 'なし'));
  } catch (e) {
    Logger.log('スプシ接続エラー: ' + e.message);
  }

  // 2. 直接appendRowテスト（writeLogToSheets_を経由しない）
  try {
    const ss2 = SpreadsheetApp.openById(SPREADSHEET_ID);
    const logSheet2 = ss2.getSheetByName(SHEET_LOGS);
    if (logSheet2) {
      logSheet2.appendRow([new Date(), '直接書き込みテスト', 0, 'test', 'info', '診断用']);
      Logger.log('直接appendRow: OK → 送信ログに「直接書き込みテスト」が追加されているはず');
    } else {
      Logger.log('直接appendRow: 送信ログシートが取得できない（SHEET_LOGS=' + SHEET_LOGS + '）');
    }
  } catch (e) {
    Logger.log('直接appendRowエラー: ' + e.message);
  }

  // 3. スタッフマッピング読み込みテスト
  try {
    const mappings = loadStaffMappingFromSheets_();
    Logger.log('送信マッピング件数: ' + Object.keys(mappings.send).length);
    Logger.log('受信マッピング件数: ' + Object.keys(mappings.recv).length);
    Logger.log('送信マッピング内容: ' + JSON.stringify(mappings.send));
    Logger.log('受信マッピング内容: ' + JSON.stringify(mappings.recv));
  } catch (e) {
    Logger.log('マッピング読込エラー: ' + e.message);
  }

  // 4. LINE Works APIトークン取得テスト
  try {
    const token = getLineWorksAccessToken();
    Logger.log('アクセストークン: ' + (token ? 'OK（取得成功）' : 'null（失敗）'));
  } catch (e) {
    Logger.log('トークン取得エラー: ' + e.message);
  }

  Logger.log('=== 診断終了 ===');
}


/**
 * 設定シートから値を取得する
 */
function getSettingValue_(key, defaultValue) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return defaultValue;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        const val = parseInt(data[i][1]);
        return isNaN(val) ? defaultValue : val;
      }
    }
  } catch (e) {
    Logger.log('設定取得エラー: ' + e.message);
  }
  return defaultValue;
}

/**
 * 設定シートに指定のキーが存在しない場合のみ行を追加する
 * @param {Array<Array>} rows - [[key, defaultValue, description], ...]
 */
function ensureMissingSettings_(rows) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    const existingKeys = data.map(function(r) { return String(r[0]); });
    rows.forEach(function(row) {
      if (existingKeys.indexOf(row[0]) === -1) {
        sheet.appendRow(row);
        Logger.log('設定行追加: ' + row[0]);
      }
    });
  } catch (e) {
    Logger.log('ensureMissingSettings_ エラー: ' + e.message);
  }
}
