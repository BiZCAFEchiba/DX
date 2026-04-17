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
    const d = new Date(params.date + 'T00:00:00+09:00');
    const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    const dateLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';

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
 */
function requestShiftRecruitment_(params) {
  initChannelId_();
  const token = getLineWorksAccessToken();
  if (!token) return { error: 'token_error' };

  // スプレッドシート更新: 部分募集に対応した行分割
  // originalStart = 元行の開始時刻（行特定用）
  // recruitStart/recruitEnd = 実際に募集する時間帯
  let originalStart = params.originalStart || null;
  let recruitStart  = params.recruitStart  || null;
  let recruitEnd    = params.recruitEnd    || null;

  // フォールバック: originalTime（例 "13:00〜15:00"）から recruitStart/recruitEnd を取得
  if ((!recruitStart || !recruitEnd) && params.originalTime) {
    const parts = params.originalTime.split(/[〜\-]/);
    if (parts.length >= 1 && parts[0].trim()) recruitStart = recruitStart || parts[0].trim();
    if (parts.length >= 2 && parts[1].trim()) recruitEnd   = recruitEnd   || parts[1].trim();
  }
  // originalStart が未指定なら recruitStart を使用（全体募集ケース）
  if (!originalStart) originalStart = recruitStart;

  let updated = false;
  try {
    updated = recruitShiftSegment(params.date, params.originalStaff, originalStart, recruitStart, recruitEnd);
  } catch (e) {
    Logger.log('recruitShiftSegment エラー（通知は継続）: ' + e.message);
  }

  const timeLabel = (recruitStart && recruitEnd) ? recruitStart + '〜' + recruitEnd : (params.originalTime || '');
  // @All をテキスト先頭に配置。offset/length で位置を指定してメンションとして認識させる
  const mentionMarker = '@All ';
  let text = mentionMarker + '🔄 【シフト交代の募集】\n\n';
  text += '以下のシフトについて、交代を募集しています。\nカレンダーより引き受けをお願いします。\n\n';
  text += '📅 ' + params.date + '\n';
  text += '⏰ ' + timeLabel + '\n';
  text += '👤 ' + params.originalStaff + ' → (募集中)\n';
  text += '📝 理由: ' + (params.reason || '記載なし') + '\n\n';
  text += 'アプリのカレンダーから引き受けをお願いします🙏';

  // 幹部グループへ @all メンション付きで通知（KANBU_CHANNEL_ID = edbdefad-...）
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
    const code = res.getResponseCode();
    const body = res.getContentText();
    Logger.log('シフト募集通知 (kanbu/@all): HTTP ' + code + ' ' + body.substring(0, 200));
    groupSent = (code === 200 || code === 201);
  } catch (e) {
    Logger.log('シフト募集通知エラー: ' + e.message);
  }

  return { ok: true, updated: updated, groupSent: groupSent };
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

  const timeLabel = newStart && newEnd ? newStart + '〜' + newEnd : (params.originalTime || '');
  let text = '✅ 【シフト交代 承認完了】\n\n';
  text += 'シフトの交代が成立しました。\n\n';
  text += '📅 ' + params.date + '\n';
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
      text: '🔄 【シフト交代 完了のお知らせ】\n\n' + params.originalStaff + ' さんのシフトが交代されました。\n\n📅 ' + params.date + '\n⏰ ' + params.originalTime + '\n👤 ' + params.originalStaff + ' → ' + params.agentStaff + '\n\nジョブカンへの反映をご確認ください🙏'
    },
    {
      name: params.agentStaff,
      text: '🔄 【シフト交代 完了のお知らせ】\n\n' + params.agentStaff + ' さんがシフトを引き受けました。\n\n📅 ' + params.date + '\n⏰ ' + params.originalTime + '\n👤 ' + params.originalStaff + ' → ' + params.agentStaff + '\n\nジョブカンへの反映をご確認ください🙏'
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

    const d = new Date(params.date + 'T00:00:00+09:00');
    const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    const dateLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日（' + dow + '）';

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

