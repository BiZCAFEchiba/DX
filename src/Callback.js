// ============================================================
// webhookHandler.gs - LINE WORKS Webhook (Callback処理)
// ============================================================

/**
 * LINE WORKSからのCallbackリクエストを処理する
 * @param {Object} e - POSTリクエストイベント
 */
function handleWebhook(e) {
  // 受信データの存在確認
  if (!e || !e.postData || !e.postData.contents) {
    writeLogToSheets_('Webhook空リクエスト', 0, 'webhook', 'error', 'No postData contents');
    return;
  }

  try {
    // パース前に生の受信ログを記録
    writeLogToSheets_('Webhookパース前', 0, 'webhook', 'info', 'Raw content exists');

    const json = JSON.parse(e.postData.contents);
    const event = json.content;

    // デバッグログをスプレッドシートに出力
    writeLogToSheets_(
      'Webhook受信',
      0,
      'webhook',
      'info',
      'Type: ' + json.type + ', UserId: ' + (json.source ? json.source.userId : 'N/A') + ', Text: ' + (event ? event.text : 'N/A')
    );

    // イベントタイプチェック
    if (json.type === 'message') {
      const senderId = json.source.userId;
      const messageText = event.text;

      // 返信先コンテキストを判定: source.channelId があればチャンネル、なければ個人DM
      const sourceChannelId = json.source.channelId || null;
      const replyContext = sourceChannelId
        ? { type: 'channel', channelId: sourceChannelId }
        : { type: 'personal', userId: senderId };

      // シフト募集応答を最優先で処理（スタッフマッピング不要）
      if (messageText && (messageText.startsWith('【入れる】') || messageText.startsWith('【入れない】'))) {
        var isAvail = messageText.startsWith('【入れる】');
        var rId = messageText.replace(/^【.+?】/, '').trim();
        // 名前はマッピングから取得、なければLINE WORKS IDをそのまま使用
        const quickMappings = loadStaffMappingFromSheets_();
        var responderName = (quickMappings && quickMappings.recv[senderId]) ? quickMappings.recv[senderId] : senderId;
        Logger.log('募集応答受信: ' + responderName + ' → ' + (isAvail ? '入れる' : '入れない') + ' / ' + rId);
        writeLogToSheets_('募集応答', 0, 'webhook', 'info', responderName + ' → ' + (isAvail ? '入れる' : '入れない') + ' / ' + rId);
        recordRecruitmentResponse_(rId, responderName, isAvail ? '入れる' : '入れない');
        touchShiftLastModified_();
        var dmReply = isAvail
          ? '✅ 入れると回答しました！\n担当者からの連絡をお待ちください。'
          : '❌ 入れないと回答しました。';
        sendLineWorksMessage(senderId, dmReply);
        return;
      }

      // 【受信用ID】スタッフマッピングからIDで名前を引く
      const mappings = loadStaffMappingFromSheets_();
      let senderName = mappings ? mappings.recv[senderId] : null;

      if (!senderName) {
        // フルネームと照合してF列に自動登録を試みる
        const normalizedText = messageText ? normalizeName_(messageText) : null;
        if (normalizedText) {
          const registered = autoRegisterRecvId_(normalizedText, senderId);
          if (registered) {
            writeLogToSheets_('UUID登録成功', 0, 'webhook', 'info', normalizedText + ': ' + senderId);
            sendLineWorksMessage(senderId, '✅ ' + normalizedText + ' さんのIDを登録しました！\nこれからシフト確認・変更が使えます。');
            return;
          } else {
            sendLineWorksMessage(senderId, '名前が見つかりませんでした。\nスペースなしのフルネームで送ってください。\n例）杉本尚哉');
          }
        }
        writeLogToSheets_('未登録UUID', 0, 'webhook', 'warn', '【登録待ち】' + senderId);
        return;
      }

      // Meetup告知Botの「テーマを見る」ボタン応答（最優先）
      // 同一URLに複数Botのwebhookが届くため、CacheServiceで二重処理を防止
      if (messageText && messageText.startsWith('meetup:')) {
        var cacheKey = 'meetup_' + messageText + '_' + Math.floor(Date.now() / 8000);
        var cache = CacheService.getScriptCache();
        if (!cache.get(cacheKey)) {
          cache.put(cacheKey, '1', 8);
          var companyName = messageText.replace(/^meetup:/, '').trim();
          var replyChannelId = sourceChannelId || LINEWORKS_CHANNEL_ID;
          handleMeetupDetailRequest_(replyChannelId, companyName);
        }
        return;
      }

      // シフト不足照会キーワード（他のキーワードより優先）
      if (messageText && messageText.includes('シフト不足')) {
        clearSession_(senderId);
        handleShortageInquiry_(senderId, senderName, messageText, replyContext);
        return;
      }

      // アクティブなシフト不足照会セッション
      const activeSession = getSession_(senderId);
      if (activeSession && activeSession.step && activeSession.step.startsWith('shortage_')) {
        handleShortageInquiry_(senderId, senderName, messageText, replyContext);
        return;
      }

      // シフト照会キーワード（既存セッションより優先）
      if (messageText && messageText.includes('シフト') &&
          (messageText.includes('教えて') || messageText.includes('照会') || messageText.includes('見せて'))) {
        clearSession_(senderId);
        handleInquiry_(senderId, senderName, messageText, replyContext);
        return;
      }

      // アクティブな照会セッション
      if (activeSession && activeSession.step && activeSession.step.startsWith('inquiry_')) {
        handleInquiry_(senderId, senderName, messageText, replyContext);
        return;
      }

      // シフト変更フロー
      if (activeSession || (messageText && messageText.includes('シフト変更'))) {
        handleConversation_(senderId, senderName, messageText, replyContext);
        return;
      }


      // ボタンクリック（Message Action）によるシフト確認
      if (messageText && messageText.includes('【確認】')) {
        const dateStr = messageText.replace('【確認】', '').trim();
        Logger.log('シフト確認処理開始: 日付=' + dateStr + ', 送信者=' + senderName);

        recordAcknowledgment_(dateStr, senderId, senderName);
        Logger.log('確認記録完了: ' + senderName + ' ' + dateStr);

        // 全員確認済みになった瞬間にグループへ多言語ありがとう送信
        if (checkAllConfirmed_(dateStr)) {
          sendAllConfirmedMessage_();
        }
      }
    }

  } catch (err) {
    Logger.log('Webhook処理エラー: ' + err.message);
    notifyError('Webhook処理エラー: ' + err.message);
  }
}

/**
 * 確認状況を記録（PropertiesService + スプレッドシート）
 */
function recordAcknowledgment_(dateStr, userId, staffName) {
  // 1. PropertiesService に記録（追っかけリマインド判定用）
  const props = PropertiesService.getScriptProperties();
  const key = 'CONFIRM_' + dateStr + '_' + userId;
  props.setProperty(key, 'true');
  Logger.log('確認記録(Properties): key=' + key);

  // 2. スプレッドシート「シフト」シートを更新（可視化用）
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SHIFTS);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    const targetISO = dateStr; // Webhookからは "2026-02-24" 形式で来る想定

    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date ? formatDateToISO_(data[i][0]) : String(data[i][0]);
      const rowName = String(data[i][2]).trim();

      if (rowDate === targetISO && rowName === staffName) {
        // I列（9列目）にステータスを書き込む
        sheet.getRange(i + 1, 9).setValue('確認済み');
        Logger.log('確認記録(Sheet): ' + staffName + ' ' + targetISO);
        break;
      }
    }
  } catch (e) {
    Logger.log('シート確認記入エラー: ' + e.message);
  }
}

/**
 * シフト変更リクエストを処理する
 */
function handleShiftChangeRequest_(userId, staffName, text) {
  // フォーマット解析
  // 【シフト変更】
  // 日付: 2026/02/14
  // 名前: 杉本尚哉 (Optional, verification purpose)
  // 変更: 15:30〜18:00

  const lines = text.split('\n');
  let dateStr = '';
  let timeRange = '';
  let targetName = staffName; // デフォルトは送信者本人

  lines.forEach(line => {
    if (line.includes('日付:')) dateStr = line.split('日付:')[1].trim();
    if (line.includes('変更:')) timeRange = line.split('変更:')[1].trim();
    if (line.includes('名前:')) {
      const namePart = line.split('名前:')[1].trim();
      // "A -> B" 形式の対応（代理申請など）は一旦保留し、本人の変更のみ想定
      // ただし、明示的に名前が書いてある場合はチェック
      if (!namePart.includes('→') && namePart !== staffName) {
        // 名前が一致しない場合（代理申請?）
        // 今回は本人申請のみ許可とするならエラー
        // targetName = namePart; 
      }
    }
  });

  if (!dateStr || !timeRange) {
    sendLineWorksMessage(userId, 'フォーマットエラー: 日付と変更時間を正しく入力してください。');
    return;
  }

  // 日付チェック
  const targetDate = new Date(dateStr);
  if (isNaN(targetDate.getTime())) {
    sendLineWorksMessage(userId, '日付フォーマットエラー: YYYY/MM/DD 形式で入力してください。');
    return;
  }

  // 締め切りチェック: 前日の11:30
  // Today (Now) vs Target Date 
  const now = new Date(); // GAS実行時の現在日時
  // targetDateの前日
  const deadlineDate = new Date(targetDate);
  deadlineDate.setDate(targetDate.getDate() - 1);
  deadlineDate.setHours(11, 30, 0, 0);

  if (now > deadlineDate) {
    sendLineWorksMessage(userId, '受付時間外です。前日の11:30までに申請してください。\nこれ以降の変更は店長に直接連絡してください。');
    return;
  }

  // シート更新処理
  const success = updateShiftInSheet(targetDate, targetName, timeRange);

  if (success) {
    const formattedDate = Utilities.formatDate(targetDate, TIMEZONE, 'MM/dd(E)');
    sendLineWorksMessage(userId, '以下の内容で変更を受け付けました。\n\n📅 ' + formattedDate + '\n👤 ' + targetName + '\n⏱ ' + timeRange);
  } else {
    sendLineWorksMessage(userId, 'システムエラー: シフトの更新に失敗しました。');
  }
}
