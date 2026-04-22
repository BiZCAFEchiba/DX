// ============================================================
// 残席管理.js - shirucafe来店数ポーリングによる残席数自動算出
// ============================================================

var TOTAL_SEATS             = 62;
var COOLDOWN_MIN            = 100; // 平均滞在時間（分）= ローリングウィンドウ幅
var POLL_INTERVAL_MIN       = 10;  // 来店数ポーリング間隔（分）
var QUEUE_WAIT_MIN_DEFAULT  = 5;  // 空いているときの最小待ち時間（分）
var QUEUE_WAIT_MAX_DEFAULT  = 30; // 混んでいるときの最大待ち時間（分）
var VISIT_LOG_SHEET_NAME    = '来店数ログ';

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
    meetupCount:         seatsResult.meetupCount || 0,
    queueExtra:          seatsResult.queueExtra  || 0,
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
    'CONGESTION_UPDATED_AT': now,
    'SEATS_OVERRIDE':        String(seats)
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
  PropertiesService.getScriptProperties().deleteProperty('SEATS_OVERRIDE');

  var seatsResult = calcRemainingSeats_();
  return { ok: true, remainingSeats: seatsResult.seats, isManualOverride: false };
}

// ─── ポーリング処理（時間トリガーから呼ぶ） ──────────────────

/**
 * 15分ごとに来店数を取得して記録・残席を更新する
 * GASの時間ベーストリガー（15分毎）で実行する
 */
function pollVisitCount() {
  // 初回デプロイ後のブートストラップ（設定シート初期化・閾値反映・トリガー再設定）
  runBootstrapIfNeeded_();

  // 営業時間外はスキップ（定休日・開店前・閉店後・貸切時間帯）
  var now   = new Date();
  var hours = getEffectiveHoursForDate_(now); // 貸切込みの実効営業時間
  if (!hours) {
    Logger.log('pollVisitCount: 営業なし（定休日または終日貸切）のためスキップ');
    return;
  }
  var nowMin   = now.getHours() * 60 + now.getMinutes();
  var openMin  = timeToMin_(hours.start);
  var closeMin = timeToMin_(hours.end);
  if (nowMin < openMin || nowMin >= closeMin) {
    Logger.log('pollVisitCount: 営業時間外のためスキップ（実効 ' + hours.start + '〜' + hours.end + '）');
    return;
  }

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

  // 各区間の差分（増加数）を合計する
  // ※ 来店数は日次累計カウンターのため、日付をまたぐ際は0にリセット
  var prevCount = null;
  var prevDate  = null;
  for (var i = 1; i < data.length; i++) {
    var logTime  = data[i][0];
    var logCount = data[i][1];
    if (!(logTime instanceof Date)) continue;

    var logDateStr = Utilities.formatDate(logTime, TIMEZONE, 'yyyy-MM-dd');
    if (prevDate !== null && logDateStr !== prevDate) {
      prevCount = 0; // 日付変わりでカウンターリセット
    }

    if (logTime >= cutoff) {
      if (prevCount !== null && logCount > prevCount) {
        occupied += (logCount - prevCount);
      } else if (prevCount === null) {
        var prevVal = getPrevCountBefore_(data, i);
        if (prevVal !== null && logCount > prevVal) {
          occupied += (logCount - prevVal);
        }
      }
      prevCount = logCount;
    } else {
      prevCount = logCount; // cutoff前の最新値を保持
    }
    prevDate = logDateStr;
  }

  // ── キュー補正（着席〜スキャンの時間差を補う） ──
  // 基本在席率（補正前）を元に動的待ち時間を算出（混んでいるほど長く）
  var baseOccupancyRate = Math.min(1, occupied / TOTAL_SEATS);
  var queueWait  = getDynamicQueueWait_(baseOccupancyRate);
  var queueExtra = calcQueueCorrection_(sheet, now, queueWait);

  // ── Meetup席数補正 ──
  var meetupCount = getConcurrentMeetupCount_(now);
  var meetupSeats = meetupCount * MEETUP_SEATS_PER_EVENT;
  if (meetupCount > 0) {
    Logger.log('Meetup補正: ' + meetupCount + '件 × ' + MEETUP_SEATS_PER_EVENT + '席 = ' + meetupSeats + '席');
  }

  var totalOccupied = occupied + queueExtra + meetupSeats;
  Logger.log('在席推計: ローリング=' + occupied + ' キュー補正=+' + queueExtra + ' Meetup=+' + meetupSeats + ' 合計=' + totalOccupied);

  return {
    seats:       Math.max(0, TOTAL_SEATS - totalOccupied),
    occupied:    Math.min(TOTAL_SEATS, totalOccupied),
    queueExtra:  queueExtra,
    meetupCount: meetupCount,
    isManual:    false
  };
}

/**
 * キュー補正値を計算する
 * 直近POLL_INTERVAL_MIN分の増加レート × 推定待ち時間 = 未スキャンの着席者数推定
 */
function calcQueueCorrection_(sheet, now, queueWaitMin) {
  try {
    if (sheet.getLastRow() < 3) return 0;
    var data = sheet.getDataRange().getValues();

    // 直近15分の増加量を取得
    var windowStart = new Date(now.getTime() - POLL_INTERVAL_MIN * 60 * 1000);
    var latestCount = null;
    var windowStartCount = null;

    for (var i = 1; i < data.length; i++) {
      var t = data[i][0];
      var c = data[i][1];
      if (!(t instanceof Date) || typeof c !== 'number') continue;
      if (t <= now) {
        latestCount = c;
        if (t >= windowStart) {
          if (windowStartCount === null) windowStartCount = c;
        }
      }
    }

    if (latestCount === null || windowStartCount === null) return 0;

    // 直近15分の増加数
    var delta = Math.max(0, latestCount - windowStartCount);

    // 増加レート（人/分）× 推定待ち時間（分）= キュー補正
    var rate       = delta / POLL_INTERVAL_MIN;
    var correction = Math.round(rate * queueWaitMin);
    Logger.log('キュー補正: 直近' + POLL_INTERVAL_MIN + '分デルタ=' + delta + ' レート=' + rate.toFixed(2) + '人/分 × 待ち' + queueWaitMin + '分 = +' + correction + '人');
    return correction;
  } catch (e) {
    Logger.log('calcQueueCorrection_ error: ' + e.message);
    return 0;
  }
}

/**
 * 在席率に応じた動的キュー待ち時間（分）を返す（指数関数的増加）
 *
 * wait = minWait + (maxWait - minWait) × rate^exponent
 *
 * exponent=2（デフォルト）の例:
 *   在席率 30% → 補正係数 0.09  → ほぼ最小待ち
 *   在席率 60% → 補正係数 0.36
 *   在席率 80% → 補正係数 0.64
 *   在席率 95% → 補正係数 0.90  → 最大待ちに近い
 *
 * @param {number} occupancyRate 0.0〜1.0 の在席率（補正前の90minローリング値ベース）
 * @returns {number} 推定キュー待ち時間（分）
 */
function getDynamicQueueWait_(occupancyRate) {
  try {
    // Script Propertiesから読む（シートより高速）
    var props    = PropertiesService.getScriptProperties().getProperties();
    var minWait  = parseFloat(props['QUEUE_MIN_WAIT'])  || QUEUE_WAIT_MIN_DEFAULT;
    var maxWait  = parseFloat(props['QUEUE_MAX_WAIT'])  || QUEUE_WAIT_MAX_DEFAULT;
    var exponent = parseFloat(props['QUEUE_EXPONENT'])  || 2;

    var rate   = Math.max(0, Math.min(1, occupancyRate));
    var factor = Math.pow(rate, exponent); // 指数関数的係数（0〜1）
    var wait   = Math.round(minWait + (maxWait - minWait) * factor);
    Logger.log('動的キュー待ち: 在席率=' + Math.round(rate * 100) + '% 指数=' + exponent +
               ' 係数=' + factor.toFixed(3) + ' → 待ち' + wait + '分（最小' + minWait + '〜最大' + maxWait + '分）');
    return wait;
  } catch (e) {
    Logger.log('getDynamicQueueWait_ error: ' + e.message);
    return QUEUE_WAIT_MIN_DEFAULT;
  }
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

// ─── Meetup席数補正 ─────────────────────────────────────────

var MEETUP_SEATS_PER_EVENT = 4; // 1対面Meetupあたりの占有席数

/**
 * 指定日時に開催中の対面Meetup数を返す
 * @param {Date} targetTime
 * @returns {number}
 */
function getConcurrentMeetupCount_(targetTime) {
  try {
    var dateStr = Utilities.formatDate(targetTime, TIMEZONE, 'yyyy-MM-dd');
    var result  = getInPersonMeetups_(dateStr, dateStr);
    if (!result.ok) return 0;

    var dayMeetups = result.meetups[dateStr] || [];
    var targetMin  = targetTime.getHours() * 60 + targetTime.getMinutes();
    var count = 0;

    dayMeetups.forEach(function(m) {
      var range = parseMeetupTimeRange_(m.time);
      if (range && targetMin >= range.start && targetMin < range.end) {
        count++;
      }
    });
    return count;
  } catch (e) {
    Logger.log('getConcurrentMeetupCount_ error: ' + e.message);
    return 0;
  }
}

/**
 * 時間文字列をパースして { start, end }（分）を返す
 * 対応形式: "13:00〜14:30", "13:00-14:30", "13:00~14:30", "13:00"
 * 終了時刻が不明な場合は開始+90分とみなす
 */
function parseMeetupTimeRange_(timeStr) {
  if (!timeStr) return null;
  var m = timeStr.match(/(\d{1,2}):(\d{2})\s*[〜~\-]\s*(\d{1,2}):(\d{2})/);
  if (m) {
    return {
      start: parseInt(m[1]) * 60 + parseInt(m[2]),
      end:   parseInt(m[3]) * 60 + parseInt(m[4])
    };
  }
  var s = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (s) {
    var start = parseInt(s[1]) * 60 + parseInt(s[2]);
    return { start: start, end: start + 90 };
  }
  return null;
}

// ─── 営業時間ユーティリティ ──────────────────────────────────

/**
 * 指定日の実効営業時間を返す（貸切による短縮を反映）
 * 定休日・終日貸切の場合は null を返す
 * pollVisitCount の営業時間チェックで使用する
 *
 * @param {Date} targetDate
 * @returns {{ start: string, end: string } | null}
 */
function getEffectiveHoursForDate_(targetDate) {
  // ① 通常営業時間（Script Properties から高速取得）
  var normalHours = getBusinessHours(targetDate);
  if (!normalHours) return null; // 定休日

  // ② 貸切イベントを確認してあれば時間を調整
  try {
    var year     = targetDate.getFullYear();
    var month    = targetDate.getMonth() + 1;
    var dateISO  = Utilities.formatDate(targetDate, TIMEZONE, 'yyyy-MM-dd');
    var kMap     = buildKashikiriMap_(year, month);
    var kList    = kMap[dateISO] || [];

    if (kList.length > 0) {
      var k        = kList[0]; // 複数貸切は1件目を優先（顧客カレンダーAPIと同じロジック）
      var adjusted = adjustHoursForKashikiri_(normalHours.start, normalHours.end, k.start, k.end);
      if (!adjusted.isOpen) {
        Logger.log('getEffectiveHoursForDate_: ' + dateISO + ' 終日貸切');
        return null;
      }
      Logger.log('getEffectiveHoursForDate_: 貸切補正 ' + normalHours.start + '〜' + normalHours.end
                 + ' → ' + adjusted.open + '〜' + adjusted.close + ' (' + k.start + '〜' + k.end + ' 貸切)');
      return { start: adjusted.open, end: adjusted.close };
    }
  } catch (e) {
    Logger.log('getEffectiveHoursForDate_ kashikiri error: ' + e.message);
  }

  return normalHours; // 貸切なし → 通常時間
}

// ─── 共通ユーティリティ ──────────────────────────────────────

/**
 * 残席数 → 混雑レベル（1〜5）変換
 * 閾値はScript Properties（LEVEL1_PCT〜LEVEL4_PCT）から読み込む。
 * 未設定時のデフォルト: 70/46/22/1（各10%下げ済み）
 */
function seatsToLevel_(remaining) {
  try {
    var props = PropertiesService.getScriptProperties();
    var lv1 = parseInt(props.getProperty('LEVEL1_PCT') || '70');
    var lv2 = parseInt(props.getProperty('LEVEL2_PCT') || '46');
    var lv3 = parseInt(props.getProperty('LEVEL3_PCT') || '22');
    var lv4 = parseInt(props.getProperty('LEVEL4_PCT') || '1');
    var t1 = Math.ceil(TOTAL_SEATS * lv1 / 100);
    var t2 = Math.ceil(TOTAL_SEATS * lv2 / 100);
    var t3 = Math.ceil(TOTAL_SEATS * lv3 / 100);
    var t4 = Math.ceil(TOTAL_SEATS * lv4 / 100);
    if (remaining >= t1) return 1;
    if (remaining >= t2) return 2;
    if (remaining >= t3) return 3;
    if (remaining >= t4) return 4;
    return 5;
  } catch (e) {
    // フォールバック（デフォルト閾値）
    if (remaining >= 44) return 1;
    if (remaining >= 29) return 2;
    if (remaining >= 14) return 3;
    if (remaining >= 1)  return 4;
    return 5;
  }
}

/**
 * 残席手動上書き値を取得（Script Propertiesから読む）
 */
function getSeatsOverride_() {
  try {
    var val = PropertiesService.getScriptProperties().getProperty('SEATS_OVERRIDE');
    if (!val || val === '') return null;
    var num = parseInt(val);
    return (!isNaN(num) && num >= 0 && num <= TOTAL_SEATS) ? num : null;
  } catch (e) {
    Logger.log('getSeatsOverride_ error: ' + e.message);
    return null;
  }
}

/**
 * 「残席自動更新」フラグを確認（Script Propertiesから読む）
 */
function isAutoUpdateEnabled_() {
  try {
    var val = PropertiesService.getScriptProperties().getProperty('SEATS_AUTO_UPDATE');
    return val === 'TRUE';
  } catch (e) {
    Logger.log('isAutoUpdateEnabled_ error: ' + e.message);
    return false;
  }
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

// 混雑レベル閾値の設定シートキー名（表示ラベルそのまま）
var CONGESTION_KEY_MAP = {
  '「空いています」残席率(%)':       'LEVEL1_PCT',
  '「やや空いています」残席率(%)':   'LEVEL2_PCT',
  '「普通」残席率(%)':               'LEVEL3_PCT',
  '「やや混んでいます」残席率(%)':   'LEVEL4_PCT'
};
// 旧キー名 → 新キー名（移行用）
var CONGESTION_OLD_KEYS = {
  '混雑LV1閾値(%)': '「空いています」残席率(%)',
  '混雑LV2閾値(%)': '「やや空いています」残席率(%)',
  '混雑LV3閾値(%)': '「普通」残席率(%)',
  '混雑LV4閾値(%)': '「やや混んでいます」残席率(%)'
};

/**
 * 設定シートに残席関連の行が存在しなければ追加する
 * 旧キー名（混雑LV*閾値）が残っている場合は新キー名に移行する
 */
function ensureSeatsSettings_() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return;

    var data = sheet.getDataRange().getValues();
    var keys = data.map(function(row) { return String(row[0]); });

    // ① 旧キー名を新キー名に移行（値を引き継ぐ）
    Object.keys(CONGESTION_OLD_KEYS).forEach(function(oldKey) {
      var newKey = CONGESTION_OLD_KEYS[oldKey];
      var oldIdx = keys.indexOf(oldKey);
      if (oldIdx === -1) return;
      var oldVal = data[oldIdx][1];
      // 新キーがなければ追加してから旧行を削除
      if (keys.indexOf(newKey) === -1) {
        var desc = '残席がこの%以上のとき「' + newKey.replace(/[「」残席率\(\)%]/g, '') + '」と表示します';
        sheet.appendRow([newKey, oldVal, desc]);
        Logger.log('移行: ' + oldKey + ' → ' + newKey + ' = ' + oldVal);
      }
      sheet.deleteRow(oldIdx + 1); // +1 はヘッダー行ずれ補正
      // deleteRow後に再読み込み
      data = sheet.getDataRange().getValues();
      keys = data.map(function(row) { return String(row[0]); });
    });

    // ② 不足している行を追加
    var defaults = [
      ['残席手動上書き',    '',                    ''],
      ['残席自動更新',      'FALSE',               ''],
      ['キュー最小待ち(分)', QUEUE_WAIT_MIN_DEFAULT, ''],
      ['キュー最大待ち(分)', QUEUE_WAIT_MAX_DEFAULT, ''],
      ['キュー補正指数',     2,                    ''],
      ['「空いています」残席率(%)',     70, '残席がこの%以上のとき「空いています」と表示します'],
      ['「やや空いています」残席率(%)', 55, '残席がこの%以上のとき「やや空いています」と表示します'],
      ['「普通」残席率(%)',             30, '残席がこの%以上のとき「普通」と表示します'],
      ['「やや混んでいます」残席率(%)', 11, '残席がこの%以上のとき「やや混んでいます」と表示します']
    ];
    defaults.forEach(function(row) {
      if (keys.indexOf(row[0]) === -1) {
        sheet.appendRow(row);
        Logger.log('設定シートに追加: ' + row[0]);
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

/**
 * 利用可能な日付一覧を返す（来店数ログより）
 */
function handleGetVisitDates_() {
  var sheet = getOrCreateVisitLogSheet_();
  if (sheet.getLastRow() < 2) return { ok: true, dates: [] };

  var allData = sheet.getDataRange().getValues();
  var dateSet = {};
  for (var i = 1; i < allData.length; i++) {
    var t = allData[i][0];
    if (!(t instanceof Date)) continue;
    var dateStr = Utilities.formatDate(t, TIMEZONE, 'yyyy-MM-dd');
    dateSet[dateStr] = true;
  }
  var dates = Object.keys(dateSet).sort().reverse(); // 新しい順
  return { ok: true, dates: dates };
}

/**
 * 指定日の15分別在席推移タイムラインを返す
 * param.date: 'yyyy-MM-dd' 形式。省略時は今日
 * 各ポイントで「直近90分の来店増分 = 推定在席数」を計算
 */
function handleGetVisitTimeline_(param) {
  var targetDateStr = (param && param.date) ? param.date
    : Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');

  var sheet = getOrCreateVisitLogSheet_();
  if (sheet.getLastRow() < 2) return { ok: true, data: [], date: targetDateStr };

  var allData = sheet.getDataRange().getValues();
  var targetDate = new Date(targetDateStr + 'T00:00:00');
  var nextDate   = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);

  // 指定日のログを抽出
  var rows = [];
  for (var i = 1; i < allData.length; i++) {
    var t = allData[i][0];
    var c = allData[i][1];
    if (!(t instanceof Date) || t < targetDate || t >= nextDate) continue;
    rows.push({ time: t, count: typeof c === 'number' ? c : parseInt(c) });
  }
  if (rows.length === 0) return { ok: true, data: [], date: targetDateStr };

  // キュー設定・Meetupデータをループ前に1回だけ読む
  var queueProps   = PropertiesService.getScriptProperties().getProperties();
  var queueMinWait = parseFloat(queueProps['QUEUE_MIN_WAIT'])  || QUEUE_WAIT_MIN_DEFAULT;
  var queueMaxWait = parseFloat(queueProps['QUEUE_MAX_WAIT'])  || QUEUE_WAIT_MAX_DEFAULT;
  var queueExp     = parseFloat(queueProps['QUEUE_EXPONENT'])  || 2;

  // 対面Meetupを事前取得（ループ内で毎回シートを読まない）
  var meetupResult  = getInPersonMeetups_(targetDateStr, targetDateStr);
  var dayMeetups    = (meetupResult.ok && meetupResult.meetups[targetDateStr]) ? meetupResult.meetups[targetDateStr] : [];

  var timeline = [];
  for (var j = 0; j < rows.length; j++) {
    var pointTime = rows[j].time;
    var cutoff    = new Date(pointTime.getTime() - COOLDOWN_MIN * 60 * 1000);

    // cutoff直前の基準値（ベースライン）を求める
    var baseline = 0;
    for (var k = j - 1; k >= 0; k--) {
      if (rows[k].time < cutoff) { baseline = rows[k].count; break; }
    }

    // baseline〜pointTime の増分を合計（ローリング在席）
    var rolling = 0;
    var prev = baseline;
    for (var k = 0; k < rows.length; k++) {
      if (rows[k].time < cutoff)     { prev = rows[k].count; continue; }
      if (rows[k].time > pointTime)  break;
      var delta = rows[k].count - prev;
      if (delta > 0) rolling += delta;
      prev = rows[k].count;
    }
    rolling = Math.min(TOTAL_SEATS, rolling);

    // キュー補正（在席率に応じた動的待ち時間を使用）
    var baseRate   = Math.min(1, rolling / TOTAL_SEATS);
    var queueWait  = Math.round(queueMinWait + (queueMaxWait - queueMinWait) * Math.pow(baseRate, queueExp));
    var queueExtra = calcQueueCorrectionFromRows_(rows, j, queueWait);

    // 対面Meetup席数補正（事前取得済みデータで時刻判定のみ行う）
    var targetMin   = pointTime.getHours() * 60 + pointTime.getMinutes();
    var meetupCount = 0;
    dayMeetups.forEach(function(m) {
      var range = parseMeetupTimeRange_(m.time);
      if (range && targetMin >= range.start && targetMin < range.end) meetupCount++;
    });
    var meetupSeats = meetupCount * MEETUP_SEATS_PER_EVENT;

    var totalOccupied = Math.min(TOTAL_SEATS, rolling + queueExtra + meetupSeats);
    var remaining     = Math.max(0, TOTAL_SEATS - totalOccupied);

    timeline.push({
      time:        Utilities.formatDate(pointTime, TIMEZONE, 'HH:mm'),
      // 積み上げ内訳（グラフ用）
      rolling:     rolling,
      queueExtra:  queueExtra,
      meetupSeats: meetupSeats,
      queueWait:   queueWait,
      // 合計
      occupied:    totalOccupied,
      remaining:   remaining,
      meetupCount: meetupCount,
      level:       seatsToLevel_(remaining),
      pct:         Math.ceil(totalOccupied / TOTAL_SEATS * 100),
      rollingPct:  Math.ceil(rolling     / TOTAL_SEATS * 100),
      queuePct:    Math.ceil(queueExtra  / TOTAL_SEATS * 100),
      meetupPct:   Math.ceil(meetupSeats / TOTAL_SEATS * 100)
    });
  }

  // 混雑レベル閾値（在席率%）をレスポンスに含める
  var lv1Pct = parseInt(queueProps['LEVEL1_PCT'] || '70');
  var lv2Pct = parseInt(queueProps['LEVEL2_PCT'] || '46');
  var lv3Pct = parseInt(queueProps['LEVEL3_PCT'] || '22');
  var lv4Pct = parseInt(queueProps['LEVEL4_PCT'] || '1');
  // 残席率 → 在席率変換: 境界在席率 = (TOTAL_SEATS - ceil(TOTAL_SEATS * remainPct / 100)) / TOTAL_SEATS * 100
  function toOccupancyPct(remainPct) {
    var remainSeats = Math.ceil(TOTAL_SEATS * remainPct / 100);
    return Math.round((TOTAL_SEATS - remainSeats) / TOTAL_SEATS * 100);
  }
  var levelThresholds = [
    { y: toOccupancyPct(lv1Pct), label: 'やや空いています' },
    { y: toOccupancyPct(lv2Pct), label: '普通'             },
    { y: toOccupancyPct(lv3Pct), label: 'やや混んでいます' },
    { y: toOccupancyPct(lv4Pct), label: '混んでいます'     }
  ];

  return { ok: true, data: timeline, date: targetDateStr, levelThresholds: levelThresholds };
}

/**
 * 既存の rows 配列からキュー補正値を計算（シート再読み込みなし）
 * calcQueueCorrection_ のローカル配列版
 */
function calcQueueCorrectionFromRows_(rows, currentIndex, queueWaitMin) {
  try {
    if (currentIndex < 1) return 0;
    var pointTime   = rows[currentIndex].time;
    var windowStart = new Date(pointTime.getTime() - POLL_INTERVAL_MIN * 60 * 1000);

    var latestCount      = rows[currentIndex].count;
    var windowStartCount = null;

    for (var i = 0; i <= currentIndex; i++) {
      if (rows[i].time >= windowStart && windowStartCount === null) {
        windowStartCount = rows[i].count;
      }
    }
    if (windowStartCount === null) return 0;

    var delta = Math.max(0, latestCount - windowStartCount);
    var rate  = delta / POLL_INTERVAL_MIN;
    return Math.round(rate * queueWaitMin);
  } catch (e) {
    return 0;
  }
}

// ─── 設定シート → Script Properties 同期 ────────────────────

/**
 * 設定シートの残席関連設定をScript Propertiesに反映する
 * メニュー「残席管理 → 設定をGASに反映」から実行する
 * （実行時の読み込みはScript Propertiesから行うため、シート編集後は必ず実行）
 */
function syncSeatsSettingsToProperties() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) throw new Error('設定シートが見つかりません');

  var keyMap = {
    'キュー最小待ち(分)': 'QUEUE_MIN_WAIT',
    'キュー最大待ち(分)': 'QUEUE_MAX_WAIT',
    'キュー補正指数':     'QUEUE_EXPONENT',
    '残席自動更新':       'SEATS_AUTO_UPDATE',
    '残席手動上書き':     'SEATS_OVERRIDE',
    '「空いています」残席率(%)':     'LEVEL1_PCT',
    '「やや空いています」残席率(%)': 'LEVEL2_PCT',
    '「普通」残席率(%)':             'LEVEL3_PCT',
    '「やや混んでいます」残席率(%)': 'LEVEL4_PCT'
  };

  var data  = sheet.getDataRange().getValues();
  var props = PropertiesService.getScriptProperties();
  var synced = {};

  for (var i = 1; i < data.length; i++) {
    var sheetKey = String(data[i][0]);
    var propKey  = keyMap[sheetKey];
    if (!propKey) continue;

    var val = data[i][1];

    if (sheetKey === '残席手動上書き') {
      // 空欄 = 上書きなし → プロパティを削除
      if (val === '' || val === null || val === undefined) {
        props.deleteProperty('SEATS_OVERRIDE');
        synced[propKey] = '(削除)';
      } else {
        props.setProperty('SEATS_OVERRIDE', String(parseInt(val)));
        synced[propKey] = String(parseInt(val));
      }
    } else if (sheetKey === '残席自動更新') {
      var boolVal = (val === true || String(val).toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
      props.setProperty('SEATS_AUTO_UPDATE', boolVal);
      synced[propKey] = boolVal;
    } else if (CONGESTION_KEY_MAP[sheetKey]) {
      var pct = parseInt(val);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        Logger.log('混雑閾値が不正 (' + sheetKey + '): ' + val + ' → スキップ');
        continue;
      }
      props.setProperty(propKey, String(pct));
      synced[propKey] = String(pct) + '%';
    } else {
      props.setProperty(propKey, String(val));
      synced[propKey] = String(val);
    }
  }

  Logger.log('残席設定をScript Propertiesに反映: ' + JSON.stringify(synced));
  return synced;
}

/**
 * メニューから呼び出す同期ラッパー（アラート付き）
 */
function menuSyncSeatsSettings() {
  try {
    var synced = syncSeatsSettingsToProperties();
    var lines = Object.keys(synced).map(function(k) { return k + ' = ' + synced[k]; });
    SpreadsheetApp.getUi().alert('残席設定をGASに反映しました。\n\n' + lines.join('\n'));
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー: ' + e.message);
  }
}

/**
 * 混雑レベル閾値のみをScript Propertiesに反映するメニューラッパー
 * 設定シートの「混雑LV1〜4閾値(%)」を編集後に実行する
 */
function menuSyncCongestionThresholds() {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) throw new Error('設定シートが見つかりません');

    var keyMap = CONGESTION_KEY_MAP;
    var labels = {
      'LEVEL1_PCT': '空いています',
      'LEVEL2_PCT': 'やや空いています',
      'LEVEL3_PCT': '普通',
      'LEVEL4_PCT': 'やや混んでいます'
    };

    var data  = sheet.getDataRange().getValues();
    var props = PropertiesService.getScriptProperties();
    var lines = [];

    for (var i = 1; i < data.length; i++) {
      var sheetKey = String(data[i][0]);
      var propKey  = keyMap[sheetKey];
      if (!propKey) continue;

      var pct = parseInt(data[i][1]);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        throw new Error(sheetKey + ' の値が不正です（0〜100の整数を入力してください）: ' + data[i][1]);
      }
      props.setProperty(propKey, String(pct));
      var seats = Math.ceil(TOTAL_SEATS * pct / 100);
      lines.push(labels[propKey] + ': ' + pct + '% 以上（残席' + seats + '席以上）');
    }

    SpreadsheetApp.getUi().alert(
      '混雑レベル閾値をGASに反映しました。\n\n' + lines.join('\n') +
      '\n\n※ LV4未満はすべて「混んでいます」（LV5）と表示されます。'
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー: ' + e.message);
  }
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
    .everyMinutes(10)
    .create();
  Logger.log('pollVisitCount トリガーを' + POLL_INTERVAL_MIN + '分ごとに設定しました');
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

/**
 * 初回デプロイ後に一度だけ実行するブートストラップ処理
 * 設定シートへの行追加・閾値のScript Properties反映・トリガー再設定を行い、完了フラグを立てる
 */
function runBootstrapIfNeeded_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('BOOTSTRAP_DONE_v3') === 'true') return;

    Logger.log('=== ブートストラップ開始 ===');

    // 1. 設定シートに不足行（混雑閾値など）を追加
    ensureSeatsSettings_();

    // 2. 閾値をScript Propertiesに反映
    syncSeatsSettingsToProperties();

    // 3. トリガー再設定（triggerFollowUpReminder 含む全トリガー）
    updateTriggersFromSettings_();

    props.setProperty('BOOTSTRAP_DONE_v3', 'true');
    Logger.log('=== ブートストラップ完了 ===');
  } catch (e) {
    Logger.log('ブートストラップエラー（次回再試行）: ' + e.message);
  }
}
