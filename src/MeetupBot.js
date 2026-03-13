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
  var companies = filterAndSelectCompanies_(result.companies);

  if (companies.length === 0) {
    Logger.log('来週のMeetup予定なし → 送信スキップ');
    Logger.log('=== 週次Meetup送信 完了 ===');
    return;
  }

  // ヘッダー
  var ws = formatMeetupDateJP_(result.weekStart);
  var we = formatMeetupDateJP_(result.weekEnd);
  sendMeetupGroupText_(
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '✨ 来週のMeetup予定 ✨\n' +
    ws + ' 〜 ' + we + '　厳選' + companies.length + '社\n' +
    '━━━━━━━━━━━━━━━━━━━━'
  );

  // 4社ずつ list_template で送信
  for (var i = 0; i < companies.length; i += 4) {
    Utilities.sleep(400);
    sendMeetupListTemplate_(companies.slice(i, i + 4));
  }

  Logger.log('=== 週次Meetup送信 完了: ' + companies.length + '社 ===');
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
  weekEnd.setDate(weekStart.getDate() + 7);

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
      companyMap[company] = {
        name:       company,
        industry:   master.industry || '',
        theme:      master.theme    || '',
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
 * 企業リストを絞り込んで最大8社を選ぶ
 * - 満席セッションを除外（残席0の回は非表示）
 * - 対面（残席あり）は全社必ず含める
 * - 不足分をオンライン（残席あり）からランダム補完し合計8社へ
 * - 対面が8社以上の場合は対面のみ全社表示
 * @param {Array} companies
 * @returns {Array}
 */
function filterAndSelectCompanies_(companies) {
  var MAX = 8;

  // 各社の満席セッションを除外し、セッションが0になった企業ごと除外
  var available = companies.map(function(c) {
    var sessions = c.sessions.filter(function(s) {
      return !isSoldOut_(s.remaining);
    });
    return sessions.length > 0
      ? { name: c.name, industry: c.industry, theme: c.theme, targetYear: c.targetYear,
          firstDate: c.firstDate, sessions: sessions }
      : null;
  }).filter(Boolean);

  // 優先度でグループ分け: 特別イベント > 対面 > 貸切 > オンライン
  var special   = available.filter(function(c) { return c.sessions.some(function(s) { return s.kind.includes('特別'); }); });
  var inPerson  = available.filter(function(c) { return !special.includes(c) && c.sessions.some(function(s) { return s.inPerson && !s.kind.includes('貸切'); }); });
  var kasshiki  = available.filter(function(c) { return !special.includes(c) && c.sessions.some(function(s) { return s.kind.includes('貸切'); }); });
  var onlineOnly = available.filter(function(c) { return !special.includes(c) && !inPerson.includes(c) && !kasshiki.includes(c); });

  // 特別イベント・対面・貸切は全社必ず含める
  var selected = special.concat(inPerson).concat(kasshiki);

  // 8社未満ならオンラインからランダムで補完
  var need = MAX - selected.length;
  if (need > 0 && onlineOnly.length > 0) {
    var shuffled = onlineOnly.slice().sort(function() { return Math.random() - 0.5; });
    selected = selected.concat(shuffled.slice(0, need));
  }

  // 最初の開催日順にソートして返す
  selected.sort(function(a, b) { return a.firstDate - b.firstDate; });
  return selected;
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
 * list_template を Meetup Bot でグループに送信する（最大4社/回）
 * @param {Array} companies
 * @returns {boolean}
 */
function sendMeetupListTemplate_(companies) {
  var token = getLineWorksAccessToken();
  if (!token) return false;

  var elements = companies.map(function(c) {
    var displayName = c.name.replace(/株式会社\s*/g, '').replace(/\s*株式会社/g, '').trim();
    var indicator = companyIndicator_(c.sessions);
    var sessionLines = c.sessions.map(function(s) {
      var compactTime = s.time.replace(/\s*[~〜]\s*/g, '~');
      var compactRemaining = s.remaining ? s.remaining.replace('残席 ', '残').replace('残席', '残') : '';
      var line = formatMeetupDateJP_(s.date) + compactTime;
      if (compactRemaining) line += ' ' + compactRemaining;
      return line;
    });
    var lines = [];
    if (c.targetYear) {
      var years = c.targetYear.split(/[\s　]+/).map(function(y) { return y.replace('卒', ''); }).filter(Boolean);
      var yearStr = years.length > 0 ? years.join('・') + '卒' : c.targetYear;
      lines.push('🎓 ' + yearStr);
    }
    sessionLines.forEach(function(sl) { lines.push(sl); });
    var subtitle = lines.join('\n');
    Logger.log('【subtitle】' + JSON.stringify(subtitle));
    return {
      title:    '🏢 ' + displayName + '　' + indicator,
      subtitle: subtitle,
      action: {
        type:  'message',
        label: 'テーマを見る',
        text:  'meetup:' + c.name
      }
    };
  });

  var url = LINEWORKS_API_BASE + '/bots/' + MEETUP_BOT_ID +
            '/channels/' + MEETUP_CHANNEL_ID + '/messages';
  var body = { content: { type: 'list_template', elements: elements } };

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
      Logger.log('list_template送信失敗: HTTP=' + code + ' ' + res.getContentText().substring(0, 300));
      return false;
    }
    Logger.log('list_template送信成功: ' + companies.length + '社');
    return true;
  } catch (e) {
    Logger.log('list_template送信エラー: ' + e.message);
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
  if (master.theme)     text += '\n📌 ' + master.theme + '\n';
  // アピールポイントをランダムに1つ選んで表示
  var appealPoints = master.appealPoints && master.appealPoints.length > 0
    ? master.appealPoints
    : (master.hookPoint ? [master.hookPoint] : []);
  if (appealPoints.length > 0) {
    var randomAppeal = appealPoints[Math.floor(Math.random() * appealPoints.length)];
    text += '\n💬 ' + randomAppeal + '\n';
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
  weekEnd.setDate(weekStart.getDate() + 7);

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
