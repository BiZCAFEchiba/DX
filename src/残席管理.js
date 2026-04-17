// ============================================================
// 残席管理.js - shirucafe来店数ポーリングによる残席数自動算出
// ============================================================

var TOTAL_SEATS          = 62;
var COOLDOWN_MIN         = 90;
var POLL_INTERVAL_MIN    = 15;
var VISIT_LOG_SHEET_NAME = '来店数ログ';

// ─── エントリポイント（メイン処理.jsから呼ぶ） ───────────────

/**
 * 現在の残席情報を返す（スタッフ画面・顧客アプリ向け）
 */
function handleGetSeats_() {
  var seatsResult = calcRemainingSeats_();
  var level       = seatsToLevel_(seatsResult.seats);
  var updatedAt   = PropertiesService.getScriptProperties().getProperty('CONGESTION_UPDATED_AT') || '';

  // 今日の最新累計来店数をログシートから取得
  var todayTotal = null;
  try {
    var sheet = getOrCreateVisitLogSheet_();
    if (sheet.getLastRow() >= 2) {
      var lastRow  = sheet.getLastRow();
      var lastVals = sheet.getRange(lastRow, 1, 1, 2).getValues()[0];
      var logTime  = lastVals[0];
      var logCount = lastVals[1];
      // 今日のデータのみ返す
      if (logTime instanceof Date) {
        var today = new Date();
        if (logTime.toDateString() === today.toDateString()) {
          todayTotal = typeof logCount === 'number' ? logCount : parseInt(logCount);
        }
      }
    }
  } catch (e) {}

  return {
    ok:                  true,
    remainingSeats:      seatsResult.seats,
    occupiedSeats:       seatsResult.occupied,
    totalSeats:          TOTAL_SEATS,
    level:               level,
    isManualOverride:    seatsResult.isManual,
    isAutoUpdateEnabled: isAutoUpdateEnabled_(),
    todayTotal:          todayTotal,
    updatedAt:           updatedAt
  };
}

/**
 * 残席を手動上書きする
 * param.seats: 上書きする残席数（0〜62）
 */
function handleSeatsOverride_(param) {
  var seats = parseInt(param.seats);
  if (isNaN(seats) || seats < 0 || seats > TOTAL_SEATS) {
    return { ok: false, error: 'invalid_seats' };
  }

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) return { ok: false, error: 'no_settings_sheet' };

  setSettingValue_(sheet, '残席手動上書き', seats);

  var level = seatsToLevel_(seats);
  var now   = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  PropertiesService.getScriptProperties().setProperties({
    'CONGESTION_LEVEL':      String(level),
    'CONGESTION_UPDATED_AT': now
  });

  return { ok: true, remainingSeats: seats, level: level, isManualOverride: true };
}

/**
 * 手動上書きを解除し、自動計算に戻す
 */
function handleClearSeatsOverride_() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) return { ok: false, error: 'no_settings_sheet' };

  setSettingValue_(sheet, '残席手動上書き', '');

  var seatsResult = calcRemainingSeats_();
  return { ok: true, remainingSeats: seatsResult.seats, isManualOverride: false };
}

// ─── ポーリング処理（時間トリガーから呼ぶ） ──────────────────

/**
 * 15分ごとに来店数を取得して記録・残席を更新する
 * GASの時間ベーストリガー（15分毎）で実行する
 */
function pollVisitCount() {
  // 営業時間外（8時前・22時以降）はスキップ
  var hour = new Date().getHours();
  if (hour < 8 || hour >= 22) return;

  var count = fetchTodayVisitCount_();
  if (count === null) {
    Logger.log('pollVisitCount: 来店数取得失敗');
    return;
  }

  // ログシートに記録
  var sheet = getOrCreateVisitLogSheet_();
  var now   = new Date();
  sheet.appendRow([now, count]);
  Logger.log('来店数記録: ' + count + '人 (' + now + ')');

  // 残席計算＆自動更新
  if (isAutoUpdateEnabled_()) {
    var seatsResult = calcRemainingSeats_();
    var level       = seatsToLevel_(seatsResult.seats);
    var nowStr      = Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    PropertiesService.getScriptProperties().setProperties({
      'CONGESTION_LEVEL':      String(level),
      'CONGESTION_UPDATED_AT': nowStr
    });
    Logger.log('残席自動更新: 推定在席 ' + seatsResult.occupied + '名 → 残席 ' + seatsResult.seats + '席 → レベル' + level);
  }
}

// ─── 内部計算 ────────────────────────────────────────────────

/**
 * 来店数ログの差分から推定残席を計算する
 * 直近90分以内の来店増加数 = 推定在席数
 */
function calcRemainingSeats_() {
  // 手動上書きチェック
  var override = getSeatsOverride_();
  if (override !== null) {
    return { seats: override, occupied: TOTAL_SEATS - override, isManual: true };
  }

  var sheet = getOrCreateVisitLogSheet_();
  if (sheet.getLastRow() < 2) {
    return { seats: TOTAL_SEATS, occupied: 0, isManual: false };
  }

  var now    = new Date();
  var cutoff = new Date(now.getTime() - COOLDOWN_MIN * 60 * 1000);

  var data     = sheet.getDataRange().getValues();
  var occupied = 0;

  // 90分前以降のログのみ対象
  // 各区間の差分（増加数）を合計する
  var prevCount = null;
  for (var i = 1; i < data.length; i++) {
    var logTime  = data[i][0];
    var logCount = data[i][1];
    if (!(logTime instanceof Date)) continue;

    if (logTime >= cutoff) {
      if (prevCount !== null && logCount > prevCount) {
        occupied += (logCount - prevCount);
      } else if (prevCount === null) {
        // 90分前直前のレコードを基準として使う
        // （切り替わり直後の1区間分の差分を取れるよう直前値を探す）
        var prevVal = getPrevCountBefore_(data, i);
        if (prevVal !== null && logCount > prevVal) {
          occupied += (logCount - prevVal);
        }
      }
      prevCount = logCount;
    } else {
      prevCount = logCount; // cutoff前の最新値を保持
    }
  }

  return {
    seats:    Math.max(0, TOTAL_SEATS - occupied),
    occupied: Math.min(TOTAL_SEATS, occupied),
    isManual: false
  };
}

/**
 * index番目の行より前で、直近のcutoff前のカウント値を返す
 */
function getPrevCountBefore_(data, targetIndex) {
  for (var i = targetIndex - 1; i >= 1; i--) {
    var logTime  = data[i][0];
    var logCount = data[i][1];
    if (logTime instanceof Date && typeof logCount === 'number') {
      return logCount;
    }
  }
  return null;
}

// ─── shirucafe admin アクセス ────────────────────────────────

/**
 * shirucafe admin /store ページから今日の来店学生数（累計）を取得する
 * day_order_chart の Chart.js データを HTML からパースして返す
 * @returns {number|null} 来店学生数。取得失敗時はnull
 */
function fetchTodayVisitCount_() {
  try {
    var cookies = loginToShirucafe_();
    if (!cookies) {
      Logger.log('fetchTodayVisitCount_: ログイン失敗');
      return null;
    }

    var res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/store', {
      headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html' },
      followRedirects: true,
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('fetchTodayVisitCount_: /store HTTP ' + res.getResponseCode());
      return null;
    }

    return parseVisitCountFromHtml_(res.getContentText());

  } catch (e) {
    Logger.log('fetchTodayVisitCount_ error: ' + e.message);
    return null;
  }
}

/**
 * /store ページの HTML から day_order_chart の今日分来店学生数を抽出する
 * Chart.js に渡されるデータは以下の形式:
 *   labels: ["04.06 (月)","04.07 (火)",...]
 *   datasets[0] (来店学生数) data: [125,64,...,13]
 * 最後の要素が今日分（ページがリアルタイム更新のため）
 */
function parseVisitCountFromHtml_(html) {
  try {
    // day_order_chart ブロック全体を抽出
    var chartBlockMatch = html.match(/day_order_chart[\s\S]*?labels:\s*(\[[\s\S]*?\])\s*,[\s\S]*?datasets:\s*\[([\s\S]*?)\]\s*\}\s*,\s*options:/);
    if (!chartBlockMatch) {
      Logger.log('parseVisitCountFromHtml_: day_order_chartブロックが見つかりません');
      return null;
    }

    // labels 配列をパース
    var labelsRaw = chartBlockMatch[1].replace(/\s+/g, ' ');
    var labels = JSON.parse(labelsRaw);

    // datasets から 来店学生数 の data 配列を抽出
    var datasetsBlock = chartBlockMatch[2];
    var dataMatch = datasetsBlock.match(/label:\s*'来店学生数'[\s\S]*?data:\s*(\[[^\]]+\])/);
    if (!dataMatch) {
      Logger.log('parseVisitCountFromHtml_: 来店学生数 dataが見つかりません');
      return null;
    }
    var data = JSON.parse(dataMatch[1]);

    // 今日の日付ラベル（MM.dd形式）で一致する要素を探す
    var todayLabel = Utilities.formatDate(new Date(), TIMEZONE, 'MM.dd');
    for (var i = 0; i < labels.length; i++) {
      if (String(labels[i]).indexOf(todayLabel) === 0) {
        var val = typeof data[i] === 'number' ? data[i] : parseInt(data[i]);
        Logger.log('parseVisitCountFromHtml_: 今日(' + labels[i] + ')の来店学生数 = ' + val);
        return isNaN(val) ? null : val;
      }
    }

    // 今日のラベルが見つからない場合は最後の要素（当日が最新）
    if (data.length > 0) {
      var last = typeof data[data.length - 1] === 'number' ? data[data.length - 1] : parseInt(data[data.length - 1]);
      Logger.log('parseVisitCountFromHtml_: 今日のラベル未一致、最終値 = ' + last + '（labels末尾: ' + labels[labels.length - 1] + '）');
      return isNaN(last) ? null : last;
    }

    return null;
  } catch (e) {
    Logger.log('parseVisitCountFromHtml_ error: ' + e.message);
    return null;
  }
}

// ─── 共通ユーティリティ ──────────────────────────────────────

/**
 * 残席数 → 混雑レベル（1〜5）変換
 */
function seatsToLevel_(remaining) {
  if (remaining >= 50) return 1; // 空いています      (80%+)
  if (remaining >= 35) return 2; // やや空いています  (56-79%)
  if (remaining >= 20) return 3; // 普通              (32-55%)
  if (remaining >= 7)  return 4; // やや混んでいます  (11-31%)
  return 5;                       // 混んでいます      (10%以下)
}

/**
 * 設定シートから残席手動上書き値を取得
 */
function getSeatsOverride_() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === '残席手動上書き') {
        var val = data[i][1];
        if (val === '' || val === null || val === undefined) return null;
        var num = parseInt(val);
        return (!isNaN(num) && num >= 0 && num <= TOTAL_SEATS) ? num : null;
      }
    }
  } catch (e) {
    Logger.log('getSeatsOverride_ error: ' + e.message);
  }
  return null;
}

/**
 * 設定シートの「残席自動更新」フラグを確認
 */
function isAutoUpdateEnabled_() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return false;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === '残席自動更新') {
        return data[i][1] === true || String(data[i][1]).toUpperCase() === 'TRUE';
      }
    }
  } catch (e) {
    Logger.log('isAutoUpdateEnabled_ error: ' + e.message);
  }
  return false;
}

/**
 * 来店数ログシートを取得または新規作成する
 */
function getOrCreateVisitLogSheet_() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(VISIT_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(VISIT_LOG_SHEET_NAME);
    sheet.appendRow(['記録日時', '来店学生数（累計）']);
    sheet.setFrozenRows(1);
    Logger.log('来店数ログシートを新規作成しました');
    ensureSeatsSettings_();
  }
  return sheet;
}

/**
 * 設定シートに残席関連の行が存在しなければ追加する
 */
function ensureSeatsSettings_() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return;

    var data     = sheet.getDataRange().getValues();
    var keys     = data.map(function(row) { return String(row[0]); });
    var defaults = [
      ['残席手動上書き', ''],
      ['残席自動更新',   'FALSE']
    ];
    defaults.forEach(function(pair) {
      if (keys.indexOf(pair[0]) === -1) {
        sheet.appendRow(pair);
        Logger.log('設定シートに追加: ' + pair[0]);
      }
    });
  } catch (e) {
    Logger.log('ensureSeatsSettings_ error: ' + e.message);
  }
}

/**
 * 設定シートの指定キーの値を更新（なければ追記）
 */
function setSettingValue_(sheet, key, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

// ─── トリガー設定 ────────────────────────────────────────────

/**
 * 15分ごとのポーリングトリガーを登録する
 * GASエディタから一度だけ実行する
 */
function setupVisitCountTrigger() {
  // 既存の pollVisitCount トリガーを削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'pollVisitCount') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // 15分ごとに再登録
  ScriptApp.newTrigger('pollVisitCount')
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log('pollVisitCount トリガーを15分ごとに設定しました');
}

/**
 * 設定シートの初期化（残席手動上書き・残席自動更新行を追加）
 * GASエディタから実行できる
 */
function initSeatsSettings() {
  ensureSeatsSettings_();
  getOrCreateVisitLogSheet_();
  Logger.log('残席設定の初期化が完了しました');
}

// ─── 診断・テスト関数 ────────────────────────────────────────

/**
 * shirucafe adminの来店数取得を診断する
 * GASエディタから実行してログを確認する
 */
function debugFetchVisitCount() {
  Logger.log('=== 来店数取得診断 開始 ===');
  var count = fetchTodayVisitCount_();
  if (count !== null) {
    Logger.log('✅ 今日の来店学生数: ' + count + '人');
  } else {
    Logger.log('❌ 来店数を取得できませんでした。ログを確認してください。');
  }
  Logger.log('=== 診断 終了 ===');
}

/**
 * ホームページのHTML本文・スクリプトを詳しく調べる診断
 * GASエディタから実行してログを確認する
 */
function debugInspectHomePage() {
  Logger.log('=== ホームページ構造診断 ===');
  var cookies = loginToShirucafe_();
  if (!cookies) { Logger.log('ログイン失敗'); return; }

  // ① ホームページ
  var pages = [
    '/',
    '/dashboard',
    '/store',
    '/stores/' + SHIRUCAFE_STORE_ID,
    '/stores/' + SHIRUCAFE_STORE_ID + '/dashboard',
    '/home'
  ];

  pages.forEach(function(path) {
    try {
      var res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + path, {
        headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html,application/json' },
        followRedirects: true,
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var body = res.getContentText();
      Logger.log('--- ' + path + ' HTTP ' + code + ' ---');
      if (code !== 200) return;

      // Inertia data-page チェック
      var inertiaMatch = body.match(/data-page="([^"]{0,2000})"/);
      if (inertiaMatch) {
        try {
          var decoded = inertiaMatch[1].replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
          var pageData = JSON.parse(decoded);
          Logger.log('Inertia component: ' + (pageData.component || '不明'));
          Logger.log('Inertia props keys: ' + JSON.stringify(Object.keys(pageData.props || {})));
          // 各propsの型と先頭値をログ
          var props = pageData.props || {};
          Object.keys(props).forEach(function(k) {
            var v = props[k];
            var preview = typeof v === 'object' ? JSON.stringify(v).substring(0, 120) : String(v);
            Logger.log('  props.' + k + ' (' + typeof v + '): ' + preview);
          });
        } catch(e) {
          Logger.log('Inertia JSON解析エラー: ' + e.message);
        }
      } else {
        // Inertiaなし → HTMLの先頭500文字とscriptタグ付近を確認
        Logger.log('data-page なし。HTML先頭500文字: ' + body.substring(0, 500));
        // <script> タグ内のJSONっぽい箇所を探す
        var scriptMatch = body.match(/<script[^>]*>([\s\S]{0,500}visit[\s\S]{0,200})<\/script>/i);
        if (scriptMatch) Logger.log('visitを含むscriptタグ: ' + scriptMatch[1].substring(0, 300));
        // フォームやリンクからページ構造を把握
        var links = [];
        var re = /href="([^"]{1,100})"/g;
        var m;
        while ((m = re.exec(body)) !== null) links.push(m[1]);
        Logger.log('ページ内リンク（先頭20件）: ' + JSON.stringify(links.slice(0, 20)));
      }
    } catch(e) {
      Logger.log(path + ' エラー: ' + e.message);
    }
  });

  // ② /store ページの本文を詳しく調べる
  Logger.log('--- /store ページ本文解析 ---');
  try {
    var storeRes = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/store', {
      headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html' },
      followRedirects: true, muteHttpExceptions: true
    });
    if (storeRes.getResponseCode() === 200) {
      var html = storeRes.getContentText();

      // 来店・学生・人数に関するテキストを含む行を抽出
      var lines = html.split('\n');
      lines.forEach(function(line, idx) {
        if (/来店|学生|visit|count|人数|ユニーク/i.test(line)) {
          Logger.log('L' + idx + ': ' + line.trim().substring(0, 200));
        }
      });

      // <script> タグ内をすべて抽出（AJAX URLや変数を探す）
      var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      var sm;
      var scriptIdx = 0;
      while ((sm = scriptRe.exec(html)) !== null) {
        var content = sm[1].trim();
        if (content.length < 10) continue;
        if (/ajax|fetch|url|route|visit|count|学生/i.test(content)) {
          Logger.log('script[' + scriptIdx + ']: ' + content.substring(0, 400));
        }
        scriptIdx++;
      }

      // data-* 属性を探す（Blade がデータを埋め込むことがある）
      var dataAttrRe = /data-[\w-]+=["']([^"']{1,200})["']/g;
      var dam;
      var dataAttrs = [];
      while ((dam = dataAttrRe.exec(html)) !== null) {
        if (/\d/.test(dam[1])) dataAttrs.push(dam[0].substring(0, 100));
      }
      Logger.log('数値を含むdata属性（先頭10件）: ' + JSON.stringify(dataAttrs.slice(0, 10)));
    }
  } catch(e) {
    Logger.log('/store 解析エラー: ' + e.message);
  }

  // ③ / ホームページの本文も同様に調べる
  Logger.log('--- / ホームページ本文解析 ---');
  try {
    var homeRes = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/', {
      headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html' },
      followRedirects: true, muteHttpExceptions: true
    });
    if (homeRes.getResponseCode() === 200) {
      var homeHtml = homeRes.getContentText();

      // 来店・学生・人数に関するテキストを含む行を抽出
      homeHtml.split('\n').forEach(function(line, idx) {
        if (/来店|学生|visit|count|人数|ユニーク/i.test(line)) {
          Logger.log('L' + idx + ': ' + line.trim().substring(0, 200));
        }
      });

      // <script> タグ内でAJAX/fetch/URLを含むものを抽出
      var hsRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      var hsm;
      var hsi = 0;
      while ((hsm = hsRe.exec(homeHtml)) !== null) {
        var c = hsm[1].trim();
        if (c.length < 10) continue;
        if (/ajax|fetch|url|route|visit|count|学生/i.test(c)) {
          Logger.log('home-script[' + hsi + ']: ' + c.substring(0, 400));
        }
        hsi++;
      }
    }
  } catch(e) {
    Logger.log('/ 解析エラー: ' + e.message);
  }

  Logger.log('=== 診断 終了 ===');
}

/**
 * /store ページから来店学生数チャートデータを抽出する診断
 * GASエディタから実行してログを確認する
 */
function debugExtractChartData() {
  Logger.log('=== チャートデータ抽出診断 ===');
  var cookies = loginToShirucafe_();
  if (!cookies) { Logger.log('ログイン失敗'); return; }

  var res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/store', {
    headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html' },
    followRedirects: true, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) { Logger.log('取得失敗: HTTP ' + res.getResponseCode()); return; }

  var html = res.getContentText();

  // スクリプトブロックを全部取り出して「来店」を含むものを全文ログ
  var scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  var sm; var idx = 0;
  while ((sm = scriptRe.exec(html)) !== null) {
    var c = sm[1];
    if (/来店/.test(c)) {
      // 2000文字ずつに分割してログ
      Logger.log('=== 来店スクリプト[' + idx + '] 全文 ===');
      for (var pos = 0; pos < c.length; pos += 2000) {
        Logger.log(c.substring(pos, pos + 2000));
      }
    }
    idx++;
  }
  Logger.log('=== 抽出 終了 ===');
}

/**
 * ポーリングのロジックテスト（実際にAPIを叩かずロジックのみ確認）
 */
function testCalcRemainingSeats() {
  Logger.log('=== 残席計算テスト ===');
  var result = calcRemainingSeats_();
  Logger.log('残席: ' + result.seats + '席 / 在席: ' + result.occupied + '名 / 手動: ' + result.isManual);
  Logger.log('レベル: ' + seatsToLevel_(result.seats));
  Logger.log('自動更新: ' + isAutoUpdateEnabled_());
}
