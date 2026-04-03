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

    // ── 代理スタッフへ個別DM送信 ───────────────────────────
    if (params.notifyAgent && params.agentStaff) {
      const isTestMode = (typeof SHIFT_CHANGE_CHANNEL_ID_TEST !== 'undefined' && SHIFT_CHANGE_CHANNEL_ID === SHIFT_CHANGE_CHANNEL_ID_TEST);
      const agents = getShiftAgentStaff();
      const agentInfo = agents.find(function(a) { return a.name === params.agentStaff; });

      if (agentInfo && agentInfo.sendId) {
        // 代理スタッフ宛のDMテキスト（より個人的な文面）
        let dmText = '📩 シフト交代の依頼があなた宛に届いています。\n\n' + text;
        dmText += '\n\n💡 交代後、ジョブカンへの反映をお願いします。';

        if (isTestMode) {
          // テストモード時は本人ではなくテストグループへ流す
          const testGroupText = '【テスト環境】 個別DM送信テスト\n本来は (' + params.agentStaff + ') さん個人のDM宛に以下の通知が届きます:\n---\n' + dmText;
          const groupUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID_TEST + '/messages';
          agentSent = sendLineWorksText_(token, groupUrl, testGroupText, SHIFT_CHANGE_BOT_ID);
          Logger.log('代理スタッフDM(テスト代替): ' + params.agentStaff + ' → テストグループへ送信');
        } else {
          // 本番時は通常の個人の個別トーク画面へDM
          const agentUrl = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + agentInfo.sendId + '/messages';
          agentSent = sendLineWorksText_(token, agentUrl, dmText, LINEWORKS_BOT_ID);
          Logger.log('代理スタッフDM: ' + params.agentStaff + ' → ' + (agentSent ? '成功' : '失敗'));
        }
      } else {
        Logger.log('代理スタッフのLINE WORKS IDが未登録: ' + params.agentStaff);
      }
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
  let text = '🔄 【シフト交代のお知らせ】\n\n';
  text += '📅 ' + dateLabel + '\n';
  text += '⏰ ' + (params.originalTime || '') + '\n';
  text += '👤 ' + (params.originalStaff || '') + ' → ' + (params.agentStaff || '') + '\n';
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
  const token = getLineWorksToken_();
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
  const token = getLineWorksToken_();
  if (!token) return { error: 'token_error' };

  // スプレッドシートのステータス更新
  const updated = updateShiftStatus(params.date, params.originalStaff, '募集中');

  let text = '🔄 【シフト交代の募集】\n\n';
  text += '以下のシフトについて、交代を募集しています。\nカレンダーより承認お願いします。\n\n';
  text += '📅 ' + params.date + '\n';
  text += '⏰ ' + params.originalTime + '\n';
  text += '👤 ' + params.originalStaff + ' -> (募集中)\n';
  text += '📝 理由: ' + (params.reason || '記載なし') + '\n\n';
  text += 'シフトにご協力いただける方は、アプリのカレンダーから引き受けをお願いします🙏';

  const groupUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID + '/messages';
  const groupSent = sendLineWorksText_(token, groupUrl, text, SHIFT_CHANGE_BOT_ID);

  return { ok: true, updated: updated, groupSent: groupSent };
}

/**
 * シフト交代の募集を引き受け（承認）し、シフトを書き換えて通知する
 */
function approveShiftRecruitment_(params) {
  initChannelId_();
  const token = getLineWorksToken_();
  if (!token) return { error: 'token_error' };

  // シフトDBのスタッフ名書き換え＆ステータスクリア
  const updated = updateShiftStaff(params.date, params.originalStaff, params.agentStaff);

  let text = '✅ 【シフト交代 承認完了】\n\n';
  text += 'シフトの交代が成立しました。\n\n';
  text += '📅 ' + params.date + '\n';
  text += '⏰ ' + params.originalTime + '\n';
  text += '👤 ' + params.originalStaff + ' → ' + params.agentStaff + '\n\n';
  text += 'ご協力ありがとうございます🙏 ジョブカンへの反映をお願いします。';

  // 幹部グループへ通知
  const kanbuUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + KANBU_CHANNEL_ID + '/messages';
  sendLineWorksText_(token, kanbuUrl, text, SHIFT_CHANGE_BOT_ID);

  // 変更（交代）グループへ通知
  const changeUrl = LINEWORKS_API_BASE + '/bots/' + SHIFT_CHANGE_BOT_ID + '/channels/' + SHIFT_CHANGE_CHANNEL_ID + '/messages';
  const groupSent = sendLineWorksText_(token, changeUrl, text, SHIFT_CHANGE_BOT_ID);

  return { ok: true, updated: updated, groupSent: groupSent };
}
