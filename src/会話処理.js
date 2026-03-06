// ============================================================
// 会話処理.gs - シフト変更会話フロー（キーワード起動型・グループ送信）
// ============================================================

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10分

// --- 返信先コンテキストに応じたメッセージ送信 ---
// replyContext = { type: 'channel', channelId: '...' }  → チャンネル（グループ）に送信
// replyContext = { type: 'personal', userId: '...' }    → 個人トークルームに送信

function sendReplyMsg_(context, text) {
  const token = getLineWorksAccessToken();
  if (!token) return;

  var url;
  if (context && context.type === 'channel') {
    url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + context.channelId + '/messages';
  } else if (context && context.type === 'personal') {
    url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + context.userId + '/messages';
  } else {
    // フォールバック: 設定済みグループチャンネル
    url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
  }

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'text', text: text } }),
    muteHttpExceptions: true
  });
}

function sendReplyButtonMsg_(context, contentText, actions) {
  const token = getLineWorksAccessToken();
  if (!token) return;

  var url;
  if (context && context.type === 'channel') {
    url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + context.channelId + '/messages';
  } else if (context && context.type === 'personal') {
    url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + context.userId + '/messages';
  } else {
    url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
  }

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'button_template', contentText: contentText, actions: actions } }),
    muteHttpExceptions: true
  });
}

// --- セッション管理 ---

function getSession_(userId) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('CHAT_' + userId);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() - session.timestamp > SESSION_TIMEOUT_MS) {
      clearSession_(userId);
      return null;
    }
    return session;
  } catch (e) {
    return null;
  }
}

function setSession_(userId, data) {
  try {
    data.timestamp = Date.now();
    PropertiesService.getScriptProperties().setProperty('CHAT_' + userId, JSON.stringify(data));
  } catch (e) {
    Logger.log('セッション保存エラー: ' + e.message);
  }
}

function clearSession_(userId) {
  try {
    PropertiesService.getScriptProperties().deleteProperty('CHAT_' + userId);
  } catch (e) {}
}

// --- メイン会話ルーター ---

function handleConversation_(senderId, senderName, messageText, replyContext) {
  const text = messageText ? toHalfWidth_(messageText.trim()) : '';
  let session = getSession_(senderId);

  if (!session) {
    // 新規セッション: 返信先コンテキストを保存
    session = { step: 'awaiting_type', replyContext: replyContext };
    setSession_(senderId, session);
    sendReplyButtonMsg_(
      replyContext,
      '変更の種類を選んでください。',
      [
        { type: 'message', label: '自分のシフト時間を変更', text: '1' },
        { type: 'message', label: '誰かと交代', text: '2' },
        { type: 'message', label: 'まちがえました（キャンセル）', text: '3' }
      ]
    );
    return;
  }

  switch (session.step) {
    case 'awaiting_type':    handleTypeSelection_(senderId, senderName, text, session); break;
    case 'awaiting_partner': handlePartnerInput_(senderId, senderName, text, session); break;
    case 'awaiting_date':    handleDateInput_(senderId, senderName, text, session);    break;
    case 'awaiting_time':    handleTimeInput_(senderId, senderName, text, session);    break;
    case 'awaiting_confirm': handleConfirmInput_(senderId, senderName, text, session); break;
    default: clearSession_(senderId);
  }
}

// --- ステップ処理 ---

function handleTypeSelection_(senderId, senderName, text, session) {
  const ctx = session.replyContext;
  if (text === '1') {
    session.step = 'awaiting_date';
    session.type = 'time_change';
    setSession_(senderId, session);
    sendReplyMsg_(ctx, '何日のシフトを変更しますか？\n例）3/1');
  } else if (text === '2') {
    session.step = 'awaiting_partner';
    session.type = 'swap';
    setSession_(senderId, session);
    sendReplyMsg_(ctx, '誰と交代しますか？\n相手の名前を入力してください。\n例）田中勇平');
  } else if (text === '3' || text.includes('まちがえ') || text.includes('キャンセル')) {
    clearSession_(senderId);
    sendReplyMsg_(ctx, 'キャンセルしました。');
  } else {
    sendReplyMsg_(ctx,
      '1、2、または3を入力してください。\n\n' +
      '1. 自分のシフト時間を変更\n' +
      '2. 誰かと交代\n' +
      '3. まちがえました（キャンセル）'
    );
  }
}

function handlePartnerInput_(senderId, senderName, text, session) {
  const ctx = session.replyContext;
  const mappings = loadStaffMappingFromSheets_();
  const sendMap = mappings ? mappings.send : {};
  const normalizedInput = normalizeName_(text);
  let partnerName = null;

  for (const name in sendMap) {
    if (normalizeName_(name) === normalizedInput) {
      partnerName = name;
      break;
    }
  }

  if (!partnerName) {
    sendReplyMsg_(ctx, '「' + text + '」さんがスタッフ名簿に見つかりません。\nもう一度名前を入力してください。');
    return;
  }
  if (partnerName === senderName) {
    sendReplyMsg_(ctx, '自分自身とは交代できません。\n別のスタッフ名を入力してください。');
    return;
  }

  session.partner = partnerName;
  session.step = 'awaiting_date';
  setSession_(senderId, session);
  sendReplyMsg_(ctx, partnerName + ' さんと交代ですね。\n何日の交代ですか？\n例）3/1');
}

function handleDateInput_(senderId, senderName, text, session) {
  const ctx = session.replyContext;
  const dateObj = parseConvDate_(text);
  if (!dateObj) {
    sendReplyMsg_(ctx, '日付の形式が認識できませんでした。\n例）3/1 または 3月1日');
    return;
  }

  const deadline = new Date(dateObj);
  deadline.setDate(deadline.getDate() - 1);
  deadline.setHours(11, 30, 0, 0);
  if (new Date() > deadline) {
    clearSession_(senderId);
    sendReplyMsg_(ctx, formatDateJP_(dateObj) + ' の変更期限（前日11:30）を過ぎています。\n店長に直接ご連絡ください。');
    return;
  }

  session.date = Utilities.formatDate(dateObj, TIMEZONE, 'yyyy/MM/dd');
  session.dateDisplay = formatDateJP_(dateObj);

  if (session.type === 'time_change') {
    session.step = 'awaiting_time';
    setSession_(senderId, session);
    sendReplyMsg_(ctx, session.dateDisplay + ' のシフトを何時〜何時に変更しますか？\n例）15:30〜18:00');
  } else {
    session.step = 'awaiting_confirm';
    setSession_(senderId, session);
    sendReplyMsg_(ctx,
      '以下の内容で交代申請します。よろしいですか？\n\n' +
      '📅 ' + session.dateDisplay + '\n' +
      '👤 ' + senderName + ' ↔ ' + session.partner + '\n\n' +
      'はい／いいえ'
    );
  }
}

function handleTimeInput_(senderId, senderName, text, session) {
  const ctx = session.replyContext;
  const timeRange = parseTimeRange_(text);
  if (!timeRange) {
    sendReplyMsg_(ctx, '時間の形式が認識できませんでした。\n例）15:30〜18:00');
    return;
  }

  session.timeRange = timeRange;
  session.step = 'awaiting_confirm';
  setSession_(senderId, session);
  sendReplyMsg_(ctx,
    '以下の内容で変更申請します。よろしいですか？\n\n' +
    '📅 ' + session.dateDisplay + '\n' +
    '👤 ' + senderName + '\n' +
    '⏱ ' + timeRange + '\n\n' +
    'はい／いいえ'
  );
}

function handleConfirmInput_(senderId, senderName, text, session) {
  const ctx = session.replyContext;
  if (text.startsWith('はい') || text === 'yes') {
    if (session.type === 'time_change') {
      applyTimeChange_(senderId, senderName, session);
    } else {
      applySwap_(senderId, senderName, session);
    }
    clearSession_(senderId);
  } else if (text.startsWith('いいえ') || text === 'no') {
    clearSession_(senderId);
    sendReplyMsg_(ctx, 'キャンセルしました。');
  } else {
    sendReplyMsg_(ctx, '「はい」または「いいえ」で答えてください。');
  }
}

// --- シフト更新処理 ---

function applyTimeChange_(senderId, senderName, session) {
  const ctx = session.replyContext;
  const targetDate = new Date(session.date);
  const success = updateShiftInSheet(targetDate, senderName, session.timeRange);
  if (success) {
    sendReplyMsg_(ctx,
      '✅ シフトを変更しました！\n\n' +
      '📅 ' + session.dateDisplay + '\n' +
      '👤 ' + senderName + '\n' +
      '⏱ ' + session.timeRange
    );
  } else {
    sendReplyMsg_(ctx, 'シフトの更新に失敗しました。店長に連絡してください。');
  }
}

function applySwap_(senderId, senderName, session) {
  const ctx = session.replyContext;
  const targetDate = new Date(session.date);
  const shifts = getShiftsForDate(targetDate);
  const myShift = shifts.find(function(s) { return s.name === senderName; });
  const partnerShift = shifts.find(function(s) { return s.name === session.partner; });

  if (!myShift || !partnerShift) {
    const missing = !myShift ? senderName : session.partner;
    sendReplyMsg_(ctx, session.dateDisplay + ' に ' + missing + ' さんのシフトが見つかりませんでした。\n店長に直接ご連絡ください。');
    return;
  }

  const myNewTime = partnerShift.start + '〜' + partnerShift.end;
  const partnerNewTime = myShift.start + '〜' + myShift.end;

  const success1 = updateShiftInSheet(targetDate, senderName, myNewTime);
  const success2 = updateShiftInSheet(targetDate, session.partner, partnerNewTime);

  if (success1 && success2) {
    sendReplyMsg_(ctx,
      '✅ 交代が完了しました！\n\n' +
      '📅 ' + session.dateDisplay + '\n' +
      '👤 ' + senderName + '　' + myNewTime + '\n' +
      '👤 ' + session.partner + '　' + partnerNewTime
    );
  } else {
    sendReplyMsg_(ctx, 'シフトの更新に失敗しました。店長に直接ご連絡ください。');
  }
}

// --- シフト照会フロー ---

function handleInquiry_(senderId, senderName, messageText, replyContext) {
  const text = messageText ? toHalfWidth_(messageText.trim()) : '';
  let session = getSession_(senderId);

  if (!session) {
    session = { step: 'inquiry_awaiting_type', replyContext: replyContext };
    setSession_(senderId, session);
    sendReplyButtonMsg_(
      replyContext,
      '何を確認しますか？',
      [
        { type: 'message', label: '自分の今後のシフト', text: '1' },
        { type: 'message', label: '特定の日のシフト', text: '2' },
        { type: 'message', label: 'まちがえました（キャンセル）', text: '3' }
      ]
    );
    return;
  }

  const ctx = session.replyContext;

  if (session.step === 'inquiry_awaiting_type') {
    if (text === '1') {
      clearSession_(senderId);
      const result = getMyFutureShifts_(senderName);
      sendReplyMsg_(ctx, result);
    } else if (text === '2') {
      session.step = 'inquiry_awaiting_date';
      setSession_(senderId, session);
      sendReplyMsg_(ctx, '何日のシフトを確認しますか？\n例）3/1');
    } else if (text === '3' || text.includes('キャンセル')) {
      clearSession_(senderId);
      sendReplyMsg_(ctx, 'キャンセルしました。');
    } else {
      sendReplyMsg_(ctx, '1、2、または3を入力してください。');
    }
    return;
  }

  if (session.step === 'inquiry_awaiting_date') {
    const dateObj = parseConvDate_(text);
    if (!dateObj) {
      sendReplyMsg_(ctx, '日付の形式が認識できませんでした。\n例）3/1 または 3月1日');
      return;
    }
    clearSession_(senderId);
    const result = getDayShifts_(dateObj);
    sendReplyMsg_(ctx, result);
  }
}

function getMyFutureShifts_(staffName) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SHIFTS);
    if (!sheet) return 'シフトデータが見つかりませんでした。';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const data = sheet.getDataRange().getValues();
    const results = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rawDate = row[0];
      if (!rawDate) continue;
      const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d.getTime()) || d < today) continue;
      const name = String(row[2]).trim();
      if (name !== staffName) continue;

      const start = formatCellTime_(row[3]);
      const end = formatCellTime_(row[4]);
      results.push({ date: d, start: start, end: end });
    }

    if (results.length === 0) return '今後のシフトは登録されていません。';

    results.sort(function(a, b) { return a.date - b.date; });

    let msg = '📋 ' + staffName + ' さんの今後のシフト\n\n';
    results.forEach(function(r) {
      msg += Utilities.formatDate(r.date, TIMEZONE, 'M月d日(E)') + '　' + r.start + '〜' + r.end + '\n';
    });
    return msg.trim();
  } catch (e) {
    Logger.log('自分のシフト取得エラー: ' + e.message);
    return 'シフトの取得に失敗しました。（' + e.message + '）';
  }
}

function getDayShifts_(dateObj) {
  try {
    const shifts = getShiftsForDate(dateObj);
    if (shifts.length === 0) {
      return formatDateJP_(dateObj) + ' のシフトは登録されていません。';
    }

    let msg = '📋 ' + formatDateJP_(dateObj) + ' のシフト\n\n';
    shifts.forEach(function(s) {
      msg += s.start + '〜' + s.end + '　' + s.name + '\n';
    });
    return msg.trim();
  } catch (e) {
    Logger.log('日別シフト取得エラー: ' + e.message);
    return 'シフトの取得に失敗しました。（' + e.message + '）';
  }
}

// --- シフト不足照会フロー ---

function handleShortageInquiry_(senderId, senderName, messageText, replyContext) {
  const text = messageText ? toHalfWidth_(messageText.trim()) : '';
  let session = getSession_(senderId);

  if (!session || !session.step.startsWith('shortage_')) {
    session = { step: 'shortage_awaiting_type', replyContext: replyContext };
    setSession_(senderId, session);
    sendReplyButtonMsg_(
      replyContext,
      'シフト不足の確認です。',
      [
        { type: 'message', label: 'いつまで確認しますか', text: '1' },
        { type: 'message', label: 'まちがえました（キャンセル）', text: '2' }
      ]
    );
    return;
  }

  const ctx = session.replyContext;

  if (session.step === 'shortage_awaiting_type') {
    if (text === '1') {
      session.step = 'shortage_awaiting_date';
      setSession_(senderId, session);
      sendReplyMsg_(ctx, 'いつまでのシフト不足を確認しますか？\n例）3/31');
    } else if (text === '2' || text.includes('まちがえ') || text.includes('キャンセル')) {
      clearSession_(senderId);
      sendReplyMsg_(ctx, 'キャンセルしました。');
    } else {
      sendReplyMsg_(ctx,
        '1 または 2 を入力してください。\n\n' +
        '1. いつまで確認しますか\n' +
        '2. まちがえました'
      );
    }
    return;
  }

  if (session.step === 'shortage_awaiting_date') {
    const dateObj = parseConvDate_(text);
    if (!dateObj) {
      sendReplyMsg_(ctx, '日付の形式が認識できませんでした。\n例）3/31 または 3月31日');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dateObj < today) {
      sendReplyMsg_(ctx, '過去の日付は確認できません。\n今日以降の日付を入力してください。');
      return;
    }

    clearSession_(senderId);
    const endDateStr = Utilities.formatDate(dateObj, TIMEZONE, 'yyyy/MM/dd');
    const endDateDisplay = formatDateJP_(dateObj);
    const result = getShortageUntilDate_(endDateStr, endDateDisplay);
    sendReplyMsg_(ctx, result);
  }
}

function getShortageUntilDate_(endDateStr, endDateDisplay) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(0, 0, 0, 0);

    const shortageList = [];
    let checkDate = new Date(today);

    while (checkDate <= endDate) {
      const businessHours = getBusinessHours(checkDate);
      if (businessHours) {
        const slots = checkShiftShortageForDate(checkDate);
        if (slots.length > 0) {
          shortageList.push({ date: new Date(checkDate), slots: slots });
        }
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }

    if (shortageList.length === 0) {
      return '✅ ' + endDateDisplay + ' までシフト不足はありません！';
    }

    let msg = '📋 シフト不足一覧（〜' + endDateDisplay + '）\n\n';
    shortageList.forEach(function(item) {
      msg += formatDateJP_(item.date) + '\n';
      item.slots.forEach(function(slot) {
        msg += '  ⚠️ ' + slot + '\n';
      });
      msg += '\n';
    });
    msg += '計 ' + shortageList.length + ' 日に不足があります。';
    return msg.trim();
  } catch (e) {
    Logger.log('シフト不足一覧取得エラー: ' + e.message);
    return 'シフト不足の確認に失敗しました。（' + e.message + '）';
  }
}

// --- ユーティリティ ---

function toHalfWidth_(str) {
  return str.replace(/[０-９]/g, function(c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
}

function parseConvDate_(text) {
  const year = new Date().getFullYear();
  let match;

  match = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (match) return new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));

  match = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (match) return new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));

  match = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match) return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));

  return null;
}

function parseTimeRange_(text) {
  const match = text.match(/(\d{1,2}:\d{2})[〜~～\-](\d{1,2}:\d{2})/);
  return match ? match[1] + '〜' + match[2] : null;
}

function formatDateJP_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'M月d日(E)');
}
