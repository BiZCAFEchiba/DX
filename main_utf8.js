// ============================================================
// main.gs - 繧ｨ繝ｳ繝医Μ繝ｼ繝昴う繝ｳ繝茨ｼ・heets邨ｱ蜷育沿・・
// ============================================================

/**
 * 繝｡繧､繝ｳ蜃ｦ逅・- 繧ｿ繧､繝繝医Μ繧ｬ繝ｼ縺九ｉ豈取律12:00縺ｫ蜻ｼ縺ｳ蜃ｺ縺輔ｌ繧・
 *
 * 邨ｱ蜷亥ｾ後・蜍穂ｽ・
 *   2. 縲後せ繧ｿ繝・ヵ縲阪す繝ｼ繝医°繧峨・繝・ヴ繝ｳ繧ｰ繧貞叙蠕・
 *   3. LINE WORKS縺ｸ繝｡繝ｳ繧ｷ繝ｧ繝ｳ莉倥″繝ｪ繝槭う繝ｳ繝蛾∽ｿ｡
 *   4. 縲碁∽ｿ｡繝ｭ繧ｰ縲阪す繝ｼ繝医↓邨先棡繧定ｨ倬鹸
 *   5. 縲後す繝輔ヨ荳崎ｶｳ縲阪メ繧ｧ繝・け・・譌･蠕鯉ｼ峨ｒ陦後＞縲∽ｸ崎ｶｳ譎ゅ・繧｢繝ｩ繝ｼ繝磯∽ｿ｡
 *
 * 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ:
 *   Sheets縺ｫ繝・・繧ｿ縺後↑縺・ｴ蜷医・蠕捺擂騾壹ｊDrive縺ｮPDF縺九ｉ隗｣譫舌ｒ隧ｦ縺ｿ繧・
 */
/**
 * LINE WORKS縺九ｉ縺ｮCallback繝ｪ繧ｯ繧ｨ繧ｹ繝医ｒ蜃ｦ逅・☆繧・
 * @param {Object} e - POST繝ｪ繧ｯ繧ｨ繧ｹ繝医う繝吶Φ繝・
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

    // Webhook縺ｮ蛻ｰ驕斐ｒ迚ｩ逅・噪縺ｫ遒ｺ隱阪☆繧九◆繧√・蛻晄悄繝ｭ繧ｰ
    writeLogToSheets_('POST蜿嶺ｿ｡', 0, 'raw', 'info', 'doPost triggered');
    handleWebhook(e);
  } catch (err) {
    writeLogToSheets_('doPost閾ｴ蜻ｽ逧・お繝ｩ繝ｼ', 0, 'raw', 'error', err.message);
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * HTTP GET繝ｪ繧ｯ繧ｨ繧ｹ繝医ｒ蜃ｦ逅・☆繧・
 * ?page=yuchi 縺ｧ隱倩・繝輔か繝ｼ繝繧定｡ｨ遉ｺ
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

  // --- 蟷ｹ驛ｨ邂｡逅・ebApp ---
  if (param.page === 'kanbu') {
    var kanbuTemplate = HtmlService.createTemplateFromFile('蟷ｹ驛ｨ邂｡逅・);
    kanbuTemplate.appUrl = ScriptApp.getService().getUrl();
    return kanbuTemplate.evaluate()
      .setTitle('蟷ｹ驛ｨ邂｡逅・| BizCAFE')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // --- 髢ｲ隕ｧ謨ｰ繝繝・す繝･繝懊・繝会ｼ医せ繧ｿ繝・ヵ逕ｨ・・---
  if (param.page === 'analytics') {
    var analyticsTemplate = HtmlService.createTemplateFromFile('髢ｲ隕ｧ謨ｰ繝繝・す繝･繝懊・繝・);
    analyticsTemplate.appUrl = ScriptApp.getService().getUrl();
    return analyticsTemplate.evaluate()
      .setTitle('髢ｲ隕ｧ謨ｰ繝繝・す繝･繝懊・繝・| BizCAFE')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // --- 隱倩・繝輔か繝ｼ繝 ---
  if (param.page === 'yuchi') {
    var template = HtmlService.createTemplateFromFile('隱倩・繝輔か繝ｼ繝');
    template.staffName = param.name || '';
    template.preselected = param.companies || '';
    return template.evaluate()
      .setTitle('隱倩・諠・ｱ蜈･蜉・)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // --- 縺雁ｮ｢讒伜髄縺大霧讌ｭ繧ｫ繝ｬ繝ｳ繝繝ｼ ---
  if (param.page === 'calendar') {
    // JSON繝・・繧ｿAPI繝｢繝ｼ繝会ｼ医き繝ｬ繝ｳ繝繝ｼ・・
    if (param.action === 'data') {
      var year    = parseInt(param.year)  || new Date().getFullYear();
      var month   = parseInt(param.month) || (new Date().getMonth() + 1);
      var nocache = param.nocache === '1';
      var data    = getCustomerCalendarData_(year, month, nocache);
      var output  = ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
      return output;
    }
    // JSON繝・・繧ｿAPI繝｢繝ｼ繝会ｼ域欠螳壽律縺ｮMeetup荳隕ｧ・・
    if (param.action === 'meetups') {
      var meetupDate = param.date || '';
      var meetups = getMeetupsForCustomer_(meetupDate);
      return ContentService.createTextOutput(JSON.stringify(meetups))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 迴ｾ蝨ｨ縺ｮ蝟ｶ讌ｭ迥ｶ豕・ｼ亥霧讌ｭ荳ｭ繝ｻLO蠕後・蝟ｶ讌ｭ譎る俣螟厄ｼ峨ｒ霑斐☆
    if (param.action === 'businessStatus') {
      var now = new Date();
      var hours = getBusinessHours(now);
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var status = 'closed'; // 繝・ヵ繧ｩ繝ｫ繝・ 螳壻ｼ第律 or 譎る俣螟・
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
          status = 'lo'; // LO蠕後・髢牙ｺ怜燕
        } else {
          status = 'outside'; // 髢句ｺ怜燕 or 髢牙ｺ怜ｾ・
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
    // 豺ｷ髮醍憾豕∝叙蠕・
    if (param.action === 'congestion') {
      var props = PropertiesService.getScriptProperties();
      var level = parseInt(props.getProperty('CONGESTION_LEVEL') || '0');
      var updatedAt = props.getProperty('CONGESTION_UPDATED_AT') || '';
      // 譌･莉倥′螟峨ｏ縺｣縺ｦ縺・◆繧画悴遒ｺ隱搾ｼ・・峨↓繝ｪ繧ｻ繝・ヨ
      var todayStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
      if (updatedAt && updatedAt.slice(0, 10) !== todayStr) {
        level = 0;
        props.setProperty('CONGESTION_LEVEL', '0');
      }
      return ContentService.createTextOutput(JSON.stringify({ level: level, updatedAt: updatedAt }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Q&A繝ｪ繧ｹ繝亥叙蠕・
    if (param.action === 'qaList') {
      var includeHidden = param.staff === '1';
      return ContentService.createTextOutput(JSON.stringify(getFAQList_(includeHidden)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Q&A雉ｪ蝠乗兜遞ｿ・磯｡ｧ螳｢逕ｨ・・
    if (param.action === 'qaSubmit') {
      var result = submitQuestion_(param.question || '');
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Q&A菫晏ｭ假ｼ医せ繧ｿ繝・ヵ逕ｨ・・
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
    // Q&A蜑企勁・医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'qaDelete') {
      var result = deleteFAQItem_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 謗ｲ遉ｺ譚ｿ荳隕ｧ蜿門ｾ・
    if (param.action === 'boardList') {
      return ContentService.createTextOutput(JSON.stringify(getBoardList_({
        includeUnpublished: param.staff === '1',
        placement: param.placement || '',
        limit: param.limit || ''
      }))).setMimeType(ContentService.MimeType.JSON);
    }
    // 謗ｲ遉ｺ譚ｿ隧ｳ邏ｰ蜿門ｾ・
    if (param.action === 'boardDetail') {
      var boardItem = getBoardItem_(param.id || '', param.staff === '1');
      return ContentService.createTextOutput(JSON.stringify(boardItem || { ok: false, error: 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action === 'articleViewCountIncrement') {
      return ContentService.createTextOutput(JSON.stringify(incrementArticleViewCount_(param.articleId || '')))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 謗ｲ遉ｺ譚ｿ菫晏ｭ・
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
    // 謗ｲ遉ｺ譚ｿ蜑企勁
    if (param.action === 'boardDelete') {
      var deleteResult = deleteBoardItem_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(deleteResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繧ｳ繝ｼ繝翫・雉ｪ蝠丈ｸ隕ｧ
    if (param.action === 'cornerQuestionList') {
      return ContentService.createTextOutput(JSON.stringify(getCornerQuestionList_(param.staff === '1')))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繧ｳ繝ｼ繝翫・雉ｪ蝠剰ｩｳ邏ｰ
    if (param.action === 'cornerQuestionDetail') {
      var cornerQuestion = getCornerQuestionDetail_(param.id || '', param.staff === '1');
      return ContentService.createTextOutput(JSON.stringify(cornerQuestion || { ok: false, error: 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // customer 蛛ｴ繧ｳ繝ｼ繝翫・雉ｪ蝠乗兜遞ｿ
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
    // staff 蛛ｴ繧ｳ繝ｼ繝翫・雉ｪ蝠乗峩譁ｰ
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
    // staff 蛛ｴ繧ｳ繝ｼ繝翫・雉ｪ蝠丞炎髯､
    if (param.action === 'cornerQuestionDelete') {
      var questionDeleteResult = deleteCornerQuestion_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(questionDeleteResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繧ｳ繝ｼ繝翫・陦ｨ遉ｺ繧ｳ繝ｳ繝・Φ繝・叙蠕・
    if (param.action === 'cornerContentGet') {
      return ContentService.createTextOutput(JSON.stringify(getCornerContent_(param.staff === '1')))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // staff 逕ｨ繧ｳ繝ｼ繝翫・繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ菫晏ｭ・
    if (param.action === 'cornerContentSave') {
      var cornerContentResult = saveCornerSection_(param.section || '', param.data || '');
      return ContentService.createTextOutput(JSON.stringify(cornerContentResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 蜿ょ刈蝙九さ繝ｼ繝翫・謚慕･ｨ
    if (param.action === 'cornerParticipationVote') {
      var participationVoteResult = voteCornerParticipation_(param.themeId || '', param.optionId || '');
      return ContentService.createTextOutput(JSON.stringify(participationVoteResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // customer 蛛ｴ繝壹・繧ｸ髢ｲ隕ｧ謨ｰ縺ｮ險倬鹸
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
    // staff 蛛ｴ髢ｲ隕ｧ謨ｰ遒ｺ隱・
    if (param.action === 'pageViewGet') {
      return ContentService.createTextOutput(JSON.stringify(getCornerPageViews_()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action === 'pageViewReset') {
      var pageViewResetResult = resetCornerPageViews_();
      return ContentService.createTextOutput(JSON.stringify(pageViewResetResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 豺ｷ髮醍憾豕∵峩譁ｰ・医せ繧ｿ繝・ヵ逕ｨ・・
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
    // 繝｡繝ｳ繝・リ繝ｳ繧ｹ迥ｶ諷句叙蠕・
    // tabs=id1,id2,... 縺ｧ繧ｿ繝蜂D繧呈欠螳夲ｼ域欠螳壹↑縺励・蝣ｴ蜷医・蜈ｨMAINTENANCE_*繝励Ο繝代ユ繧｣繧定ｿ斐☆・・
    // 譛ｪ險ｭ螳壹ち繝悶・繝・ヵ繧ｩ繝ｫ繝医〒繝｡繝ｳ繝・ｸｭ・・rue・・
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
    // 繝｡繝ｳ繝・リ繝ｳ繧ｹ迥ｶ諷玖ｨｭ螳夲ｼ医ち繝蜂D縺ｮ蛻ｶ髯舌↑縺暦ｼ・
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
    // 繝ｫ繝ｼ繝莠育ｴ・ 遨ｺ縺咲憾豕∝叙蠕・
    if (param.action === 'roomAvailability') {
      var roomAvail = getRoomAvailability_(param.date || '');
      return ContentService.createTextOutput(JSON.stringify(roomAvail))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 莠育ｴ・ｽ懈・
    if (param.action === 'roomReserve') {
      var roomReserveResult = reserveRoom_(param);
      return ContentService.createTextOutput(JSON.stringify(roomReserveResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 繧ｭ繝｣繝ｳ繧ｻ繝ｫ・磯｡ｧ螳｢縺御ｺ育ｴИD縺ｮ縺ｿ縺ｧ螳溯｡鯉ｼ・
    if (param.action === 'roomCancel') {
      var roomCancelResult = cancelRoom_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(roomCancelResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 繝√ぉ繝・け繧､繝ｳ
    if (param.action === 'roomCheckIn') {
      var roomCheckInResult = checkInRoom_(param.id || '', param.contact || '', param.staff === '1');
      return ContentService.createTextOutput(JSON.stringify(roomCheckInResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 荳隕ｧ蜿門ｾ暦ｼ医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'roomList') {
      var roomListResult = getRoomList_(param.date || '');
      return ContentService.createTextOutput(JSON.stringify(roomListResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 繧ｹ繝・・繧ｿ繧ｹ譖ｴ譁ｰ・医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'roomStatusUpdate') {
      var roomStatusResult = updateRoomStatus_(param.id || '', param.status || '', param.memo || '');
      return ContentService.createTextOutput(JSON.stringify(roomStatusResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 繝√ぉ繝・け繧､繝ｳ繝｢繝ｼ繝牙叙蠕・險ｭ螳・
    if (param.action === 'roomCheckinMode') {
      if (param.set) {
        var roomCheckinSetResult = setRoomCheckinMode_(param.set);
        return ContentService.createTextOutput(JSON.stringify(roomCheckinSetResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, mode: getRoomCheckinMode_() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 閾ｪ蛻・・莠育ｴ・ｸ隕ｧ・磯｡ｧ螳｢逕ｨ・・
    if (param.action === 'roomMyReservations') {
      var roomMyResult = getMyRoomReservations_(param.contact || '');
      return ContentService.createTextOutput(JSON.stringify(roomMyResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 蛻ｩ逕ｨ閠・ｸ隕ｧ・医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'roomUserList') {
      var roomUserListResult = getRoomUserList_();
      return ContentService.createTextOutput(JSON.stringify(roomUserListResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ 蛻ｩ逕ｨ閠・峩譁ｰ・医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'roomUserUpdate') {
      var roomUserUpdateResult = updateRoomUser_(
        param.contact || '',
        param.restricted === 'true',
        param.resetCount === 'true'
      );
      return ContentService.createTextOutput(JSON.stringify(roomUserUpdateResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 遏･繧九ヱ繧ｹID逋ｺ陦鯉ｼ医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'shiruPassIssue') {
      var issueResult = issueShiruPassId_(param.note || '');
      return ContentService.createTextOutput(JSON.stringify(issueResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 遏･繧九ヱ繧ｹID讀懆ｨｼ・磯｡ｧ螳｢逕ｨ・・
    if (param.action === 'shiruPassValidate') {
      var validateResult = validateShiruPassId_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(validateResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 遏･繧九ヱ繧ｹID荳隕ｧ・医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'shiruPassList') {
      var listResult = getShiruPassList_();
      return ContentService.createTextOutput(JSON.stringify(listResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 遏･繧九ヱ縺僮D譖ｴ譁ｰ・医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'shiruPassRenew') {
      var renewResult = renewShiruPassId_(param.id || '');
      return ContentService.createTextOutput(JSON.stringify(renewResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 遏･繧九ヱ繧ｹID譛牙柑譌･謨ｰ 蜿門ｾ・險ｭ螳夲ｼ医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'shiruPassValidDays') {
      if (param.set) {
        var setDaysResult = setShiruPassValidDays_(param.set);
        return ContentService.createTextOutput(JSON.stringify(setDaysResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, days: getShiruPassValidDays_() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繝ｫ繝ｼ繝莠育ｴ・ｸ企剞譎る俣 蜿門ｾ・險ｭ螳夲ｼ医せ繧ｿ繝・ヵ逕ｨ・・
    if (param.action === 'roomMaxHours') {
      if (param.set) {
        var setHoursResult = setRoomMaxHours_(param.set);
        return ContentService.createTextOutput(JSON.stringify(setHoursResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, hours: getRoomMaxHours_() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 蠎苓・繝溘・繝・ぅ繝ｳ繧ｰ荳隕ｧ・医せ繧ｿ繝・ヵ繧｢繝励Μ逕ｨ・・
    if (param.action === 'getMeetings') {
      return ContentService.createTextOutput(JSON.stringify(kanbuGetMeetings_()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 蜿ょ刈迥ｶ豕∝叙蠕暦ｼ医せ繧ｿ繝・ヵ繧｢繝励Μ逕ｨ・・
    if (param.action === 'getMeetingAttendance') {
      return ContentService.createTextOutput(JSON.stringify(kanbuGetAttendance_(param.date || '')))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 繧ｹ繧ｿ繝・ヵ蜷堺ｸ隕ｧ・医せ繧ｿ繝・ヵ繧｢繝励Μ逕ｨ・・
    if (param.action === 'getStaffList') {
      return ContentService.createTextOutput(JSON.stringify(kanbuGetStaffList_()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // 蠎苓・騾ｲ謐暦ｼ・igQuery・・
    if (param.action === 'storeProgress') {
      var spStore = param.store || 'BiZCAFE・亥鴻闡牙､ｧ蟄ｦ・牙ｺ・;
      // yearmonths="2026-12,2027-01" 蠖｢蠑擾ｼ亥ｹｴ縺ｾ縺溘℃蟇ｾ蠢懶ｼ・
      var spYM = param.yearmonths ? param.yearmonths.split(',') : [];
      if (!spYM.length) {
        // 譌ｧ蠖｢蠑上ヵ繧ｩ繝ｼ繝ｫ繝舌ャ繧ｯ
        var spYear = parseInt(param.year) || new Date().getFullYear();
        var spMon  = param.months ? param.months.split(',').map(Number) : [new Date().getMonth() + 1];
        spYM = spMon.map(function(m) { return spYear + '-' + (m < 10 ? '0' + m : m); });
      }
      var spResult = getStoreProgress(spYM, spStore);
      return ContentService.createTextOutput(JSON.stringify(spResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (param.action === 'kpiDailyGet') {
      var kpiStore = param.store || 'BiZCAFE・亥鴻闡牙､ｧ蟄ｦ・牙ｺ・;
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
    // HTML繝壹・繧ｸ繝｢繝ｼ繝・
    var calTemplate = HtmlService.createTemplateFromFile('鬘ｧ螳｢繧ｫ繝ｬ繝ｳ繝繝ｼ');
    calTemplate.appUrl = ScriptApp.getService().getUrl();
    return calTemplate.evaluate()
      .setTitle('蝟ｶ讌ｭ繧ｫ繝ｬ繝ｳ繝繝ｼ | BizCAFE 蜊・痩螟ｧ蟄ｦ蠎・)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return ContentService.createTextOutput('Shift Reminder Bot is active.');
}

/**
 * 鄙梧律縺ｮ繧ｷ繝輔ヨ繝ｪ繝槭う繝ｳ繝峨ｒ騾∽ｿ｡縺吶ｋ・医ヨ繝ｪ繧ｬ繝ｼ螳溯｡檎畑 entry point・・
 * 螳溯｡梧耳螂ｨ譎る俣: 12:00鬆・
 */
function triggerShiftReminder() {
  initChannelId_();
  Logger.log('=== 繧ｷ繝輔ヨ繝ｪ繝槭う繝ｳ繝・螳溯｡碁幕蟋・===');

  const now = new Date();

  // 蝨滓屆繝ｻ譌･譖懊・繧ｹ繧ｭ繝・・・磯≡譖懊↓譛域屆蛻・ｒ騾∽ｿ｡貂医∩縺ｮ縺溘ａ・・
  const todayDow = now.getDay(); // 0=譌･, 6=蝨・
  if (todayDow === 0 || todayDow === 6) {
    Logger.log('蝨滓律縺ｮ縺溘ａ繧ｷ繝輔ヨ繝ｪ繝槭う繝ｳ繝峨ｒ繧ｹ繧ｭ繝・・縺励∪縺吶・);
    return;
  }

  const nextBusinessDay = findNextBusinessDay_(now);
  const targetISO = formatDateToISO_(nextBusinessDay);
  const targetDisplay = Utilities.formatDate(nextBusinessDay, TIMEZONE, 'M譛・譌･(E)');

  Logger.log('谺｡蝟ｶ讌ｭ譌･蛻､螳・ ' + targetDisplay + ' (' + targetISO + ')');

  // 莉頑律縺悟ｮ壻ｼ第律縺ｮ蝣ｴ蜷医〒繧ゅ∵ｬ｡蝟ｶ讌ｭ譌･縺ｮ繝ｪ繝槭う繝ｳ繝峨ｒ騾√ｋ
  // 縺溘□縺励∵里縺ｫ縺昴・譌･蜷代￠縺ｫ騾∽ｿ｡貂医∩縺ｮ蝣ｴ蜷医・繧ｹ繧ｭ繝・・
  if (isAlreadySent_(targetISO, 'auto')) {
    Logger.log(targetDisplay + ' 蜷代￠縺ｮ繝ｪ繝槭う繝ｳ繝峨・騾∽ｿ｡貂医∩縺ｮ縺溘ａ繧ｹ繧ｭ繝・・縺励∪縺吶・);
    return;
  }

  // 莉頑律縺悟霧讌ｭ譌･縲√°縺､繧ｿ繝ｼ繧ｲ繝・ヨ縺梧・譌･縺ｧ縺ｪ縺・ｴ蜷茨ｼ茨ｼ晞｣莨大燕・峨・縺ｿ譌ｩ譛滄∽ｿ｡
  // 縺ｾ縺溘・縲∽ｻ頑律縺悟ｮ壻ｼ第律縺ｮ蝣ｴ蜷医・繧ｿ繝ｼ繧ｲ繝・ヨ縺ｫ蜷代￠縺ｦ騾∽ｿ｡
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowISO = formatDateToISO_(tomorrow);

  // --- Step 1: Sheets縺九ｉ繧ｷ繝輔ヨ繝・・繧ｿ繧貞叙蠕・---
  let shiftData = getShiftsFromSheets_(targetISO);

  // --- Step 2: Sheets縺ｫ繝・・繧ｿ縺後↑縺代ｌ縺ｰ縲￣DF縺九ｉ蠕捺擂譁ｹ蠑上〒繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ ---
  if (shiftData.length === 0) {
    Logger.log('Sheets縺ｫ繧ｷ繝輔ヨ繝・・繧ｿ縺ｪ縺励１DF繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ繧定ｩｦ陦・..');
    shiftData = getShiftsFromPdfFallback_(tomorrow);
  }

  if (shiftData.length === 0) {
    var errorMsg = '鄙梧律・・ + targetDisplay + '・峨・繧ｷ繝輔ヨ諠・ｱ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ縺ｧ縺励◆縲・;
    Logger.log(errorMsg);
    writeLogToSheets_(tomorrowISO, 0, 'auto', 'skip', '繧ｷ繝輔ヨ繝・・繧ｿ縺ｪ縺・);
    // 驥崎ｦ・ｼ壹ョ繝ｼ繧ｿ縺後↑縺・ｴ蜷医・騾夂衍縺励※豌嶺ｻ倥°縺帙ｋ
    // notifyError(errorMsg); 
    Logger.log('=== 繝ｪ繝槭う繝ｳ繝蛾∽ｿ｡ 邨ゆｺ・===');
    return;
  }

  Logger.log('繧ｷ繝輔ヨ諠・ｱ蜿門ｾ・ ' + shiftData.length + '蜷・);

  // --- Step 2.5: 譛ｬ譌･縺ｮ遒ｺ隱咲憾豕√ｒ繝ｪ繧ｻ繝・ヨ・磯㍾隍・亟豁｢・・---
  resetAcknowledgment_(targetISO);

  // --- Step 2.6: Meetup驥崎､・メ繧ｧ繝・け・亥ｯｾ髱｢髢句ぎ縺ｮ縺ｿ縲∬ｨｭ螳唹N縺ｮ蝣ｴ蜷茨ｼ・---
  if (isMeetupNotificationEnabled_()) {
    var dayMeetups = getMeetupsForDay_(nextBusinessDay);
    // 蟇ｾ髱｢繝ｻ雋ｸ蛻・・縺ｿ縺ｫ邨槭ｊ霎ｼ繧・医が繝ｳ繝ｩ繧､繝ｳ髯､螟厄ｼ・
    var inPersonMeetups = dayMeetups.filter(function(m) {
      return m.kind && (m.kind.indexOf('蟇ｾ髱｢') !== -1 || m.kind.indexOf('雋ｸ蛻・) !== -1);
    });
    if (inPersonMeetups.length > 0) {
      Logger.log('蠖捺律蟇ｾ髱｢Meetup莉ｶ謨ｰ: ' + inPersonMeetups.length);
      shiftData = shiftData.map(function(staff) {
        var overlapping = findOverlappingMeetups_(staff.start, staff.end, inPersonMeetups);
        if (overlapping.length > 0) {
          Logger.log('Meetup驥崎､・ ' + staff.name + ' 竊・' + overlapping.length + '莉ｶ');
          return { name: staff.name, start: staff.start, end: staff.end, tasks: staff.tasks, meetups: overlapping };
        }
        return staff;
      });
    }
  } else {
    Logger.log('Meetup驥崎､・夂衍: OFF・郁ｨｭ螳壹す繝ｼ繝医〒辟｡蜉ｹ蛹悶＆繧後※縺・∪縺呻ｼ・);
  }

  // --- Step 3: LINE WORKS縺ｫ繝ｪ繝槭う繝ｳ繝蛾∽ｿ｡ ---
  var tomorrowParams = {
    displayStr: targetDisplay,
    dateObj: nextBusinessDay
  };
  var success = sendLineWorksReminder(shiftData, tomorrowParams);

  // --- Step 3.5: Meetup繧｢繝ｩ繝ｼ繝磯∽ｿ｡・亥ｯｾ髱｢繝ｻ雋ｸ蛻・ｼ・---
  if (success) {
    sendMeetupAlertAfterReminder_(nextBusinessDay, shiftData);
  }

  // --- Step 4: 騾∽ｿ｡繝ｭ繧ｰ繧定ｨ倬鹸 ---
  writeLogToSheets_(targetISO, shiftData.length, 'auto',
    success ? 'success' : 'error',
    success ? '豁｣蟶ｸ騾∽ｿ｡' : '騾∽ｿ｡螟ｱ謨・
  );

  if (!success) {
    notifyError('繝ｪ繝槭う繝ｳ繝蛾∽ｿ｡縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲・n蟇ｾ雎｡譌･: ' + tomorrow.displayStr);
  }

  Logger.log('=== 繝ｪ繝槭う繝ｳ繝蛾∽ｿ｡ 螳御ｺ・===');
}

/**
 * 繧ｷ繝輔ヨ繝ｪ繝槭う繝ｳ繝蛾∽ｿ｡蠕後↓縲∫ｿ悟霧讌ｭ譌･縺ｮ蟇ｾ髱｢繝ｻ雋ｸ蛻⑭eetup繧｢繝ｩ繝ｼ繝医ｒ騾∽ｿ｡縺吶ｋ
 * @param {Date}  targetDate - 鄙悟霧讌ｭ譌･
 * @param {Array} shiftData  - getShiftsFromSheets_ 縺ｮ謌ｻ繧雁､
 */
function sendMeetupAlertAfterReminder_(targetDate, shiftData) {
  var dayMeetups = getMeetupsForDay_(targetDate);
  if (!dayMeetups || dayMeetups.length === 0) return;

  var inPersonMeetups = dayMeetups.filter(function(m) { return m.kind && m.kind.indexOf('蟇ｾ髱｢') !== -1; });
  var kasshikiMeetups = dayMeetups.filter(function(m) { return m.kind && m.kind.indexOf('雋ｸ蛻・) !== -1; });

  if (inPersonMeetups.length === 0 && kasshikiMeetups.length === 0) return;

  var mappings = loadStaffMappingFromSheets_();
  var sendMap = mappings ? mappings.send : {};
  var token = getLineWorksAccessToken();
  if (!token) {
    Logger.log('sendMeetupAlertAfterReminder_: 繝医・繧ｯ繝ｳ蜿門ｾ怜､ｱ謨・);
    return;
  }
  var url = LINEWORKS_API_BASE + '/bots/' + LINEWORKS_BOT_ID + '/channels/' + LINEWORKS_CHANNEL_ID + '/messages';

  /**
   * 繝｡繝ｳ繧ｷ繝ｧ繝ｳ莉倥″繝√Ε繝ｳ繝阪Ν繝｡繝・そ繝ｼ繧ｸ繧帝∽ｿ｡縺吶ｋ繝倥Ν繝代・
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
      Logger.log('Meetup繧｢繝ｩ繝ｼ繝磯∽ｿ｡: ' + code + ' ' + text.substring(0, 30));
      return code === 200 || code === 201;
    } catch (e) {
      Logger.log('Meetup繧｢繝ｩ繝ｼ繝磯∽ｿ｡繧ｨ繝ｩ繝ｼ: ' + e.message);
      return false;
    }
  }

  // 竭｡ 蟇ｾ髱｢Meetup: 莨∵･ｭ縺斐→縺ｫ縲∵凾髢薙′驥崎､・☆繧九せ繧ｿ繝・ヵ縺ｫ繝｡繝ｳ繧ｷ繝ｧ繝ｳ
  inPersonMeetups.forEach(function(meetup) {
    var overlapping = shiftData.filter(function(staff) {
      return findOverlappingMeetups_(staff.start, staff.end, [meetup]).length > 0;
    });
    if (overlapping.length === 0) return;

    var text = '閥 蟇ｾ髱｢Meetup蟇ｾ蠢懊ｒ縺企｡倥＞縺励∪縺呻ｼ―n';
    text += '縲・ + meetup.company + '縲・ + meetup.time + '\n';
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
    text += '\n莨∵･ｭ蟇ｾ蠢懊ｈ繧阪＠縺上♀鬘倥＞縺励∪縺咀泗・;
    sendChannelMention(text, mentioned);
  });

  // 竭｡ 蟶ｭ遒ｺ菫昴Μ繝槭う繝ｳ繝・ 譛ｬ譌･繧ｷ繝輔ヨ縺ｮ譛邨ゅせ繧ｿ繝・ヵ・磯蜍､縺梧怙繧る≦縺・ｺｺ・峨↓鄙梧律縺ｮ蟇ｾ髱｢Meetup蟶ｭ遒ｺ菫昴ｒ萓晞ｼ
  var todayISO = formatDateToISO_(new Date());
  var todayShifts = getShiftsFromSheets_(todayISO);
  if (todayShifts && todayShifts.length > 0 && inPersonMeetups.length > 0) {
    var lastStaff = todayShifts.reduce(function(prev, curr) {
      return curr.end > prev.end ? curr : prev;
    }, todayShifts[0]);

    var seatText = 'ｪ・蟶ｭ遒ｺ菫昴・縺企｡倥＞\n';
    var targetDisplay = Utilities.formatDate(targetDate, TIMEZONE, 'M譛・譌･(E)');
    seatText += targetDisplay + '縺ｮ蟇ｾ髱｢Meetup縺ｮ蟶ｭ遒ｺ菫昴ｒ縺企｡倥＞縺励∪縺咀泗十n\n';
    inPersonMeetups.forEach(function(m) {
      seatText += '繝ｻ縲・ + m.company + '縲・ + m.time + '\n';
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

  // 竭｢ 雋ｸ蛻⑭eetup: 繧､繝吶Φ繝医＃縺ｨ縺ｫ縲∵凾髢薙′驥崎､・☆繧九せ繧ｿ繝・ヵ縺ｫ繝｡繝ｳ繧ｷ繝ｧ繝ｳ
  kasshikiMeetups.forEach(function(meetup) {
    var overlapping = shiftData.filter(function(staff) {
      return findOverlappingMeetups_(staff.start, staff.end, [meetup]).length > 0;
    });
    if (overlapping.length === 0) return;

    var text = '泯 雋ｸ蛻・ｯｾ蠢懊ｒ縺企｡倥＞縺励∪縺呻ｼ―n';
    text += '縲・ + meetup.company + '縲・ + meetup.time + '\n';
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
    text += '\n雋ｸ蛻・ｯｾ蠢懊ｈ繧阪＠縺上♀鬘倥＞縺励∪縺咀泗・;
    sendChannelMention(text, mentioned);
  });
}

/**
 * 繧ｷ繝輔ヨ荳崎ｶｳ繧｢繝ｩ繝ｼ繝医ｒ騾∽ｿ｡縺吶ｋ・医ヨ繝ｪ繧ｬ繝ｼ螳溯｡檎畑 entry point・・
 * 螳溯｡梧耳螂ｨ譎る俣: 12:01鬆・
 */
function triggerShortageAlert() {
  Logger.log('=== 繧ｷ繝輔ヨ荳崎ｶｳ繧｢繝ｩ繝ｼ繝・繝√ぉ繝・け髢句ｧ・===');
  checkAndSendShortageAlert_();
  Logger.log('=== 繝√ぉ繝・け 螳御ｺ・===');
}

/**
 * 譛ｪ遒ｺ隱崎・∈縺ｮ霑ｽ縺｣縺九￠繝ｪ繝槭う繝ｳ繝峨ｒ騾∽ｿ｡縺吶ｋ・医ヨ繝ｪ繧ｬ繝ｼ螳溯｡檎畑 entry point・・
 * 螳溯｡梧耳螂ｨ譎る俣: 17:00鬆・
 */
function triggerFollowUpReminder() {
  Logger.log('=== 譛ｪ遒ｺ隱崎・∈縺ｮ霑ｽ縺｣縺九￠繝ｪ繝槭う繝ｳ繝・繝√ぉ繝・け髢句ｧ・===');

  const now = new Date();
  const nextBusinessDay = findNextBusinessDay_(now);
  const targetISO = formatDateToISO_(nextBusinessDay);
  const targetDisplay = Utilities.formatDate(nextBusinessDay, TIMEZONE, 'M譛・譌･(E)');

  Logger.log('繧ｿ繝ｼ繧ｲ繝・ヨ譌･: ' + targetDisplay + ' (' + targetISO + ')');

  // 譌｢縺ｫ繝｡繧､繝ｳ縺ｮ繝ｪ繝槭う繝ｳ繝峨′騾∽ｿ｡縺輔ｌ縺ｦ縺・↑縺・ｴ蜷医・霑ｽ縺｣縺九￠縺ｪ縺・
  if (!isAlreadySent_(targetISO, 'auto')) {
    Logger.log(targetDisplay + ' 蜷代￠縺ｮ繝ｪ繝槭う繝ｳ繝峨′縺ｾ縺騾∽ｿ｡縺輔ｌ縺ｦ縺・↑縺・◆繧∫ｵゆｺ・＠縺ｾ縺吶・);
    return;
  }

  // 鄙梧律縺ｮ繧ｷ繝輔ヨ蜷咲ｰｿ繧貞叙蠕・
  const shiftData = getShiftsFromSheets_(targetISO);
  if (shiftData.length === 0) {
    Logger.log('鄙梧律縺ｮ繧ｷ繝輔ヨ繝・・繧ｿ縺後↑縺・◆繧∫ｵゆｺ・);
    return;
  }

  // 譛ｪ遒ｺ隱崎・ｒ謚ｽ蜃ｺ
  const unconfirmedStaff = [];
  for (const staff of shiftData) {
    if (!isAcknowledgedBySheet_(targetISO, staff.name)) {
      unconfirmedStaff.push(staff);
      Logger.log('譛ｪ遒ｺ隱榊愛螳・ ' + staff.name);
    }
  }

  if (unconfirmedStaff.length === 0) {
    // 蜈ｨ蜩｡遒ｺ隱肴ｸ医∩ 竊・縺ゅｊ縺後→縺・・遒ｺ隱阪・繧ｿ繝ｳ謚ｼ荳区凾縺ｫ繝ｪ繧｢繝ｫ繧ｿ繧､繝騾∽ｿ｡貂医∩縺ｮ縺溘ａ縺薙％縺ｧ縺ｯ騾√ｉ縺ｪ縺・
    Logger.log('蜈ｨ蜩｡遒ｺ隱肴ｸ医∩縺ｮ縺溘ａ繝ｪ繝槭う繝ｳ繝我ｸ崎ｦ√・);
    resetAcknowledgment_(targetISO);
    return;
  }

  // 繧ｹ繧ｿ繝・ヵ繝槭ャ繝斐Φ繧ｰ繧貞叙蠕暦ｼ亥錐蜑・-> 騾∽ｿ｡逕ｨID 螟画鋤逕ｨ・・
  const mappings = loadStaffMappingFromSheets_();
  const sendMap = mappings ? mappings.send : {};

  let text = '縲舌す繝輔ヨ譛ｪ遒ｺ隱阪Μ繝槭う繝ｳ繝峨曾n';
  text += '莉･荳九・繧ｹ繧ｿ繝・ヵ縺ｮ逧・＆繧薙∵・譌･縺ｮ繧ｷ繝輔ヨ遒ｺ隱阪ｒ縺企｡倥＞縺励∪縺呻ｼ―n\n';

  for (const staff of unconfirmedStaff) {
    const userId = sendMap[staff.name];
    if (userId) {
      text += '<m userId="' + userId + '">  ' + staff.start + '縲・ + staff.end + '\n';
    } else {
      text += '笆ｶ ' + staff.name + '  ' + staff.start + '縲・ + staff.end + ' (隕！D逋ｻ骭ｲ)\n';
    }
  }

  text += '\n遒ｺ隱阪＠縺溘ｉ縲・2:00縺ｮ繝｡繝・そ繝ｼ繧ｸ縺ｮ縲千｢ｺ隱阪＠縺ｾ縺励◆縲代・繧ｿ繝ｳ繧呈款縺励※縺上□縺輔＞縲・;

  // 騾∽ｿ｡
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

  Logger.log('霑ｽ縺｣縺九￠繝ｪ繝槭う繝ｳ繝蛾∽ｿ｡螳御ｺ・);

  // 遒ｺ隱阪し繧､繧ｯ繝ｫ邨ゆｺ・竊・蠖捺律蛻・・遒ｺ隱咲憾豕√ｒ繝ｪ繧ｻ繝・ヨ
  resetAcknowledgment_(targetISO);
}

/**
 * 謖・ｮ壽律縺ｮ繧ｷ繝輔ヨ逋ｻ骭ｲ閠・・蜩｡縺檎｢ｺ隱肴ｸ医∩縺九←縺・°繧貞愛螳壹☆繧・
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
 * 蜈ｨ蜩｡遒ｺ隱肴ｸ医∩譎ゅ↓繝ｩ繝ｳ繝繝縺ｪ螟夊ｨ隱槭≠繧翫′縺ｨ縺・Γ繝・そ繝ｼ繧ｸ繧偵げ繝ｫ繝ｼ繝励↓騾∽ｿ｡縺吶ｋ
 */
function sendAllConfirmedMessage_() {
  const messages = [
    '縺ゅｊ縺後→縺・ｼ・,   // 譌･譛ｬ隱・
    'Thank you!',     // 闍ｱ隱・
    '・川ぎ﨑ｩ・壱共・・,    // 髻灘嵜隱・
    '隹｢隹｢・・,          // 荳ｭ蝗ｽ隱・
    'ﾘｴﾙ・ｱﾘｧﾙ具ｼ・,         // 繧｢繝ｩ繝薙い隱・
    'ﾂ｡Gracias!',      // 繧ｹ繝壹う繝ｳ隱・
    'Merci !',         // 繝輔Λ繝ｳ繧ｹ隱・
    'Obrigado!',       // 繝昴Ν繝医ぎ繝ｫ隱・
    'Danke!',          // 繝峨う繝・ｪ・
    'Grazie!'          // 繧､繧ｿ繝ｪ繧｢隱・
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

  Logger.log('蜈ｨ蜩｡遒ｺ隱阪Γ繝・そ繝ｼ繧ｸ騾∽ｿ｡: ' + text);
}

/**
 * 繧ｷ繝ｼ繝医・縲檎｢ｺ隱咲憾豕√榊・繧定ｦ九※遒ｺ隱肴ｸ医∩縺句愛螳壹☆繧・
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
      const status = String(data[i][8] || ''); // I蛻・ 遒ｺ隱咲憾豕・

      if (rowDate === dateISO && rowName === staffName) {
        return status.includes('遒ｺ隱肴ｸ医∩');
      }
    }
  } catch (e) {
    Logger.log('繧ｷ繝ｼ繝育｢ｺ隱榊､ｱ謨・ ' + e.message);
  }
  return false;
}

/**
 * 謖・ｮ壽律縺ｮ遒ｺ隱咲憾豕√ｒ縺吶∋縺ｦ繝ｪ繧ｻ繝・ヨ・育ｩｺ縺ｫ縺吶ｋ・・
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
        // I蛻暦ｼ・蛻礼岼・峨ｒ遨ｺ縺ｫ縺吶ｋ
        sheet.getRange(i + 1, 9).setValue('');
      }
    }
    Logger.log('遒ｺ隱咲憾豕√ｒ繝ｪ繧ｻ繝・ヨ縺励∪縺励◆: ' + dateISO);
  } catch (e) {
    Logger.log('繝ｪ繧ｻ繝・ヨ螟ｱ謨・ ' + e.message);
  }
}

/**
 * 遒ｺ隱肴ｸ医∩縺九←縺・°繧貞愛螳・(Properties迚・
 */
function isAcknowledged_(dateStr, userId) {
  const props = PropertiesService.getScriptProperties();
  const key = 'CONFIRM_' + dateStr + '_' + userId;
  const val = props.getProperty(key);
  Logger.log('遒ｺ隱咲憾諷九メ繧ｧ繝・け: key=' + key + ', value=' + val);
  return val === 'true';
}

/**
 * 蜿嶺ｿ｡ID縺梧悴逋ｻ骭ｲ縺ｮ繧ｹ繧ｿ繝・ヵ縺ｮ縺ｿ縺ｫ蛟句挨縺ｧID逋ｻ骭ｲ萓晞ｼ繝｡繝・そ繝ｼ繧ｸ繧帝∽ｿ｡縺吶ｋ・育ｮ｡逅・・′GAS繧ｨ繝・ぅ繧ｿ縺九ｉ謇句虚螳溯｡鯉ｼ・
 * F蛻暦ｼ亥女菫｡逕ｨID・峨′遨ｺ縺ｮ繧ｹ繧ｿ繝・ヵ縺ｮ縺ｿ繧貞ｯｾ雎｡縺ｨ縺吶ｋ
 */
function requestNameRegistration() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_STAFF);
  if (!sheet) {
    Logger.log('繧ｹ繧ｿ繝・ヵ繧ｷ繝ｼ繝医′隕九▽縺九ｊ縺ｾ縺帙ｓ');
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
    const recvId = row[5] ? String(row[5]).trim() : ''; // F蛻・ 蜿嶺ｿ｡逕ｨID

    if (!name || !sendId) continue;

    // 蜿嶺ｿ｡ID縺後☆縺ｧ縺ｫ逋ｻ骭ｲ貂医∩縺ｮ蝣ｴ蜷医・繧ｹ繧ｭ繝・・
    if (recvId) {
      Logger.log('繧ｹ繧ｭ繝・・・亥女菫｡ID逋ｻ骭ｲ貂医∩・・ ' + name);
      skipCount++;
      continue;
    }

    const message = name + ' 縺輔ｓ\n\n繧ｷ繝輔ヨ遒ｺ隱阪す繧ｹ繝・Β縺ｮ逋ｻ骭ｲ繧偵♀鬘倥＞縺励∪縺吶・n縺薙・繝｡繝・そ繝ｼ繧ｸ縺ｫ縺碑・霄ｫ縺ｮ繝輔Ν繝阪・繝繧偵せ繝壹・繧ｹ縺ｪ縺励〒霑比ｿ｡縺励※縺上□縺輔＞縲・n\n萓具ｼ・ + name + '\n\n窶ｻ1蝗樣√ｋ縺縺代〒逋ｻ骭ｲ螳御ｺ・〒縺吶・;
    const success = sendLineWorksMessage(sendId, message);
    if (success) {
      Logger.log('騾∽ｿ｡謌仙粥: ' + name);
      successCount++;
    } else {
      Logger.log('騾∽ｿ｡螟ｱ謨・ ' + name);
      failCount++;
    }
    Utilities.sleep(500); // API蛻ｶ髯仙ｯｾ遲・
  }

  Logger.log('逋ｻ骭ｲ萓晞ｼ螳御ｺ・ 騾∽ｿ｡謌仙粥=' + successCount + '蜷・/ 騾∽ｿ｡螟ｱ謨・' + failCount + '蜷・/ 繧ｹ繧ｭ繝・・・育匳骭ｲ貂医∩・・' + skipCount + '蜷・);
}

/**
 * 繝｡繧､繝ｳ蜃ｦ逅・ｼ井ｺ呈鋤諤ｧ縺ｮ縺溘ａ縺ｫ邯ｭ謖・ｼ・
 */
function main() {
  triggerShiftReminder();
  triggerShortageAlert();
  // triggerFollowUpReminder(); // 17:00縺ｫ蛻･騾泌ｮ溯｡後＆繧後ｋ
}

/**
 * Drive繝輔か繝ｫ繝縺ｮPDF繧定・蜍募叙霎ｼ縺吶ｋ・域凾髢薙ヨ繝ｪ繧ｬ繝ｼ螳溯｡檎畑・・
 * UI縺ｪ縺励〒蜍穂ｽ懊☆繧九◆繧√∵凾髢薙・繝ｼ繧ｹ繝医Μ繧ｬ繝ｼ縺九ｉ螳牙・縺ｫ蜻ｼ縺ｳ蜃ｺ縺帙ｋ
 * 螳溯｡梧凾髢・ 05:00 / 10:00 / 19:00 / 22:00 (JST)
 */
function autoProcessPdfFromDrive() {
  Logger.log('=== PDF閾ｪ蜍募叙霎ｼ 髢句ｧ・===');

  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    Logger.log('蜿冶ｾｼ蟇ｾ雎｡PDF縺ｪ縺暦ｼ育ｵゆｺ・ｼ・);
    return;
  }

  Logger.log('蜿冶ｾｼ蟇ｾ雎｡PDF: ' + pdfFiles.length + '莉ｶ');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SHIFTS);
    sheet.getRange(1, 1, 1, 8).setValues([['譌･莉・, '譖懈律', '繧ｹ繧ｿ繝・ヵ蜷・, '髢句ｧ区凾蛻ｻ', '邨ゆｺ・凾蛻ｻ', '讌ｭ蜍吝・螳ｹ', '逋ｻ骭ｲ譌･譎・, '逋ｻ骭ｲ蜈・]]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  // 驥崎､・メ繧ｧ繝・け逕ｨ繧ｭ繝｣繝・す繝･繧呈ｧ狗ｯ・
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
    Logger.log('--- PDF蜃ｦ逅・ ' + fileName + ' ---');

    const shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) {
      Logger.log('繝・く繧ｹ繝域歓蜃ｺ螟ｱ謨・ ' + fileName);
      continue;
    }

    const allShifts = parseAllShiftsFromPdf_(pdfFile, shiftText);
    let fileImported = 0;
    let fileSkipped = 0;

    // 繧ｫ繝ｬ繝ｳ繝繝ｼ逋ｻ骭ｲ
    const calendarCount = registerShiftsToCalendar(allShifts);
    registeredCountTotal += calendarCount;

    // 繧ｷ繝ｼ繝医∈譖ｸ縺崎ｾｼ縺ｿ
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

    // 蜃ｦ逅・ｸ医∩PDF繧偵ざ繝溽ｮｱ縺ｸ
    pdfFile.setTrashed(true);
    processedCount++;
    totalImported += fileImported;
    totalSkipped += fileSkipped;
    Logger.log(fileName + ': 譁ｰ隕・' + fileImported + '莉ｶ, 繧ｹ繧ｭ繝・・=' + fileSkipped + '莉ｶ, 繧ｫ繝ｬ繝ｳ繝繝ｼ=' + calendarCount + '莉ｶ');
  }

  writeLogToSheets_('pdf_auto_import', totalImported, 'auto', 'success',
    'PDF閾ｪ蜍募叙霎ｼ: ' + processedCount + '繝輔ぃ繧､繝ｫ, 譁ｰ隕・ + totalImported + '莉ｶ, 繧ｫ繝ｬ繝ｳ繝繝ｼ' + registeredCountTotal + '莉ｶ');
  Logger.log('=== PDF閾ｪ蜍募叙霎ｼ 螳御ｺ・ 譁ｰ隕・' + totalImported + '莉ｶ ===');
}

// ============================================================
// Sheets 騾｣謳ｺ髢｢謨ｰ
// ============================================================

/**
 * Sheets縺ｮ縲後す繝輔ヨ縲阪す繝ｼ繝医°繧画欠螳壽律縺ｮ繧ｷ繝輔ヨ繧貞叙蠕・
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

    // 髢句ｧ区凾髢馴・↓繧ｽ繝ｼ繝・
    results.sort(function (a, b) { return a.start.localeCompare(b.start); });
    return results;
  } catch (e) {
    Logger.log('Sheets隱ｭ縺ｿ蜿悶ｊ繧ｨ繝ｩ繝ｼ: ' + e.message);
    return [];
  }
}

/**
 * 繧ｻ繝ｫ縺ｮ蛟､繧・"HH:mm" 蠖｢蠑上・譎ょ綾譁・ｭ怜・縺ｫ螟画鋤縺吶ｋ
 * Google Sheets縺ｯ譎ょ綾縺ｮ縺ｿ縺ｮ繧ｻ繝ｫ繧奪ate蝙・1899蟷ｴ)縺ｧ菫晄戟縺吶ｋ縺溘ａ螟画鋤縺悟ｿ・ｦ・
 */
function formatCellTime_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, TIMEZONE, 'HH:mm');
  }
  // 譁・ｭ怜・縺ｮ蝣ｴ蜷医・縺昴・縺ｾ縺ｾ霑斐☆
  return String(val).trim();
}


/**
 * 謖・ｮ壽律縺ｮ謖・ｮ壽婿豕輔〒縺ｮ騾∽ｿ｡縺梧里縺ｫ謌仙粥縺励※縺・ｋ縺九Ο繧ｰ繧堤｢ｺ隱・
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
    Logger.log('騾∽ｿ｡貂医∩繝√ぉ繝・け繧ｨ繝ｩ繝ｼ: ' + e.message);
  }
  return false;
}

/**
 * 騾∽ｿ｡繝ｭ繧ｰ繧担heets縺ｫ險倬鹸縺吶ｋ
 * 100陦後ｒ雜・∴縺溘ｉ蜿､縺・｡後ｒ蜑企勁縺励※譛譁ｰ50陦後・縺ｿ谿九☆
 */
function writeLogToSheets_(dateStr, staffCount, method, result, detail) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_LOGS);
      sheet.getRange(1, 1, 1, 6).setValues([['騾∽ｿ｡譌･譎・, '蟇ｾ雎｡譌･', '繧ｹ繧ｿ繝・ヵ謨ｰ', '騾∽ｿ｡譁ｹ豕・, '邨先棡', '隧ｳ邏ｰ']]);
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    }
    sheet.appendRow([new Date(), dateStr, staffCount, method, result, detail]);

    // 200陦瑚ｶ・∴縺溘ｉ蜿､縺・｡後ｒ蜑企勁縺励※譛譁ｰ100陦後□縺第ｮ九☆・医・繝・ム繝ｼ髯､縺擾ｼ・
    var lastRow = sheet.getLastRow();
    if (lastRow > 201) { // 繝倥ャ繝繝ｼ1陦・+ 繝・・繧ｿ200陦・
      var deleteCount = lastRow - 101; // 繝倥ャ繝繝ｼ1陦・+ 譛譁ｰ100陦・繧呈ｮ九☆
      sheet.deleteRows(2, deleteCount);
    }
  } catch (e) {
    Logger.log('繝ｭ繧ｰ譖ｸ縺崎ｾｼ縺ｿ繧ｨ繝ｩ繝ｼ: ' + e.message);
  }
}

/**
 * PDF繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ: 蠕捺擂縺ｮDrive PDF隗｣譫舌〒鄙梧律繧ｷ繝輔ヨ繧貞叙蠕・
 * 隍・焚PDF縺後≠繧句ｴ蜷医・蜈ｨ繝輔ぃ繧､繝ｫ縺ｮ繝・・繧ｿ繧堤ｵ仙粋縺励※霑斐☆
 */
function getShiftsFromPdfFallback_(tomorrow) {
  var pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) return [];

  var allShiftData = [];

  for (var i = 0; i < pdfFiles.length; i++) {
    var pdfFile = pdfFiles[i];
    Logger.log('PDF繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ蜃ｦ逅・ｸｭ: ' + pdfFile.getName());

    var shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) continue;

    var shiftData = parseShiftData(shiftText, tomorrow, pdfFile);
    if (shiftData.length === 0) continue;

    // 蜈ｨPDF縺ｮ繝・・繧ｿ繧堤ｵ仙粋
    allShiftData = allShiftData.concat(shiftData);
    // 蜃ｦ逅・ｸ医∩PDF繧偵ざ繝溽ｮｱ縺ｫ遘ｻ蜍・
    trashPdfFile(pdfFile);
  }

  // 髢句ｧ区凾髢馴・〒繧ｽ繝ｼ繝・
  allShiftData.sort(function(a, b) { return a.start.localeCompare(b.start); });
  return allShiftData;
}

// ============================================================
// 繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ
// ============================================================

/**
 * Date 繧・YYYY-MM-DD 蠖｢蠑上↓螟画鋤
 */
function formatDateToISO_(d) {
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
}

/**
 * 繝・せ繝育畑 - 謇句虚螳溯｡後〒PDF隗｣譫千ｵ先棡繧堤｢ｺ隱・
 */
function testParsePdf() {
  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    Logger.log('PDF縺ｪ縺・);
    return;
  }

  for (var i = 0; i < pdfFiles.length; i++) {
    var pdfFile = pdfFiles[i];
    Logger.log('--- ' + pdfFile.getName() + ' ---');

    var text = extractTextFromPdf(pdfFile);
    if (!text) {
      Logger.log('繝・く繧ｹ繝域歓蜃ｺ螟ｱ謨・);
      continue;
    }
    Logger.log('謚ｽ蜃ｺ繝・く繧ｹ繝・\n' + text);

    var tomorrow = getTomorrow();
    var allShifts = parseAllShiftsFromPdf_(pdfFile, text);
    Logger.log('蜈ｨ繧ｷ繝輔ヨ繝・・繧ｿ: ' + JSON.stringify(allShifts, null, 2));

    var data = parseShiftData(text, tomorrow, pdfFile);
    Logger.log('鄙梧律繧ｷ繝輔ヨ繝・・繧ｿ: ' + JSON.stringify(data, null, 2));

    var result = buildReminderMessage(data, tomorrow);
    Logger.log('騾∽ｿ｡繝｡繝・そ繝ｼ繧ｸ:\n' + result.messageText);
  }
}

/**
 * 繝・せ繝育畑 - Sheets隱ｭ縺ｿ蜿悶ｊ繧堤｢ｺ隱・
 */
function testSheetsRead() {
  loadStaffMappingFromSheets_();
  Logger.log('STAFF_MAPPING: ' + JSON.stringify(STAFF_MAPPING));

  var tomorrow = getTomorrow();
  var tomorrowISO = formatDateToISO_(tomorrow.dateObj);
  var data = getShiftsFromSheets_(tomorrowISO);
  Logger.log('鄙梧律繧ｷ繝輔ヨ (' + tomorrowISO + '): ' + JSON.stringify(data, null, 2));
}

/**
 * 繧ｿ繧､繝繝医Μ繧ｬ繝ｼ繧定ｨｭ螳壹☆繧具ｼ亥・蝗槭・縺ｿ謇句虚螳溯｡鯉ｼ・
 */
function setupTrigger() {
  // 譌｢蟄倥・main繝医Μ繧ｬ繝ｼ繧貞炎髯､
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 豈取律12:00縺ｫ螳溯｡後☆繧九ヨ繝ｪ繧ｬ繝ｼ繧剃ｽ懈・
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .nearMinute(0)
    .inTimezone(TIMEZONE)
    .create();

  Logger.log('繝医Μ繧ｬ繝ｼ險ｭ螳壼ｮ御ｺ・ 豈取律12:00 (JST)');
}

/**
 * 蜑肴怦縺ｮ繧ｷ繝輔ヨ繝・・繧ｿ繧貞炎髯､縺吶ｋ・域ｯ取怦1譌･縺ｫ閾ｪ蜍募ｮ溯｡鯉ｼ・
 */
function triggerDeleteLastMonthShifts() {
  Logger.log('=== 蜑肴怦繧ｷ繝輔ヨ蜑企勁 髢句ｧ・===');

  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const targetYear = lastMonth.getFullYear();
  const targetMonth = lastMonth.getMonth(); // 0-indexed

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    Logger.log('繧ｷ繝輔ヨ繧ｷ繝ｼ繝医′隕九▽縺九ｊ縺ｾ縺帙ｓ');
    return;
  }

  const data = sheet.getDataRange().getValues();
  let deleteCount = 0;

  // 蠕後ｍ縺九ｉ蜑企勁・郁｡後★繧碁亟豁｢・・
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

  const label = targetYear + '蟷ｴ' + (targetMonth + 1) + '譛・;
  Logger.log(label + ' 縺ｮ繧ｷ繝輔ヨ繝・・繧ｿ繧・' + deleteCount + ' 莉ｶ蜑企勁縺励∪縺励◆縲・);
  writeLogToSheets_(label, deleteCount, 'auto', 'success', '蜑肴怦繧ｷ繝輔ヨ閾ｪ蜍募炎髯､');

  Logger.log('=== 蜑肴怦繧ｷ繝輔ヨ蜑企勁 螳御ｺ・===');
}

/**
 * 繧ｷ繝輔ヨ荳崎ｶｳ繧｢繝ｩ繝ｼ繝医ｒ騾∽ｿ｡縺吶ｋ (5譌･蠕悟ｯｾ雎｡)
 */
function checkAndSendShortageAlert_() {
  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + SHIFT_SHORTAGE_ALERT_DAYS); // 5譌･蠕・

  Logger.log('繧ｷ繝輔ヨ荳崎ｶｳ繝√ぉ繝・け蟇ｾ雎｡譌･: ' + formatDateToISO_(targetDate));

  const shortageSlots = checkShiftShortageForDate(targetDate);

  if (shortageSlots.length > 0) {
    const dateStr = Utilities.formatDate(targetDate, TIMEZONE, 'M譛・譌･(E)'); // 萓・ 2譛・9譌･(豌ｴ)

    let msg = '圷 縲舌す繝輔ヨ荳崎ｶｳ縺ｮ縺顔衍繧峨○縲曾n';
    msg += dateStr + ' 縺ｮ繧ｷ繝輔ヨ縺御ｸ崎ｶｳ縺励※縺・∪縺呻ｼ―n\n';
    msg += '荳崎ｶｳ譎る俣蟶ｯ: ' + shortageSlots.join(', ') + '\n';
    msg += '隧ｲ蠖薙☆繧九せ繧ｿ繝・ヵ縺ｮ譁ｹ縺ｯ縺泌鵠蜉帙ｒ縺企｡倥＞縺励∪縺呻ｼ・;

    sendLineWorksGroupMessage(msg);
    Logger.log('繧ｷ繝輔ヨ荳崎ｶｳ繧｢繝ｩ繝ｼ繝磯∽ｿ｡: ' + dateStr);
  } else {
    Logger.log('繧ｷ繝輔ヨ荳崎ｶｳ縺ｪ縺・);
  }
}

// ============================================================
// 繧ｹ繝励Ξ繝・ラ繧ｷ繝ｼ繝医Γ繝九Η繝ｼ縺九ｉ蜻ｼ縺ｳ蜃ｺ縺咎未謨ｰ
// ============================================================

/**
 * 繝｡繝九Η繝ｼ: PDF隗｣譫・竊・繧ｷ繝ｼ繝亥叙霎ｼ
 * Drive繝輔か繝ｫ繝縺ｮPDF繧定ｧ｣譫舌＠縲√す繝輔ヨ繝・・繧ｿ繧偵後す繝輔ヨ縲阪す繝ｼ繝医↓譖ｸ縺崎ｾｼ繧
 */
function menuParsePdf() {
  const ui = SpreadsheetApp.getUi();

  const pdfFiles = getShiftPdfsFromDrive(DRIVE_FOLDER_ID);
  if (pdfFiles.length === 0) {
    ui.alert('PDF縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ', 'Drive繝輔か繝ｫ繝蜀・↓PDF繝輔ぃ繧､繝ｫ縺後≠繧翫∪縺帙ｓ縲・, ui.ButtonSet.OK);
    return;
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SHIFTS);
    sheet.getRange(1, 1, 1, 8).setValues([['譌･莉・, '譖懈律', '繧ｹ繧ｿ繝・ヵ蜷・, '髢句ｧ区凾蛻ｻ', '邨ゆｺ・凾蛻ｻ', '讌ｭ蜍吝・螳ｹ', '逋ｻ骭ｲ譌･譎・, '逋ｻ骭ｲ蜈・]]);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  // 驥崎､・メ繧ｧ繝・け逕ｨ縺ｮ譌｢蟄倥ョ繝ｼ繧ｿ繧貞叙蠕・
  const existingData = sheet.getDataRange().getValues();
  const shiftCache = new Set();
  for (let j = 1; j < existingData.length; j++) {
    const d = existingData[j][0] instanceof Date ? formatDateToISO_(existingData[j][0]) : String(existingData[j][0]);
    const name = String(existingData[j][2]).trim();
    const startTime = formatCellTime_(existingData[j][3]);

    // 繧ｭ繝ｼ: 譌･莉・蜷榊燕|髢句ｧ区凾蛻ｻ
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
    Logger.log('--- PDF蜃ｦ逅・幕蟋・ ' + fileName + ' ---');

    const shiftText = extractTextFromPdf(pdfFile);
    if (!shiftText) {
      Logger.log('繝・く繧ｹ繝域歓蜃ｺ螟ｱ謨・ ' + fileName);
      continue;
    }

    // 繝・く繧ｹ繝医°繧牙・譌･莉倥ヶ繝ｭ繝・け繧呈歓蜃ｺ
    const allShifts = parseAllShiftsFromPdf_(pdfFile, shiftText);
    let fileImported = 0;
    let fileSkipped = 0;

    // 繧ｫ繝ｬ繝ｳ繝繝ｼ逋ｻ骭ｲ・磯㍾隍・・繧ｫ繝ｬ繝ｳ繝繝ｼ蛛ｴ縺ｧ繧ゅメ繧ｧ繝・け縺輔ｌ繧具ｼ・
    const calendarCount = registerShiftsToCalendar(allShifts);
    registeredCountTotal += calendarCount;

    for (const entry of allShifts) {
      const dateStr = entry.date;
      const dayOfWeek = entry.dayOfWeek;

      for (const staff of entry.shifts) {
        // 驥崎､・メ繧ｧ繝・け
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

    // 蜃ｦ逅・ｸ医∩繝輔ぃ繧､繝ｫ繧偵ざ繝溽ｮｱ縺ｸ
    pdfFile.setTrashed(true);
    processedFileNames.push(fileName);

    totalImported += fileImported;
    totalSkipped += fileSkipped;
    Logger.log('邨先棡: ' + fileName + ' -> 譁ｰ隕・' + fileImported + '莉ｶ, 驥崎､・せ繧ｭ繝・・:' + fileSkipped + '莉ｶ');
  }

  // 邨先棡陦ｨ遉ｺ
  if (processedFileNames.length > 0) {
    let msg = processedFileNames.length + ' 蛟九・繝輔ぃ繧､繝ｫ繧貞・逅・＠縲√ざ繝溽ｮｱ縺ｸ遘ｻ蜍輔＠縺ｾ縺励◆縲・n\n';
    msg += '繝ｻ譁ｰ隕丞叙霎ｼ: ' + totalImported + ' 莉ｶ\n';
    msg += '繝ｻ驥崎､・・縺溘ａ繧ｹ繧ｭ繝・・: ' + totalSkipped + ' 莉ｶ\n';
    msg += '繝ｻ繧ｫ繝ｬ繝ｳ繝繝ｼ逋ｻ骭ｲ/譖ｴ譁ｰ: ' + registeredCountTotal + ' 莉ｶ';
    ui.alert('PDF蜿冶ｾｼ邨先棡', msg, ui.ButtonSet.OK);
  } else {
    ui.alert('蜃ｦ逅・ｯｾ雎｡縺ｪ縺・, 'PDF繝輔ぃ繧､繝ｫ縺瑚ｦ九▽縺九ｉ縺ｪ縺・°縲∬ｧ｣譫舌↓螟ｱ謨励＠縺ｾ縺励◆縲・, ui.ButtonSet.OK);
  }
}

/**
 * PDF蜈ｨ譁・°繧牙・譌･莉倥・繧ｷ繝輔ヨ繧呈歓蜃ｺ縺吶ｋ・・enuParsePdf逕ｨ・・
 *
 * OCR縺訓DF縺ｮ陦ｨ繧貞・縺斐→縺ｫ隱ｭ繧蝣ｴ蜷医∝燕縺ｮ譌･莉倥ヶ繝ｭ繝・け縺ｮ繧ｹ繧ｿ繝・ヵ蜷阪→
 * 譎ょ綾縺梧ｬ｡縺ｮ譌･莉倥ヶ繝ｭ繝・け縺ｫ蛻・妙縺輔ｌ繧九％縺ｨ縺後≠繧具ｼ井ｾ・ 3/16蝠城｡鯉ｼ峨・
 * carryoverNames 縺ｧ縺昴・譛ｪ繝壹い蜷榊燕繧呈ｬ｡繝悶Ο繝・け蜀帝ｭ縺ｮ譎ょ綾縺ｨ郢九￡繧九・
 */
function parseAllShiftsFromText_(text) {
  const lines = normalizePdfText_(text).split('\n');
  const results = [];
  let currentBlock = null;
  let currentDateStr = null;
  let currentDayOfWeek = null;
  let carryoverNames = [];    // 蜑阪ヶ繝ｭ繝・け縺ｧ譎ょ綾縺ｨ蟇ｾ蠢懊〒縺阪↑縺九▲縺溷錐蜑・
  let carryoverDateStr = null;
  let carryoverDayOfWeek = null;

  const flushBlock_ = function() {
    if (!currentBlock || !currentDateStr) return;
    let blockToProcess = currentBlock;

    // 繧ｭ繝｣繝ｪ繝ｼ繧ｪ繝ｼ繝舌・蜷榊燕縺後≠繧句ｴ蜷・ 谺｡繝悶Ο繝・け蜈磯ｭ縺ｮ譎ょ綾縺ｧ陬懷ｮ・
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
        Logger.log('繧ｭ繝｣繝ｪ繝ｼ繧ｪ繝ｼ繝舌・隗｣豎ｺ: ' + carryoverDateStr + ' 縺ｫ ' + pCount + '蜷崎ｿｽ蜉');
        results.push({ date: carryoverDateStr, dayOfWeek: carryoverDayOfWeek, shifts: carryoverShifts });
        blockToProcess = extracted.remainingLines; // 豸郁ｲｻ縺励◆譎ょ綾陦後ｒ髯､縺・◆谿九ｊ
      }
      carryoverNames = [];
      carryoverDateStr = null;
      carryoverDayOfWeek = null;
    }

    const parsed = parseStaffLines(blockToProcess);
    if (parsed.shifts.length > 0) {
      results.push({ date: currentDateStr, dayOfWeek: currentDayOfWeek, shifts: parsed.shifts });
    }
    // 譛ｪ繝壹い蜷榊燕繧呈ｬ｡繝悶Ο繝・け縺ｸ謖√■雜翫☆
    if (parsed.unpairedNames.length > 0) {
      Logger.log('繧ｭ繝｣繝ｪ繝ｼ繧ｪ繝ｼ繝舌・逋ｺ逕・ ' + currentDateStr + ' 譛ｪ繝壹い蜷榊燕=' + parsed.unpairedNames.join(','));
      carryoverNames = parsed.unpairedNames;
      carryoverDateStr = currentDateStr;
      carryoverDayOfWeek = currentDayOfWeek;
    }
  };

  for (const line of lines) {
    const dateMatch = line.match(/(\d{4})蟷ｴ(\d{1,2})譛・\d{1,2})譌･\s*[・・](.)[・・]/);
    if (dateMatch) {
      flushBlock_();
      // 蟷ｴ縺ｮOCR隱､隱崎ｭ倩｣懈ｭ｣・井ｾ・ 2016 竊・2026・・
      var parsedYear = parseInt(dateMatch[1]);
      var currentYear = new Date().getFullYear();
      if (Math.abs(parsedYear - currentYear) >= 2) {
        Logger.log('蟷ｴ縺ｮOCR隱､隱崎ｭ倥ｒ陬懈ｭ｣: ' + parsedYear + ' 竊・' + currentYear + ' (' + dateMatch[2] + '譛・ + dateMatch[3] + '譌･)');
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
  // 譛蠕後・繝悶Ο繝・け
  flushBlock_();

  return results;
}

/**
 * 繝｡繝九Η繝ｼ: 繝ｪ繝槭う繝ｳ繝画焔蜍暮∽ｿ｡
 * 12:00蝓ｺ貅悶〒谺｡縺ｮ繧ｷ繝輔ヨ譌･繧定・蜍募愛螳壹＠縺ｦ騾∽ｿ｡縺吶ｋ
 * - 12:00繧医ｊ蜑・竊・蠖捺律縺ｮ繧ｷ繝輔ヨ繧偵Μ繝槭う繝ｳ繝・
 * - 12:00莉･髯・竊・鄙梧律縺ｮ繧ｷ繝輔ヨ繧偵Μ繝槭う繝ｳ繝・
 */
function menuSendReminder() {
  const ui = SpreadsheetApp.getUi();

  // 繧ｹ繧ｿ繝・ヵ繝槭ャ繝斐Φ繧ｰ繧呈怙譁ｰ蛹・
  loadStaffMappingFromSheets_();

  const now = new Date();
  const hour = parseInt(Utilities.formatDate(now, TIMEZONE, 'H'));

  let initialTarget;
  if (hour < 12) {
    // 12譎ょ燕 竊・蠖捺律・医◆縺縺怜ｽ捺律縺御ｼ代∩縺ｪ繧画ｬ｡蝟ｶ讌ｭ譌･・・
    const hours = getBusinessHours(now);
    initialTarget = hours ? now : findNextBusinessDay_(now);
  } else {
    // 12譎ゆｻ･髯・竊・鄙梧律莉･髯阪・譛蛻昴・蝟ｶ讌ｭ譌･
    initialTarget = findNextBusinessDay_(now);
  }

  const targetDate = initialTarget;
  const targetISO = formatDateToISO_(targetDate);
  const dayOfWeek = ['譌･', '譛・, '轣ｫ', '豌ｴ', '譛ｨ', '驥・, '蝨・][targetDate.getDay()];
  const displayStr = targetDate.getFullYear() + '蟷ｴ' + (targetDate.getMonth() + 1) + '譛・ + targetDate.getDate() + '譌･・・ + dayOfWeek + '・・;

  const tomorrow = {
    formatted: Utilities.formatDate(targetDate, TIMEZONE, 'yyyy蟷ｴMM譛・d譌･'),
    dateObj: targetDate,
    displayStr: displayStr
  };

  // 繧ｷ繝輔ヨ繝・・繧ｿ蜿門ｾ・
  var shiftData = getShiftsFromSheets_(targetISO);

  if (shiftData.length === 0) {
    // PDF繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ
    shiftData = getShiftsFromPdfFallback_(tomorrow);
  }

  if (shiftData.length === 0) {
    ui.alert('繧ｷ繝輔ヨ縺ｪ縺・, displayStr + ' 縺ｮ繧ｷ繝輔ヨ繝・・繧ｿ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ縲・n\n縲後す繝輔ヨ縲阪す繝ｼ繝医↓繝・・繧ｿ繧貞・蜉帙☆繧九°縲￣DF繧偵い繝・・繝ｭ繝ｼ繝峨＠縺ｦ縺上□縺輔＞縲・, ui.ButtonSet.OK);
    return;
  }

  // 遒ｺ隱阪ム繧､繧｢繝ｭ繧ｰ
  const confirmMsg = displayStr + ' 縺ｮ繝ｪ繝槭う繝ｳ繝峨ｒ騾∽ｿ｡縺励∪縺吶・n\n' +
    '繧ｹ繧ｿ繝・ヵ謨ｰ: ' + shiftData.length + '蜷構n' +
    '繧医ｍ縺励＞縺ｧ縺吶°・・;

  const response = ui.alert('繝ｪ繝槭う繝ｳ繝蛾∽ｿ｡遒ｺ隱・, confirmMsg, ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) {
    ui.alert('繧ｭ繝｣繝ｳ繧ｻ繝ｫ縺励∪縺励◆縲・);
    return;
  }

  // 騾∽ｿ｡
  const success = sendLineWorksReminder(shiftData, tomorrow);

  writeLogToSheets_(targetISO, shiftData.length, 'manual',
    success ? 'success' : 'error',
    success ? '謇句虚騾∽ｿ｡' : '謇句虚騾∽ｿ｡螟ｱ謨・
  );

  if (success) {
    ui.alert('騾∽ｿ｡螳御ｺ・, displayStr + ' 縺ｮ繝ｪ繝槭う繝ｳ繝峨ｒ騾∽ｿ｡縺励∪縺励◆縲・n(' + shiftData.length + '蜷・', ui.ButtonSet.OK);
  } else {
    ui.alert('騾∽ｿ｡螟ｱ謨・, '繝ｪ繝槭う繝ｳ繝峨・騾∽ｿ｡縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲・nGAS縺ｮ螳溯｡後Ο繧ｰ繧堤｢ｺ隱阪＠縺ｦ縺上□縺輔＞縲・, ui.ButtonSet.OK);
  }
}

/**
 * 險ｭ螳壹す繝ｼ繝医・縲勲eetup驥崎､・夂衍縲阪メ繧ｧ繝・け繝懊ャ繧ｯ繧ｹ縺薫N縺句愛螳壹☆繧・
 * 繧ｭ繝ｼ縺瑚ｦ九▽縺九ｉ縺ｪ縺・ｴ蜷医・ON・・rue・峨ｒ霑斐☆
 * @returns {boolean}
 */
function isMeetupNotificationEnabled_() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return true;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'Meetup驥崎､・夂衍') {
        return data[i][1] === true || String(data[i][1]).toUpperCase() === 'TRUE';
      }
    }
  } catch (e) {
    Logger.log('Meetup騾夂衍險ｭ螳壼叙蠕励お繝ｩ繝ｼ: ' + e.message);
  }
  return true; // 繧ｭ繝ｼ縺瑚ｦ九▽縺九ｉ縺ｪ縺・ｴ蜷医・ON縺ｨ縺励※謇ｱ縺・
}

/**
 * 騾ｱ蟋九ａMeetup蜈ｱ譛峨ｒ騾∽ｿ｡縺吶ｋ・医ヨ繝ｪ繧ｬ繝ｼ螳溯｡檎畑 entry point・・
 * 螳溯｡梧耳螂ｨ: 豈朱ｱ譛域屆9譎ゑｼ・etchMeetupSchedule縺・譎ゅ↓鄙碁ｱ繝・・繧ｿ繧呈峩譁ｰ縺励◆蠕鯉ｼ・
 */
function triggerWeeklyMeetupShare() {
  Logger.log('=== 騾ｱ谺｡Meetup蜈ｱ譛・螳溯｡碁幕蟋・===');

  var result = getMeetupsForWeek_();
  var meetups = result.meetups;
  var weekStart = result.weekStart;
  var weekEnd = result.weekEnd;

  if (meetups.length === 0) {
    Logger.log('莉企ｱ縺ｮMeetup莠亥ｮ壹・縺ゅｊ縺ｾ縺帙ｓ');
    Logger.log('=== 騾ｱ谺｡Meetup蜈ｱ譛・螳御ｺ・===');
    return;
  }

  var message = buildWeeklyMeetupMessage_(meetups, weekStart, weekEnd);
  var success = sendLineWorksGroupMessage(message);
  Logger.log(success ? '騾ｱ谺｡Meetup蜈ｱ譛蛾∽ｿ｡謌仙粥: ' + meetups.length + '莉ｶ' : '騾ｱ谺｡Meetup蜈ｱ譛蛾∽ｿ｡螟ｱ謨・);
  Logger.log('=== 騾ｱ谺｡Meetup蜈ｱ譛・螳御ｺ・===');
}

/**
 * 謖・ｮ壽律縺ｮMeetup莠亥ｮ壻ｸ隕ｧ繧偵せ繝励Ξ繝・ラ繧ｷ繝ｼ繝医°繧牙叙蠕励☆繧・
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
    Logger.log('getMeetupsForDay_ 繧ｨ繝ｩ繝ｼ: ' + e.message);
    return [];
  }
}

/**
 * 繧ｷ繝輔ヨ譎る俣縺ｨMeetup譎る俣縺ｮ驥崎､・ｒ繝√ぉ繝・け縺吶ｋ
 * 驥崎､・擅莉ｶ: shiftStart < meetupEnd AND meetupStart < shiftEnd
 * @param {string} shiftStart - "HH:mm"
 * @param {string} shiftEnd   - "HH:mm"
 * @param {Array}  meetups    - getMeetupsForDay_() 縺ｮ謌ｻ繧雁､
 * @returns {Array} 驥崎､・☆繧貴eetup縺ｮ驟榊・
 */
function findOverlappingMeetups_(shiftStart, shiftEnd, meetups) {
  if (!meetups || meetups.length === 0) return [];

  var shiftStartDate = stringToDate_(shiftStart);
  var shiftEndDate = stringToDate_(shiftEnd);

  return meetups.filter(function(m) {
    // "10:00 ~ 11:00" 蠖｢蠑上ｒ繝代・繧ｹ
    var parts = m.time.split(/\s*~\s*/);
    if (parts.length < 2) return false;
    var meetupStart = stringToDate_(parts[0].trim());
    var meetupEnd = stringToDate_(parts[1].trim());
    return shiftStartDate < meetupEnd && meetupStart < shiftEndDate;
  });
}

/**
 * 繝｡繝九Η繝ｼ: 繧ｹ繧ｿ繝・ヵ譖ｴ譁ｰ
 * 縲後せ繧ｿ繝・ヵ縲阪す繝ｼ繝医°繧唄TAFF_MAPPING繧貞・隱ｭ縺ｿ霎ｼ縺ｿ縺吶ｋ
 */
function menuRefreshStaff() {
  const ui = SpreadsheetApp.getUi();
  loadStaffMappingFromSheets_();

  const staffNames = Object.keys(STAFF_MAPPING);
  if (staffNames.length === 0) {
    ui.alert('繧ｹ繧ｿ繝・ヵ譖ｴ譁ｰ', '縲後せ繧ｿ繝・ヵ縲阪す繝ｼ繝医↓繝・・繧ｿ縺後≠繧翫∪縺帙ｓ縲・n\nA蛻・ 繧ｹ繧ｿ繝・ヵ蜷阪。蛻・ LINE WORKS ID縲，蛻・ 譛牙柑(TRUE/FALSE) 繧貞・蜉帙＠縺ｦ縺上□縺輔＞縲・, ui.ButtonSet.OK);
    return;
  }

  let list = '';
  for (const name of staffNames) {
    list += '繝ｻ' + name + ' 竊・' + STAFF_MAPPING[name] + '\n';
  }
  ui.alert('繧ｹ繧ｿ繝・ヵ譖ｴ譁ｰ螳御ｺ・, staffNames.length + '蜷阪・繧ｹ繧ｿ繝・ヵ繧定ｪｭ縺ｿ霎ｼ縺ｿ縺ｾ縺励◆縲・n\n' + list, ui.ButtonSet.OK);
}

/**
 * 譌｢蟄倥ち繝悶・繝｡繝ｳ繝・リ繝ｳ繧ｹ迥ｶ諷九ｒ蛻晄悄蛹厄ｼ域悴險ｭ螳壹ち繝悶ｒ譏守､ｺ逧・↓false縺ｫ險ｭ螳夲ｼ・
 * 譁ｰ縺励＞繝・ヵ繧ｩ繝ｫ繝亥虚菴懶ｼ域悴險ｭ螳・繝｡繝ｳ繝・ｸｭ・牙ｰ主・蜑阪・譌｢蟄倥ち繝悶ｒ螳牙・蛹悶☆繧九◆繧・
 * 蛻晏屓縺ｮ縺ｿ謇句虚螳溯｡後＠縺ｦ縺上□縺輔＞: 繝｡繧､繝ｳ蜃ｦ逅・gs 縺ｮ initMaintenanceProperties
 */
function initMaintenanceProperties() {
  var props = PropertiesService.getScriptProperties();
  var existingTabs = ['congestion', 'calendar', 'qa', 'board', 'corner'];
  existingTabs.forEach(function(tab) {
    if (props.getProperty('MAINTENANCE_' + tab) === null) {
      props.setProperty('MAINTENANCE_' + tab, 'false');
      Logger.log('蛻晄悄蛹・ MAINTENANCE_' + tab + ' = false');
    } else {
      Logger.log('繧ｹ繧ｭ繝・・・郁ｨｭ螳壽ｸ医∩・・ MAINTENANCE_' + tab + ' = ' + props.getProperty('MAINTENANCE_' + tab));
    }
  });
  Logger.log('繝｡繝ｳ繝・リ繝ｳ繧ｹ蛻晄悄蛹門ｮ御ｺ・);
}

