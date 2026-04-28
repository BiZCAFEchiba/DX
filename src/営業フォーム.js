// ============================================================
// 営業フォーム.js - 毎日22:00に来店数・Meetup誘致報告を送信する
// ============================================================

// EIGYO チャンネルID（設定.jsの SHIFT_CHANGE_CHANNEL_ID_PROD と同じ）
const EIGYO_CHANNEL_ID_PROD = '6e5b33f4-140b-92d1-78e1-754cbb00ff0e';
var EIGYO_CHANNEL_ID = EIGYO_CHANNEL_ID_PROD;

// ============================================================
// エントリ関数（GASトリガーから毎日22:00に呼ぶ）
// ============================================================

/**
 * 毎日22:00に実行する営業フォーム送信メイン処理
 * 来店数 + Meetup誘致報告を YUCHI_BOT_ID でグループに送信する
 */
function sendDailyEigyoReport() {
  if (isTodayWeekendOrHoliday_()) {
    Logger.log('sendDailyEigyoReport: 土日・祝日のためスキップ');
    return;
  }
  initChannelId_();

  // 1. 来店学生数・来店ユニーク学生数を取得
  var counts = fetchTodayVisitCounts_();
  var visitCount  = counts ? counts.visit  : null;
  var uniqueCount = counts ? counts.unique : null;

  // 2. 今日の誘致ログを集計
  var yuchiData = getTodayYuchiLog_();

  // 3. メッセージ組み立て
  var text = buildEigyoReportText_(visitCount, uniqueCount, yuchiData);

  // 4. LINE WORKS 送信
  var token = getLineWorksAccessToken();
  if (!token) {
    Logger.log('sendDailyEigyoReport: 認証失敗');
    return;
  }
  var url = LINEWORKS_API_BASE + '/bots/' + YUCHI_BOT_ID + '/channels/' + EIGYO_CHANNEL_ID + '/messages';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'text', text: text } }),
    muteHttpExceptions: true
  });
  Logger.log('sendDailyEigyoReport: HTTP ' + res.getResponseCode());
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * 今日の誘致ログシートから集計データを返す
 * @returns {{ total: number, byStaff: [{name, entries}] }}
 */
function getTodayYuchiLog_() {
  try {
    var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(YUCHI_LOG_SHEET_NAME);
    if (!sheet || sheet.getLastRow() <= 1) return { total: 0, byStaff: [] };

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
    // A=送信日時, B=誘致日, C=誘致者名, D=企業名, E=卒年情報(JSON), F=合計人数

    var staffMap = {};
    var totalAll = 0;

    data.forEach(function(row) {
      var recruitDate = '';
      if (row[1]) {
        try { recruitDate = Utilities.formatDate(new Date(row[1]), TIMEZONE, 'yyyy-MM-dd'); } catch (e) { recruitDate = String(row[1]).substring(0, 10); }
      }
      if (recruitDate !== today) return;

      var recruiterName = String(row[2] || '').trim();
      var companyName   = String(row[3] || '').trim();
      var yearCountsJson = String(row[4] || '').trim();
      var entryTotal    = Number(row[5] || 0);

      if (!recruiterName || !companyName) return;

      var yearCounts = [];
      try { if (yearCountsJson) yearCounts = JSON.parse(yearCountsJson); } catch (e) {}

      if (!staffMap[recruiterName]) staffMap[recruiterName] = { name: recruiterName, entries: [] };
      staffMap[recruiterName].entries.push({ companyName: companyName, yearCounts: yearCounts, total: entryTotal });
      totalAll += entryTotal;
    });

    return {
      total:   totalAll,
      byStaff: Object.keys(staffMap).map(function(n) { return staffMap[n]; })
    };
  } catch (e) {
    Logger.log('getTodayYuchiLog_ error: ' + e.message);
    return { total: 0, byStaff: [] };
  }
}

/**
 * 営業フォームのメッセージ文字列を組み立てる
 */
function buildEigyoReportText_(visitCount, uniqueCount, yuchiData) {
  var lines = ['社員さん、スタッフ各位', ''];
  lines.push('==============');
  lines.push('【来店数】'   + (visitCount  != null ? visitCount  + '名' : '取得中'));
  lines.push('【ユニーク数】' + (uniqueCount != null ? uniqueCount + '名' : '取得中'));
  lines.push('==============');
  lines.push('【Meetup誘致成功報告】');
  lines.push('■全体');
  lines.push('Meetup予約計' + (yuchiData.total || 0) + '名');
  lines.push('■個人');

  var staffList = yuchiData.byStaff || [];
  var NUMS = ['①', '②', '③', '④', '⑤', '⑥'];

  staffList.forEach(function(staff, i) {
    var num = NUMS[i] || ('(' + (i + 1) + ')');
    lines.push(num);
    lines.push('スタッフ氏名：' + staff.name);
    var entryTexts = staff.entries.map(function(e) { return formatYuchiEntry_(e); });
    lines.push('企業・人数：' + entryTexts.join('、'));
    lines.push('');
  });

  lines.push('==============');
  return lines.join('\n');
}

/**
 * 1社分の誘致エントリを "企業名N人(Y卒)" 形式に整形する
 */
function formatYuchiEntry_(entry) {
  var txt = entry.companyName;
  var ycs = entry.yearCounts || [];
  if (ycs.length === 0) return txt;
  if (ycs.length === 1) {
    txt += ycs[0].count + '人';
    if (ycs[0].year) txt += '(' + ycs[0].year + '卒)';
    return txt;
  }
  return txt + ycs.map(function(yc) {
    return yc.count + '人(' + yc.year + '卒)';
  }).join('・');
}

/**
 * 今日が土曜・日曜・日本の祝日かどうかを返す
 */
function isTodayWeekendOrHoliday_() {
  var today = new Date();
  var dow = today.getDay(); // 0=日, 6=土
  if (dow === 0 || dow === 6) return true;

  // Google の日本祝日カレンダーで当日イベントを確認
  try {
    var cal = CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com');
    if (cal) {
      var events = cal.getEventsForDay(today);
      if (events.length > 0) return true;
    }
  } catch (e) {
    Logger.log('isTodayWeekendOrHoliday_: 祝日チェック失敗 ' + e.message);
  }
  return false;
}

// ============================================================
// セットアップ・テスト
// ============================================================

/**
 * 全トリガーの一覧をログに出力する（どれが不要か確認用）
 */
function listAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  Logger.log('登録済みトリガー数: ' + triggers.length);
  triggers.forEach(function(t, i) {
    Logger.log(
      '[' + i + '] ' + t.getHandlerFunction() +
      ' | type=' + t.getTriggerSource() +
      ' | id=' + t.getUniqueId()
    );
  });
}

/**
 * 重複トリガーと不要なテストトリガーを削除してから sendDailyEigyoReport を登録する
 *
 * 削除対象:
 *   - cleanupPastRoomReservations の重複（1個だけ残す）
 *   - testParsePdf（テスト関数のトリガーは不要）
 *   - sendDailyEigyoReport の重複（再登録前にクリア）
 */
function setupEigyoReportTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var seenCleanup = false;
  var deleted = 0;

  triggers.forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'cleanupPastRoomReservations') {
      if (seenCleanup) {
        // 2個目以降は重複なので削除
        ScriptApp.deleteTrigger(t);
        Logger.log('重複削除: ' + fn);
        deleted++;
      } else {
        seenCleanup = true; // 最初の1個は残す
      }
    } else if (fn === 'testParsePdf' || fn === 'sendDailyEigyoReport') {
      ScriptApp.deleteTrigger(t);
      Logger.log('削除: ' + fn);
      deleted++;
    }
  });

  Logger.log('削除合計: ' + deleted + '件');

  // sendDailyEigyoReport を毎日22:00で新規登録
  ScriptApp.newTrigger('sendDailyEigyoReport')
    .timeBased()
    .atHour(22)
    .everyDays(1)
    .inTimezone(TIMEZONE)
    .create();
  Logger.log('営業フォーム送信トリガー登録完了（毎日22:00）');
}

/**
 * テスト: テストグループに今日の営業フォームを即時送信する
 */
function testSendEigyoReport() {
  EIGYO_CHANNEL_ID = LINEWORKS_CHANNEL_ID_TEST;
  sendDailyEigyoReport();
}
