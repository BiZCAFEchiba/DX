// ============================================================
// lineworksClient.gs - LINE WORKS Bot API 2.0（認証・送信）
// ============================================================

/**
 * JWTを生成してアクセストークンを取得する
 * @returns {string|null} アクセストークン
 */
function getLineWorksAccessToken() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: LINEWORKS_CLIENT_ID,
      sub: LINEWORKS_SERVICE_ACCOUNT,
      iat: now,
      exp: now + 3600
    };

    const jwt = createJwt_(header, payload, LINEWORKS_PRIVATE_KEY);

    const response = UrlFetchApp.fetch(LINEWORKS_AUTH_URL, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        assertion: jwt,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        client_id: LINEWORKS_CLIENT_ID,
        client_secret: LINEWORKS_CLIENT_SECRET,
        scope: 'bot'
      },
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    if (result.access_token) {
      Logger.log('アクセストークン取得成功');
      return result.access_token;
    } else {
      Logger.log('トークン取得失敗: ' + response.getContentText());
      return null;
    }
  } catch (e) {
    Logger.log('認証エラー: ' + e.message);
    return null;
  }
}

/**
 * RS256 JWT を生成する
 * @param {Object} header
 * @param {Object} payload
 * @param {string} privateKey - PEM形式の秘密鍵
 * @returns {string} JWT文字列
 */
function createJwt_(header, payload, privateKey) {
  const base64Header = base64UrlEncode_(JSON.stringify(header));
  const base64Payload = base64UrlEncode_(JSON.stringify(payload));
  const signingInput = base64Header + '.' + base64Payload;

  const signature = Utilities.computeRsaSha256Signature(signingInput, privateKey);
  const base64Signature = base64UrlEncode_(signature);

  return signingInput + '.' + base64Signature;
}

/**
 * Base64URL エンコード
 * @param {string|byte[]} input
 * @returns {string}
 */
function base64UrlEncode_(input) {
  var encoded;
  if (typeof input === 'string') {
    encoded = Utilities.base64Encode(input, Utilities.Charset.UTF_8);
  } else {
    encoded = Utilities.base64Encode(input);
  }
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * LINE WORKS ID (UUID) から表示名を取得する
 * @param {string} userId
 * @returns {string|null}
 */
function getLineWorksUserName_(userId) {
  const token = getLineWorksAccessToken();
  if (!token) return null;

  const url = LINEWORKS_API_BASE + '/users/' + userId;

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const user = JSON.parse(response.getContentText());
      // userName.lastName + userName.firstName または displayName
      const name = user.userName ? (user.userName.lastName + user.userName.firstName) : user.displayName;
      return name ? name.trim() : null;
    }
    Logger.log('ユーザー情報取得失敗: ' + response.getContentText());
  } catch (e) {
    Logger.log('ユーザー情報取得エラー: ' + e.message);
  }
  return null;
}

/**
 * 文字列を正規化する（空白除去、全角英数を半角にするなど）
 */
function normalizeName_(name) {
  if (!name) return '';
  // 全角スペースを半角に、前後の空白除去、途中の空白も除去
  let n = String(name).replace(/　/g, ' ').trim().replace(/\s+/g, '');
  return n;
}

/**
 * 全メンバーリストを取得して {名前: ID} のマップを返す
 * @returns {Object} { "名前": "ID" }
 */
function getLineWorksUserMap_() {
  const token = getLineWorksAccessToken();
  if (!token) return {};

  const url = LINEWORKS_API_BASE + '/users';
  const userMap = {};

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code === 200) {
      const data = JSON.parse(response.getContentText());
      if (data.users) {
        data.users.forEach(user => {
          const userId = user.userId;
          const variants = [];

          // 1. 姓名(lastName + firstName)
          if (user.userName) {
            const last = user.userName.lastName || '';
            const first = user.userName.firstName || '';
            if (last || first) variants.push(last + first);
          }

          // 2. 表示名(displayName)
          if (user.displayName) variants.push(user.displayName);

          // 3. ニックネーム(nickname)
          if (user.nickname) variants.push(user.nickname);

          // 全てのバリエーションを正規化してマップに登録
          variants.forEach(v => {
            const key = normalizeName_(v);
            if (key) {
              userMap[key] = userId;
            }
          });

          Logger.log('取得ユーザー: ID=' + userId + ', 名前=[' + variants.join(', ') + ']');
        });
      }
      return userMap;
    } else {
      Logger.log('ユーザーリスト取得失敗: ' + code + ' - ' + response.getContentText());
    }
  } catch (e) {
    Logger.log('メンバーリスト取得エラー: ' + e.message);
  }
  return userMap;
}

/**
 * LINE WORKSグループにメンション付きリマインドメッセージを送信する
 * @param {Array<{ name: string, start: string, end: string, tasks: string[] }>} shiftData
 * @param {{ displayStr: string }} tomorrow
 * @returns {boolean} 送信成功/失敗
 */
function sendLineWorksReminder(shiftData, tomorrow) {
  const token = getLineWorksAccessToken();
  if (!token) return false;

  const { messageText, mentionedList, targetDateISO } = buildReminderMessage(shiftData, tomorrow);

  // API送信（最大3回リトライ）
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';

      const body = {
        content: {
          type: 'button_template',
          contentText: messageText,
          actions: [
            {
              type: 'message',
              label: '確認しました',
              text: '【確認】' + targetDateISO
            }
          ]
        }
      };

      if (mentionedList.length > 0) {
        body.content.mentionedList = mentionedList;
      }

      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });

      if (response.getResponseCode() === 200 || response.getResponseCode() === 201) {
        Logger.log('リマインド送信成功');
        return true;
      }
    } catch (e) {
      Logger.log('送信エラー (試行' + attempt + '/3): ' + e.message);
    }
    if (attempt < 3) Utilities.sleep(2000);
  }
  return false;
}

/**
 * メンション付きリマインドメッセージを組み立てる
 */
function buildReminderMessage(shiftData, tomorrow) {
  // スタッフマッピングを最新の状態に更新
  const mappings = loadStaffMappingFromSheets_();
  const sendMap = mappings ? mappings.send : {};

  var text = '【シフトリマインド (' + tomorrow.displayStr + ')】\n';
  text += '勤務時間の確認をお願いします！\n\n';
  text += '\uD83D\uDCC5 ' + tomorrow.displayStr + '\n\n';

  const mentionedList = [];

  for (var i = 0; i < shiftData.length; i++) {
    const staff = shiftData[i];
    // 送信用ID（B列）から ID を取得
    const lineworksId = sendMap[staff.name];

    if (lineworksId) {
      text += '<m userId="' + lineworksId + '">';
      text += '  ' + staff.start + '\u301C' + staff.end + '\n';
      mentionedList.push(lineworksId);
    } else {
      text += '▶ ' + staff.name + '  ' + staff.start + '\u301C' + staff.end + '\n';
      Logger.log('警告: ID未登録スタッフ - ' + staff.name);
    }

    if (staff.tasks.length > 0) {
      text += '  \u2514 \uD83D\uDCCB ' + staff.tasks.join(' / ') + '\n';
    }

    if (staff.meetups && staff.meetups.length > 0) {
      staff.meetups.forEach(function(m) {
        var kindLabel = m.kind && m.kind.indexOf('貸切') !== -1 ? '貸切Meetup' : '対面Meetup';
        text += '  🤝 ' + kindLabel + ': ' + m.time + ' ' + m.company + '\n';
      });
    }
  }

  text += '\n明日もよろしくお願いします！\n';

  return {
    messageText: text,
    mentionedList: mentionedList,
    targetDateISO: formatDateToISO_(tomorrow.dateObj)
  };
}

/**
 * 特定のユーザーにメッセージを送信する（Webhook返信用）
 */
function sendLineWorksMessage(userId, text) {
  const token = getLineWorksAccessToken();
  if (!token) return false;

  const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + userId + '/messages';

  const body = {
    content: {
      type: 'text',
      text: text
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    return response.getResponseCode() === 200 || response.getResponseCode() === 201;
  } catch (e) {
    return false;
  }
}

/**
 * LINE WORKSグループにテキストメッセージを送信する
 * @param {string} text - 送信するテキスト
 * @returns {boolean} 送信成功/失敗
 */
function sendLineWorksGroupMessage(text) {
  const token = getLineWorksAccessToken();
  if (!token) return false;

  const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
  const body = {
    content: {
      type: 'text',
      text: text
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code === 200 || code === 201) {
      Logger.log('グループメッセージ送信成功');
      return true;
    } else {
      Logger.log('グループメッセージ送信失敗: ' + response.getContentText());
      return false;
    }
  } catch (e) {
    Logger.log('グループメッセージ送信エラー: ' + e.message);
    return false;
  }
}

/**
 * 特定のユーザーにボタンテンプレートを送信する（セルフオンボーディング用）
 * @param {string} userId - LINE WORKS User ID
 * @param {string} contentText - 説明文
 * @param {Array} actions - ボタン要素の配列
 * @returns {boolean}
 */
function sendLineWorksButtonMessage(userId, contentText, actions) {
  const token = getLineWorksAccessToken();
  if (!token) return false;

  const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/users/' + userId + '/messages';

  const body = {
    content: {
      type: 'button_template',
      contentText: contentText,
      actions: actions
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code === 200 || code === 201) {
      return true;
    } else {
      Logger.log('ボタンメッセージ送信失敗: ' + response.getContentText());
      return false;
    }
  } catch (e) {
    Logger.log('ボタンメッセージ送信エラー: ' + e.message);
    return false;
  }
}
