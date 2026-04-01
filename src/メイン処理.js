// ============================================================
// main.gs - エントリーポイント（Sheets統合版）
// ============================================================

/**
 * メイン処理 - タイムトリガーから毎日12:00に呼び出される
 *
 * 統合後の動作:
 *   2. 「スタッフ」シートからマッピングを取得
 *   3. LINE WORKSへメンション付きリマインド送信
 *   4. 「送信ログ」シートに結果を記録
 *   5. 「シフト不足」チェック（5日後）を行い、不足時はアラート送信
 *
 * フォールバック:
 *   Sheetsにデータがない場合は従来通りDriveのPDFから解析を試みる
 */
/**
 * LINE WORKSからのCallbackリクエストを処理する
 * @param {Object} e - POSTリクエストイベント
 */
function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (jsonErr) {}
    }

    if (body.page === 'kanbu') {
      var kanbuResult = handleKanbuApi_(body);
      return ContentService.createTextOutput(JSON.stringify(kanbuResult))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.page === 'calendar') {
      if (body.action === 'boardSave') {
        var saveResult = saveBoardItem_(body);
        return ContentService.createTextOutput(JSON.stringify(saveResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'boardUploadImage') {
        return ContentService.createTextOutput(JSON.stringify({
          ok: false,
          error: 'board_image_upload_disabled'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'attendanceSave') {
        var attResult = kanbuSaveAttendance_(body.meetingDate, body.staffName, body.status, body.reason);
        return ContentService.createTextOutput(JSON.stringify(attResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid_action' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Webhookの到達を物理的に確認するための初期ログ
    writeLogToSheets_('POST受信', 0, 'raw', 'info', 'doPost triggered');
    handleWebhook(e);
  } catch (err) {
    writeLogToSheets_('doPost致命的エラー', 0, 'raw', 'error', err.message);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * HTTP GETリクエストを処理する
 * ?page=yuchi で誘致フォームを表示
 */
function doGet(e) {
  var param = (e && e.parameter) ? e.parameter : {};
  writeLogToSheets_(
    'doGet',
    0,
    'raw',
    'info',
    JSON.stringify({ page: param.page || '', action: param.action || '', id: param.id || '' })
  );

  // --- 幹部管理WebApp ---
  if (param.page === 'kanbu') {
    var kanbuTemplate = HtmlService.createTemplateFromFile('幹部管理');
    kanbuTemplate.appUrl = ScriptApp.getService().getUrl();
    return kanbuTemplate.evaluate()
      .setTitle('幹部管理 | BizCAFE')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // --- 閲覧数ダッシュボード（スタッフ用） ---
  if (param.page === 'analytics') {
    var analyticsTemplate = HtmlService.createTemplateFromFile('閲覧数ダッシュボード');
    analyticsTemplate.appUrl = ScriptApp.getService().getUrl();
    return analyticsTemplate.evaluate()
      .setTitle('閲覧数ダッシュボード | BizCAFE')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // --- 誘致フォーム ---
  if (param.page === 'yuchi') {
    var template = HtmlService.createTemplateFromFile('誘致フォーム');
    template.staffName = param.name || '';
    template.preselected = param.companies || '';
    return template.evaluate()
      .setTitle('誘致情報入力')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // --- お客様向け営業カレンダー ---
  if (param.page === 'calendar') {
    // JSONデータAPIモード（カレンダー）
    if (param.action === 'data') {
      var year    = parseInt(param.year)  || new Date().getFullYear();
      var month   = parseInt(param.month) || (new Date().getMonth() + 1);
      var nocache = param.nocache === '1';
      var data    = getCustomerCalendarData_(year, month, nocache);
      var output  = ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
      return output;
    }
    // JSONデータAPIモード（指定日のMeetup一覧）
    if (param.action === 'meetups') {
      var meetupDate = param.date || '';
      var meetups = getMeetupsForCustomer_(meetupDate);
      return ContentService.createTextOutput(JSON.stringify(meetups))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 現在の営業状況（営業中・LO後・営業時間外）を返す
    if (param.action === 'businessStatus') {
      var now = new Date();
      var hours = getBusinessHours(now);
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var status = 'closed'; // デフォルト: 定休日 or 時間外
      var openTime = null, loTime = null, closeTime = null;
      if (hours) {
        openTime  = hours.start;
        loTime    = hours.lo || null;
        closeTime = hours.end;
        var openMin  = timeToMin_(hours.start);
        var closeMin = timeToMin_(hours.end);
        var loMin    = loTime ? timeToMin_(loTime) : closeMin;
        if (nowMin >= openMin && nowMin < loMin) {
          status = 'open';
        } else if (loTime && nowMin >= loMin && nowMin < closeMin) {
          status = 'lo'; // LO後・閉店前
        } else {
          status = 'outside'; // 開店前 or 閉店後
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status:    status,
        openTime:  openTime,
        loTime:    loTime,
        closeTime: closeTime,
        nowTime:   Utilities.formatDate(now, TIMEZONE, 'HH:mm')
      })).setMimeType(ContentService.MimeType.JSON);
    }
    // 混雑状況取得
    if (param.action === 'congestion') {
      var props = PropertiesService.getScriptProperties();
      var level = parseInt(props.getProperty('CONGESTION_LEVEL') || '0');
      var updatedAt = props.getProperty('CONGESTION_UPDATED_AT') || '';
      // 日付が変わっていたら未確認（0）にリセット
      var todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
      if (updatedAt && updatedAt.slice(0, 10) !== todayStr) {
        level = 0;
        props.setProperty('CONGESTION_LEVEL', '0');
      }
      return ContentService.createTextOutput(JSON.stringify({ level: level, updatedAt: updatedAt }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Q&Aリスト取得
    if (param.action === 'qaList') {
      var includeHidden = param.staff === '1';
      return ContentService.createTextOutput(JSON.stringify(getFAQList_(includeHidden)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Q&A質問投稿（顧客用）
    if (param.action === 'qaSubmit') {
      var result = submitQuestion_(param.question || '');
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Q&A保存（スタッフ用）
    if (param.action === 'qaSave') {
      var result = saveFAQItem_(
        param.id || '',
        param.question || '',
        param.answer || '',
        param.visible !== 'false'
      );
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Q&A削除（スタッフ用）
    if (param.action === 'qaDelete') {
      var result = deleteFAQItem_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 掲示板一覧取得
    if (param.action === 'boardList') {
      return ContentService.createTextOutput(JSON.stringify(getBoardList_({
        includeUnpublished: param.staff === '1',
        placement: param.placement || '',
        limit: param.limit || ''
      }))).setMimeType(ContentService.MimeType.JSON);
    }
    // 掲示板詳細取得
    if (param.action === 'boardDetail') {
      var boardItem = getBoardItem_(param.id || '', param.staff === '1');
      return ContentService.createTextOutput(JSON.stringify(boardItem || { ok: false, error: 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action === 'articleViewCountIncrement') {
      return ContentService.createTextOutput(JSON.stringify(incrementArticleViewCount_(param.articleId || '')))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 掲示板保存
    if (param.action === 'boardSave') {
      var saveResult = saveBoardItem_({
        id: param.id || '',
        title: param.title || '',
        category: param.category || '',
        summary: param.summary || '',
        body: param.body || '',
        date: param.date || '',
        imageUrl: param.imageUrl || '',
        thumbnailUrl: param.thumbnailUrl || '',
        showInUpdates: param.showInUpdates === 'true',
        showInArticles: param.showInArticles === 'true',
        published: param.published === 'true'
      });
      return ContentService.createTextOutput(JSON.stringify(saveResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 掲示板削除
    if (param.action === 'boardDelete') {
      var deleteResult = deleteBoardItem_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(deleteResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // コーナー質問一覧
    if (param.action === 'cornerQuestionList') {
      return ContentService.createTextOutput(JSON.stringify(getCornerQuestionList_(param.staff === '1')))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // コーナー質問詳細
    if (param.action === 'cornerQuestionDetail') {
      var cornerQuestion = getCornerQuestionDetail_(param.id || '', param.staff === '1');
      return ContentService.createTextOutput(JSON.stringify(cornerQuestion || { ok: false, error: 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // customer 側コーナー質問投稿
    if (param.action === 'cornerQuestionSubmit') {
      var questionSubmitResult = submitCornerQuestion_({
        nickname: param.nickname || '',
        category: param.category || '',
        title: param.title || '',
        body: param.body || ''
      });
      return ContentService.createTextOutput(JSON.stringify(questionSubmitResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // staff 側コーナー質問更新
    if (param.action === 'cornerQuestionSave') {
      var questionSaveResult = saveCornerQuestion_({
        id: param.id || '',
        nickname: param.nickname,
        category: param.category,
        title: param.title,
        body: param.body,
        status: param.status,
        published: param.published === 'true',
        answerBody: param.answerBody,
        answeredBy: param.answeredBy
      });
      return ContentService.createTextOutput(JSON.stringify(questionSaveResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // staff 側コーナー質問削除
    if (param.action === 'cornerQuestionDelete') {
      var questionDeleteResult = deleteCornerQuestion_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(questionDeleteResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // コーナー表示コンテンツ取得
    if (param.action === 'cornerContentGet') {
      return ContentService.createTextOutput(JSON.stringify(getCornerContent_(param.staff === '1')))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // staff 用コーナーセクション保存
    if (param.action === 'cornerContentSave') {
      var cornerContentResult = saveCornerSection_(param.section || '', param.data || '');
      return ContentService.createTextOutput(JSON.stringify(cornerContentResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 参加型コーナー投票
    if (param.action === 'cornerParticipationVote') {
      var participationVoteResult = voteCornerParticipation_(param.themeId || '', param.optionId || '');
      return ContentService.createTextOutput(JSON.stringify(participationVoteResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // customer 側ページ閲覧数の記録
    if (param.action === 'pageViewTrack') {
      var pageViewTrackResult = trackCornerPageView_(param.pageKey || '');
      return ContentService.createTextOutput(JSON.stringify(pageViewTrackResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action === 'cornerSettingsGet') {
      return ContentService.createTextOutput(JSON.stringify(getCornerSettings_()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action === 'cornerSettingsSave') {
      return ContentService.createTextOutput(JSON.stringify(saveCornerSettingsValue_({
        freeBoardVisible: param.freeBoardVisible === 'true'
      })))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // staff 側閲覧数確認
    if (param.action === 'pageViewGet') {
      return ContentService.createTextOutput(JSON.stringify(getCornerPageViews_()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action === 'pageViewReset') {
      var pageViewResetResult = resetCornerPageViews_();
      return ContentService.createTextOutput(JSON.stringify(pageViewResetResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 混雑状況更新（スタッフ用）
    if (param.action === 'setCongestion') {
      var newLevel = parseInt(param.level || '0');
      if (newLevel >= 0 && newLevel <= 5) {
        var now = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
        PropertiesService.getScriptProperties().setProperties({
          'CONGESTION_LEVEL': String(newLevel),
          'CONGESTION_UPDATED_AT': now
        });
        return ContentService.createTextOutput(JSON.stringify({ ok: true, level: newLevel, updatedAt: now }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid level' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // メンテナンス状態取得
    // tabs=id1,id2,... でタブIDを指定（指定なしの場合は全MAINTENANCE_*プロパティを返す）
    // 未設定タブはデフォルトでメンテ中（true）
    if (param.action === 'maintenanceGet') {
      var props = PropertiesService.getScriptProperties();
      var mtResult = {};
      if (param.tabs) {
        param.tabs.split(',').forEach(function(tab) {
          tab = tab.trim();
          if (tab) mtResult[tab] = props.getProperty('MAINTENANCE_' + tab) !== 'false';
        });
      } else {
        var allProps = props.getProperties();
        Object.keys(allProps).forEach(function(key) {
          if (key.indexOf('MAINTENANCE_') === 0) {
            mtResult[key.replace('MAINTENANCE_', '')] = allProps[key] !== 'false';
          }
        });
      }
      return ContentService.createTextOutput(JSON.stringify(mtResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // メンテナンス状態設定（タブIDの制限なし）
    if (param.action === 'maintenanceSet') {
      var mtTab = param.tab || '';
      if (!mtTab) {
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'tab required' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var mtEnabled = param.enabled === 'true';
      PropertiesService.getScriptProperties().setProperty('MAINTENANCE_' + mtTab, String(mtEnabled));
      return ContentService.createTextOutput(JSON.stringify({ ok: true, tab: mtTab, enabled: mtEnabled }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: 空き状況取得
    if (param.action === 'roomAvailability') {
      var roomAvail = getRoomAvailability_(param.date || '');
      return ContentService.createTextOutput(JSON.stringify(roomAvail))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: 予約作成
    if (param.action === 'roomReserve') {
      var roomReserveResult = reserveRoom_(param);
      return ContentService.createTextOutput(JSON.stringify(roomReserveResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: キャンセル（顧客が予約IDのみで実行）
    if (param.action === 'roomCancel') {
      var roomCancelResult = cancelRoom_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(roomCancelResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: チェックイン
    if (param.action === 'roomCheckIn') {
      var roomCheckInResult = checkInRoom_(param.id || '', param.contact || '', param.staff === '1');
      return ContentService.createTextOutput(JSON.stringify(roomCheckInResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: 一覧取得（スタッフ用）
    if (param.action === 'roomList') {
      var roomListResult = getRoomList_(param.date || '');
      return ContentService.createTextOutput(JSON.stringify(roomListResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: ステータス更新（スタッフ用）
    if (param.action === 'roomStatusUpdate') {
      var roomStatusResult = updateRoomStatus_(param.id || '', param.status || '', param.memo || '');
      return ContentService.createTextOutput(JSON.stringify(roomStatusResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: チェックインモード取得/設定
    if (param.action === 'roomCheckinMode') {
      if (param.set) {
        var roomCheckinSetResult = setRoomCheckinMode_(param.set);
        return ContentService.createTextOutput(JSON.stringify(roomCheckinSetResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, mode: getRoomCheckinMode_() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: 自分の予約一覧（顧客用）
    if (param.action === 'roomMyReservations') {
      var roomMyResult = getMyRoomReservations_(param.contact || '');
      return ContentService.createTextOutput(JSON.stringify(roomMyResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: 利用者一覧（スタッフ用）
    if (param.action === 'roomUserList') {
      var roomUserListResult = getRoomUserList_();
      return ContentService.createTextOutput(JSON.stringify(roomUserListResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約: 利用者更新（スタッフ用）
    if (param.action === 'roomUserUpdate') {
      var roomUserUpdateResult = updateRoomUser_(
        param.contact || '',
        param.restricted === 'true',
        param.resetCount === 'true'
      );
      return ContentService.createTextOutput(JSON.stringify(roomUserUpdateResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 知るパスID発行（スタッフ用）
    if (param.action === 'shiruPassIssue') {
      var issueResult = issueShiruPassId_(param.note || '');
      return ContentService.createTextOutput(JSON.stringify(issueResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 知るパスID検証（顧客用）
    if (param.action === 'shiruPassValidate') {
      var validateResult = validateShiruPassId_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(validateResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 知るパスID一覧（スタッフ用）
    if (param.action === 'shiruPassList') {
      var listResult = getShiruPassList_();
      return ContentService.createTextOutput(JSON.stringify(listResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 知るパすID更新（スタッフ用）
    if (param.action === 'shiruPassRenew') {
      var renewResult = renewShiruPassId_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(renewResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 知るパスID有効日数 取得/設定（スタッフ用）
    if (param.action === 'shiruPassValidDays') {
      if (param.set) {
        var setDaysResult = setShiruPassValidDays_(param.set);
        return ContentService.createTextOutput(JSON.stringify(setDaysResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, days: getShiruPassValidDays_() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // ルーム予約上限時間 取得/設定（スタッフ用）
    if (param.action === 'roomMaxHours') {
      if (param.set) {
        var setHoursResult = setRoomMaxHours_(param.set);
        return ContentService.createTextOutput(JSON.stringify(setHoursResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, hours: getRoomMaxHours_() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 店舗ミーティング一覧（スタッフアプリ用）
    if (param.action === 'getMeetings') {
      return ContentService.createTextOutput(JSON.stringify(kanbuGetMeetings_()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 参加状況取得（スタッフアプリ用）
    if (param.action === 'getMeetingAttendance') {
      return ContentService.createTextOutput(JSON.stringify(kanbuGetAttendance_(param.date || '')))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // スタッフ名一覧（スタッフアプリ用）
    if (param.action === 'getStaffList') {
      return ContentService.createTextOutput(JSON.stringify(kanbuGetStaffList_()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 店舗進捗（BigQuery）
    if (param.action === 'storeProgress') {
      var spStore = param.store || 'BiZCAFE（千葉大学）店';
      // yearmonths="2026-12,2027-01" 形式（年またぎ対応）
      var spYM = param.yearmonths ? param.yearmonths.split(',') : [];
      if (!spYM.length) {
        // 旧形式フォールバック
        var spYear = parseInt(param.year) || new Date().getFullYear();
        var spMon  = param.months ? param.months.split(',').map(Number) : [new Date().getMonth() + 1];
        spYM = spMon.map(function(m) { return spYear + '-' + (m < 10 ? '0' + m : m); });
      }
      var spResult = getStoreProgress(spYM, spStore);
      return ContentService.createTextOutput(JSON.stringify(spResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action === 'kpiDailyGet') {
      var kpiStore = param.store || 'BiZCAFE（千葉大学）店';
      var kpiYM = param.yearmonths ? param.yearmonths.split(',') : [Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM')];
      var kpiResult = getStoreProgressDaily(kpiYM, kpiStore);
      return ContentService.createTextOutput(JSON.stringify(kpiResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        error: 'unknown_calendar_action',
        action: param.action
      })).setMimeType(ContentService.MimeType.JSON);
    }
    // HTMLページモード
    var calTemplate = HtmlService.createTemplateFromFile('顧客カレンダー');
    calTemplate.appUrl = ScriptApp.getService().getUrl();
    return calTemplate.evaluate()
      .setTitle('営業カレンダー | BizCAFE 千葉大学店')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return ContentService.createTextOutput('Shift Reminder Bot is active.');
}

/**
 * 翌日のシフトリマインドを送信する（トリガー実行用 entry point）
 * 実行推奨時間: 12:00頃
 */
function triggerShiftReminder() {
  initChannelId_();
  Logger.log('=== シフトリマインド 実行開始 ===');

  const now = new Date();

  // 土曜・日曜はスキップ（金曜に月曜分を送信済みのため）
  const todayDow = now.getDay(); // 0=日, 6=土
  if (todayDow === 0 || todayDow === 6) {
    Logger.log('土日のためシフトリマインドをスキップします。');
    return;
  }

  const nextBusinessDay = findNextBusinessDay_(now);
  const targetISO = formatDateToISO_(nextBusinessDay);
  const targetDisplay = Utilities.formatDate(nextBusinessDay, TIMEZONE, 'M月d日(E)');

  Logger.log('次営業日判定: ' + targetDisplay + ' (' + targetISO + ')');

  // 今日が定休日の場合でも、次営業日のリマインドを送る
  // ただし、既にその日向けに送信済みの場合はスキップ
  if (isAlreadySent_(targetISO, 'auto')) {
    Logger.log(targetDisplay + ' 向けのリマインドは送信済みのためスキップします。');
    return;
  }

  // 今日が営業日、かつターゲットが明日でない場合（＝連休前）のみ早期送信
  // または、今日が定休日の場合はターゲットに向けて送信
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowISO = formatDateToISO_(tomorrow);

  // --- Step 1: Sheetsからシフトデータを取得 ---
  let shiftData = getShiftsFromSheets_(targetISO);

  // --- Step 2: Sheetsにデータがなければ、PDFから従来方式でフォールバック ---
  if (shiftData.length === 0) {
    Logger.log('Sheetsにシフトデータなし。PDFフォールバックを試行...');
    shiftData = getShiftsFromPdfFallback_(tomorrow);
  }

  if (shiftData.length === 0) {
    var errorMsg = '翌日（' + targetDisplay + '）のシフト情報が見つかりませんでした。';
    Logger.log(errorMsg);
    writeLogToSheets_(tomorrowISO, 0, 'auto', 'skip', 'シフトデータなし');
    // 重要：データがない場合は通知して気付かせる
    // notifyError(errorMsg); 
    Logger.log('=== リマインド送信 終了 ===');
    return;
  }

  Logger.log('シフト情報取得: ' + shiftData.length + '名');

  // --- Step 2.5: 本日の確認状況をリセット（重複防止） ---
  resetAcknowledgment_(targetISO);

  // --- Step 2.6: Meetup重複チェック（対面開催のみ、設定ONの場合） ---
  if (isMeetupNotificationEnabled_()) {
    var dayMeetups = getMeetupsForDay_(nextBusinessDay);
    // 対面・貸切のみに絞り込む（オンライン除外）
    var inPersonMeetups = dayMeetups.filter(function(m) {
      return m.kind && (m.kind.indexOf('対面') !== -1 || m.kind.indexOf('貸切') !== -1);
    });
    if (inPersonMeetups.length > 0) {
      Logger.log('当日対面Meetup件数: ' + inPersonMeetups.length);
      shiftData = shiftData.map(function(staff) {
        var overlapping = findOverlappingMeetups_(staff.start, staff.end, inPersonMeetups);
        if (overlapping.length > 0) {
          Logger.log('Meetup重複: ' + staff.name + ' → ' + overlapping.length + '件');
          return { name: staff.name, start: staff.start, end: staff.end, tasks: staff.tasks, meetups: overlapping };
        }
        return staff;
      });
    }
  } else {
    Logger.log('Meetup重複通知: OFF（設定シートで無効化されています）');
  }

  // --- Step 3: LINE WORKSにリマインド送信 ---
  var tomorrowParams = {
    displayStr: targetDisplay,
    dateObj: nextBusinessDay
  };
  var success = sendLineWorksReminder(shiftData, tomorrowParams);

  // --- Step 3.5: Meetupアラート送信（対面・貸切） ---
  if (success) {
    sendMeetupAlertAfterReminder_(nextBusinessDay, shiftData);
  }

  // --- Step 4: 送信ログを記録 ---
  writeLogToSheets_(targetISO, shiftData.length, 'auto',
    success ? 'success' : 'error',
    success ? '正常送信' : '送信失敗'
  );

  if (!success) {
    notifyError('リマインド送信に失敗しました。\n対象日: ' + tomorrow.displayStr);
  }

  Logger.log('=== リマインド送信 完了 ===');
}

/**
 * シフトリマインド送信後に、翌営業日の対面・貸切Meetupアラートを送信する
 * @param {Date}  targetDate - 翌営業日
 * @param {Array} shiftData  - getShiftsFromSheets_ の戻り値
 */
function sendMeetupAlertAfterReminder_(targetDate, shiftData) {
  var dayMeetups = getMeetupsForDay_(targetDate);
  if (!dayMeetups || dayMeetups.length === 0) return;

  var inPersonMeetups = dayMeetups.filter(function(m) { return m.kind && m.kind.indexOf('対面') !== -1; });
  var kasshikiMeetups = dayMeetups.filter(function(m) { return m.kind && m.kind.indexOf('貸切') !== -1; });

  if (inPersonMeetups.length === 0 && kasshikiMeetups.length === 0) return;

  var mappings = loadStaffMappingFromSheets_();
  var sendMap = mappings ? mappings.send : {};
  var token = getLineWorksAccessToken();
  if (!token) {
    Logger.log('sendMeetupAlertAfterReminder_: トークン取得失敗');
    return;
  }
  var url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';

  /**
   * メンション付きチャンネルメッセージを送信するヘルパー
   */
  function sendChannelMention(text, mentionedList) {
    var body = { content: { type: 'text', text: text } };
    if (mentionedList && mentionedList.length > 0) {
      body.content.mentionedList = mentionedList;
    }
    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      Logger.log('Meetupアラート送信: ' + code + ' ' + text.substring(0, 30));
      return code === 200 || code === 201;
    } catch (e) {
      Logger.log('Meetupアラート送信エラー: ' + e.message);
      return false;
    }
  }

  // ② 対面Meetup: 企業ごとに、時間が重複するスタッフにメンション
  inPersonMeetups.forEach(function(meetup) {
    var overlapping = shiftData.filter(function(staff) {
      return findOverlappingMeetups_(staff.start, staff.end, [meetup]).length > 0;
    });
    if (overlapping.length === 0) return;

    var text = '🔴 対面Meetup対応をお願いします！\n';
    text += '【' + meetup.company + '】' + meetup.time + '\n';
    var mentioned = [];
    overlapping.forEach(function(staff) {
      var id = sendMap[staff.name];
      if (id) {
        text += '<m userId="' + id + '">';
        mentioned.push(id);
      } else {
        text += staff.name + ' ';
      }
    });
    text += '\n企業対応よろしくお願いします🙏';
    sendChannelMention(text, mentioned);
  });

  // ② 席確保リマインド: 本日シフトの最終スタッフ（退勤が最も遅い人）に翌日の対面Meetup席確保を依頼
  var todayISO = formatDateToISO_(new Date());
  var todayShifts = getShiftsFromSheets_(todayISO);
  if (todayShifts && todayShifts.length > 0 && inPersonMeetups.length > 0) {
    var lastStaff = todayShifts.reduce(function(prev, curr) {
      return curr.end > prev.end ? curr : prev;
    }, todayShifts[0]);

    var seatText = '🪑 席確保のお願い\n';
    var targetDisplay = Utilities.formatDate(targetDate, TIMEZONE, 'M月d日(E)');
    seatText += targetDisplay + 'の対面Meetupの席確保をお願いします🙏\n\n';
    inPersonMeetups.forEach(function(m) {
      seatText += '・【' + m.company + '】' + m.time + '\n';
    });
    var lastId = sendMap[lastStaff.name];
    var mentioned = [];
    if (lastId) {
      seatText += '\n' + '<m userId="' + lastId + '">';
      mentioned.push(lastId);
    } else {
      seatText += '\n' + lastStaff.name;
    }
    sendChannelMention(seatText, mentioned);
  }

  // ③ 貸切Meetup: イベントごとに、時間が重複するスタッフにメンション
  kasshikiMeetups.forEach(function(meetup) {
    var overlapping = shiftData.filter(function(staff) {
      return findOverlappingMeetups_(staff.start, staff.end, [meetup]).length > 0;
    });
    if (overlapping.length === 0) return;

    var text = '🟡 貸切対応をお願いします！\n';
    text += '【' + meetup.company + '】' + meetup.time + '\n';
    var mentioned = [];
    overlapping.forEach(function(staff) {
      var id = sendMap[staff.name];
      if (id) {
        text += '<m userId="' + id + '">';
        mentioned.push(id);
      } else {
        text += staff.name + ' ';
      }
    });
    text += '\n貸切対応よろしくお願いします🙏';
    sendChannelMention(text, mentioned);
  });
}

/**
 * シフト不足アラートを送信する（トリガー実行用 entry point）
 * 実行推奨時間: 12:01頃
 */
function triggerShortageAlert() {
  Logger.log('=== シフト不足アラート チェック開始 ===');
  checkAndSendShortageAlert_();
  Logger.log('=== チェック 完了 ===');
}

/**
 * 未確認者への追っかけリマインドを送信する（トリガー実行用 entry point）
 * 実行推奨時間: 17:00頃
 */
function triggerFollowUpReminder() {
  Logger.log('=== 未確認者への追っかけリマインド チェック開始 ===');

  const now = new Date();
  const nextBusinessDay = findNextBusinessDay_(now);
  const targetISO = formatDateToISO_(nextBusinessDay);
  const targetDisplay = Utilities.formatDate(nextBusinessDay, TIMEZONE, 'M月d日(E)');

  Logger.log('ターゲット日: ' + targetDisplay + ' (' + targetISO + ')');

  // 既にメインのリマインドが送信されていない場合は追っかけない
  if (!isAlreadySent_(targetISO, 'auto')) {
    Logger.log(targetDisplay + ' 向けのリマインドがまだ送信されていないため終了します。');
    return;
  }

  // 翌日のシフト名簿を取得
  const shiftData = getShiftsFromSheets_(targetISO);
  if (shiftData.length === 0) {
    Logger.log('翌日のシフトデータがないため終了');
    return;
  }

  // 未確認者を抽出
  const unconfirmedStaff = [];
  for (const staff of shiftData) {
    if (!isAcknowledgedBySheet_(targetISO, staff.name)) {
      unconfirmedStaff.push(staff);
      Logger.log('未確認判定: ' + staff.name);
    }
  }

  if (unconfirmedStaff.length === 0) {
    // 全員確認済み → ありがとうは確認ボタン押下時にリアルタイム送信済みのためここでは送らない
    Logger.log('全員確認済みのためリマインド不要。');
    resetAcknowledgment_(targetISO);
    return;
  }

  // スタッフマッピングを取得（名前 -> 送信用ID 変換用）
  const mappings = loadStaffMappingFromSheets_();
  const sendMap = mappings ? mappings.send : {};

  let text = '【シフト未確認リマインド】\n';
  text += '以下のスタッフの皆さん、明日のシフト確認をお願いします！\n\n';

  for (const staff of unconfirmedStaff) {
    const userId = sendMap[staff.name];
    if (userId) {
      text += '<m userId="' + userId + '">  ' + staff.start + '〜' + staff.end + '\n';
    } else {
      text += '▶ ' + staff.name + '  ' + staff.start + '〜' + staff.end + ' (要ID登録)\n';
    }
  }

  text += '\n確認したら、12:00のメッセージの【確認しました】ボタンを押してください。';

  // 送信
  const token = getLineWorksAccessToken();
  if (!token) return;

  const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
  const body = {
    content: {
      type: 'text',
      text: text
    }
  };

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  Logger.log('追っかけリマインド送信完了');

  // 確認サイクル終了 → 当日分の確認状況をリセット
  resetAcknowledgment_(targetISO);
}

/**
 * 指定日のシフト登録者全員が確認済みかどうかを判定する
 * @param {string} dateISO - YYYY-MM-DD
 * @returns {boolean}
 */
function checkAllConfirmed_(dateISO) {
  const shiftData = getShiftsFromSheets_(dateISO);
  if (shiftData.length === 0) return false;
  for (const staff of shiftData) {
    if (!isAcknowledgedBySheet_(dateISO, staff.name)) return false;
  }
  return true;
}

/**
 * 全員確認済み時にランダムな多言語ありがとうメッセージをグループに送信する
 */
function sendAllConfirmedMessage_() {
  const messages = [
    'ありがとう！',   // 日本語
    'Thank you!',     // 英語
    '감사합니다！',    // 韓国語
    '谢谢！',          // 中国語
    'شكراً！',         // アラビア語
    '¡Gracias!',      // スペイン語
    'Merci !',         // フランス語
    'Obrigado!',       // ポルトガル語
    'Danke!',          // ドイツ語
    'Grazie!'          // イタリア語
  ];

  const text = messages[Math.floor(Math.random() * messages.length)];

  const token = getLineWorksAccessToken();
  if (!token) return;

  const url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ content: { type: 'text', text: text } }),
    muteHttpExceptions: true
  });

  Logger.log('全員確認メッセージ送信: ' + text);
}

/**
 * シートの「確認状況」列を見て確認済みか判定する
 */
function isAcknowledgedBySheet_(dateISO, staffName) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SHIFTS);
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date ? formatDateToISO_(data[i][0]) : String(data[i][0]);
      const rowName = String(data[i][2]).trim();
      const status = String(data[i][8] || ''); // I列: 確認状況

      if (rowDate === dateISO && rowName === staffName) {
        return status.includes('確認済み');
      }
    }
  } catch (e) {
    Logger.log('シート確認失敗: ' + e.message);
  }
  return false;
}

/**
 * 指定日の確認状況をすべてリセット（空にする）
 * @param {string} dateISO - YYYY-MM-DD
 */
function resetAcknowledgment_(dateISO) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_SHIFTS);
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowDate = data[i][0] instanceof Date ? formatDateToISO_(data[i][0]) : String(data[i][0]);
      if (rowDate === dateISO) {
        // I列（9列目）を空にする
        sheet.getRange(i + 1, 9).setValue('');
      }
    }
    Logger.log('確認状況をリセットしました: ' + dateISO);
  } catch (e) {
    Logger.log('リセット失敗: ' + e.message);
  }
}

/**
 * 確認済みかどうかを判定 (Properties版)
 */
function isAcknowledged_(dateStr, userId) {
  const props = PropertiesService.getScriptProperties();
  const key = 'CONFIRM_' + dateStr + '_' + userId;
  const val = props.getProperty(key);
  Logger.log('確認状態チェック: key=' + key + ', value=' + val);
  return val === 'true';
}

/**
 * 受信IDが未登録のスタッフのみに個別でID登録依頼メッセージを送信する（管理者がGASエディタから手動実行）
 * F列（受信用ID）が空のスタッフのみを対象とする
 */
function requestNameRegistration() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_STAFF);
  if (!sheet) {
    Logger.log('スタッフシートが見つかりません');
    return;
  }

  const data = sheet.getDataRange().getValues();
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const name = row[0] ? String(row[0]).trim() : '';
    const sendId = row[1] ? String(row[1]).trim() : '';
    const recvId = row[5] ? String(row[5]).trim() : ''; // F列: 受信用ID

    if (!name || !sendId) continue;

    // 受信IDがすでに登録済みの場合はスキップ
    if (recvId) {
      Logger.log('スキップ（受信ID登録済み）: ' + name);
      skipCount++;
      continue;
    }

    const message = name + ' さん\n\nシフト確認システムの登録をお願いします。\nこのメッセージにご自身のフルネームをスペースなしで返信してください。\n\n例）' + name + '\n\n※1回送るだけで登録完了です。';
    const success = sendLineWorksMessage(sendId, message);
    if (success) {
      Logger.log('送信成功: ' + name);
      successCount++;
    } else {
      Logger.log('送信失敗: ' + name);
      failCount++;
    }
    Utilities.sleep(500); // API制限対策
  }

  Logger.log('登録依頼完了: 送信成功=' + successCount + '名 / 送信失敗=' + failCount + '名 / スキップ（登録済み）=' + skipCount + '名');
}

/**
 * メイン処理（互換性のために維持）
 */
function main() {
  triggerShiftReminder();
  triggerShortageAlert();
  // triggerFollowUpReminder(); // 17:00に別途実行される
}

/**
 * DriveフォルダのPDFを自動取込する（時間トリガー実行用）
 * UIなしで動作するため、時間ベーストリガーから安全に呼び出せる
 * 実行時間: 05:00 / 10:00 / 19:00 / 22:00 (JST)
 */
function autoProcessPdfFromDrive() {
  Logger.log('=== PDF自動取込 開始 ===');

  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    Logger.log('取込対象PDFなし（終了）');
    return;
  }

  Logger.log('取込対象PDF: ' + pdfFiles.length + '件');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SHIFTS);
    sheet.getRange(1, 1, 1, 8).setValues([['日付', '曜日', 'スタッフ名', '開始時刻', '終了時刻', '業務内容', '登録日時', '登録元']]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  // 重複チェック用キャッシュを構築
  const existingData = sheet.getDataRange().getValues();
  const shiftCache = new Set();
  for (let j = 1; j < existingData.length; j++) {
    const d = existingData[j][0] instanceof Date ? formatDateToISO_(existingData[j][0]) : String(existingData[j][0]);
    const name = String(existingData[j][2]).trim();
    const startTime = formatCellTime_(existingData[j][3]);
    shiftCache.add(d + '|' + name + '|' + startTime);
  }

  let totalImported = 0;
  let totalSkipped = 0;
  let registeredCountTotal = 0;
  let processedCount = 0;

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    const fileName = pdfFile.getName();
    Logger.log('--- PDF処理: ' + fileName + ' ---');

    const shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) {
      Logger.log('テキスト抽出失敗: ' + fileName);
      continue;
    }

    const allShifts = parseAllShiftsFromPdf_(pdfFile, shiftText);
    let fileImported = 0;
    let fileSkipped = 0;

    // カレンダー登録
    const calendarCount = registerShiftsToCalendar(allShifts);
    registeredCountTotal += calendarCount;

    // シートへ書き込み
    for (const entry of allShifts) {
      for (const staff of entry.shifts) {
        const key = entry.date + '|' + staff.name + '|' + staff.start;
        if (shiftCache.has(key)) {
          fileSkipped++;
          continue;
        }
        const tasks = staff.tasks.length > 0 ? staff.tasks.join(' / ') : '';
        sheet.appendRow([entry.date, entry.dayOfWeek, staff.name, staff.start, staff.end, tasks, new Date(), 'pdf_auto']);
        shiftCache.add(key);
        fileImported++;
      }
    }

    // 処理済みPDFをゴミ箱へ
    pdfFile.setTrashed(true);
    processedCount++;
    totalImported += fileImported;
    totalSkipped += fileSkipped;
    Logger.log(fileName + ': 新規=' + fileImported + '件, スキップ=' + fileSkipped + '件, カレンダー=' + calendarCount + '件');
  }

  writeLogToSheets_('pdf_auto_import', totalImported, 'auto', 'success',
    'PDF自動取込: ' + processedCount + 'ファイル, 新規' + totalImported + '件, カレンダー' + registeredCountTotal + '件');
  Logger.log('=== PDF自動取込 完了: 新規=' + totalImported + '件 ===');
}

// ============================================================
// Sheets 連携関数
// ============================================================

/**
 * Sheetsの「シフト」シートから指定日のシフトを取得
 * @param {string} dateISO - YYYY-MM-DD
 * @returns {Array<{ name: string, start: string, end: string, tasks: string[] }>}
 */
function getShiftsFromSheets_(dateISO) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SHIFTS);
    if (!sheet) return [];

    var data = sheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var rawDate = data[i][0];
      if (!rawDate) continue;

      var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d.getTime())) continue;

      var rowISO = formatDateToISO_(d);
      if (rowISO !== dateISO) continue;

      var tasks = [];
      if (data[i][5]) {
        tasks = String(data[i][5]).split(' / ').filter(function (t) { return t.trim(); });
      }

      results.push({
        name: String(data[i][2]).trim(),
        start: formatCellTime_(data[i][3]),
        end: formatCellTime_(data[i][4]),
        tasks: tasks
      });
    }

    // 開始時間順にソート
    results.sort(function (a, b) { return a.start.localeCompare(b.start); });
    return results;
  } catch (e) {
    Logger.log('Sheets読み取りエラー: ' + e.message);
    return [];
  }
}

/**
 * セルの値を "HH:mm" 形式の時刻文字列に変換する
 * Google Sheetsは時刻のみのセルをDate型(1899年)で保持するため変換が必要
 */
function formatCellTime_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, TIMEZONE, 'HH:mm');
  }
  // 文字列の場合はそのまま返す
  return String(val).trim();
}


/**
 * 指定日の指定方法での送信が既に成功しているかログを確認
 * @param {string} dateISO - YYYY-MM-DD
 * @param {string} method - 'auto' or 'manual'
 * @returns {boolean}
 */
function isAlreadySent_(dateISO, method) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      const logDate = data[i][1] instanceof Date ? formatDateToISO_(data[i][1]) : String(data[i][1]);
      const logMethod = data[i][3];
      const logResult = data[i][4];

      if (logDate === dateISO && logMethod === method && logResult === 'success') {
        return true;
      }
    }
  } catch (e) {
    Logger.log('送信済みチェックエラー: ' + e.message);
  }
  return false;
}

/**
 * 送信ログをSheetsに記録する
 * 100行を超えたら古い行を削除して最新50行のみ残す
 */
function writeLogToSheets_(dateStr, staffCount, method, result, detail) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_LOGS);
      sheet.getRange(1, 1, 1, 6).setValues([['送信日時', '対象日', 'スタッフ数', '送信方法', '結果', '詳細']]);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    }
    sheet.appendRow([new Date(), dateStr, staffCount, method, result, detail]);

    // 200行超えたら古い行を削除して最新100行だけ残す（ヘッダー除く）
    var lastRow = sheet.getLastRow();
    if (lastRow > 201) { // ヘッダー1行 + データ200行
      var deleteCount = lastRow - 101; // ヘッダー1行 + 最新100行 を残す
      sheet.deleteRows(2, deleteCount);
    }
  } catch (e) {
    Logger.log('ログ書き込みエラー: ' + e.message);
  }
}

/**
 * PDFフォールバック: 従来のDrive PDF解析で翌日シフトを取得
 * 複数PDFがある場合は全ファイルのデータを結合して返す
 */
function getShiftsFromPdfFallback_(tomorrow) {
  var pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) return [];

  var allShiftData = [];

  for (var i = 0; i < pdfFiles.length; i++) {
    var pdfFile = pdfFiles[i];
    Logger.log('PDFフォールバック処理中: ' + pdfFile.getName());

    var shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) continue;

    var shiftData = parseShiftData(shiftText, tomorrow, pdfFile);
    if (shiftData.length === 0) continue;

    // 全PDFのデータを結合
    allShiftData = allShiftData.concat(shiftData);
    // 処理済みPDFをゴミ箱に移動
    trashPdfFile(pdfFile);
  }

  // 開始時間順でソート
  allShiftData.sort(function(a, b) { return a.start.localeCompare(b.start); });
  return allShiftData;
}

// ============================================================
// ユーティリティ
// ============================================================

/**
 * Date を YYYY-MM-DD 形式に変換
 */
function formatDateToISO_(d) {
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
}

/**
 * テスト用 - 手動実行でPDF解析結果を確認
 */
function testParsePdf() {
  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    Logger.log('PDFなし');
    return;
  }

  for (var i = 0; i < pdfFiles.length; i++) {
    var pdfFile = pdfFiles[i];
    Logger.log('--- ' + pdfFile.getName() + ' ---');

    var text = extractTextFromPdf(pdfFile);
    if (!text) {
      Logger.log('テキスト抽出失敗');
      continue;
    }
    Logger.log('抽出テキスト:\n' + text);

    var tomorrow = getTomorrow();
    var allShifts = parseAllShiftsFromPdf_(pdfFile, text);
    Logger.log('全シフトデータ: ' + JSON.stringify(allShifts, null, 2));

    var data = parseShiftData(text, tomorrow, pdfFile);
    Logger.log('翌日シフトデータ: ' + JSON.stringify(data, null, 2));

    var result = buildReminderMessage(data, tomorrow);
    Logger.log('送信メッセージ:\n' + result.messageText);
  }
}

/**
 * テスト用 - Sheets読み取りを確認
 */
function testSheetsRead() {
  loadStaffMappingFromSheets_();
  Logger.log('STAFF_MAPPING: ' + JSON.stringify(STAFF_MAPPING));

  var tomorrow = getTomorrow();
  var tomorrowISO = formatDateToISO_(tomorrow.dateObj);
  var data = getShiftsFromSheets_(tomorrowISO);
  Logger.log('翌日シフト (' + tomorrowISO + '): ' + JSON.stringify(data, null, 2));
}

/**
 * タイムトリガーを設定する（初回のみ手動実行）
 */
function setupTrigger() {
  // 既存のmainトリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 毎日12:00に実行するトリガーを作成
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .nearMinute(0)
    .inTimezone(TIMEZONE)
    .create();

  Logger.log('トリガー設定完了: 毎日12:00 (JST)');
}

/**
 * 前月のシフトデータを削除する（毎月1日に自動実行）
 */
function triggerDeleteLastMonthShifts() {
  Logger.log('=== 前月シフト削除 開始 ===');

  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const targetYear = lastMonth.getFullYear();
  const targetMonth = lastMonth.getMonth(); // 0-indexed

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    Logger.log('シフトシートが見つかりません');
    return;
  }

  const data = sheet.getDataRange().getValues();
  let deleteCount = 0;

  // 後ろから削除（行ずれ防止）
  for (let i = data.length - 1; i >= 1; i--) {
    const rawDate = data[i][0];
    if (!rawDate) continue;
    const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (isNaN(d.getTime())) continue;

    if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
      sheet.deleteRow(i + 1);
      deleteCount++;
    }
  }

  const label = targetYear + '年' + (targetMonth + 1) + '月';
  Logger.log(label + ' のシフトデータを ' + deleteCount + ' 件削除しました。');
  writeLogToSheets_(label, deleteCount, 'auto', 'success', '前月シフト自動削除');

  Logger.log('=== 前月シフト削除 完了 ===');
}

/**
 * シフト不足アラートを送信する (5日後対象)
 */
function checkAndSendShortageAlert_() {
  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + SHIFT_SHORTAGE_ALERT_DAYS); // 5日後

  Logger.log('シフト不足チェック対象日: ' + formatDateToISO_(targetDate));

  const shortageSlots = checkShiftShortageForDate(targetDate);

  if (shortageSlots.length > 0) {
    const dateStr = Utilities.formatDate(targetDate, TIMEZONE, 'M月d日(E)'); // 例: 2月19日(水)

    let msg = '🚨 【シフト不足のお知らせ】\n';
    msg += dateStr + ' のシフトが不足しています！\n\n';
    msg += '不足時間帯: ' + shortageSlots.join(', ') + '\n';
    msg += '該当するスタッフの方はご協力をお願いします！';

    sendLineWorksGroupMessage(msg);
    Logger.log('シフト不足アラート送信: ' + dateStr);
  } else {
    Logger.log('シフト不足なし');
  }
}

// ============================================================
// スプレッドシートメニューから呼び出す関数
// ============================================================

/**
 * メニュー: PDF解析 → シート取込
 * DriveフォルダのPDFを解析し、シフトデータを「シフト」シートに書き込む
 */
function menuParsePdf() {
  const ui = SpreadsheetApp.getUi();

  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    ui.alert('PDFが見つかりません', 'Driveフォルダ内にPDFファイルがありません。', ui.ButtonSet.OK);
    return;
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SHIFTS);
    sheet.getRange(1, 1, 1, 8).setValues([['日付', '曜日', 'スタッフ名', '開始時刻', '終了時刻', '業務内容', '登録日時', '登録元']]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  // 重複チェック用の既存データを取得
  const existingData = sheet.getDataRange().getValues();
  const shiftCache = new Set();
  for (let j = 1; j < existingData.length; j++) {
    const d = existingData[j][0] instanceof Date ? formatDateToISO_(existingData[j][0]) : String(existingData[j][0]);
    const name = String(existingData[j][2]).trim();
    const startTime = formatCellTime_(existingData[j][3]);

    // キー: 日付|名前|開始時刻
    const key = d + '|' + name + '|' + startTime;
    shiftCache.add(key);
  }

  let totalImported = 0;
  let totalSkipped = 0;
  let registeredCountTotal = 0;
  let processedFileNames = [];

  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfFile = pdfFiles[i];
    const fileName = pdfFile.getName();
    Logger.log('--- PDF処理開始: ' + fileName + ' ---');

    const shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) {
      Logger.log('テキスト抽出失敗: ' + fileName);
      continue;
    }

    // テキストから全日付ブロックを抽出
    const allShifts = parseAllShiftsFromPdf_(pdfFile, shiftText);
    let fileImported = 0;
    let fileSkipped = 0;

    // カレンダー登録（重複はカレンダー側でもチェックされる）
    const calendarCount = registerShiftsToCalendar(allShifts);
    registeredCountTotal += calendarCount;

    for (const entry of allShifts) {
      const dateStr = entry.date;
      const dayOfWeek = entry.dayOfWeek;

      for (const staff of entry.shifts) {
        // 重複チェック
        const key = dateStr + '|' + staff.name + '|' + staff.start;
        if (shiftCache.has(key)) {
          fileSkipped++;
          continue;
        }

        const tasks = staff.tasks.length > 0 ? staff.tasks.join(' / ') : '';
        sheet.appendRow([
          dateStr,
          dayOfWeek,
          staff.name,
          staff.start,
          staff.end,
          tasks,
          new Date(),
          'pdf_import'
        ]);
        shiftCache.add(key);
        fileImported++;
      }
    }

    // 処理済みファイルをゴミ箱へ
    pdfFile.setTrashed(true);
    processedFileNames.push(fileName);

    totalImported += fileImported;
    totalSkipped += fileSkipped;
    Logger.log('結果: ' + fileName + ' -> 新規:' + fileImported + '件, 重複スキップ:' + fileSkipped + '件');
  }

  // 結果表示
  if (processedFileNames.length > 0) {
    let msg = processedFileNames.length + ' 個のファイルを処理し、ゴミ箱へ移動しました。\n\n';
    msg += '・新規取込: ' + totalImported + ' 件\n';
    msg += '・重複のためスキップ: ' + totalSkipped + ' 件\n';
    msg += '・カレンダー登録/更新: ' + registeredCountTotal + ' 件';
    ui.alert('PDF取込結果', msg, ui.ButtonSet.OK);
  } else {
    ui.alert('処理対象なし', 'PDFファイルが見つからないか、解析に失敗しました。', ui.ButtonSet.OK);
  }
}

/**
 * PDF全文から全日付のシフトを抽出する（menuParsePdf用）
 *
 * OCRがPDFの表を列ごとに読む場合、前の日付ブロックのスタッフ名と
 * 時刻が次の日付ブロックに分断されることがある（例: 3/16問題）。
 * carryoverNames でその未ペア名前を次ブロック冒頭の時刻と繋げる。
 */
function parseAllShiftsFromText_(text) {
  const lines = normalizePdfText_(text).split('\n');
  const results = [];
  let currentBlock = null;
  let currentDateStr = null;
  let currentDayOfWeek = null;
  let carryoverNames = [];    // 前ブロックで時刻と対応できなかった名前
  let carryoverDateStr = null;
  let carryoverDayOfWeek = null;

  const flushBlock_ = function() {
    if (!currentBlock || !currentDateStr) return;
    let blockToProcess = currentBlock;

    // キャリーオーバー名前がある場合: 次ブロック先頭の時刻で補完
    if (carryoverNames.length > 0) {
      const extracted = extractLeadingTimes_(blockToProcess, carryoverNames.length);
      const pCount = Math.min(carryoverNames.length, extracted.times.length);
      if (pCount > 0) {
        const carryoverShifts = [];
        for (let ci = 0; ci < pCount; ci++) {
          carryoverShifts.push({
            name: carryoverNames[ci],
            start: extracted.times[ci].start,
            end: extracted.times[ci].end,
            tasks: extracted.times[ci].tasks
          });
        }
        Logger.log('キャリーオーバー解決: ' + carryoverDateStr + ' に ' + pCount + '名追加');
        results.push({ date: carryoverDateStr, dayOfWeek: carryoverDayOfWeek, shifts: carryoverShifts });
        blockToProcess = extracted.remainingLines; // 消費した時刻行を除いた残り
      }
      carryoverNames = [];
      carryoverDateStr = null;
      carryoverDayOfWeek = null;
    }

    const parsed = parseStaffLines(blockToProcess);
    if (parsed.shifts.length > 0) {
      results.push({ date: currentDateStr, dayOfWeek: currentDayOfWeek, shifts: parsed.shifts });
    }
    // 未ペア名前を次ブロックへ持ち越す
    if (parsed.unpairedNames.length > 0) {
      Logger.log('キャリーオーバー発生: ' + currentDateStr + ' 未ペア名前=' + parsed.unpairedNames.join(','));
      carryoverNames = parsed.unpairedNames;
      carryoverDateStr = currentDateStr;
      carryoverDayOfWeek = currentDayOfWeek;
    }
  };

  for (const line of lines) {
    const dateMatch = line.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*[（(](.)[）)]/);
    if (dateMatch) {
      flushBlock_();
      // 年のOCR誤認識補正（例: 2016 → 2026）
      var parsedYear = parseInt(dateMatch[1]);
      var currentYear = new Date().getFullYear();
      if (Math.abs(parsedYear - currentYear) >= 2) {
        Logger.log('年のOCR誤認識を補正: ' + parsedYear + ' → ' + currentYear + ' (' + dateMatch[2] + '月' + dateMatch[3] + '日)');
        parsedYear = currentYear;
      }
      currentDateStr = parsedYear + '-' + String(dateMatch[2]).padStart(2, '0') + '-' + String(dateMatch[3]).padStart(2, '0');
      currentDayOfWeek = dateMatch[4];
      currentBlock = [];
      continue;
    }
    if (currentBlock !== null) {
      currentBlock.push(line);
    }
  }
  // 最後のブロック
  flushBlock_();

  return results;
}

/**
 * メニュー: リマインド手動送信
 * 12:00基準で次のシフト日を自動判定して送信する
 * - 12:00より前 → 当日のシフトをリマインド
 * - 12:00以降 → 翌日のシフトをリマインド
 */
function menuSendReminder() {
  const ui = SpreadsheetApp.getUi();

  // スタッフマッピングを最新化
  loadStaffMappingFromSheets_();

  const now = new Date();
  const hour = parseInt(Utilities.formatDate(now, TIMEZONE, 'H'));

  let initialTarget;
  if (hour < 12) {
    // 12時前 → 当日（ただし当日が休みなら次営業日）
    const hours = getBusinessHours(now);
    initialTarget = hours ? now : findNextBusinessDay_(now);
  } else {
    // 12時以降 → 翌日以降の最初の営業日
    initialTarget = findNextBusinessDay_(now);
  }

  const targetDate = initialTarget;
  const targetISO = formatDateToISO_(targetDate);
  const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][targetDate.getDay()];
  const displayStr = targetDate.getFullYear() + '年' + (targetDate.getMonth() + 1) + '月' + targetDate.getDate() + '日（' + dayOfWeek + '）';

  const tomorrow = {
    formatted: Utilities.formatDate(targetDate, TIMEZONE, 'yyyy年MM月dd日'),
    dateObj: targetDate,
    displayStr: displayStr
  };

  // シフトデータ取得
  var shiftData = getShiftsFromSheets_(targetISO);

  if (shiftData.length === 0) {
    // PDFフォールバック
    shiftData = getShiftsFromPdfFallback_(tomorrow);
  }

  if (shiftData.length === 0) {
    ui.alert('シフトなし', displayStr + ' のシフトデータが見つかりません。\n\n「シフト」シートにデータを入力するか、PDFをアップロードしてください。', ui.ButtonSet.OK);
    return;
  }

  // 確認ダイアログ
  const confirmMsg = displayStr + ' のリマインドを送信します。\n\n' +
    'スタッフ数: ' + shiftData.length + '名\n' +
    'よろしいですか？';

  const response = ui.alert('リマインド送信確認', confirmMsg, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) {
    ui.alert('キャンセルしました。');
    return;
  }

  // 送信
  const success = sendLineWorksReminder(shiftData, tomorrow);

  writeLogToSheets_(targetISO, shiftData.length, 'manual',
    success ? 'success' : 'error',
    success ? '手動送信' : '手動送信失敗'
  );

  if (success) {
    ui.alert('送信完了', displayStr + ' のリマインドを送信しました。\n(' + shiftData.length + '名)', ui.ButtonSet.OK);
  } else {
    ui.alert('送信失敗', 'リマインドの送信に失敗しました。\nGASの実行ログを確認してください。', ui.ButtonSet.OK);
  }
}

/**
 * 設定シートの「Meetup重複通知」チェックボックスがONか判定する
 * キーが見つからない場合はON（true）を返す
 * @returns {boolean}
 */
function isMeetupNotificationEnabled_() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return true;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'Meetup重複通知') {
        return data[i][1] === true || String(data[i][1]).toUpperCase() === 'TRUE';
      }
    }
  } catch (e) {
    Logger.log('Meetup通知設定取得エラー: ' + e.message);
  }
  return true; // キーが見つからない場合はONとして扱う
}

/**
 * 週始めMeetup共有を送信する（トリガー実行用 entry point）
 * 実行推奨: 毎週月曜9時（fetchMeetupScheduleが8時に翌週データを更新した後）
 */
function triggerWeeklyMeetupShare() {
  Logger.log('=== 週次Meetup共有 実行開始 ===');

  var result = getMeetupsForWeek_();
  var meetups = result.meetups;
  var weekStart = result.weekStart;
  var weekEnd = result.weekEnd;

  if (meetups.length === 0) {
    Logger.log('今週のMeetup予定はありません');
    Logger.log('=== 週次Meetup共有 完了 ===');
    return;
  }

  var message = buildWeeklyMeetupMessage_(meetups, weekStart, weekEnd);
  var success = sendLineWorksGroupMessage(message);
  Logger.log(success ? '週次Meetup共有送信成功: ' + meetups.length + '件' : '週次Meetup共有送信失敗');
  Logger.log('=== 週次Meetup共有 完了 ===');
}

/**
 * 指定日のMeetup予定一覧をスプレッドシートから取得する
 * @param {Date} targetDate
 * @returns {Array<{ company: string, time: string, kind: string, reserveId: string|null, description: string|null, url: string|null }>}
 */
function getMeetupsForDay_(targetDate) {
  var targetISO = formatDateToISO_(targetDate);
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_MEETUP);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    var data = sheet.getDataRange().getValues();
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var dateVal = data[i][0];
      if (!dateVal) continue;
      var d = dateVal instanceof Date ? dateVal : new Date(dateVal);
      if (isNaN(d.getTime())) continue;
      if (formatDateToISO_(d) !== targetISO) continue;

      results.push({
        company: String(data[i][1]).trim(),
        time: String(data[i][2]).trim(),
        kind: String(data[i][3]).trim()
      });
    }
    return results;
  } catch (e) {
    Logger.log('getMeetupsForDay_ エラー: ' + e.message);
    return [];
  }
}

/**
 * シフト時間とMeetup時間の重複をチェックする
 * 重複条件: shiftStart < meetupEnd AND meetupStart < shiftEnd
 * @param {string} shiftStart - "HH:mm"
 * @param {string} shiftEnd   - "HH:mm"
 * @param {Array}  meetups    - getMeetupsForDay_() の戻り値
 * @returns {Array} 重複するMeetupの配列
 */
function findOverlappingMeetups_(shiftStart, shiftEnd, meetups) {
  if (!meetups || meetups.length === 0) return [];

  var shiftStartDate = stringToDate_(shiftStart);
  var shiftEndDate = stringToDate_(shiftEnd);

  return meetups.filter(function(m) {
    // "10:00 ~ 11:00" 形式をパース
    var parts = m.time.split(/\s*~\s*/);
    if (parts.length < 2) return false;
    var meetupStart = stringToDate_(parts[0].trim());
    var meetupEnd = stringToDate_(parts[1].trim());
    return shiftStartDate < meetupEnd && meetupStart < shiftEndDate;
  });
}

/**
 * メニュー: スタッフ更新
 * 「スタッフ」シートからSTAFF_MAPPINGを再読み込みする
 */
function menuRefreshStaff() {
  const ui = SpreadsheetApp.getUi();
  loadStaffMappingFromSheets_();

  const staffNames = Object.keys(STAFF_MAPPING);
  if (staffNames.length === 0) {
    ui.alert('スタッフ更新', '「スタッフ」シートにデータがありません。\n\nA列: スタッフ名、B列: LINE WORKS ID、C列: 有効(TRUE/FALSE) を入力してください。', ui.ButtonSet.OK);
    return;
  }

  let list = '';
  for (const name of staffNames) {
    list += '・' + name + ' → ' + STAFF_MAPPING[name] + '\n';
  }
  ui.alert('スタッフ更新完了', staffNames.length + '名のスタッフを読み込みました。\n\n' + list, ui.ButtonSet.OK);
}

/**
 * 既存タブのメンテナンス状態を初期化（未設定タブを明示的にfalseに設定）
 * 新しいデフォルト動作（未設定=メンテ中）導入前の既存タブを安全化するため
 * 初回のみ手動実行してください: メイン処理.gs の initMaintenanceProperties
 */
function initMaintenanceProperties() {
  var props = PropertiesService.getScriptProperties();
  var existingTabs = ['congestion', 'calendar', 'qa', 'board', 'corner'];
  existingTabs.forEach(function(tab) {
    if (props.getProperty('MAINTENANCE_' + tab) === null) {
      props.setProperty('MAINTENANCE_' + tab, 'false');
      Logger.log('初期化: MAINTENANCE_' + tab + ' = false');
    } else {
      Logger.log('スキップ（設定済み）: MAINTENANCE_' + tab + ' = ' + props.getProperty('MAINTENANCE_' + tab));
    }
  });
  Logger.log('メンテナンス初期化完了');
}
