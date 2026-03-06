// ============================================================
// calendarService.gs - Googleカレンダー連携
// PDF取込時にスタッフのカレンダーへシフト予定を自動登録
// ============================================================

/**
 * 「スタッフ」シートからメールアドレスマッピングを読み込む
 * @returns {Object} { スタッフ名: メールアドレス }
 */
function loadStaffEmailMap_() {
  const map = {};
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_STAFF);
    if (!sheet) return map;

    const data = sheet.getDataRange().getValues();
    // A: スタッフ名, B: LINE WORKS ID, C: 有効, D: 登録日, E: Googleカレンダー用メール
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0]).trim();
      const email = data[i][4] ? String(data[i][4]).trim() : '';
      const active = data[i][2] !== false && data[i][2] !== 'FALSE';

      if (name && email && active && email.includes('@')) {
        map[name] = email;
      }
    }
    Logger.log('カレンダー用メール読み込み: ' + Object.keys(map).length + '名');
  } catch (e) {
    Logger.log('メールマッピング読み込みエラー: ' + e.message);
  }
  return map;
}

/**
 * シフトデータをGoogleカレンダーに登録する
 * @param {Array} allShifts - [{date, dayOfWeek, shifts: [{name, start, end, tasks}]}]
 * @returns {number} 登録件数
 */
function registerShiftsToCalendar(allShifts) {
  const staffEmailMap = loadStaffEmailMap_();
  if (Object.keys(staffEmailMap).length === 0) {
    Logger.log('カレンダー用メール登録なし → カレンダー登録スキップ');
    return 0;
  }

  const calendar = CalendarApp.getDefaultCalendar();
  let registeredCount = 0;

  for (const entry of allShifts) {
    const dateStr = entry.date; // "2026-02-18" 形式

    for (const staff of entry.shifts) {
      const email = staffEmailMap[staff.name];
      if (!email) continue; // メール未登録 → スキップ

      try {
        // 日時を構築
        const startTime = buildDateTime_(dateStr, staff.start);
        const endTime = buildDateTime_(dateStr, staff.end);
        if (!startTime || !endTime) {
          Logger.log('日時構築失敗: ' + staff.name + ' ' + dateStr);
          continue;
        }

        // 重複チェック
        const eventTitle = '【BizCAFE】シフト: ' + staff.name;
        if (isDuplicateEvent_(calendar, eventTitle, startTime, endTime)) {
          Logger.log('重複スキップ: ' + staff.name + ' ' + dateStr + ' ' + staff.start);
          continue;
        }

        // イベント作成
        const description = staff.tasks.length > 0
          ? '業務内容: ' + staff.tasks.join(' / ')
          : '';

        const event = calendar.createEvent(
          eventTitle,
          startTime,
          endTime,
          {
            description: description,
            guests: email,
            sendInvites: false  // 招待メールを送らない（静かに登録）
          }
        );

        Logger.log('カレンダー登録: ' + staff.name + ' ' + dateStr + ' ' + staff.start + '〜' + staff.end);
        registeredCount++;

      } catch (e) {
        Logger.log('カレンダー登録エラー (' + staff.name + '): ' + e.message);
      }
    }
  }

  Logger.log('カレンダー登録完了: ' + registeredCount + '件');
  return registeredCount;
}

/**
 * 日付文字列と時刻文字列からDateオブジェクトを構築
 * @param {string} dateStr - "2026-02-18" 形式
 * @param {string} timeStr - "13:45" 形式
 * @returns {Date|null}
 */
function buildDateTime_(dateStr, timeStr) {
  try {
    const parts = dateStr.split('-');
    const timeParts = timeStr.split(':');
    if (parts.length < 3 || timeParts.length < 2) return null;

    const dt = new Date(
      parseInt(parts[0]),
      parseInt(parts[1]) - 1,
      parseInt(parts[2]),
      parseInt(timeParts[0]),
      parseInt(timeParts[1])
    );
    return isNaN(dt.getTime()) ? null : dt;
  } catch (e) {
    return null;
  }
}

/**
 * 重複イベントがあるかチェック
 * @param {CalendarApp.Calendar} calendar
 * @param {string} title
 * @param {Date} startTime
 * @param {Date} endTime
 * @returns {boolean}
 */
function isDuplicateEvent_(calendar, title, startTime, endTime) {
  const events = calendar.getEvents(startTime, endTime);
  for (const event of events) {
    if (event.getTitle() === title &&
        event.getStartTime().getTime() === startTime.getTime() &&
        event.getEndTime().getTime() === endTime.getTime()) {
      return true;
    }
  }
  return false;
}

/**
 * メニュー: シートのシフトをカレンダー同期
 * 「シフト」シートにある既存データをすべてカレンダーに同期する（今日以降）
 */
function menuSyncCalendarFromSheet() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    ui.alert('シートが見つかりません');
    return;
  }

  const data = sheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const groupedShifts = {}; // { "2026-02-18": [shift, ...] }

  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][0];
    if (!rawDate) continue;

    const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (isNaN(date.getTime()) || date < today) continue; // 今日より前はスキップ

    const dateStr = Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
    if (!groupedShifts[dateStr]) groupedShifts[dateStr] = [];

    const tasks = data[i][5] ? String(data[i][5]).split(' / ').filter(Boolean) : [];
    
    groupedShifts[dateStr].push({
      name: String(data[i][2]).trim(),
      start: formatCellTime_(data[i][3]),
      end: formatCellTime_(data[i][4]),
      tasks: tasks
    });
  }

  // registerShiftsToCalendar が期待する形式に変換
  const allShifts = Object.keys(groupedShifts).map(dateStr => {
    return {
      date: dateStr,
      shifts: groupedShifts[dateStr]
    };
  });

  if (allShifts.length === 0) {
    ui.alert('同期対象なし', '本日以降のシフトデータが「シフト」シートに見つかりませんでした。', ui.ButtonSet.OK);
    return;
  }

  const registeredCount = registerShiftsToCalendar(allShifts);
  ui.alert('同期完了', registeredCount + '件の予定をGoogleカレンダーに登録/更新しました。', ui.ButtonSet.OK);
}
