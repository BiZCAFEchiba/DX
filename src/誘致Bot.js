// ============================================================
// 誘致Bot.js - 誘致情報収集 WebApp + グループ投稿
// ============================================================

// YUCHI_CHANNEL_ID は設定.js で定義（テストモード切替対応）
const YUCHI_BOT_ID = '11788756';
const YUCHI_FORM_SS_ID = '1X3lIgrDsK3gYlPNvHcDl51g3LjxmStJZSBqTD7V9ML4';

// ============================================================
// WebApp データ取得（google.script.run から呼ぶ）
// ============================================================

/**
 * 誘致フォームに必要なデータを返す
 * - 今後30日以内の企業一覧と開催日
 * @returns {Object} { companies: [{ name, sessions: [{ date, dateDisplay, time }] }] }
 */
function getYuchiFormData() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet || sheet.getLastRow() <= 1) return { companies: [] };

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var limit = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  var companyMap = {};

  data.forEach(function(row) {
    var dateVal = row[0];
    if (!dateVal) return;
    var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime()) || d < today || d > limit) return;

    var companyName = String(row[1] || '').trim();
    var time = String(row[2] || '').trim();
    var kind = String(row[3] || '').trim();
    var gradYear = String(row[6] || '').trim(); // G列: 卒年
    if (!companyName) return;

    var dateISO = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
    var dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    var dateDisplay = (d.getMonth() + 1) + '/' + d.getDate() + '(' + dayNames[d.getDay()] + ')';

    if (!companyMap[companyName]) companyMap[companyName] = [];
    companyMap[companyName].push({ date: dateISO, dateDisplay: dateDisplay, time: time, kind: kind, gradYear: gradYear });
  });

  var companies = Object.keys(companyMap).map(function(name) {
    var sessions = companyMap[name];
    // G列の卒年を全セッションから収集・重複排除
    var yearSet = {};
    sessions.forEach(function(s) {
      if (!s.gradYear) return;
      s.gradYear.split(/[\s　]+/).forEach(function(y) {
        var yr = y.replace('卒', '').trim();
        if (yr) yearSet[yr] = true;
      });
    });
    var years = Object.keys(yearSet).sort();
    return { name: name, sessions: sessions, years: years };
  });
  companies.sort(function(a, b) {
    if (!a.sessions[0] || !b.sessions[0]) return 0;
    return a.sessions[0].date.localeCompare(b.sessions[0].date);
  });

  return { companies: companies };
}

// ============================================================
// WebApp フォーム送信処理（google.script.run から呼ぶ）
// ============================================================

/**
 * 誘致フォームの回答を保存してグループに投稿する
 * @param {Object} formData
 *   { recruiterName, recruitDate, entries: [{ companyName, dates, years, count, appealPoint }] }
 * @returns {string} 結果メッセージ
 */
function submitYuchiForm(formData) {
  try {
    if (!formData || !formData.entries || formData.entries.length === 0) {
      return 'エラー: 入力データが空です';
    }
    initChannelId_();

    // 企業IDマスターにアピールポイントを追記
    formData.entries.forEach(function(entry) {
      if (entry.appealPoint && entry.companyName) {
        appendAppealPoint_(entry.companyName, entry.appealPoint);
      }
    });

    // グループに投稿
    var text = buildYuchiGroupMessage_(formData);
    var token = getLineWorksAccessToken();
    if (!token) return 'エラー: LINE WORKS 認証失敗';

    var url = LINEWORKS_API_BASE + '/bots/' + YUCHI_BOT_ID + '/channels/' + YUCHI_CHANNEL_ID + '/messages';
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ content: { type: 'text', text: text } }),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code === 200 || code === 201) {
      Logger.log('誘致情報グループ投稿成功');
      return 'success';
    } else {
      Logger.log('誘致情報グループ投稿失敗: ' + res.getContentText());
      return 'エラー: 投稿失敗 (HTTP ' + code + ')';
    }
  } catch (e) {
    Logger.log('submitYuchiForm エラー: ' + e.message);
    return 'エラー: ' + e.message;
  }
}

// ============================================================
// Meetupフォーム送信トリガー → DM送信
// ============================================================

/**
 * Meetup企業選択フォームの送信時に自動実行されるトリガー
 * フォームの1問目（名前）でスタッフを特定し、誘致フォームURLをDM送信する
 * ※ setupYuchiFormTrigger() でトリガー登録が必要
 */
function onYuchiFormSubmit(e) {
  try {
    var response = e.response;
    var items = response.getItemResponses();
    if (!items || items.length === 0) {
      Logger.log('onYuchiFormSubmit: 回答なし');
      return;
    }

    // 質問タイトルでスタッフ名を取得
    var staffName = '';
    var selectedCompanies = [];
    for (var i = 0; i < items.length; i++) {
      var title = String(items[i].getItem().getTitle()).trim();
      var ans = items[i].getResponse();
      if (title === 'スタッフ名（フルネーム）') {
        staffName = String(ans).trim();
      } else if (Array.isArray(ans) && ans.length > 0) {
        selectedCompanies = selectedCompanies.concat(ans);
      }
    }
    Logger.log('onYuchiFormSubmit: 回答者=' + staffName);
    Logger.log('選択企業: ' + selectedCompanies.join(', '));

    if (selectedCompanies.length === 0) {
      Logger.log('企業未選択のためDM送信をスキップ: ' + staffName);
      return;
    }

    // スタッフシートからLINE WORKS IDを取得
    var mappings = loadStaffMappingFromSheets_();
    var sendMap = mappings ? mappings.send : {};
    var userId = sendMap[staffName];

    if (!userId) {
      Logger.log('LINE WORKS ID未登録のスタッフ: ' + staffName);
      return;
    }

    // 誘致フォームURLを組み立ててDM送信
    var webAppUrl = getWebAppUrl_();
    if (!webAppUrl) {
      Logger.log('WebApp URLが未設定です。setWebAppUrl() を実行してください。');
      return;
    }

    var formUrl = webAppUrl + '?page=yuchi&name=' + encodeURIComponent(staffName);
    if (selectedCompanies.length > 0) {
      formUrl += '&companies=' + encodeURIComponent(selectedCompanies.join(','));
    }

    var msg = staffName + ' さん\n\n誘致情報の入力をお願いします！\n担当した企業のアピールポイント等を入力してください。\n\n' + formUrl;
    var success = sendLineWorksMessage(userId, msg);
    Logger.log('誘致フォームURL送信' + (success ? '成功' : '失敗') + ': ' + staffName);
  } catch (err) {
    Logger.log('onYuchiFormSubmit エラー: ' + err.message);
  }
}

/**
 * Meetup企業選択フォームにonYuchiFormSubmitトリガーを登録する
 * 初回のみGASエディタから手動実行
 */
function setupYuchiFormTrigger() {
  // 既存の重複トリガーを削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onYuchiFormSubmit') {
      ScriptApp.deleteTrigger(t);
    }
  });

  var form = FormApp.openById(MEETUP_FORM_ID);
  ScriptApp.newTrigger('onYuchiFormSubmit')
    .forForm(form)
    .onFormSubmit()
    .create();

  Logger.log('誘致フォームトリガー登録完了 (フォームID: ' + MEETUP_FORM_ID + ')');
}

/**
 * WebApp URLをスクリプトプロパティに保存する（初回のみ手動実行）
 * GASエディタのデプロイURLをコピーしてこの関数の引数に貼り付けて実行
 */
function setWebAppUrl() {
  // ここにデプロイURLを貼り付けて実行
  var url = 'https://script.google.com/macros/s/AKfycbxc5QSSH2bHqX6cuHqClVMWfkBrfqW8Zi4AY2E_wYPjO2NWUD4oJXMihgR1XtVgR0vP/exec';
  PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', url);
  Logger.log('WebApp URL 保存完了: ' + url);
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * 企業IDマスターのD列以降にアピールポイントを追記する
 */
function appendAppealPoint_(companyName, appealPoint) {
  if (!companyName || !appealPoint) return;
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1) return;

  var nameCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < nameCol.length; i++) {
    if (String(nameCol[i][0]).trim() === companyName) {
      // この行のD列以降（index 3〜）で最初の空きセルに書き込む
      var rowData = sheet.getRange(i + 2, 1, 1, Math.max(lastCol, 4)).getValues()[0];
      var writeCol = 4; // D列（1-indexed）
      for (var j = 3; j < rowData.length; j++) { // 0-indexedで3 = D列
        if (!String(rowData[j]).trim()) {
          writeCol = j + 1; // 1-indexed
          break;
        }
        writeCol = j + 2; // 全部埋まっていたら次の列
      }
      sheet.getRange(i + 2, writeCol).setValue(appealPoint);
      Logger.log('アピールポイント追記: ' + companyName + ' → 列' + writeCol + ': ' + appealPoint.substring(0, 30));
      return;
    }
  }
  // 企業が未登録の場合は新規追加
  var newRow = [companyName, '', '', appealPoint];
  sheet.appendRow(newRow);
  Logger.log('アピールポイント新規追加: ' + companyName);
}

/**
 * グループ投稿用メッセージを組み立てる
 */
function buildYuchiGroupMessage_(formData) {
  var lines = ['【誘致情報】'];
  lines.push('誘致者: ' + (formData.recruiterName || '不明'));

  if (formData.recruitDate) {
    var d = new Date(formData.recruitDate);
    var dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    lines.push('誘致日: ' + (d.getMonth() + 1) + '/' + d.getDate() + '(' + dayNames[d.getDay()] + ')');
  }

  formData.entries.forEach(function(entry) {
    lines.push('');
    lines.push('企業: ' + entry.companyName);

    if (entry.dates && entry.dates.length > 0) {
      lines.push('開催日: ' + entry.dates.join(' / '));
    }
    if (entry.yearCounts && entry.yearCounts.length > 0) {
      entry.yearCounts.forEach(function(yc) {
        var line = yc.year + '卒';
        if (yc.count) line += ' ' + yc.count + '名';
        lines.push(line);
      });
    }
    if (entry.appealPoint) {
      lines.push('アピールポイント: ' + entry.appealPoint);
    }
  });

  return lines.join('\n');
}

/**
 * スクリプトプロパティからWebApp URLを取得する
 */
function getWebAppUrl_() {
  return PropertiesService.getScriptProperties().getProperty('WEBAPP_URL') || '';
}

// ============================================================
// テスト用
// ============================================================

/**
 * 今日すでに送信されたフォーム回答を使って手動でDMを再送する
 * トリガー未登録だった場合のリカバリ用
 */
function replayTodayYuchiFormResponses() {
  var form = FormApp.openById(MEETUP_FORM_ID);
  var allResponses = form.getResponses();
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var mappings = loadStaffMappingFromSheets_();
  var sendMap = mappings ? mappings.send : {};
  var webAppUrl = getWebAppUrl_();
  if (!webAppUrl) {
    Logger.log('WebApp URLが未設定です。setWebAppUrl() を実行してください。');
    return;
  }

  var count = 0;
  allResponses.forEach(function(response) {
    var timestamp = response.getTimestamp();
    if (timestamp < today) return; // 今日以外はスキップ

    var items = response.getItemResponses();
    if (!items || items.length === 0) return;

    var staffName = '';
    var selectedCompanies = [];
    for (var i = 0; i < items.length; i++) {
      var title = String(items[i].getItem().getTitle()).trim();
      var ans = items[i].getResponse();
      if (title === 'スタッフ名（フルネーム）') {
        staffName = String(ans).trim();
      } else if (Array.isArray(ans) && ans.length > 0) {
        selectedCompanies = selectedCompanies.concat(ans);
      }
    }

    if (selectedCompanies.length === 0) {
      Logger.log('企業未選択のためスキップ: ' + staffName);
      return;
    }

    var userId = sendMap[staffName];
    if (!userId) {
      Logger.log('LINE WORKS ID未登録のスタッフ: ' + staffName);
      return;
    }

    var formUrl = webAppUrl + '?page=yuchi&name=' + encodeURIComponent(staffName)
      + '&companies=' + encodeURIComponent(selectedCompanies.join(','));
    var msg = staffName + ' さん\n\n誘致情報の入力をお願いします！\n担当した企業のアピールポイント等を入力してください。\n\n' + formUrl;
    var success = sendLineWorksMessage(userId, msg);
    Logger.log('再送' + (success ? '成功' : '失敗') + ': ' + staffName + ' / ' + selectedCompanies.join(', '));
    count++;
  });

  Logger.log('replayTodayYuchiFormResponses 完了: ' + count + '件処理');
}

/**
 * テストグループにフォームURLを送信する
 * デジタル庁・東京都を選択済みの状態でフォームURLを投稿する
 */
function testSendYuchiFormUrl() {
  var webAppUrl = getWebAppUrl_();
  if (!webAppUrl) {
    Logger.log('WebApp URLが未設定です。setWebAppUrl() を先に実行してください。');
    return;
  }

  var testName = 'テストスタッフ';
  var formUrl = webAppUrl + '?page=yuchi&name=' + encodeURIComponent(testName) + '&companies=' + encodeURIComponent('デジタル庁,東京都');
  var text = testName + ' さん\n誘致情報の入力をお願いします！\n\n' + formUrl;

  var token = getLineWorksAccessToken();
  if (!token) { Logger.log('認証失敗'); return; }

  var url = LINEWORKS_API_BASE + '/bots/' + YUCHI_BOT_ID + '/channels/' + YUCHI_CHANNEL_ID_TEST + '/messages';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'text', text: text } }),
    muteHttpExceptions: true
  });

  Logger.log('URL送信結果: HTTP ' + res.getResponseCode());
}

/**
 * 誘致情報のテスト送信（テストグループへ）
 * デジタル庁・東京都を選択した想定でテストグループに投稿する
 */
function testSendYuchiForm() {
  // テストグループに強制切替
  YUCHI_CHANNEL_ID = YUCHI_CHANNEL_ID_TEST;

  var formData = {
    recruiterName: 'テストスタッフ',
    recruitDate: Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'),
    entries: [
      {
        companyName: 'デジタル庁',
        dates: ['3/10(月) 15:00~16:00'],
        years: ['27', '28'],
        count: 3,
        appealPoint: 'デジタル社会の実現に向け、エンジニアや政策立案など幅広い職種で採用中です。'
      },
      {
        companyName: '東京都',
        dates: ['3/15(土) 13:00~14:00'],
        years: ['26', '27'],
        count: 2,
        appealPoint: '都民のための公共サービスを技術で変革するプロジェクトに携われます。'
      }
    ]
  };

  var text = buildYuchiGroupMessage_(formData);
  Logger.log('送信メッセージ:\n' + text);

  var token = getLineWorksAccessToken();
  if (!token) { Logger.log('認証失敗'); return; }

  var url = LINEWORKS_API_BASE + '/bots/' + YUCHI_BOT_ID + '/channels/' + YUCHI_CHANNEL_ID + '/messages';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'text', text: text } }),
    muteHttpExceptions: true
  });

  Logger.log('テスト送信結果: HTTP ' + res.getResponseCode() + ' ' + res.getContentText().substring(0, 200));
}
