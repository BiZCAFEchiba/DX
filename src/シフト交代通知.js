// ============================================================
// シフト交代通知.js - シフト交代をLINE WORKSに通知する
// ============================================================

/**
 * シフト代理スタッフ（スタッフシートG列がTRUEの人）一覧を取得する
 * @returns {{ name: string, sendId: string }[]}
 */
function getShiftAgentStaff() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_STAFF);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const data = sheet.getDataRange().getValues();
    const agents = [];

    for (let i = 1; i < data.length; i++) {
      const name   = data[i][0] ? String(data[i][0]).trim() : '';
      const sendId = data[i][1] ? String(data[i][1]).trim() : '';
      // G列（インデックス6）: シフト代理フラグ
      const isAgent = data[i][6] === true || String(data[i][6]).toUpperCase() === 'TRUE';

      if (name && isAgent) {
        agents.push({ name: name, sendId: sendId });
      }
    }

    Logger.log('シフト代理スタッフ取得: ' + agents.length + '名');
    return agents;
  } catch (e) {
    Logger.log('getShiftAgentStaff エラー: ' + e.message);
    return [];
  }
}

/**
 * シフト交代をLINE WORKSグループ・代理スタッフに通知する
 *
 * @param {Object} params
 * @param {string} params.date         - 対象日 (YYYY-MM-DD)
 * @param {string} params.originalStaff - 元のシフト担当スタッフ名
 * @param {string} params.originalTime  - 元のシフト時間 (HH:mm〜HH:mm)
 * @param {string} params.agentStaff   - 代理スタッフ名
 * @param {string} params.reason       - 交代理由
 * @param {boolean} params.notifyGroup  - グループへ通知するか
 * @param {boolean} params.notifyAgent  - 代理スタッフ本人へも個別DM通知するか
 * @returns {{ ok: boolean, groupSent: boolean, agentSent: boolean, error?: string }}
 */
function notifyShiftChange_(params) {
  try {
    initChannelId_();
    const token = getLineWorksAccessToken();
    if (!token) {
      Logger.log('シフト交代通知: アクセストークン取得失敗');
      return { ok: false, groupSent: false, agentSent: false, error: 'token_error' };
    }

    // 日付を日本語表示に変換
    const dateLabel = formatDateLabelFromISO_(params.date);

    // ── スプレッドシート更新 ─────────────────────────────────
    if (params.mode === 'assign' && params.date && params.originalStaff && params.agentStaff) {
      updateShiftStaff(params.date, params.originalStaff, params.agentStaff, params.newStart || null, params.newEnd || null);
    } else if (params.mode === 'edit' && params.date && params.originalStaff && params.newStart && params.newEnd) {
      updateShiftInSheet(new Date(params.date + 'T00:00:00+09:00'), params.originalStaff, params.newStart + '〜' + params.newEnd);
    }

    // 通知テキスト作成
    const text = buildShiftChangeText_(dateLabel, params);

    let groupSent = false;
    let agentSent = false;

    // ── グループへ送信 ───────────────────────────────────────
    if (params.notifyGroup) {
      const groupUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID + '/messages';
      const groupRes = sendLineWorksText_(token, groupUrl, text, SHIFT_CHANGE_BOT_ID);
      groupSent = groupRes;
      Logger.log('グループ通知: ' + (groupSent ? '成功' : '失敗'));
    }

    // ── 承認者へ個別DM送信（交代モード時） ───────────────────────────
    if (params.mode === 'assign') {
      const isTestMode = (typeof SHIFT_CHANGE_CHANNEL_ID_TEST !== 'undefined' && SHIFT_CHANGE_CHANNEL_ID === SHIFT_CHANGE_CHANNEL_ID_TEST);
      const approvers = getShiftAgentStaff(); // G列チェックのスタッフ（承認者）
      const dmText = '📩 【シフト交代の承認依頼】\n\n' + text;

      approvers.forEach(function(approver) {
        if (!approver.sendId) return;
        if (isTestMode) {
          const testGroupText = '【テスト環境】 承認者DM送信テスト\n本来は (' + approver.name + ') さん個人のDM宛に以下の通知が届きます:\n---\n' + dmText;
          const groupUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID_TEST + '/messages';
          sendLineWorksText_(token, groupUrl, testGroupText, SHIFT_CHANGE_BOT_ID);
        } else {
          const approverUrl = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + approver.sendId + '/messages';
          sendLineWorksText_(token, approverUrl, dmText, LINEWORKS_BOT_ID);
        }
        agentSent = true;
      });
    }

    return { ok: true, groupSent: groupSent, agentSent: agentSent };
  } catch (e) {
    Logger.log('notifyShiftChange_ エラー: ' + e.message);
    return { ok: false, groupSent: false, agentSent: false, error: e.message };
  }
}

/**
 * シフト交代通知テキストを組み立てる
 * @private
 */
function buildShiftChangeText_(dateLabel, params) {
  const isEdit = (params.mode === 'edit');
  let title = isEdit ? '📝 【シフト時間変更・延長のお知らせ】' : '🔄 【シフト交代のお知らせ】';
  
  let text = title + '\n\n';
  text += '📅 ' + dateLabel + '\n';
  
  if (isEdit) {
    // 編集・延長モード
    text += '👤 担当者: ' + (params.originalStaff || '') + '\n';
    text += '⏰ 時間変更: ' + (params.originalTime || '') + ' → ' + (params.newStart || '') + '〜' + (params.newEnd || '') + '\n';
  } else {
    // 交代モード
    text += '⏰ 時間: ' + (params.newStart || params.originalTime || '') + '〜' + (params.newEnd || '') + '\n';
    text += '👤 担当者: ' + (params.originalStaff || '') + ' → ' + (params.agentStaff || '') + '\n';
  }
  
  if (params.reason) {
    text += '📝 理由: ' + params.reason + '\n';
  }
  text += '\nご確認よろしくお願いします🙏';
  return text;
}

/**
 * 指定URLにLINE WORKSテキストメッセージを送信するヘルパー
 * @private
 * @param {string} token   - アクセストークン
 * @param {string} url     - 送信先URL
 * @param {string} text    - 送信テキスト
 * @param {string} botId   - BotID（認証ヘッダー切り替え用）
 * @returns {boolean}
 */
function sendLineWorksText_(token, url, text, botId) {
  try {
    const payload = JSON.stringify({
      content: { type: 'text', text: text }
    });
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: payload,
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    Logger.log('LINE WORKS送信 [' + url.split('/').slice(-2).join('/') + ']: HTTP ' + code);
    if (code !== 200 && code !== 201) {
      Logger.log('レスポンス: ' + res.getContentText());
    }
    return code === 200 || code === 201;
  } catch (e) {
    Logger.log('sendLineWorksText_ エラー: ' + e.message);
    return false;
  }
}

/**
 * シフト変更依頼（トラブル報告）の通知を行う
 */
function notifyShiftTrouble_(params) {
  initChannelId_();
  const token = getLineWorksAccessToken();
  if (!token) return { error: 'token_error' };

  let text = '🚨\n【FMT】\n';
  text += '名前:' + (params.staffName || '') + '\n';
  text += '日にち:' + (params.date || '') + '\n';
  text += '時間:' + (params.time || '') + '\n';
  text += '理由:' + (params.reason || '') + '\n';
  text += '抜けた後のオペ数:' + (params.remainingOpe || '') + '\n';

  const groupUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + TROUBLE_REPORT_CHANNEL_ID + '/messages';
  const groupSent = sendLineWorksText_(token, groupUrl, text, SHIFT_CHANGE_BOT_ID);
  
  return { ok: true, groupSent: groupSent };
}

/**
 * シフト交代の募集を開始し、J列（ステータス）を更新して通知する
 * ・グループ: 募集詳細 + 残オペ数
 * ・全スタッフDM: 詳細 + [✅入れる][❌入れない] ボタン
 */
function requestShiftRecruitment_(params) {
  initChannelId_();
  const token = getLineWorksAccessToken();
  if (!token) return { error: 'token_error' };

  let originalStart = params.originalStart || null;
  let recruitStart  = params.recruitStart  || null;
  let recruitEnd    = params.recruitEnd    || null;

  if ((!recruitStart || !recruitEnd) && params.originalTime) {
    const parts = params.originalTime.split(/[〜\-]/);
    if (parts.length >= 1 && parts[0].trim()) recruitStart = recruitStart || parts[0].trim();
    if (parts.length >= 2 && parts[1].trim()) recruitEnd   = recruitEnd   || parts[1].trim();
  }
  if (!originalStart) originalStart = recruitStart;

  let updated = false;
  try {
    updated = recruitShiftSegment(params.date, params.originalStaff, originalStart, recruitStart, recruitEnd);
  } catch (e) {
    Logger.log('recruitShiftSegment エラー（通知は継続）: ' + e.message);
  }

  const timeLabel = (recruitStart && recruitEnd) ? recruitStart + '〜' + recruitEnd : (params.originalTime || '');

  // 残オペ計算（募集時間帯を1時間スロットで）
  const slots = calcOpeCountPerSlot_(params.date, params.originalStaff, recruitStart, recruitEnd);

  // 募集をシートに保存
  const recruitmentId = saveRecruitment_({
    date: params.date,
    start: recruitStart || '',
    end: recruitEnd || '',
    staffName: params.originalStaff,
    reason: params.reason || ''
  });

  // ── グループ通知（残オペ情報付き） ──────────────────────
  const mentionMarker = '@All ';
  let text = mentionMarker + '🔄 【シフト交代の募集】\n\n';
  text += '📅 ' + formatDateLabelFromISO_(params.date) + '\n';
  text += '⏰ ' + timeLabel + '\n';
  text += '👤 ' + params.originalStaff + ' → (募集中)\n';
  text += '📝 理由: ' + (params.reason || '記載なし') + '\n\n';
  if (slots.length > 0) {
    text += '【抜けた後のオペ数】\n';
    slots.forEach(function(s) {
      text += s.start + '〜' + s.end + ': ' + s.count + 'オペ' + (s.count === 0 ? ' ⚠️' : '') + '\n';
    });
    text += '\n';
  }
  text += '個人DMに回答ボタンが届いています🙏';

  const kanbuUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + KANBU_CHANNEL_ID + '/messages';
  let groupSent = false;
  try {
    const res = UrlFetchApp.fetch(kanbuUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        content: { type: 'text', text: text },
        mentionedList: [{ type: 'all', offset: 0, length: mentionMarker.trim().length }]
      }),
      muteHttpExceptions: true
    });
    groupSent = (res.getResponseCode() === 200 || res.getResponseCode() === 201);
    Logger.log('シフト募集グループ通知: HTTP ' + res.getResponseCode());
  } catch (e) {
    Logger.log('シフト募集グループ通知エラー: ' + e.message);
  }

  // ── 全スタッフへDM（ボタン付き） ──────────────────────
  sendRecruitmentDMs_(token, recruitmentId, params.date, timeLabel, params.reason, params.originalStaff, slots);

  return { ok: true, updated: updated, groupSent: groupSent, recruitmentId: recruitmentId };
}

// ============================================================
// シフト募集: データ保存・応答・計算ヘルパー
// ============================================================

/**
 * シフト募集をシートに保存してIDを返す
 * 列: A=募集ID | B=募集日 | C=開始時刻 | D=終了時刻 | E=対象スタッフ名 | F=理由 | G=ステータス | H=募集日時
 */
function saveRecruitment_(params) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_RECRUITMENT);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_RECRUITMENT);
    sheet.getRange(1, 1, 1, 8).setValues([['募集ID','募集日','開始時刻','終了時刻','対象スタッフ名','理由','ステータス','募集日時']]);
  }
  var now = new Date();
  var id = 'R' + Utilities.formatDate(now, TIMEZONE, 'yyyyMMddHHmmss');
  sheet.appendRow([id, params.date, params.start, params.end, params.staffName, params.reason || '', '募集中', now]);
  Logger.log('シフト募集保存: ' + id);
  return id;
}

/**
 * 募集への応答を記録する
 * 既存回答があれば更新、なければ追加
 * @returns {boolean} 入れるが初めての回答なら true
 */
function recordRecruitmentResponse_(recruitId, staffName, response) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_RECRUITMENT_RESPONSE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_RECRUITMENT_RESPONSE);
    sheet.getRange(1, 1, 1, 4).setValues([['募集ID','スタッフ名','応答','応答日時']]);
  }

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === recruitId && String(data[i][1]) === staffName) {
        var wasAvailable = String(data[i][2]) === '入れる';
        sheet.getRange(i + 2, 3).setValue(response);
        sheet.getRange(i + 2, 4).setValue(new Date());
        touchShiftLastModified_();
        Logger.log('募集応答更新: ' + staffName + ' → ' + response);
        // 変更前が入れないで今回入れるになった場合も初回扱い
        return (!wasAvailable && response === '入れる');
      }
    }
  }

  sheet.appendRow([recruitId, staffName, response, new Date()]);
  touchShiftLastModified_();
  Logger.log('募集応答追加: ' + staffName + ' → ' + response);

  if (response === '入れる') {
    // 入れるが何件目か確認
    var allData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    var count = allData.filter(function(r) { return String(r[0]) === recruitId && String(r[2]) === '入れる'; }).length;
    return count === 1;
  }
  return false;
}

/**
 * 募集IDの回答状況を返す
 * @returns {{ available: string[], unavailable: string[] }}
 */
function getRecruitmentResponses_(recruitId) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_RECRUITMENT_RESPONSE);
  if (!sheet || sheet.getLastRow() <= 1) return { available: [], unavailable: [] };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  var available = [], unavailable = [];
  data.forEach(function(r) {
    if (String(r[0]) !== recruitId) return;
    if (r[2] === '入れる') available.push(String(r[1]));
    else unavailable.push(String(r[1]));
  });
  return { available: available, unavailable: unavailable };
}

/**
 * 指定日のアクティブな募集一覧と応答状況を返す（getShifts API用）
 * シフト募集シートに未登録の「募集中」ステータスのシフトも自動補完する
 */
function getActiveRecruitmentsForDate_(dateISO) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. シフト募集シートから既存エントリ取得
  var recruitSheet = ss.getSheetByName(SHEET_RECRUITMENT);
  var results = [];
  var registeredKeys = {}; // staffName|start|end → true

  if (recruitSheet && recruitSheet.getLastRow() > 1) {
    var data = recruitSheet.getRange(2, 1, recruitSheet.getLastRow() - 1, 8).getValues();
    data.forEach(function(r) {
      try {
        var rowDate = r[1] instanceof Date
          ? Utilities.formatDate(r[1], TIMEZONE, 'yyyy-MM-dd')
          : String(r[1]).substring(0, 10);
        if (rowDate !== dateISO) return;
        if (String(r[6]).trim() !== '募集中') return;
        var id = String(r[0]);
        var resp = getRecruitmentResponses_(id);
        var startFmt = formatCellTime_(r[2]);
        var endFmt   = formatCellTime_(r[3]);
        results.push({
          id: id, date: rowDate,
          start: startFmt, end: endFmt,
          staffName: String(r[4]), reason: String(r[5]),
          available: resp.available, unavailable: resp.unavailable
        });
        registeredKeys[String(r[4]) + '|' + startFmt + '|' + endFmt] = true;
      } catch(e) { Logger.log('getActiveRecruitmentsForDate_ row error: ' + e.message); }
    });
  }

  // 2. シフトシートの募集中ステータスで未登録のものを自動補完
  var shiftsSheet = ss.getSheetByName(SHEET_SHIFTS);
  if (shiftsSheet && shiftsSheet.getLastRow() > 1) {
    var sData = shiftsSheet.getDataRange().getValues();
    for (var i = 1; i < sData.length; i++) {
      var rawDate = sData[i][0];
      if (!rawDate) continue;
      var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d.getTime())) continue;
      try { if (formatDateToISO_(d) !== dateISO) continue; } catch(e) { continue; }
      if (String(sData[i][9] || '').trim() !== '募集中') continue;

      var staffName = String(sData[i][2] || '').trim();
      var start = formatCellTime_(sData[i][3]);
      var end   = formatCellTime_(sData[i][4]);
      if (!staffName || !start || !end) continue;

      var key = staffName + '|' + start + '|' + end;
      if (registeredKeys[key]) continue;

      // シフト募集シートに自動登録
      var newId = saveRecruitment_({ date: dateISO, start: start, end: end, staffName: staffName, reason: '' });
      var resp2 = getRecruitmentResponses_(newId);
      results.push({
        id: newId, date: dateISO,
        start: start, end: end,
        staffName: staffName, reason: '',
        available: resp2.available, unavailable: resp2.unavailable
      });
      registeredKeys[key] = true;
      Logger.log('getActiveRecruitmentsForDate_: 旧募集を自動登録 ' + newId + ' (' + staffName + ')');
    }
  }

  return results;
}

/**
 * 募集時間帯の残オペ数を1時間スロットで計算する
 * excludeStaffName と status=募集中 のスタッフを除外
 * @returns {{ start: string, end: string, count: number }[]}
 */
function calcOpeCountPerSlot_(dateISO, excludeStaffName, recruitStart, recruitEnd) {
  if (!recruitStart || !recruitEnd) return [];

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var activeStaff = [];
  for (var i = 1; i < data.length; i++) {
    var rawDate = data[i][0];
    if (!rawDate) continue;
    var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (isNaN(d.getTime())) continue;
    try { if (formatDateToISO_(d) !== dateISO) continue; } catch(e) { continue; }
    var name = String(data[i][2] || '').trim();
    var status = String(data[i][9] || '').trim();
    if (name === excludeStaffName || status === '募集中') continue;
    var s = formatCellTime_(data[i][3]);
    var e2 = formatCellTime_(data[i][4]);
    if (s && e2) activeStaff.push({ start: s, end: e2 });
  }

  var slots = [];
  try {
    var recStartMs = stringToDate_(recruitStart).getTime();
    var recEndMs   = stringToDate_(recruitEnd).getTime();

    // Collect all shift boundaries within the recruitment window
    var boundarySet = {};
    boundarySet[recStartMs] = true;
    boundarySet[recEndMs]   = true;
    activeStaff.forEach(function(sh) {
      var sMs = stringToDate_(sh.start).getTime();
      var eMs = stringToDate_(sh.end).getTime();
      if (sMs > recStartMs && sMs < recEndMs) boundarySet[sMs] = true;
      if (eMs > recStartMs && eMs < recEndMs) boundarySet[eMs] = true;
    });

    var boundaries = Object.keys(boundarySet).map(Number).sort(function(a, b) { return a - b; });

    // Calculate ope count for each sub-slot
    var rawSlots = [];
    for (var j = 0; j < boundaries.length - 1; j++) {
      var slotStartMs = boundaries[j];
      var count = 0;
      activeStaff.forEach(function(sh) {
        var ss2 = stringToDate_(sh.start).getTime();
        var se2 = stringToDate_(sh.end).getTime();
        if (ss2 <= slotStartMs && slotStartMs < se2) count++;
      });
      rawSlots.push({ start: formatTime_(new Date(slotStartMs)), end: formatTime_(new Date(boundaries[j + 1])), count: count });
    }

    // Merge consecutive slots with the same count
    rawSlots.forEach(function(sl) {
      if (slots.length > 0 && slots[slots.length - 1].count === sl.count) {
        slots[slots.length - 1].end = sl.end;
      } else {
        slots.push({ start: sl.start, end: sl.end, count: sl.count });
      }
    });
  } catch(e) { Logger.log('calcOpeCountPerSlot_ error: ' + e.message); }
  return slots;
}

/**
 * 全アクティブスタッフへシフト募集DMをボタン付きで送信する
 * 本人（absentStaff）には送らない
 */
function sendRecruitmentDMs_(token, recruitId, date, timeLabel, reason, absentStaff, slots) {
  var mappings = loadStaffMappingFromSheets_();
  var sendMap = mappings ? mappings.send : {};

  var dateLabel = formatDateLabelFromISO_(date);

  var slotsText = '';
  slots.forEach(function(s) {
    slotsText += '\n  ' + s.start + '〜' + s.end + ': ' + s.count + 'オペ' + (s.count === 0 ? '⚠️' : '');
  });

  var contentText = '📢 シフト交代の募集\n\n📅 ' + dateLabel + '\n⏰ ' + timeLabel + '\n👤 ' + absentStaff + ' → (募集中)\n📝 ' + (reason || '記載なし');
  if (slotsText) contentText += '\n\n【抜けた後のオペ数】' + slotsText;
  contentText += '\n\n入れますか？';

  var isTestMode = (SHIFT_CHANGE_CHANNEL_ID === SHIFT_CHANGE_CHANNEL_ID_TEST);

  // テストモードはチャンネルに1回だけボタン付きで送信（全員分まとめて）
  if (isTestMode) {
    var testUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID_TEST + '/messages';
    var nameList = Object.keys(sendMap).filter(function(n) { return n !== absentStaff; }).join('、');
    try {
      UrlFetchApp.fetch(testUrl, {
        method: 'post', contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify({
          content: {
            type: 'button_template',
            contentText: '【テスト】送信対象: ' + nameList + '\n\n' + contentText,
            actions: [
              { type: 'uri',     label: '✅ 入れる',   uri: 'https://shiftcalender.originalcafe423.workers.dev' },
              { type: 'message', label: '❌ 入れない', text: '【入れない】' + recruitId }
            ]
          }
        }),
        muteHttpExceptions: true
      });
      Logger.log('テスト用ボタンメッセージ送信完了: recruitId=' + recruitId);
    } catch(e) { Logger.log('テストボタン送信エラー: ' + e.message); }
    return;
  }

  Object.keys(sendMap).forEach(function(name) {
    if (name === absentStaff) return;
    var userId = sendMap[name];
    if (!userId) return;

    {
      var dmUrl = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + userId + '/messages';
      try {
        var res = UrlFetchApp.fetch(dmUrl, {
          method: 'post', contentType: 'application/json',
          headers: { 'Authorization': 'Bearer ' + token },
          payload: JSON.stringify({
            content: {
              type: 'button_template',
              contentText: contentText,
              actions: [
                { type: 'uri',     label: '✅ 入れる',   uri: 'https://shiftcalender.originalcafe423.workers.dev' },
                { type: 'message', label: '❌ 入れない', text: '【入れない】' + recruitId }
              ]
            }
          }),
          muteHttpExceptions: true
        });
        Logger.log('募集DM送信(' + name + '): HTTP ' + res.getResponseCode());
      } catch(e) { Logger.log('募集DM送信エラー(' + name + '): ' + e.message); }
    }
  });
}

/**
 * 自分の個人DM にボタンを送信するテスト
 * MY_NAME を自分の名前に変えてから GASエディタで実行する
 */
function testRecruitmentDMButton() {
  var MY_NAME = '杉本尚哉'; // ← 自分のスタッフ名に変更して実行

  var token = getLineWorksAccessToken();
  if (!token) { Logger.log('❌ 認証失敗'); return; }

  var mappings = loadStaffMappingFromSheets_();
  var sendMap = mappings ? mappings.send : {};
  var userId = sendMap[MY_NAME];

  if (!userId) {
    Logger.log('❌ スタッフが見つかりません: ' + MY_NAME);
    Logger.log('登録済みスタッフ: ' + Object.keys(sendMap).join(', '));
    return;
  }

  var recruitId = 'R_TEST_' + Date.now();
  var dmUrl = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + userId + '/messages';

  var res = UrlFetchApp.fetch(dmUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({
      content: {
        type: 'button_template',
        contentText: '【テスト】シフト募集ボタン確認\n\n📅 5/10（土）\n⏰ 13:00〜15:00\n👤 テストスタッフ → (募集中)\n📝 動作確認用\n\n【抜けた後のオペ数】\n  13:00〜14:00: 1オペ\n  14:00〜15:00: 0オペ⚠️\n\n入れますか？',
        actions: [
          { type: 'uri',     label: '入れる',   uri: 'https://shiftcalender.originalcafe423.workers.dev' },
          { type: 'message', label: '入れない', text: '【入れない】' + recruitId }
        ]
      }
    }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  Logger.log('DM送信結果: HTTP ' + code);
  Logger.log(res.getContentText().substring(0, 300));
  if (code === 200 || code === 201) {
    Logger.log('✅ 成功 → ' + MY_NAME + ' のDMを確認してください');
    Logger.log('募集ID: ' + recruitId + '（ボタンを押したときにこのIDが返ってきます）');
  } else {
    Logger.log('❌ 失敗');
  }
}

/**
 * 指定募集IDの未回答スタッフへリマインドDMを再送する
 * テストモード時はテストチャンネルにテキスト送信
 */
function remindShiftRecruitment_(recruitId) {
  initChannelId_();
  var token = getLineWorksAccessToken();
  if (!token) return { error: 'token_error' };

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_RECRUITMENT);
  if (!sheet || sheet.getLastRow() <= 1) return { ok: false, error: 'no_recruitment' };

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  var targetRow = null;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === recruitId) { targetRow = data[i]; break; }
  }
  if (!targetRow) return { ok: false, error: 'not_found' };
  if (String(targetRow[6]).trim() !== '募集中') return { ok: false, error: 'not_active' };

  var rowDate = targetRow[1] instanceof Date
    ? Utilities.formatDate(targetRow[1], TIMEZONE, 'yyyy-MM-dd')
    : String(targetRow[1]).substring(0, 10);
  var absentStaff = String(targetRow[4]);
  var start = String(targetRow[2]);
  var end   = String(targetRow[3]);
  var reason = String(targetRow[5]);
  var timeLabel = start + '〜' + end;

  var responses = getRecruitmentResponses_(recruitId);
  var respondedNames = responses.available.concat(responses.unavailable);

  var dateLabel = formatDateLabelFromISO_(rowDate);

  var slots = calcOpeCountPerSlot_(rowDate, absentStaff, start, end);
  var slotsText = '';
  slots.forEach(function(s) {
    slotsText += '\n  ' + s.start + '〜' + s.end + ': ' + s.count + 'オペ' + (s.count === 0 ? '⚠️' : '');
  });

  var contentText = '🔔 【リマインド】シフト交代の募集\n\n📅 ' + dateLabel + '\n⏰ ' + timeLabel + '\n👤 ' + absentStaff + ' → (募集中)\n📝 ' + (reason || '記載なし');
  if (slotsText) contentText += '\n\n【抜けた後のオペ数】' + slotsText;
  contentText += '\n\n入れますか？';

  var mappings = loadStaffMappingFromSheets_();
  var sendMap = mappings ? mappings.send : {};
  var isTestMode = (SHIFT_CHANGE_CHANNEL_ID === SHIFT_CHANGE_CHANNEL_ID_TEST);
  var sent = 0;

  Object.keys(sendMap).forEach(function(name) {
    if (name === absentStaff) return;
    if (respondedNames.indexOf(name) !== -1) return;
    var userId = sendMap[name];
    if (!userId) return;

    if (isTestMode) {
      var testUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID_TEST + '/messages';
      try {
        UrlFetchApp.fetch(testUrl, {
          method: 'post', contentType: 'application/json',
          headers: { 'Authorization': 'Bearer ' + token },
          payload: JSON.stringify({ content: { type: 'text', text: '【テスト・リマインド】' + name + 'さん宛DM:\n' + contentText } }),
          muteHttpExceptions: true
        });
        sent++;
      } catch(e) { Logger.log('テストリマインドDM送信エラー(' + name + '): ' + e.message); }
    } else {
      var dmUrl = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + userId + '/messages';
      try {
        var res = UrlFetchApp.fetch(dmUrl, {
          method: 'post', contentType: 'application/json',
          headers: { 'Authorization': 'Bearer ' + token },
          payload: JSON.stringify({
            content: {
              type: 'button_template',
              contentText: contentText,
              actions: [
                { type: 'uri',     label: '✅ 入れる',   uri: 'https://shiftcalender.originalcafe423.workers.dev' },
                { type: 'message', label: '❌ 入れない', text: '【入れない】' + recruitId }
              ]
            }
          }),
          muteHttpExceptions: true
        });
        Logger.log('リマインドDM送信(' + name + '): HTTP ' + res.getResponseCode());
        sent++;
      } catch(e) { Logger.log('リマインドDM送信エラー(' + name + '): ' + e.message); }
    }
  });

  Logger.log('リマインド完了: recruitId=' + recruitId + ' sent=' + sent);
  return { ok: true, sent: sent };
}

/**
 * シフト交代の募集を引き受け（承認）し、シフトを書き換えて通知する
 */
function approveShiftRecruitment_(params) {
  initChannelId_();
  const token = getLineWorksAccessToken();
  if (!token) return { error: 'token_error' };

  // originalStart/originalEnd を取得（新フィールド優先、フォールバックで originalTime からパース）
  let origStart = params.originalStart || null;
  let origEnd   = params.originalEnd   || null;
  if (!origStart && params.originalTime) {
    const parts = params.originalTime.split(/[〜\-]/);
    if (parts.length >= 1 && parts[0].trim()) origStart = parts[0].trim();
    if (parts.length >= 2 && parts[1].trim()) origEnd   = parts[1].trim();
  }
  const newStart = params.newStart || origStart;
  const newEnd   = params.newEnd   || origEnd;

  // シフトDBのスタッフ名書き換え＆ステータスクリア（originalStart で行を特定）
  const updated = updateShiftStaff(params.date, params.originalStaff, params.agentStaff, newStart, newEnd, origStart);

  // シフト募集シートのステータスを「成立」に更新
  if (params.recruitId) {
    try {
      var recSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_RECRUITMENT);
      if (recSheet && recSheet.getLastRow() > 1) {
        var recData = recSheet.getRange(2, 1, recSheet.getLastRow() - 1, 7).getValues();
        for (var ri = 0; ri < recData.length; ri++) {
          if (String(recData[ri][0]) === String(params.recruitId)) {
            recSheet.getRange(ri + 2, 7).setValue('成立');
            Logger.log('募集ステータス更新: ' + params.recruitId + ' → 成立');
            break;
          }
        }
      }
    } catch(e) { Logger.log('募集ステータス更新エラー: ' + e.message); }
  } else {
    // recruitId がない場合は staffName + start + end で検索
    try {
      var recSheet2 = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_RECRUITMENT);
      if (recSheet2 && recSheet2.getLastRow() > 1) {
        var recData2 = recSheet2.getRange(2, 1, recSheet2.getLastRow() - 1, 7).getValues();
        for (var ri2 = 0; ri2 < recData2.length; ri2++) {
          if (String(recData2[ri2][4]) === String(params.originalStaff) &&
              String(recData2[ri2][6]).trim() === '募集中') {
            recSheet2.getRange(ri2 + 2, 7).setValue('成立');
            Logger.log('募集ステータス更新(名前検索): ' + params.originalStaff + ' → 成立');
            break;
          }
        }
      }
    } catch(e) { Logger.log('募集ステータス更新エラー: ' + e.message); }
  }

  const timeLabel = newStart && newEnd ? newStart + '〜' + newEnd : (params.originalTime || '');
  let text = '✅ 【シフト交代 承認完了】\n\n';
  text += 'シフトの交代が成立しました。\n\n';
  text += '📅 ' + formatDateLabelFromISO_(params.date) + '\n';
  text += '⏰ ' + timeLabel + '\n';
  text += '👤 ' + params.originalStaff + ' → ' + params.agentStaff + '\n\n';
  text += 'ご協力ありがとうございます🙏 ジョブカンへの反映をお願いします。';

  // 幹部グループへ通知
  const kanbuUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + KANBU_CHANNEL_ID + '/messages';
  sendLineWorksText_(token, kanbuUrl, text, SHIFT_CHANGE_BOT_ID);

  // 変更（交代）グループへ通知
  const changeUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID + '/messages';
  const groupSent = sendLineWorksText_(token, changeUrl, text, SHIFT_CHANGE_BOT_ID);

  // 交代される人・する人それぞれにDM通知
  const mappings = loadStaffMappingFromSheets_();
  const sendMap = mappings ? mappings.send : {};
  const isTestMode = (SHIFT_CHANGE_CHANNEL_ID === SHIFT_CHANGE_CHANNEL_ID_TEST);

  const dmTargets = [
    {
      name: params.originalStaff,
      text: '🔄 【シフト交代 完了のお知らせ】\n\n' + params.originalStaff + ' さんのシフトが交代されました。\n\n📅 ' + formatDateLabelFromISO_(params.date) + '\n⏰ ' + timeLabel + '\n👤 ' + params.originalStaff + ' → ' + params.agentStaff + '\n\nジョブカンへの反映をご確認ください🙏'
    },
    {
      name: params.agentStaff,
      text: '🔄 【シフト交代 完了のお知らせ】\n\n' + params.agentStaff + ' さんがシフトを引き受けました。\n\n📅 ' + formatDateLabelFromISO_(params.date) + '\n⏰ ' + timeLabel + '\n👤 ' + params.originalStaff + ' → ' + params.agentStaff + '\n\nジョブカンへの反映をご確認ください🙏'
    }
  ];

  dmTargets.forEach(function(target) {
    const sendId = sendMap[target.name];
    if (!sendId) { Logger.log('sendId未登録: ' + target.name); return; }
    if (isTestMode) {
      const url = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID_TEST + '/messages';
      sendLineWorksText_(token, url, '【テスト】' + target.name + 'さん宛:\n' + target.text, SHIFT_CHANGE_BOT_ID);
    } else {
      const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + sendId + '/messages';
      sendLineWorksText_(token, url, target.text, LINEWORKS_BOT_ID);
    }
    Logger.log('交代DM送信: ' + target.name);
  });

  return { ok: true, updated: updated, groupSent: groupSent };
}

/**
 * シフト不足時間帯への補充を承認者へDM通知する
 * @param {{ date: string, staffName: string, start: string, end: string }} params
 */
function notifyShiftFill_(params) {
  try {
    initChannelId_();
    const token = getLineWorksAccessToken();
    if (!token) return { ok: false, error: 'token_error' };

    const dateLabel = formatDateLabelFromISO_(params.date);

    // 承認者向けテキスト
    let approverText = '✅ 【シフト補充のお知らせ】\n\n';
    approverText += '📅 ' + dateLabel + '\n';
    approverText += '⏰ ' + params.start + '〜' + params.end + '\n';
    approverText += '👤 ' + params.staffName + '\n';
    approverText += '\nご確認よろしくお願いします🙏';

    // 追加されたスタッフ本人向けテキスト
    let staffText = '📋 【シフト追加のお知らせ】\n\n';
    staffText += params.staffName + ' さん、以下のシフトが追加されました。\n\n';
    staffText += '📅 ' + dateLabel + '\n';
    staffText += '⏰ ' + params.start + '〜' + params.end + '\n\n';
    staffText += 'ジョブカンへの反映をご確認ください🙏';

    const isTestMode = (SHIFT_CHANGE_CHANNEL_ID === SHIFT_CHANGE_CHANNEL_ID_TEST);
    const mappings = loadStaffMappingFromSheets_();
    const sendMap = mappings ? mappings.send : {};

    // 承認者へDM
    const approvers = getShiftAgentStaff();
    approvers.forEach(function(approver) {
      if (!approver.sendId) return;
      if (isTestMode) {
        const url = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID_TEST + '/messages';
        sendLineWorksText_(token, url, '【テスト】' + approver.name + 'さん宛:\n' + approverText, SHIFT_CHANGE_BOT_ID);
      } else {
        const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + approver.sendId + '/messages';
        sendLineWorksText_(token, url, approverText, LINEWORKS_BOT_ID);
      }
    });

    // 追加されたスタッフ本人へDM
    const staffSendId = sendMap[params.staffName];
    if (staffSendId) {
      if (isTestMode) {
        const url = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID_TEST + '/messages';
        sendLineWorksText_(token, url, '【テスト】' + params.staffName + 'さん宛:\n' + staffText, SHIFT_CHANGE_BOT_ID);
      } else {
        const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + staffSendId + '/messages';
        sendLineWorksText_(token, url, staffText, LINEWORKS_BOT_ID);
      }
      Logger.log('追加スタッフへDM送信: ' + params.staffName);
    } else {
      Logger.log('追加スタッフのsendId未登録: ' + params.staffName);
    }

    Logger.log('シフト補充通知完了: ' + params.staffName + ' ' + params.start + '〜' + params.end);
    return { ok: true };
  } catch (e) {
    Logger.log('notifyShiftFill_ エラー: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * "YYYY-MM-DD" 形式の日付文字列を "M月D日（曜）" の日本語表記に変換する
 * タイムゾーン依存の new Date().getDate() を使わず文字列パースで安全に変換する
 */
function formatDateLabelFromISO_(dateISO) {
  var parts = String(dateISO).split('-');
  if (parts.length < 3) return String(dateISO);
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  var dow = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
  return m + '月' + d + '日（' + dow + '）';
}

/**
 * シフト募集 DM ボタン機能のテスト送信
 * GASエディタからこの関数を実行する
 * ・テストグループに募集通知を送信
 * ・全スタッフの個人DM に [✅入れる][❌入れない] ボタンを送信
 * ※テストが終わったら「シフト募集」シートの該当行を削除してください
 */
function testRecruitmentWithDMs() {
  // テストチャンネルに強制切替
  SHIFT_CHANGE_CHANNEL_ID = SHIFT_CHANGE_CHANNEL_ID_TEST;

  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');

  var result = requestShiftRecruitment_({
    date:          today,
    originalStaff: 'テストスタッフ',
    recruitStart:  '13:00',
    recruitEnd:    '15:00',
    reason:        '【テスト送信】動作確認用のダミー募集です'
  });

  Logger.log('テスト結果: ' + JSON.stringify(result));
  Logger.log('募集ID: ' + result.recruitmentId);
  Logger.log('グループ送信: ' + result.groupSent);
}

/**
 * 【診断用】シフト募集通知の送信テスト
 * GASエディタから直接実行して Logger でエラー原因を確認する
 */
function debugRecruitmentNotification() {
  initChannelId_();

  Logger.log('=== シフト募集通知 診断開始 ===');
  Logger.log('SHIFT_CHANGE_BOT_ID: ' + SHIFT_CHANGE_BOT_ID);
  Logger.log('KANBU_CHANNEL_ID: ' + KANBU_CHANNEL_ID);

  // Step 1: トークン取得
  const token = getLineWorksAccessToken();
  if (!token) {
    Logger.log('❌ アクセストークン取得失敗 → CLIENT_ID / SECRET / SERVICE_ACCOUNT / 秘密鍵 を確認してください');
    return;
  }
  Logger.log('✅ アクセストークン取得成功');

  // Step 2: Bot情報確認（botが存在しトークンが有効か）
  try {
    const botInfoUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID;
    const botRes = UrlFetchApp.fetch(botInfoUrl, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    Logger.log('Bot情報 HTTP: ' + botRes.getResponseCode() + ' → ' + botRes.getContentText().substring(0, 200));
  } catch (e) {
    Logger.log('Bot情報取得エラー: ' + e.message);
  }

  // Step 3: チャンネルへのテストメッセージ（mentionedList あり）
  const kanbuUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + KANBU_CHANNEL_ID + '/messages';
  Logger.log('送信先URL: ' + kanbuUrl);

  try {
    const res1 = UrlFetchApp.fetch(kanbuUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({
        content: { type: 'text', text: '@All シフト募集通知テスト送信' },
        mentionedList: [{ type: 'all', offset: 0, length: 4 }]
      }),
      muteHttpExceptions: true
    });
    const code1 = res1.getResponseCode();
    const body1 = res1.getContentText();
    Logger.log('mentionedList あり → HTTP ' + code1 + ': ' + body1.substring(0, 300));

    if (code1 !== 200 && code1 !== 201) {
      // Step 4: mentionedList なしで再試行
      const res2 = UrlFetchApp.fetch(kanbuUrl, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify({
          content: { type: 'text', text: '【診断テスト】シフト募集通知テスト送信（@allなし）' }
        }),
        muteHttpExceptions: true
      });
      const code2 = res2.getResponseCode();
      Logger.log('mentionedList なし → HTTP ' + code2 + ': ' + res2.getContentText().substring(0, 300));

      if (code2 === 403) {
        Logger.log('❌ 403 Forbidden → Bot (ID:' + SHIFT_CHANGE_BOT_ID + ') がチャンネル (ID:' + KANBU_CHANNEL_ID + ') に参加していない可能性が高い');
        Logger.log('→ LINE WORKS 管理画面でチャンネルにBotを追加してください');
      } else if (code2 === 401) {
        Logger.log('❌ 401 Unauthorized → トークンまたはBot IDが正しくない');
      } else if (code2 === 404) {
        Logger.log('❌ 404 Not Found → チャンネルIDまたはBot IDが存在しない');
      }
    } else {
      Logger.log('✅ 送信成功（mentionedList あり）');
    }
  } catch (e) {
    Logger.log('送信エラー: ' + e.message);
  }

  Logger.log('=== 診断終了 ===');
}

/**
 * 【診断用】webhookの「入れない」応答フローをシミュレーション
 * GASエディタから実行して各ステップを確認する
 */
function debugRecruitmentResponse() {
  Logger.log('=== 募集応答 診断開始 ===');

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Step1: シフト募集シートに有効な募集があるか確認
  var recruitSheet = ss.getSheetByName(SHEET_RECRUITMENT);
  if (!recruitSheet || recruitSheet.getLastRow() <= 1) {
    Logger.log('❌ シフト募集シートが空 → まずアプリから募集をかけてください');
    return;
  }
  var recruitData = recruitSheet.getDataRange().getValues();
  var latestRecruit = null;
  for (var i = recruitData.length - 1; i >= 1; i--) {
    if (String(recruitData[i][6]).trim() === '募集中') {
      latestRecruit = { id: String(recruitData[i][0]), staffName: String(recruitData[i][4]) };
      break;
    }
  }
  if (!latestRecruit) {
    Logger.log('❌ 募集中のエントリなし → シフトに募集をかけてください');
    return;
  }
  Logger.log('✅ 募集中エントリ発見: ID=' + latestRecruit.id + ' 対象=' + latestRecruit.staffName);

  // Step2: スタッフマッピング確認
  var mappings = loadStaffMappingFromSheets_();
  var recvMap = mappings ? mappings.recv : {};
  Logger.log('受信IDマッピング件数: ' + Object.keys(recvMap).length);
  Logger.log('登録済みID一覧: ' + JSON.stringify(Object.keys(recvMap)));

  // Step3: recordRecruitmentResponse_ を直接実行（テストユーザー名で）
  var testName = latestRecruit.staffName + '_テスト';
  Logger.log('テスト応答を記録: 名前=' + testName + ' 応答=入れない');
  try {
    recordRecruitmentResponse_(latestRecruit.id, testName, '入れない');
    Logger.log('✅ recordRecruitmentResponse_ 実行成功');
  } catch (e) {
    Logger.log('❌ recordRecruitmentResponse_ エラー: ' + e.message);
    return;
  }

  // Step4: シフト募集応答シートに保存されているか確認
  var respSheet = ss.getSheetByName(SHEET_RECRUITMENT_RESPONSE);
  if (!respSheet) {
    Logger.log('❌ シフト募集応答シートが存在しない');
    return;
  }
  var lastRow = respSheet.getLastRow();
  Logger.log('✅ シフト募集応答シート行数: ' + lastRow);
  if (lastRow > 1) {
    var lastData = respSheet.getRange(lastRow, 1, 1, 4).getValues()[0];
    Logger.log('最新行: ' + JSON.stringify(lastData));
  }

  // Step5: getActiveRecruitmentsForDate_ で取得できるか確認
  var dateISO = String(recruitData[1][1]);
  if (recruitData[1][1] instanceof Date) {
    dateISO = Utilities.formatDate(recruitData[1][1], TIMEZONE, 'yyyy-MM-dd');
  }
  Logger.log('募集日: ' + dateISO);
  var active = getActiveRecruitmentsForDate_(dateISO);
  Logger.log('getActiveRecruitmentsForDate_ 結果: ' + JSON.stringify(active));

  Logger.log('=== 診断終了 ===');
  Logger.log('→ カレンダーアプリで該当日を開いて15秒待つと反映されます');
}

/**
 * 【診断用】LINE WORKS DMの「入れない」ボタン押下をシミュレーション
 * GASエディタから実行してログを確認する
 *
 * Step1: 最新の募集IDを取得
 * Step2: 登録済みrecvIDでwebhookペイロードを組み立て
 * Step3: handleWebhook を直接呼び出し
 * Step4: シフト募集応答シートへの保存を確認
 */
function debugWebhookSimulation() {
  Logger.log('=== Webhook シミュレーション診断 開始 ===');
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Step1: 最新の募集中エントリを取得
  var recruitSheet = ss.getSheetByName(SHEET_RECRUITMENT);
  if (!recruitSheet || recruitSheet.getLastRow() <= 1) {
    Logger.log('❌ シフト募集シートが空'); return;
  }
  var rData = recruitSheet.getDataRange().getValues();
  var latest = null;
  for (var i = rData.length - 1; i >= 1; i--) {
    if (String(rData[i][6]).trim() === '募集中') {
      latest = { id: String(rData[i][0]), staffName: String(rData[i][4]) };
      break;
    }
  }
  if (!latest) { Logger.log('❌ 募集中エントリなし'); return; }
  Logger.log('✅ 募集中: ID=' + latest.id + ' / 対象=' + latest.staffName);

  // Step2: 受信マッピングから最初のrecvIDを取得
  var mappings = loadStaffMappingFromSheets_();
  if (!mappings || Object.keys(mappings.recv).length === 0) {
    Logger.log('❌ 受信マッピングが空'); return;
  }
  var recvId = Object.keys(mappings.recv)[0];
  var recvName = mappings.recv[recvId];
  Logger.log('シミュレーション送信者: ' + recvName + ' (ID: ' + recvId + ')');

  // Step3: LINE WORKSのwebhookペイロードを模擬
  var fakePayload = JSON.stringify({
    type: 'message',
    source: { userId: recvId, domainId: '0' },
    content: { type: 'text', text: '【入れない】' + latest.id }
  });
  var fakeEvent = { postData: { contents: fakePayload } };

  Logger.log('送信ペイロード: ' + fakePayload);

  // Step4: handleWebhook を直接呼び出し
  try {
    handleWebhook(fakeEvent);
    Logger.log('✅ handleWebhook 実行完了');
  } catch(e) {
    Logger.log('❌ handleWebhook エラー: ' + e.message);
    return;
  }

  // Step5: 結果確認
  var respSheet = ss.getSheetByName(SHEET_RECRUITMENT_RESPONSE);
  if (!respSheet) { Logger.log('❌ シフト募集応答シートが存在しない'); return; }
  var lastRow = respSheet.getLastRow();
  if (lastRow > 1) {
    var last = respSheet.getRange(lastRow, 1, 1, 4).getValues()[0];
    Logger.log('最新応答行: ID=' + last[0] + ' / 名前=' + last[1] + ' / 応答=' + last[2]);
    if (String(last[0]) === latest.id && String(last[1]) === recvName) {
      Logger.log('✅ 正常に保存されました！ → カレンダーに15秒以内に反映されます');
    } else {
      Logger.log('⚠️ 保存されたが想定外の値: expected ID=' + latest.id + ' name=' + recvName);
    }
  } else {
    Logger.log('❌ シフト募集応答シートにデータなし');
  }
  Logger.log('=== 診断終了 ===');
}

