var STAFF_SEND_MAPPING = {}; // { 'Name': 'Send ID' }
var STAFF_RECV_MAPPING = {}; // { 'Recv ID': 'Name' }

/**
 * 「スタッフ」シートから最新のマッピング情報を読み込み、
 * グローバル変数を更新
 */
function loadStaffMappingFromSheets_() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_STAFF);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    const sendMap = {};
    const recvMap = {};

    Logger.log('スタッフシート読込開始: 全' + data.length + '行');

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const name = row[0] ? String(row[0]).trim() : '';
      const sendId = row[1] ? String(row[1]).trim() : '';
      const recvId = row[5] ? String(row[5]).trim() : sendId; // F列が空ならB列を代用

      if (name && sendId) {
        sendMap[name] = sendId;
      }
      if (name && recvId) {
        recvMap[recvId] = name;
      }
    }

    STAFF_SEND_MAPPING = sendMap;
    STAFF_RECV_MAPPING = recvMap;

    Logger.log('スタッフマッピング更新完了: 送信' + Object.keys(sendMap).length + '名 / 受信' + Object.keys(recvMap).length + '名');
    return { send: sendMap, recv: recvMap };
  } catch (e) {
    Logger.log('スタッフマッピング読込エラー: ' + e.message);
    return null;
  }
}

/**
 * 指定日が授業期間かターム休みかを返す
 * 「期間設定」シート（A:開始日, B:種別）を参照
 * 終了日は「次の行の開始日の前日」として自動計算
 *
 * @param {Date} targetDate
 * @returns {string} '授業期間' | 'ターム休み'（未設定時は'授業期間'）
 */
function getTermPeriod_(targetDate) {
  try {
    const ss = SpreadsheetApp.openById(BUSINESS_HOURS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_PERIOD_SETTINGS);
    if (!sheet || sheet.getLastRow() <= 1) return '授業期間';

    const data = sheet.getDataRange().getValues();

    // 有効な行だけ抽出して開始日順にソート
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0] || !data[i][1]) continue;
      const start = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);
      if (isNaN(start.getTime())) continue;
      start.setHours(0, 0, 0, 0);
      rows.push({ start: start, kind: String(data[i][1]).trim() });
    }
    rows.sort(function(a, b) { return a.start - b.start; });

    // targetDateより後の最初の開始日を探し、その前日が終了日
    // → targetDateが含まれる期間 = targetDate以前の最後の開始日の行
    const targetMidnight = new Date(targetDate);
    targetMidnight.setHours(0, 0, 0, 0);

    let matched = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].start <= targetMidnight) {
        matched = rows[i];
      } else {
        break;
      }
    }

    return matched ? matched.kind : '授業期間';
  } catch (e) {
    Logger.log('getTermPeriod_ エラー: ' + e.message);
  }
  return '授業期間';
}

/**
 * 指定シートから曜日・期間に応じた時間設定を取得する内部関数
 *
 * 【シート列構成】
 * A: 曜日 | B: 授業期間_開始 | C: 授業期間_終了 | D: 授業期間_営業
 *          | E: ターム休み_開始 | F: ターム休み_終了 | G: ターム休み_営業
 *
 * @param {Date} targetDate
 * @param {string} sheetName - 読み込むシート名
 * @returns {{ start: string, end: string, period: string } | null}
 */
function getHoursFromSheet_(targetDate, sheetName) {
  if (!targetDate) return null;

  const sheet = SpreadsheetApp.openById(BUSINESS_HOURS_SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('「' + sheetName + '」シートが見つかりません。');
    return null;
  }

  const data = sheet.getDataRange().getValues();
  const dayOfWeekJaMap = { 0: '日', 1: '月', 2: '火', 3: '水', 4: '木', 5: '金', 6: '土' };
  const targetDayJa = dayOfWeekJaMap[targetDate.getDay()];

  const period = getTermPeriod_(targetDate);
  const isTermBreak = (period === 'ターム休み');

  // 列インデックス: 授業期間=B(1),C(2),D(3) / ターム休み=E(4),F(5),G(6)
  const colOpen   = isTermBreak ? 4 : 1;
  const colClose  = isTermBreak ? 5 : 2;
  const colIsOpen = isTermBreak ? 6 : 3;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0]).trim() !== targetDayJa) continue;

    // ターム休み列が未設定の場合、授業期間列にフォールバック
    const openVal   = row[colOpen]   || row[1];
    const closeVal  = row[colClose]  || row[2];
    const isOpenVal = (row[colIsOpen] !== undefined && row[colIsOpen] !== '') ? row[colIsOpen] : row[3];

    const isBusinessDay = isOpenVal === true || String(isOpenVal).toUpperCase() === 'TRUE';
    if (!isBusinessDay || isJapaneseHoliday_(targetDate)) return null;

    return { start: formatTime_(openVal), end: formatTime_(closeVal), period: period };
  }

  return { start: '10:00', end: '20:00', period: period };
}

/**
 * お客様向け営業時間を取得する（顧客カレンダー用）
 * 「営業時間」シートを参照
 *
 * @param {Date} targetDate
 * @returns {{ start: string, end: string, period: string } | null}
 */
function getBusinessHours(targetDate) {
  return getHoursFromSheet_(targetDate, BUSINESS_HOURS_SHEET_NAME);
}

/**
 * スタッフ勤務時間を取得する（シフト不足チェック用）
 * 「スタッフ勤務時間」シートを参照。シートがなければ「営業時間」シートにフォールバック
 *
 * @param {Date} targetDate
 * @returns {{ start: string, end: string, period: string } | null}
 */
function getStaffHours(targetDate) {
  const result = getHoursFromSheet_(targetDate, STAFF_HOURS_SHEET_NAME);
  if (result !== null) return result;
  // シートが未作成の場合は営業時間シートで代用
  return getHoursFromSheet_(targetDate, BUSINESS_HOURS_SHEET_NAME);
}

/**
 * 指定日の翌日以降で、最初に「営業日」チェックが入っている日を探す
 * @param {Date} startDate - 基準日
 * @returns {Date} 次営業日のDateオブジェクト
 */
function findNextBusinessDay_(startDate) {
  let date = new Date(startDate.getTime());

  // 最大7日間探す（無限ループ防止）
  for (let i = 0; i < 7; i++) {
    date.setDate(date.getDate() + 1);
    const hours = getBusinessHours(date);
    if (hours) {
      return date; // 営業時間を取得できれば＝営業日
    }
  }

  // 見つからない場合は翌日を返す（フォールバック）
  const tomorrow = new Date(startDate.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

// 祝日キャッシュ（GAS実行1回につき月単位で保持）
var _holidayCache_ = {};

/**
 * 指定日が日本の祝日かどうかを判定する
 * 同じ月のリクエストはキャッシュを使い CalendarApp 呼び出しを1回に抑える
 * @param {Date} date
 * @returns {boolean}
 */
function isJapaneseHoliday_(date) {
  try {
    const monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');

    // 月単位で祝日セットを一括取得（初回のみ）
    if (!_holidayCache_[monthKey]) {
      const set = {};
      const calendarIds = [
        'ja.japanese#holiday@group.v.calendar.google.com',
        'japanese__ja@holiday.calendar.google.com',
        'en.japanese#holiday@group.v.calendar.google.com'
      ];
      let calendar = null;
      for (let i = 0; i < calendarIds.length; i++) {
        calendar = CalendarApp.getCalendarById(calendarIds[i]);
        if (calendar) break;
      }
      if (!calendar) {
        const cals = CalendarApp.getCalendarsByName('日本の祝日');
        if (cals && cals.length > 0) calendar = cals[0];
      }
      if (calendar) {
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        const end   = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
        const events = calendar.getEvents(start, end);
        events.forEach(function(e) {
          set[Utilities.formatDate(e.getStartTime(), TIMEZONE, 'yyyy-MM-dd')] = true;
        });
        Logger.log('祝日一括取得: ' + monthKey + ' → ' + Object.keys(set).length + '件');
      } else {
        Logger.log('警告: 日本の祝日カレンダーが見つかりませんでした。');
      }
      _holidayCache_[monthKey] = set;
    }

    const iso = Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
    return !!_holidayCache_[monthKey][iso];
  } catch (e) {
    Logger.log('祝日判定エラー: ' + e.message);
    return false;
  }
}

/**
 * 時刻フォーマットを HH:mm に統一するヘルパー
 */
function formatTime_(obj) {
  if (obj instanceof Date) {
    return Utilities.formatDate(obj, TIMEZONE, 'HH:mm');
  }
  // 文字列の場合、H:mm なら HH:mm にする等の正規化が必要だが
  // ここでは入力が正しい前提で文字列化のみ
  return String(obj).trim();
}

/**
 * シフト変更を適用する（シート更新）
 * @param {Date} targetDate
 * @param {string} staffName
 * @param {string} newTimeRange "10:00〜12:00"
 * @returns {boolean}
 */
function updateShiftInSheet(targetDate, staffName, newTimeRange) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SHIFTS);
  if (!sheet) return false;

  const targetDateStr = Utilities.formatDate(targetDate, TIMEZONE, 'yyyy/MM/dd');
  const data = sheet.getDataRange().getValues();

  // "〜" の表記揺れ対応
  const normalizedRange = newTimeRange.replace('~', '〜');
  const [newStart, newEnd] = normalizedRange.split('〜');

  let updated = false;

  // 既存レコードを探して更新
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], TIMEZONE, 'yyyy/MM/dd') : String(data[i][0]);
    const rowStaff = data[i][2]; // C列: スタッフ名

    if (rowDate === targetDateStr && rowStaff === staffName) {
      // D列: Start, E列: End
      sheet.getRange(i + 1, 4).setValue(newStart.trim()); // D
      sheet.getRange(i + 1, 5).setValue(newEnd.trim());   // E
      sheet.getRange(i + 1, 8).setValue('webhook_update'); // H: 登録元
      updated = true;
      break; // 1日1レコード前提ならbreak。複数シフトある場合は条件追加が必要
    }
  }

  // 既存がない場合は新規追加（今回の変更申請対応）
  if (!updated) {
    sheet.appendRow([
      targetDateStr,
      ['日', '月', '火', '水', '木', '金', '土'][new Date(targetDateStr).getDay()],
      staffName,
      newStart.trim(),
      newEnd.trim(),
      '',               // 業務内容
      new Date(),       // 登録日時
      'webhook_create'  // 登録元
    ]);
    updated = true;
  }

  return updated;
}

/**
 * 指定日の全シフトを取得する
 * @param {Date} date
 * @returns {Array<{ name: string, start: string, end: string, tasks: string[] }>}
 */
function getShiftsForDate(date) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SHIFTS);
  if (!sheet) return [];

  const targetDateStr = Utilities.formatDate(date, TIMEZONE, 'yyyy/MM/dd');
  const data = sheet.getDataRange().getValues();
  // ヘッダー除く
  const shifts = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDate = row[0] instanceof Date ? Utilities.formatDate(row[0], TIMEZONE, 'yyyy/MM/dd') : String(row[0]);

    if (rowDate === targetDateStr) {
      shifts.push({
        name: String(row[2]).trim(),
        start: formatCellTime_(row[3]),
        end: formatCellTime_(row[4]),
        tasks: row[5] ? String(row[5]).split('/') : []
      });
    }
  }

  // 開始時間順にソート (HH:MM -> Number)
  shifts.sort((a, b) => {
    return parseInt(a.start.replace(':', '')) - parseInt(b.start.replace(':', ''));
  });

  return shifts;
}

/**
 * シフト不足をチェックする
 * @param {Date} targetDate
 * @returns {string[]} 不足している時間帯のリスト（例: ["10:00〜11:00", "13:00〜14:00"]）
 */
function checkShiftShortageForDate(targetDate) {
  const businessHours = getStaffHours(targetDate); // スタッフ勤務時間でチェック
  if (!businessHours || !businessHours.start || !businessHours.end) {
    return []; // 勤務時間設定なし or 休業日
  }

  const shifts = getShiftsForDate(targetDate);
  const slots = []; // 30分ごとのスロット { start: "HH:mm", end: "HH:mm", count: 0 }

  // 営業時間からスロット生成 (例: 10:00, 10:30, ...)
  let current = stringToDate_(businessHours.start);
  const end = stringToDate_(businessHours.end);

  while (current < end) {
    const next = new Date(current.getTime() + 30 * 60 * 1000);
    if (next > end) break;

    slots.push({
      start: formatTime_(current),
      end: formatTime_(next),
      count: 0
    });
    current = next;
  }

  // 各スロットにスタッフがいるかカウント
  shifts.forEach(shift => {
    const shiftStart = stringToDate_(shift.start);
    const shiftEnd = stringToDate_(shift.end);

    slots.forEach(slot => {
      const slotStart = stringToDate_(slot.start);
      // スロット開始時刻がシフト内（開始 <= スロット < 終了）
      if (shiftStart <= slotStart && slotStart < shiftEnd) {
        slot.count++;
      }
    });
  });

  // 不足している（count === 0）スロットを抽出
  const shortageSlots = slots.filter(s => s.count === 0);

  // 連続するスロットを結合して読みやすくする
  // 例: 10:00-10:30, 10:30-11:00 -> 10:00-11:00
  return mergeShortageSlots_(shortageSlots);
}

// --- Helper for Time Calculation ---

function stringToDate_(timeStr) {
  const d = new Date();
  const [h, m] = timeStr.split(':');
  d.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
  return d;
}

function mergeShortageSlots_(slots) {
  if (slots.length === 0) return [];

  const merged = [];
  let current = { start: slots[0].start, end: slots[0].end };

  for (let i = 1; i < slots.length; i++) {
    if (slots[i].start === current.end) {
      // 連続している場合、終了時刻を延長
      current.end = slots[i].end;
    } else {
      // 連続していない場合、今の期間を保存して新しい期間開始
      merged.push(current.start + '〜' + current.end);
      current = { start: slots[i].start, end: slots[i].end };
    }
  }
  merged.push(current.start + '〜' + current.end);

  return merged;
}

/**
 * 名前でスタッフを検索し、受信用ID（C列）を自動登録する
 * @param {string} name - LINE Worksから取得した表示名
 * @param {string} userId - 受信したsource.userId
 * @returns {boolean}
 */
function autoRegisterRecvId_(name, userId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_STAFF);
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    const normalizedTarget = normalizeName_(name);

    for (let i = 1; i < data.length; i++) {
      const sheetName = normalizeName_(String(data[i][0]));
      if (sheetName === normalizedTarget) {
        sheet.getRange(i + 1, 6).setValue(userId); // F列: 受信用ID
        Logger.log('受信用ID自動登録完了: ' + name + ' -> ' + userId);
        return true;
      }
    }
    Logger.log('自動登録失敗: シートに一致する名前なし - ' + name);
    return false;
  } catch (e) {
    Logger.log('自動登録エラー: ' + e.message);
    return false;
  }
}

/**
 * スタッフのID（UUID）をシートに書き込む
 * @param {string} staffName
 * @param {string} userId
 */
function updateStaffId_(staffName, userId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_STAFF);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === staffName) {
        // B列（インデックス1）にIDを書き込む
        sheet.getRange(i + 1, 2).setValue(userId);
        Logger.log('スタッフIDを更新しました: ' + staffName + ' -> ' + userId);
        return true;
      }
    }
  } catch (e) {
    Logger.log('スタッフID構成エラー: ' + e.message);
  }
  return false;
}
