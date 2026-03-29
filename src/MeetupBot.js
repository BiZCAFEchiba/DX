// ============================================================
// MeetupBot.js - Meetup告知Bot（企業別テキスト送信・詳細返信）
// ============================================================

/**
 * 週次Meetupを企業別テキストでグループに送信する（トリガー実行用）
 * 毎週日曜 設定シートの「週次Meetup共有実行時間」に実行
 */
function weeklyMeetupCarousel() {
  initChannelId_();
  Logger.log('=== 週次Meetup送信 開始 ===');

  var result = getMeetupsNextWeekGrouped_();
  var groups = filterAndSelectCompaniesByGroup_(result.companies);

  var totalCount = groups.special.length + groups.inPerson.length + groups.kasshiki.length + groups.online.length;

  if (totalCount === 0) {
    Logger.log('来週のMeetup予定なし → 送信スキップ');
    Logger.log('=== 週次Meetup送信 完了 ===');
    return;
  }

  // ヘッダー（weekEndは月曜起算+5日=土曜なので1日引いて金曜を表示）
  var ws = formatMeetupDateJP_(result.weekStart);
  var weekFri = new Date(result.weekEnd);
  weekFri.setDate(weekFri.getDate() - 1);
  var we = formatMeetupDateJP_(weekFri);
  sendMeetupGroupText_(
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '✨ 来週のMeetup予定 ✨\n' +
    ws + ' 〜 ' + we + '　計' + totalCount + '社\n' +
    '━━━━━━━━━━━━━━━━━━━━'
  );

  // カテゴリ別に送信
  var sections = [
    { label: '🟢 特別イベント', list: groups.special },
    { label: '🔴 対面',         list: groups.inPerson },
    { label: '🟡 貸切',         list: groups.kasshiki },
    { label: '🔵 オンライン',   list: groups.online }
  ];

  sections.forEach(function(sec) {
    if (sec.list.length === 0) return;
    Utilities.sleep(400);
    sendMeetupGroupText_(sec.label + '（' + sec.list.length + '社）');
    for (var i = 0; i < sec.list.length; i += 10) {
      Utilities.sleep(400);
      sendMeetupListTemplate_(sec.list.slice(i, i + 10));
    }
  });

  Logger.log('=== 週次Meetup送信 完了: ' + totalCount + '社 ===');
}

/**
 * 来週分のMeetupを企業単位でグループ化して返す
 * @returns {{ companies: Array, weekStart: Date, weekEnd: Date }}
 */
function getMeetupsNextWeekGrouped_() {
  var today = new Date();
  var dow = today.getDay();
  var daysToMon = (dow === 0) ? 1 : 8 - dow;
  var weekStart = new Date(today);
  weekStart.setDate(today.getDate() + daysToMon);
  weekStart.setHours(0, 0, 0, 0);
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 5); // 月〜金

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { companies: [], weekStart: weekStart, weekEnd: weekEnd };
  }

  var data = sheet.getDataRange().getValues();
  var masterMap = loadCompanyIdMaster_();

  var companyMap = {};   // 企業名 → company object
  var companyOrder = []; // 最初の開催日でソートするための順序

  for (var i = 1; i < data.length; i++) {
    var dateVal = data[i][0];
    if (!dateVal) continue;
    var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) continue;
    var dMid = new Date(d);
    dMid.setHours(0, 0, 0, 0);
    if (dMid < weekStart || dMid >= weekEnd) continue;

    var company = String(data[i][1] || '').trim();
    if (!company) continue;

    var kind       = String(data[i][3] || '').trim();
    var remaining  = calcMeetupRemaining_(String(data[i][4] || '')); // E列: 残席
    var targetYear = String(data[i][6] || '').trim(); // G列: 卒年
    var master     = masterMap[company] || {};

    if (!companyMap[company]) {
      // appealPointsが複数ある場合はランダムに1つ選ぶ、なければhookPointを使う
      var appealPoints = master.appealPoints || [];
      var hookPoint = appealPoints.length > 0
        ? appealPoints[Math.floor(Math.random() * appealPoints.length)]
        : (master.hookPoint || '');
      companyMap[company] = {
        name:       company,
        industry:   master.industry || '',
        theme:      master.theme    || '',
        hookPoint:  hookPoint,
        targetYear: targetYear,
        firstDate:  d,
        sessions:   []
      };
      companyOrder.push(company);
    } else if (!companyMap[company].targetYear && targetYear) {
      companyMap[company].targetYear = targetYear;
    }

    companyMap[company].sessions.push({
      date:      d,
      time:      String(data[i][2] || '').trim(),
      kind:      kind,
      remaining: remaining,
      inPerson:  isInPerson_(kind)
    });

    if (d < companyMap[company].firstDate) {
      companyMap[company].firstDate = d;
    }
  }

  // 最初の開催日順にソート
  var companies = companyOrder
    .map(function(name) { return companyMap[name]; })
    .sort(function(a, b) { return a.firstDate - b.firstDate; });

  // 各社のセッションを日付→時間順にソート
  companies.forEach(function(c) {
    c.sessions.sort(function(a, b) {
      return a.date - b.date || a.time.localeCompare(b.time);
    });
  });

  return { companies: companies, weekStart: weekStart, weekEnd: weekEnd };
}

/**
 * 1社分のテキストカードを組み立てる
 * @param {Object} c - company object
 * @returns {string}
 */
function buildCompanyCard_(c) {
  var hasInPerson = c.sessions.some(function(s) { return s.inPerson; });

  var lines = [];
  lines.push('🏢 ' + c.name);
  if (c.industry)              lines.push('🏭 ' + c.industry);
  if (c.targetYear)            lines.push('🎓 ' + c.targetYear);
  if (hasInPerson && c.theme)  lines.push('📌 ' + c.theme);
  lines.push('');

  c.sessions.forEach(function(s) {
    var line = '📅 ' + formatMeetupDateJP_(s.date) + ' ' + s.time;
    line += '　' + kindEmoji_(s.kind) + s.kind;
    if (s.remaining) line += '　' + s.remaining;
    lines.push(line);
  });

  return lines.join('\n');
}

/**
 * 企業リストをカテゴリ別にグループ化して返す
 * - 満席セッションを除外（残席0の回は非表示）
 * - 特別・対面・貸切は全社必ず含める
 * - オンラインは合計8社になるよう不足分をランダム補完
 * @param {Array} companies
 * @returns {{ special: Array, inPerson: Array, kasshiki: Array, online: Array }}
 */
function filterAndSelectCompaniesByGroup_(companies) {
  var MAX = 8;
  var hideSoldOut = getMeetupHideSoldOut_();

  // 満席セッション除外（設定シートのチェックがONの場合のみ）
  var available = companies.map(function(c) {
    var sessions = hideSoldOut
      ? c.sessions.filter(function(s) { return !isSoldOut_(s.remaining); })
      : c.sessions;
    return sessions.length > 0
      ? { name: c.name, industry: c.industry, theme: c.theme, hookPoint: c.hookPoint,
          targetYear: c.targetYear, firstDate: c.firstDate, sessions: sessions }
      : null;
  }).filter(Boolean);

  // カテゴリ分類
  var special   = available.filter(function(c) { return c.sessions.some(function(s) { return s.kind.includes('特別'); }); });
  var inPerson  = available.filter(function(c) { return !special.includes(c) && c.sessions.some(function(s) { return s.inPerson && !s.kind.includes('貸切'); }); });
  var kasshiki  = available.filter(function(c) { return !special.includes(c) && c.sessions.some(function(s) { return s.kind.includes('貸切'); }); });
  var onlineAll = available.filter(function(c) { return !special.includes(c) && !inPerson.includes(c) && !kasshiki.includes(c); });

  // オンラインは合計8社になるよう不足分をランダム補完
  var fixedCount = special.length + inPerson.length + kasshiki.length;
  var need = Math.max(0, MAX - fixedCount);
  var online = onlineAll.slice().sort(function() { return Math.random() - 0.5; }).slice(0, need);

  function sortByDate(arr) {
    return arr.slice().sort(function(a, b) { return a.firstDate - b.firstDate; });
  }

  return {
    special:  sortByDate(special),
    inPerson: sortByDate(inPerson),
    kasshiki: sortByDate(kasshiki),
    online:   sortByDate(online)
  };
}

/**
 * 残席文字列が満席（残席0）かどうか判定する
 * @param {string} remaining - "残席 0/20" 形式、または ""
 * @returns {boolean}
 */
function isSoldOut_(remaining) {
  if (!remaining) return false; // 残席情報なし → 除外しない
  var m = remaining.match(/残席 (\d+)\//);
  return m ? parseInt(m[1]) === 0 : false;
}

/**
 * 設定シートの「満席を非表示」チェックボックスを読み込む（デフォルト: ON）
 * @returns {boolean}
 */
function getMeetupHideSoldOut_() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return true;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === '満席を非表示') {
        return data[i][1] === true || String(data[i][1]).toUpperCase() === 'TRUE';
      }
    }
  } catch (e) {
    Logger.log('getMeetupHideSoldOut_エラー: ' + e.message);
  }
  return true; // 設定行がなければデフォルトON
}

/**
 * 種別が対面かどうか判定する
 * @param {string} kind
 * @returns {boolean}
 */
function isInPerson_(kind) {
  return !kind.includes('オンライン');
}

/**
 * 種別の優先度を返す（小さいほど優先）
 * 特別イベント > 対面 > 貸切 > オンライン
 * @param {string} kind
 * @returns {number}
 */
function kindPriority_(kind) {
  if (kind.includes('特別')) return 0;
  if (!kind.includes('オンライン') && !kind.includes('貸切')) return 1; // 対面
  if (kind.includes('貸切')) return 2;
  return 3; // オンライン
}

/**
 * 種別に対応する絵文字を返す
 * @param {string} kind
 * @returns {string}
 */
function kindEmoji_(kind) {
  if (kind.includes('特別')) return '🟢';
  if (kind.includes('貸切')) return '🟡';
  if (!kind.includes('オンライン')) return '🔴';
  return '🔵';
}

/**
 * セッション一覧から企業全体の代表絵文字を返す（最優先種別を使用）
 * @param {Array} sessions
 * @returns {string}
 */
function companyIndicator_(sessions) {
  var best = sessions.reduce(function(acc, s) {
    return kindPriority_(s.kind) < kindPriority_(acc.kind) ? s : acc;
  }, sessions[0]);
  return kindEmoji_(best.kind);
}

/**
 * carousel を Meetup Bot でグループに送信する（最大10社/回）
 * - title: 企業名 ｜ テーマ（40字以内）
 * - text : 開催日・残席（60字以内、複数セッションは改行）
 * - action: 「詳細を見る」→ meetup:企業名
 * @param {Array} companies
 * @returns {boolean}
 */
function sendMeetupListTemplate_(companies) {
  var token = getLineWorksAccessToken();
  if (!token) return false;

  var columns = companies.map(function(c) {
    var displayName = c.name.replace(/株式会社\s*/g, '').replace(/\s*株式会社/g, '').trim();

    // title: 企業名 ｜ テーマ（40字以内）
    var title = displayName;
    if (c.theme) {
      var sep = ' ｜ ';
      var candidate = title + sep + c.theme;
      if (candidate.length <= 40) {
        title = candidate;
      } else {
        var remain = 40 - title.length - sep.length;
        if (remain > 3) title = title + sep + c.theme.substring(0, remain - 1) + '…';
      }
    }

    // text: 卒年 + 開催日 時間 残席（60字以内）
    var yearLine = '';
    if (c.targetYear) {
      var years = c.targetYear.split(/[\s　]+/).map(function(y) { return y.replace('卒', ''); }).filter(Boolean);
      yearLine = years.join('・') + '卒';
    }
    var sessionLines = [];
    var charCount = yearLine ? yearLine.length + 1 : 0; // +1 for \n after yearLine
    c.sessions.forEach(function(s) {
      var compactTime = s.time.replace(/\s*[~〜]\s*/g, '~');
      var compactRemaining = '';
      if (s.remaining) {
        var rm = s.remaining.match(/残席 ?(\d+)/);
        compactRemaining = rm ? '残席' + rm[1] + '席' : '';
      }
      var line = formatMeetupDateJP_(s.date) + compactTime;
      if (compactRemaining) line += ' ' + compactRemaining;
      var needed = (sessionLines.length > 0 ? 1 : 0) + line.length; // +1 for \n
      if (charCount + needed <= 60) {
        sessionLines.push(line);
        charCount += needed;
      }
    });
    var textParts = [];
    if (yearLine) textParts.push(yearLine);
    if (sessionLines.length > 0) textParts.push(sessionLines.join('\n'));
    var text = textParts.join('\n') || '日程調整中';

    Logger.log('【carousel】title=' + title + ' / text=' + text);
    return {
      title: title,
      text:  text,
      actions: [{
        type:  'message',
        label: '詳細を見る',
        text:  'meetup:' + c.name
      }]
    };
  });

  var url = LINEWORKS_API_BASE + '/bots/' + MEETUP_BOT_ID +
            '/channels/' + MEETUP_CHANNEL_ID + '/messages';
  var body = { content: { type: 'carousel', columns: columns } };

  try {
    var res = UrlFetchApp.fetch(url, {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'Authorization': 'Bearer ' + token },
      payload:            JSON.stringify(body),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200 && code !== 201) {
      Logger.log('carousel送信失敗: HTTP=' + code + ' ' + res.getContentText().substring(0, 300));
      return false;
    }
    Logger.log('carousel送信成功: ' + companies.length + '社');
    return true;
  } catch (e) {
    Logger.log('carousel送信エラー: ' + e.message);
    return false;
  }
}

/**
 * Meetup Bot でグループにテキストメッセージを送信する
 * @param {string} text
 * @returns {boolean}
 */
function sendMeetupGroupText_(text) {
  var token = getLineWorksAccessToken();
  if (!token) return false;

  var url = LINEWORKS_API_BASE + '/bots/' + MEETUP_BOT_ID +
            '/channels/' + MEETUP_CHANNEL_ID + '/messages';
  var body = { content: { type: 'text', text: text } };

  try {
    var res = UrlFetchApp.fetch(url, {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'Authorization': 'Bearer ' + token },
      payload:            JSON.stringify(body),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200 && code !== 201) {
      Logger.log('送信失敗: HTTP=' + code + ' ' + res.getContentText().substring(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    Logger.log('送信エラー: ' + e.message);
    return false;
  }
}

/**
 * Meetup Bot でチャンネルに企業詳細を返信する（Webhookから呼ばれる）
 * @param {string} replyChannelId
 * @param {string} companyName
 */
function handleMeetupDetailRequest_(replyChannelId, companyName) {
  var masterMap = loadCompanyIdMaster_();
  var master = masterMap[companyName] || {};
  var sessions = getCompanySessionsNextWeek_(companyName);
  var hasInPerson = sessions.some(function(s) { return s.inPerson; });

  var text = '🏢 ' + companyName + '\n';
  if (master.industry)  text += '🏭 ' + master.industry + '\n';
  if (master.theme) {
    text += '\n📌 テーマ\n' + master.theme + '\n';
  }
  if (master.aiAppeal) {
    text += '\n🤖 AIによる紹介\n' + master.aiAppeal + '\n';
  }
  if (master.staffAppeals && master.staffAppeals.length > 0) {
    var randomStaff = master.staffAppeals[Math.floor(Math.random() * master.staffAppeals.length)];
    text += '\n💬 スタッフの声\n' + randomStaff + '\n';
  }

  // セッション一覧
  if (sessions.length > 0) {
    text += '\n📅 来週の日程\n';
    sessions.forEach(function(s) {
      var line = formatMeetupDateJP_(s.date) + ' ' + s.time;
      line += '　' + kindEmoji_(s.kind) + s.kind;
      if (s.remaining) {
        // "残席 4/20" → "残席4"
        var m = s.remaining.match(/残席 ?(\d+)/);
        if (m) line += '　残席' + m[1];
      }
      text += line + '\n';
    });
  }

  var token = getLineWorksAccessToken();
  if (!token) return;

  var url = LINEWORKS_API_BASE + '/bots/' + MEETUP_BOT_ID +
            '/channels/' + replyChannelId + '/messages';
  var body = { content: { type: 'text', text: text.trim() } };

  try {
    UrlFetchApp.fetch(url, {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'Authorization': 'Bearer ' + token },
      payload:            JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('Meetup詳細返信エラー: ' + e.message);
  }
}

/**
 * 来週のその企業のセッション一覧をシートから取得する
 * @param {string} companyName
 * @returns {Array<{ date, time, kind, remaining, inPerson }>}
 */
function getCompanySessionsNextWeek_(companyName) {
  var today = new Date();
  var dow = today.getDay();
  var daysToMon = (dow === 0) ? 1 : 8 - dow;
  var weekStart = new Date(today);
  weekStart.setDate(today.getDate() + daysToMon);
  weekStart.setHours(0, 0, 0, 0);
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 5); // 月〜金

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getDataRange().getValues();
  var sessions = [];

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1] || '').trim() !== companyName) continue;
    var dateVal = data[i][0];
    if (!dateVal) continue;
    var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) continue;
    var dMid = new Date(d); dMid.setHours(0, 0, 0, 0);
    if (dMid < weekStart || dMid >= weekEnd) continue;

    var kind = String(data[i][3] || '').trim();
    sessions.push({
      date:      d,
      time:      String(data[i][2] || '').trim(),
      kind:      kind,
      remaining: calcMeetupRemaining_(String(data[i][4] || '')),
      inPerson:  isInPerson_(kind)
    });
  }

  sessions.sort(function(a, b) { return a.date - b.date || a.time.localeCompare(b.time); });
  return sessions;
}

/**
 * "X/Y" 形式の参加数から残席文字列を返す
 * @param {string} str
 * @returns {string} "残席 N/Y" or ""
 */
function calcMeetupRemaining_(str) {
  if (!str) return '';
  var m = String(str).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return '';
  var remaining = parseInt(m[2]) - parseInt(m[1]);
  return '残席 ' + remaining + '/' + m[2];
}

/**
 * Date を "3/10(月)" 形式にフォーマット
 * @param {Date} date
 * @returns {string}
 */
function formatMeetupDateJP_(date) {
  var dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  return (date.getMonth() + 1) + '/' + date.getDate() +
         '(' + dayNames[date.getDay()] + ')';
}
