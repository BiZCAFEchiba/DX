// ============================================================
// Meetup取得.js - SHIRUCAFE管理画面からMeetup予定を自動取得
// ============================================================

const SHIRUCAFE_BASE_URL = 'https://admin.shirucafe.com';
const SHIRUCAFE_EMAIL = 'originalcafe423+staff@gmail.com';
const SHIRUCAFE_PASSWORD = 'cafe46423';
const SHIRUCAFE_STORE_ID = '38';
const SHEET_MEETUP = 'Meetup予定';
const SHEET_COMPANY_IDS = '企業IDマスター';

/**
 * メイン処理 - 翌週1週間分のMeetup予定を取得してスプレッドシートに書き込む
 * 毎週月曜日のトリガーで自動実行
 */
function fetchMeetupSchedule() {
  const cookies = loginToShirucafe_();
  if (!cookies) {
    Logger.log('ログイン失敗: セッションCookieを取得できませんでした');
    return;
  }

  // 翌週月曜日から7日分を取得
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=日, 1=月, ..., 6=土
  const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilNextMonday);
  nextMonday.setHours(0, 0, 0, 0);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MEETUP);
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, 4).setValues([['日付', '企業名', '時間', '種別']]);

  let row = 2;
  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(nextMonday);
    targetDate.setDate(nextMonday.getDate() + i);
    const reserves = fetchReservesByDate_(targetDate, cookies);
    reserves.forEach(reserve => {
      const reserveId = String(reserve.id || reserve.reserve_id || reserve.shiru_reserve_id || '');
      sheet.getRange(row, 1, 1, 4).setValues([[
        targetDate, reserve.sponsor_name, reserve.time, reserve.kind
      ]]);
      if (reserve.sponsor_name) {
        const fields = reserveId ? fetchMeetupFields_(reserveId, cookies, reserve.sponsor_name) : {};
        // テーマのみ自動保存（業界・アピールポイントは手動入力）
        saveToCompanyIdMaster_(reserve.sponsor_name, reserveId, { theme: fields.theme || '' });
      }
      row++;
    });
  }

  if (row > 2) sheet.getRange(2, 1, row - 2, 1).setNumberFormat('M/d(E)');
  Logger.log('Meetup予定の取得完了: ' + (row - 2) + '件');

  // ホームページのHTML・Inertia JSONからID未取得企業を補完
  fillMissingIdsFromHtml_(cookies);
}

/**
 * 今週分（今週月曜〜日曜）のMeetup予定を取得してシートに追記する（一度だけ実行）
 * 既存データは消さずに末尾へ追加する
 */
function fetchThisWeekMeetupSchedule() {
  const cookies = loginToShirucafe_();
  if (!cookies) {
    Logger.log('ログイン失敗: セッションCookieを取得できませんでした');
    return;
  }

  // 今週の月曜日を計算
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=日, 1=月
  const daysToThisMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + daysToThisMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MEETUP);
    sheet.getRange(1, 1, 1, 4).setValues([['日付', '企業名', '時間', '種別']]);
  }

  const startRow = sheet.getLastRow() + 1;
  let row = startRow;

  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(thisMonday);
    targetDate.setDate(thisMonday.getDate() + i);

    const reserves = fetchReservesByDate_(targetDate, cookies);
    reserves.forEach(reserve => {
      const reserveId = String(reserve.id || reserve.reserve_id || reserve.shiru_reserve_id || '');
      sheet.getRange(row, 1, 1, 4).setValues([[
        targetDate, reserve.sponsor_name, reserve.time, reserve.kind
      ]]);
      if (reserve.sponsor_name) {
        const fields = reserveId ? fetchMeetupFields_(reserveId, cookies, reserve.sponsor_name) : {};
        // テーマのみ自動保存（業界・アピールポイントは手動入力）
        saveToCompanyIdMaster_(reserve.sponsor_name, reserveId, { theme: fields.theme || '' });
      }
      row++;
    });
  }

  const added = row - startRow;
  if (added > 0) {
    sheet.getRange(startRow, 1, added, 1).setNumberFormat('M/d(E)');
  }
  Logger.log('今週分Meetup追記完了: ' + added + '件');

  // ホームページのHTML・Inertia JSONからID未取得企業を補完
  fillMissingIdsFromHtml_(cookies);
}

/**
 * 今日から14日分のMeetup予定を差分追加する（毎日更新用）
 * 既存データは保持し、新規イベントのみ追記する。F列IDも随時補完。
 * 毎日6時のトリガーで自動実行
 */
function fetchAllUpcomingMeetups() {
  const cookies = loginToShirucafe_();
  if (!cookies) {
    Logger.log('ログイン失敗: セッションCookieを取得できませんでした');
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MEETUP);
    sheet.getRange(1, 1, 1, 6).setValues([['日付', '企業名', '時間', '種別', '参加数', '予約ID']]);
    sheet.getRange(1, 5, 1000, 1).setNumberFormat('@');
  }

  // ヘッダーが古い場合（6列 or 7列）は8列に更新
  if (sheet.getLastRow() >= 1 && sheet.getLastColumn() < 8) {
    sheet.getRange(1, 1, 1, 8).setValues([['日付', '企業名', '時間', '種別', '参加数', '予約ID', '卒年', 'イメージURL']]);
    sheet.getRange(1, 5, 1000, 1).setNumberFormat('@');
  }

  // 既存データのキー（企業名_日付_時間）を収集（重複追加防止）
  const existingKeys = {};
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existingData = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    existingData.forEach(function(row) {
      const d = row[0];
      const dateStr = d instanceof Date
        ? Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd')
        : String(d).substring(0, 10);
      existingKeys[String(row[1] || '') + '_' + dateStr + '_' + String(row[2] || '')] = true;
    });
  }
  Logger.log('既存データ: ' + Object.keys(existingKeys).length + '件');

  // 今日から30日分を取得して新規行のみ追記
  const fetchedKeys = {}; // 取得済みキーを記録（キャンセル検知に使用）
  const newRows = [];
  for (let i = 0; i < 30; i++) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + i);
    const dateStr = Utilities.formatDate(targetDate, TIMEZONE, 'yyyy-MM-dd');

    const reserves = fetchReservesByDate_(targetDate, cookies);
    reserves.forEach(function(reserve) {
      const cName = String(reserve.sponsor_name || '').trim();
      const time = reserve.time || '';
      const key = cName + '_' + dateStr + '_' + time;
      fetchedKeys[key] = true;
      if (!existingKeys[key]) {
        newRows.push([targetDate, cName, time, reserve.kind || '', '', '', '']);
        existingKeys[key] = true;
      }
    });
  }

  // キャンセル検知: 既存シートの将来分で取得データにないものを削除して通知
  removeDeletedMeetups_(sheet, fetchedKeys, today);

  if (newRows.length > 0) {
    const insertRow = sheet.getLastRow() + 1;
    sheet.getRange(insertRow, 1, newRows.length, 7).setValues(newRows);
    sheet.getRange(insertRow, 1, newRows.length, 1).setNumberFormat('M/d(E)');
    sheet.getRange(insertRow, 5, newRows.length, 1).setNumberFormat('@');
  }
  Logger.log('fetchAllUpcomingMeetups: 新規追加=' + newRows.length + '件');
  SpreadsheetApp.flush();

  // F列（予約ID）をHTMLスキャン＋APIで補完（高速モード：fetchMeetupFields_省略）
  Logger.log('F列ID補完開始...');
  fillMissingIdsFromHtml_(cookies, true);

  // 企業IDマスターに未登録の企業を追加し、テーマ・業界・アピールポイントを取得
  Logger.log('企業IDマスター同期開始...');
  syncNewCompaniesToMaster_(cookies);
}

/**
 * キャンセル検知: シートの将来イベントのうち取得データにないものを削除し LINE WORKS 通知
 * @param {Sheet} sheet - Meetup予定シート
 * @param {Object} fetchedKeys - { "企業名_日付_時間": true } の形式
 * @param {Date} today - 本日 00:00:00
 */
function removeDeletedMeetups_(sheet, fetchedKeys, today) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const todayTime = today.getTime();
  const deleted = [];

  // 後ろから削除（行番号ずれ防止）
  for (let i = data.length - 1; i >= 0; i--) {
    const dateVal = data[i][0];
    if (!dateVal) continue;
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) continue;
    if (d.getTime() < todayTime) continue; // 過去のデータは対象外

    const dateStr = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
    const cName = String(data[i][1] || '').trim();
    const time  = String(data[i][2] || '').trim();
    const kind  = String(data[i][3] || '').trim();
    const key = cName + '_' + dateStr + '_' + time;

    if (!fetchedKeys[key]) {
      deleted.push({
        dateLabel: Utilities.formatDate(d, TIMEZONE, 'M/d(E)'),
        company: cName,
        time: time,
        kind: kind
      });
      sheet.deleteRow(i + 2);
      Logger.log('キャンセル削除: ' + cName + ' ' + dateStr + ' ' + time);
    }
  }

  if (deleted.length === 0) return;

  Logger.log('キャンセル削除合計: ' + deleted.length + '件');

  // LINE WORKS グループに通知
  let msg = '🚫 【Meetupキャンセル通知】\n';
  msg += '以下のMeetupがキャンセル（または変更）されました。\n\n';
  deleted.forEach(function(item) {
    msg += '📅 ' + item.dateLabel + '　' + item.time + '\n';
    msg += '🏢 ' + item.company;
    if (item.kind) msg += '（' + item.kind + '）';
    msg += '\n\n';
  });
  msg += 'シフト・準備の調整をお願いします。';
  sendLineWorksGroupMessage(msg);
}

/**
 * 詳細HTMLページから学生予約人数を取得する
 * （student_number = 学生参加枠 = 分母、学生予約人数 = 分子）
 * @param {string} reserveId
 * @param {Object} cookies
 * @returns {number|null}
 */
function fetchYoyakuFromHtml_(reserveId, cookies) {
  try {
    const xsrfToken = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
    const res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/reserve/detail/' + reserveId, {
      headers: { 'Cookie': buildCookieString_(cookies), 'X-XSRF-TOKEN': xsrfToken },
      followRedirects: true,
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('詳細ページ取得失敗 (ID=' + reserveId + '): HTTP ' + res.getResponseCode());
      return null;
    }
    const html = res.getContentText();
    const m = html.match(/学生予約人数[\s\S]{0,400}?(\d+)\s*人/);
    if (m) {
      Logger.log('学生予約人数取得 (ID=' + reserveId + '): ' + m[1]);
      return Number(m[1]);
    }
    Logger.log('学生予約人数: HTMLで未発見 (ID=' + reserveId + ')');
    return null;
  } catch (e) {
    Logger.log('fetchYoyakuFromHtml_ エラー: ' + e.message);
    return null;
  }
}

/**
 * Meetup予定シートのE列（参加数）を更新する
 * 学生予約人数(分子) / 学生参加枠(分母) 形式で書き込む
 * @param {Sheet} sheet - Meetup予定シート
 * @param {Object} cookies
 */
function updateMeetupParticipation_(sheet, cookies) {
  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log('updateMeetupParticipation_: シートが空またはnull');
    return;
  }
  const masterMap = loadCompanyIdMaster_();
  const masterWithId = Object.keys(masterMap).filter(function(k) { return masterMap[k].reserveId; });
  Logger.log('updateMeetupParticipation_: masterMap=' + Object.keys(masterMap).length + '社 / ID有り=' + masterWithId.length + '社');

  const xsrfToken = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
  const lastRow = sheet.getLastRow();
  Logger.log('updateMeetupParticipation_: シート行数=' + lastRow);

  // E列をテキスト形式に強制設定（"0/3"が 0÷3=0 と解釈されるのを防ぐ）
  sheet.getRange(2, 5, lastRow - 1, 1).setNumberFormat('@');

  // A〜G列を読み込む（F列=予約ID、G列=卒年）
  const numCols = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, lastRow - 1, Math.max(numCols, 7)).getValues();
  let matched = 0;
  let updated = 0;

  // reserveId → {displayVal, gradYear} のキャッシュ
  const apiCache = {};

  data.forEach(function(row, i) {
    const companyName = String(row[1] || '').trim();
    if (!companyName) return;
    // F列（index=5）に予約IDがあるもののみ対象
    const reserveId = String(row[5] || '').trim();
    if (!reserveId) return;
    matched++;

    // キャッシュ済みなら即書込
    if (apiCache[reserveId] !== undefined) {
      sheet.getRange(i + 2, 5).setValue(apiCache[reserveId].displayVal);
      if (apiCache[reserveId].gradYear && !String(row[6] || '').trim()) {
        sheet.getRange(i + 2, 7).setValue(apiCache[reserveId].gradYear);
      }
      if (apiCache[reserveId].imageUrl && !String(row[7] || '').trim()) {
        sheet.getRange(i + 2, 8).setValue(apiCache[reserveId].imageUrl);
      }
      updated++;
      return;
    }

    try {
      Utilities.sleep(400); // レート制限対策
      const res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/api/shiru_reserves/' + reserveId, {
        headers: {
          'Cookie': buildCookieString_(cookies),
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-XSRF-TOKEN': xsrfToken
        },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) {
        Logger.log('参加数API失敗 (' + companyName + '): HTTP ' + res.getResponseCode());
        apiCache[reserveId] = { displayVal: '', gradYear: '' };
        return;
      }
      const apiData = JSON.parse(res.getContentText());
      const record = apiData.reserve || apiData;
      // student_number = 学生参加枠（募集人数）= 分母
      const boshu = record.student_number != null ? Number(record.student_number) : 0;
      // 卒年 (reserve_grade_year)
      let gradYear = '';
      if (record.reserve_grade_year) {
        const years = String(record.reserve_grade_year).split(',').map(function(y) {
          const yr = y.trim();
          if (!yr) return '';
          return (yr.length === 4 ? yr.slice(2) : yr) + '卒';
        }).filter(function(v) { return v; });
        gradYear = years.filter(function(v, i, a) { return a.indexOf(v) === i; }).sort().join(' ');
      }
      // イメージURL（meetup_image_url = S3フルURL）
      const imageUrl = String(record.meetup_image_url || '').trim();
      // 学生予約人数（分子）= 詳細HTMLページから取得
      Utilities.sleep(400);
      const yoyaku = fetchYoyakuFromHtml_(reserveId, cookies);
      let displayVal;
      if (yoyaku !== null && boshu > 0) {
        displayVal = yoyaku + '/' + boshu;
      } else if (boshu > 0) {
        displayVal = '?/' + boshu;
      } else {
        displayVal = '';
      }
      apiCache[reserveId] = { displayVal: displayVal, gradYear: gradYear, imageUrl: imageUrl };
      sheet.getRange(i + 2, 5).setValue(displayVal);
      if (gradYear) sheet.getRange(i + 2, 7).setValue(gradYear);
      if (imageUrl) sheet.getRange(i + 2, 8).setValue(imageUrl);
      Logger.log('参加数書込: ' + companyName + ' → ' + displayVal + ' / 卒年: ' + gradYear + ' / 画像: ' + (imageUrl ? 'あり' : 'なし') + ' (行' + (i + 2) + ')');
      updated++;
    } catch (e) {
      Logger.log('参加数取得エラー (' + companyName + '): ' + e.message);
      apiCache[reserveId] = { displayVal: '', gradYear: '' };
    }
  });

  Logger.log('updateMeetupParticipation_完了: ' + matched + '社対象 / ' + updated + '件書込');
}

/**
 * SHIRUCAFEのHTMLページからInertia.js埋め込みJSONを取得し、
 * テーマ・企業説明を抽出して返す（取得できない場合は空オブジェクト）
 * @param {Date} weekStart - 週の開始日（月曜）
 * @param {Object} cookies
 * @returns {Object} { "企業名_時間": { theme, description } }
 */
function tryEnrichFromSHIRUCAFE_(weekStart, cookies) {
  const enrichMap = {};
  const dateStr = Utilities.formatDate(weekStart, TIMEZONE, 'yyyy-MM-dd');

  // 試みるURLパターン
  const urlsToTry = [
    SHIRUCAFE_BASE_URL + '/shiru_reserves?store_id_list=' + SHIRUCAFE_STORE_ID + '&reserve_day=' + encodeURIComponent(dateStr + ' 00:00:00'),
    SHIRUCAFE_BASE_URL + '/shiru_reserves',
    SHIRUCAFE_BASE_URL + '/calendar'
  ];

  // ホームページから有効なreserve系URLを発見してリストに追加
  try {
    const homeRes = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/', {
      headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html' },
      followRedirects: true,
      muteHttpExceptions: true
    });
    if (homeRes.getResponseCode() === 200) {
      const homeHtml = homeRes.getContentText();

      // ナビゲーションのhrefからreserve/meetup/shiru系リンクを収集
      const linkRe = /href="([^"]*(?:reserve|shiru|meetup|calendar|schedule)[^"]*)"/gi;
      const linkSet = [];
      let lm;
      while ((lm = linkRe.exec(homeHtml)) !== null) {
        const href = lm[1].startsWith('http') ? lm[1] : SHIRUCAFE_BASE_URL + lm[1];
        if (href.startsWith(SHIRUCAFE_BASE_URL) && linkSet.indexOf(href) === -1) {
          linkSet.push(href);
        }
      }
      Logger.log('ホームから発見したreserve系リンク: ' + JSON.stringify(linkSet.slice(0, 10)));
      linkSet.forEach(function (u) { if (urlsToTry.indexOf(u) === -1) urlsToTry.push(u); });

      // ホーム自体にInertia/reserve/detail/{id}があれば処理
      const homeInertia = homeHtml.match(/data-page="([^"]+)"/);
      if (homeInertia) {
        Logger.log('ホームページにInertiaデータあり → URLリストに追加済みで再処理');
      }
      const homeIdRe = /\/(?:reserve|shiru_reserve|shiru_reserves)\/(?:detail\/|show\/|edit\/)?(\d+)/g;
      const homeIds = [];
      let hm;
      while ((hm = homeIdRe.exec(homeHtml)) !== null) {
        if (homeIds.indexOf(hm[1]) === -1) homeIds.push(hm[1]);
      }
      if (homeIds.length > 0) {
        Logger.log('ホームからReserveID発見: [' + homeIds.join(', ') + ']');
        homeIds.forEach(function (id) { tryEnrichFromDetailPage_(id, cookies, enrichMap); });
      }
    }
  } catch (e) {
    Logger.log('ホームページ取得エラー: ' + e.message);
  }

  if (Object.keys(enrichMap).length > 0) {
    Logger.log('enrich結果: ' + Object.keys(enrichMap).length + '件マッチ');
    return enrichMap;
  }

  for (let ui = 0; ui < urlsToTry.length; ui++) {
    const url = urlsToTry[ui];
    try {
      const res = UrlFetchApp.fetch(url, {
        headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html' },
        followRedirects: true,
        muteHttpExceptions: true
      });
      const code = res.getResponseCode();
      Logger.log('enrich試行 [' + url + ']: HTTP ' + code);
      if (code !== 200) continue;

      const html = res.getContentText();

      // ① Inertia.js の data-page 属性から埋め込みJSON を解析
      const inertiaMatch = html.match(/data-page="([^"]+)"/);
      if (inertiaMatch) {
        try {
          const decoded = inertiaMatch[1]
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&');
          const pageData = JSON.parse(decoded);
          Logger.log('Inertia props keys: ' + JSON.stringify(Object.keys(pageData.props || {})));

          // reservesやshiru_reservesなどのキーを探す
          const props = pageData.props || {};
          const reserveList = props.shiru_reserves || props.reserves || props.data || null;
          if (reserveList && Array.isArray(reserveList)) {
            Logger.log('Inertia reserveList: ' + reserveList.length + '件, fields: ' + JSON.stringify(Object.keys(reserveList[0] || {})));
            reserveList.forEach(function (r) {
              const key = (r.sponsor_name || '') + '_' + (r.time || '');
              const ed = r.event_details || r.details || r.description || '';
              enrichMap[key] = {
                theme: r.theme || r.title || r.meetup_theme || r.subject || '',
                targetYear: r.target_year || r.graduation_year || r.year || '',
                industry: extractIndustryTags_(ed),
                hookPoint: r.hook_point || r.hook || r.pitch || r.appeal || '',
                companyUrl: r.sponsor_url || r.company_url || r.website || r.hp_url || r.url || '',
                reserveId: String(r.id || r.reserve_id || r.shiru_reserve_id || '')
              };
            });
            if (Object.keys(enrichMap).length > 0) break;
          }
        } catch (e) {
          Logger.log('Inertia JSON解析エラー: ' + e.message);
        }
      }

      // ② reserve/detail/{id} リンクを探す（パターン拡張）
      const idPattern = /\/(?:reserve|shiru_reserve|shiru_reserves)\/(?:detail\/|show\/|edit\/)?(\d+)/g;
      const ids = [];
      let m;
      while ((m = idPattern.exec(html)) !== null) {
        if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
      }
      if (ids.length > 0) {
        Logger.log('HTMLからReserveID発見: [' + ids.join(', ') + ']');
        ids.forEach(function (id) {
          tryEnrichFromDetailPage_(id, cookies, enrichMap);
        });
        if (Object.keys(enrichMap).length > 0) break;
      }

      // 調査用: HTMLスニペットを出力
      Logger.log('HTMLスニペット (' + url + '): ' + html.substring(0, 800));

    } catch (e) {
      Logger.log('enrich取得エラー (' + url + '): ' + e.message);
    }
  }

  Logger.log('enrich結果: ' + Object.keys(enrichMap).length + '件マッチ');
  return enrichMap;
}

/**
 * reserve詳細ページからテーマ・企業説明を取得してenrichMapに追加する
 * @param {string} reserveId
 * @param {Object} cookies
 * @param {Object} enrichMap - 結果を書き込む参照
 */
function tryEnrichFromDetailPage_(reserveId, cookies, enrichMap) {
  // /reserve/detail/{id} が唯一動作するURL（他は404確認済み）
  let html = null;
  try {
    const res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/reserve/detail/' + reserveId, {
      headers: { 'Cookie': buildCookieString_(cookies) },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('detail 取得失敗 (ID=' + reserveId + '): HTTP ' + res.getResponseCode());
      return;
    }
    html = res.getContentText();
  } catch (e) {
    Logger.log('detail取得エラー (ID=' + reserveId + '): ' + e.message);
    return;
  }

  // ① Inertia.js の data-page から取得（SPAの場合）
  const inertiaMatch = html.match(/data-page="([^"]+)"/);
  if (inertiaMatch) {
    try {
      const decoded = inertiaMatch[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
      const pageData = JSON.parse(decoded);
      const props = pageData.props || {};
      Logger.log('detail (ID=' + reserveId + ') props keys: ' + JSON.stringify(Object.keys(props)));
      const r = props.shiru_reserve || props.reserve || props.data || null;
      if (r) {
        const key = (r.sponsor_name || '') + '_' + (r.time || '');
        const ed = r.event_details || r.details || r.description || '';
        enrichMap[key] = {
          theme: r.theme || r.title || r.meetup_theme || r.subject || '',
          targetYear: r.target_year || r.graduation_year || r.year || '',
          industry: extractIndustryTags_(ed),
          hookPoint: r.hook_point || r.hook || r.pitch || r.appeal || '',
          companyUrl: r.sponsor_url || r.company_url || r.website || r.hp_url || r.url || '',
          reserveId: String(reserveId)
        };
        Logger.log('detail Inertia enrich成功 (ID=' + reserveId + '): key=' + key);
      }
    } catch (e) {
      Logger.log('detail Inertia解析エラー: ' + e.message);
    }
    return;
  }

  // ② 従来型 Blade HTML からスクレイピング
  // <body> 以降だけを対象にして速度・精度を上げる
  const bodyStart = html.indexOf('<body');
  const bodyHtml = bodyStart >= 0 ? html.substring(bodyStart) : html;

  // フォームの input[name]/textarea[name] を収集
  const formData = {};
  const inputRe = /<input[^>]+>/gi;
  let im;
  while ((im = inputRe.exec(bodyHtml)) !== null) {
    const tag = im[0];
    const nameM = tag.match(/name="([^"]+)"/);
    const valM = tag.match(/value="([^"]*)"/);
    if (nameM) formData[nameM[1]] = valM ? valM[1] : '';
  }
  const textareaRe = /<textarea[^>]+name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/gi;
  let tam;
  while ((tam = textareaRe.exec(bodyHtml)) !== null) {
    formData[tam[1]] = tam[2].replace(/<[^>]+>/g, '').trim();
  }

  // <th>〜</th> <td>〜</td> の隣接ペアを収集
  const thTd = {};
  const thTdRe = /<th[^>]*>\s*([\s\S]*?)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tm;
  while ((tm = thTdRe.exec(bodyHtml)) !== null) {
    const k = tm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const v = tm[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (k && v) thTd[k] = v;
  }

  // ログ出力（構造確認用）
  Logger.log('detail formData (ID=' + reserveId + '): ' + JSON.stringify(formData).substring(0, 500));
  Logger.log('detail thTd (ID=' + reserveId + '): ' + JSON.stringify(thTd).substring(0, 500));
  if (Object.keys(formData).length === 0 && Object.keys(thTd).length === 0) {
    // まだ何も取れない場合はbodyの先頭を出力して構造を確認
    Logger.log('detail body snippet (ID=' + reserveId + '): ' + bodyHtml.substring(0, 3000));
    return;
  }

  // sponsor_name と time を特定してenrichMapキーを生成
  const sponsorName = formData['sponsor_name'] || thTd['企業名'] || thTd['スポンサー'] || thTd['会社名'] || '';
  const time = formData['time'] || formData['start_time'] || thTd['時間'] || thTd['開始時間'] || thTd['実施時間'] || '';

  if (!sponsorName || !time) {
    Logger.log('detail sponsor_name/time 特定不可 (ID=' + reserveId + ') formData keys: ' + JSON.stringify(Object.keys(formData)));
    return;
  }

  const key = sponsorName + '_' + time;
  enrichMap[key] = {
    theme: formData['theme'] || thTd['テーマ'] || thTd['meetupテーマ'] || '',
    targetYear: formData['target_year'] || thTd['対象年'] || '',
    description: formData['description'] || thTd['企業説明'] || thTd['説明'] || '',
    hookPoint: formData['hook_point'] || thTd['フックポイント'] || '',
    companyUrl: formData['sponsor_url'] || formData['company_url'] || thTd['企業URL'] || thTd['HP'] || '',
    reserveId: String(reserveId)
  };
  Logger.log('detail HTML scrape成功 (ID=' + reserveId + '): key=' + key + ', desc=' + (enrichMap[key].description || '（なし）').substring(0, 30));
}

/**
 * 企業の公式HPを取得してテキストを返す（タグ除去済み・最大1500文字）
 * @param {string} url - 企業HP URL
 * @returns {string}
 */
function fetchCompanyHP_(url) {
  if (!url) return '';
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.getResponseCode() !== 200) return '';
    return res.getContentText()
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim()
      .substring(0, 1500);
  } catch (e) {
    Logger.log('HP取得エラー: ' + e.message);
    return '';
  }
}

// ============================================================
// Gemini API 日次使用回数管理（上限 20回/日）
// ============================================================

var GEMINI_DAILY_LIMIT = 20;

/**
 * 本日のGemini使用回数を取得する（スクリプトプロパティ管理）
 * @returns {{ date: string, count: number }}
 */
function getGeminiDailyUsage_() {
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var raw = PropertiesService.getScriptProperties().getProperty('GEMINI_DAILY');
  if (!raw) return { date: today, count: 0 };
  try {
    var obj = JSON.parse(raw);
    return obj.date === today ? obj : { date: today, count: 0 };
  } catch (e) { return { date: today, count: 0 }; }
}

/**
 * Geminiを呼び出せるか確認する（上限未達 & APIキーあり）
 * @returns {boolean}
 */
function canCallGemini_() {
  if (!GEMINI_API_KEY) return false;
  return getGeminiDailyUsage_().count < GEMINI_DAILY_LIMIT;
}

/**
 * Gemini呼び出し後に使用回数をインクリメントする
 * @returns {number} 更新後の使用回数
 */
function recordGeminiCall_() {
  var usage = getGeminiDailyUsage_();
  usage.count++;
  PropertiesService.getScriptProperties().setProperty('GEMINI_DAILY', JSON.stringify(usage));
  Logger.log('Gemini使用回数: ' + usage.count + '/' + GEMINI_DAILY_LIMIT);
  return usage.count;
}

// ============================================================

/**
 * Gemini API を使ってカフェスタッフ向けフックポイントを生成する
 * モデル: gemini-2.5-flash
 * @param {string} companyName
 * @param {string} description - SHIRUCAFEの企業説明
 * @param {string} hpText      - 企業HPから取得したテキスト
 * @returns {string}
 */
function generateStudentHook_(companyName, description, hpText) {
  if (!GEMINI_API_KEY) return '';
  const info = [
    description ? '企業説明: ' + description : '',
    hpText ? 'HP情報: ' + hpText.substring(0, 800) : ''
  ].filter(Boolean).join('\n');

  const prompt = 'あなたはカフェで働く大学生スタッフ向けの案内を書くアシスタントです。\n' +
    '以下の企業情報をもとに、「この会社の人と話してみたい！」と感じさせる' +
    'フックポイントを2〜3行で書いてください。\n' +
    '・どんなビジネスか（学生に分かりやすく）\n・面白いポイントや珍しい点\n' +
    '・話しかけるとよい話題のヒント\nフックポイントの文章のみ出力してください。\n\n' +
    '企業名: ' + companyName + '\n' + info;

  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  try {
    Utilities.sleep(4100); // 無料枠 15 RPM = 4秒/リクエスト
    const res = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      const result = JSON.parse(res.getContentText());
      const hook = result.candidates[0].content.parts[0].text.trim();
      Logger.log('学生フック生成成功 (' + companyName + '): ' + hook.substring(0, 50));
      return hook;
    }
    if (res.getResponseCode() === 429) {
      Logger.log('Gemini API レート制限 (フック): クォータ超過 - ' + companyName);
      return '';
    }
    Logger.log('Gemini API エラー: ' + res.getContentText().substring(0, 200));
  } catch (e) {
    Logger.log('Gemini API 呼び出しエラー: ' + e.message);
  }
  return '';
}

/**
 * Gemini API を使ってMeetupのテーマを生成する
 * @param {string} companyName
 * @param {string} kind - 種別（例: 企業説明、インターン説明など）
 * @param {string} description - 企業説明（あれば）
 * @returns {string}
 */
function generateTheme_(companyName, kind, description) {
  if (!GEMINI_API_KEY) return '';
  const info = [
    kind ? '種別: ' + kind : '',
    description ? '企業説明: ' + description.substring(0, 500) : ''
  ].filter(Boolean).join('\n');

  const prompt = 'あなたはカフェで行われる企業Meetupのテーマを考えるアシスタントです。\n' +
    '以下の情報をもとに、Meetupのテーマを20文字以内で1つ提案してください。\n' +
    '例: 「ITエンジニアへのキャリアパス」「スタートアップの資金調達」など\n' +
    'テーマ文のみを出力してください（カギ括弧不要）。\n\n' +
    '企業名: ' + companyName + '\n' + info;

  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  try {
    Utilities.sleep(4100); // 無料枠 15 RPM = 4秒/リクエスト
    const res = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      const result = JSON.parse(res.getContentText());
      const theme = result.candidates[0].content.parts[0].text.trim();
      Logger.log('テーマ生成成功 (' + companyName + '): ' + theme);
      return theme;
    }
    if (res.getResponseCode() === 429) {
      Logger.log('Gemini API レート制限 (テーマ): クォータ超過 - ' + companyName);
      return '';
    }
    Logger.log('Gemini API エラー (テーマ): ' + res.getContentText().substring(0, 200));
  } catch (e) {
    Logger.log('Gemini API 呼び出しエラー (テーマ): ' + e.message);
  }
  return '';
}

/**
 * 企業IDマスターの業界が空の企業をGeminiで一括分類して埋める
 * 全企業を1リクエストにまとめてGeminiに送るため、レート制限を回避できる
 * 毎日の dailyMeetupUpdate からも自動実行される
 */
function fillIndustryWithGemini_() {
  if (!GEMINI_API_KEY) {
    Logger.log('fillIndustryWithGemini_: GEMINI_API_KEYが未設定');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const numCols = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  let themeIdx = 1, industryIdx = 2;
  header.forEach(function(h, i) {
    const s = String(h || '');
    if (s === 'テーマ') themeIdx = i;
    else if (s === '業界') industryIdx = i;
  });

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();

  // 業界が空の行を収集
  const targets = [];
  data.forEach(function(row, i) {
    const company  = String(row[0]           || '').trim();
    const industry = String(row[industryIdx] || '').trim();
    if (!company || industry) return; // 既に入力済みはスキップ
    targets.push({ rowIdx: i, company: company, theme: String(row[themeIdx] || '').trim() });
  });

  if (targets.length === 0) {
    Logger.log('fillIndustryWithGemini_: 対象なし');
    return;
  }
  if (!canCallGemini_()) {
    Logger.log('fillIndustryWithGemini_: 本日のGemini使用上限に達しています');
    return;
  }
  Logger.log('fillIndustryWithGemini_: 対象 ' + targets.length + '社');

  // 30社ずつバッチで1リクエストに束ねて送信
  const BATCH_SIZE = 30;
  let updated = 0;

  for (var b = 0; b < targets.length; b += BATCH_SIZE) {
    if (!canCallGemini_()) {
      Logger.log('fillIndustryWithGemini_: 上限到達のため中断');
      break;
    }
    var batch = targets.slice(b, b + BATCH_SIZE);
    var resultMap = classifyIndustriesBatch_(batch);
    recordGeminiCall_();

    batch.forEach(function(item) {
      var industry = resultMap[item.company];
      if (industry) {
        sheet.getRange(item.rowIdx + 2, industryIdx + 1).setValue(industry);
        updated++;
        Logger.log('業界分類: ' + item.company + ' → ' + industry);
      }
    });

    if (b + BATCH_SIZE < targets.length) Utilities.sleep(4100);
  }

  Logger.log('fillIndustryWithGemini_完了: ' + updated + '件更新');
}

/**
 * 企業IDマスターのフックポイント・テーマが空の企業をGeminiで自動生成する
 * 1企業 = 1リクエスト（フック+テーマを同時生成）、日次上限管理あり
 * dailyMeetupUpdateStep2 から自動実行される
 */
function fillHookAndThemeWithGemini_() {
  if (!GEMINI_API_KEY) {
    Logger.log('fillHookAndThemeWithGemini_: GEMINI_API_KEYが未設定');
    return;
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const numCols = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  let themeIdx = 1, hookIdx = 3, descIdx = -1;
  header.forEach(function(h, i) {
    const s = String(h || '');
    if (s === 'テーマ') themeIdx = i;
    else if (s === 'AIアピール' || s === 'アピールポイント' || s === 'hookPoint') hookIdx = i;
    else if (s === 'description' || s === 'イベント詳細') descIdx = i;
  });

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();

  // テーマ or フックが空の企業を対象（既に両方埋まっていればスキップ）
  const targets = [];
  data.forEach(function(row, i) {
    const company = String(row[0] || '').trim();
    const theme   = String(row[themeIdx] || '').trim();
    const hook    = String(row[hookIdx]  || '').trim();
    if (!company) return;
    if (theme && hook) return; // 両方埋まっていればスキップ（重複防止）
    const desc = descIdx >= 0 ? String(row[descIdx] || '').substring(0, 600) : '';
    targets.push({ rowIdx: i, company: company, theme: theme, hook: hook, desc: desc });
  });

  if (targets.length === 0) {
    Logger.log('fillHookAndThemeWithGemini_: 対象なし');
    return;
  }

  // 業界分類のために1回分を残した上で処理可能な件数を計算
  const usage = getGeminiDailyUsage_();
  const available = GEMINI_DAILY_LIMIT - usage.count - 1;
  if (available <= 0) {
    Logger.log('fillHookAndThemeWithGemini_: 本日のGemini使用上限に達しています (' + usage.count + '/' + GEMINI_DAILY_LIMIT + ')');
    return;
  }
  const processCount = Math.min(targets.length, available);
  Logger.log('fillHookAndThemeWithGemini_: 対象 ' + targets.length + '社 → 本日最大 ' + processCount + '社処理');

  let updated = 0;
  for (var i = 0; i < processCount; i++) {
    if (!canCallGemini_()) break;
    const item = targets[i];
    const result = generateHookAndTheme_(item.company, item.desc, item.theme, item.hook);
    recordGeminiCall_();

    const rowNum = item.rowIdx + 2;
    if (result.theme && !item.theme) {
      sheet.getRange(rowNum, themeIdx + 1).setValue(result.theme);
      Logger.log('テーマ生成: ' + item.company + ' → ' + result.theme);
    }
    if (result.hook && !item.hook) {
      sheet.getRange(rowNum, hookIdx + 1).setValue(result.hook);
      Logger.log('フック生成: ' + item.company + ' → ' + result.hook.substring(0, 50));
    }
    updated++;
    if (i < processCount - 1) Utilities.sleep(3000);
  }

  Logger.log('fillHookAndThemeWithGemini_完了: ' + updated + '社処理');
}

/**
 * 企業IDマスターのアピールポイントが空の企業をGeminiで自動生成して追記する
 * テーマ・業界は対象外。スプシに手動追加した行に対して実行する。
 */
function fillAppealPointsWithGemini() {
  if (!GEMINI_API_KEY) {
    Logger.log('fillAppealPointsWithGemini: GEMINI_API_KEYが未設定');
    return;
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const numCols = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  let themeIdx = 1, industryIdx = 2, aiAppealIdx = 3;
  header.forEach(function(h, i) {
    const s = String(h || '');
    if (s === 'テーマ') themeIdx = i;
    else if (s === '業界') industryIdx = i;
    else if (s === 'AIアピール' || s === 'アピールポイント' || s === 'hookPoint') aiAppealIdx = i;
  });

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();

  // AIアピール列が空の企業のみ対象（業界が空でも同時に埋める）
  const targets = [];
  data.forEach(function(row, i) {
    const company = String(row[0] || '').trim();
    if (!company) return;
    if (String(row[aiAppealIdx] || '').trim()) return; // 既にAIアピールあり → スキップ
    const theme = String(row[themeIdx] || '').trim();
    const industry = String(row[industryIdx] || '').trim();
    targets.push({ rowIdx: i, company: company, theme: theme, industry: industry });
  });

  if (targets.length === 0) {
    Logger.log('fillAppealPointsWithGemini: 対象なし（全企業にAIアピールあり）');
    return;
  }

  const usage = getGeminiDailyUsage_();
  const available = GEMINI_DAILY_LIMIT - usage.count;
  if (available <= 0) {
    Logger.log('fillAppealPointsWithGemini: 本日のGemini使用上限に達しています');
    return;
  }
  const processCount = Math.min(targets.length, available);
  Logger.log('fillAppealPointsWithGemini: 対象 ' + targets.length + '社 → 本日最大 ' + processCount + '社処理');

  let updated = 0;
  for (var i = 0; i < processCount; i++) {
    if (!canCallGemini_()) break;
    const item = targets[i];
    const result = generateAppealPoint_(item.company, item.theme);
    recordGeminiCall_();
    if (result.appeal) {
      setAiAppeal_(item.company, result.appeal); // D列（AIアピール）に書き込み
      Logger.log('AIアピール生成: ' + item.company + ' → ' + result.appeal.substring(0, 50));
    }
    if (result.industry && !item.industry) {
      // 業界が空の場合のみ書き込み
      const rowNum = item.rowIdx + 2;
      sheet.getRange(rowNum, industryIdx + 1).setValue(result.industry);
      Logger.log('業界設定: ' + item.company + ' → ' + result.industry);
    }
    if (result.appeal) updated++;
    if (i < processCount - 1) Utilities.sleep(4100);
  }

  Logger.log('fillAppealPointsWithGemini完了: ' + updated + '社処理');
}

/**
 * Gemini API でアピールポイントを1件生成する
 * @param {string} companyName
 * @param {string} theme - 既存テーマ（あれば参考情報として使用）
 * @returns {{ appeal: string, industry: string }}
 */
function generateAppealPoint_(companyName, theme) {
  if (!GEMINI_API_KEY) return { appeal: '', industry: '' };

  const INDUSTRY_CATEGORIES = 'IT・通信 / コンサルティング / 商社 / メーカー / 金融・保険 / マスコミ・広告 / 小売・流通 / 不動産・建設 / サービス / 医療・製薬 / エネルギー・インフラ / 食品・飲料 / 教育 / 非営利・NPO / その他';

  const prompt =
    'あなたはカフェで働く大学生スタッフ向けの案内を書くアシスタントです。\n' +
    '以下の企業情報をもとに、下記2つをJSONで返してください。\n\n' +
    '「appeal」: 「この会社の人と話してみたい！」と感じさせるアピールポイントを2〜3行。\n' +
    '  ・どんなビジネスか（学生に分かりやすく）\n' +
    '  ・面白いポイントや珍しい点\n' +
    '  ・話しかけるとよい話題のヒント\n' +
    '「industry」: 以下のカテゴリから1つ選ぶ。\n' +
    '  カテゴリ: ' + INDUSTRY_CATEGORIES + '\n\n' +
    '出力形式（JSONのみ、説明不要）:\n{"appeal": "...", "industry": "..."}\n\n' +
    '企業名: ' + companyName + '\n' +
    (theme ? 'Meetupテーマ: ' + theme : '');

  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  try {
    const res = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      const result = JSON.parse(res.getContentText());
      const text = result.candidates[0].content.parts[0].text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { appeal: parsed.appeal || '', industry: parsed.industry || '' };
      }
      Logger.log('generateAppealPoint_: JSONパース失敗 - ' + companyName);
    } else if (res.getResponseCode() === 429) {
      Logger.log('generateAppealPoint_: レート制限 - ' + companyName);
    } else {
      Logger.log('generateAppealPoint_: エラー ' + res.getResponseCode());
    }
  } catch (e) {
    Logger.log('generateAppealPoint_ 呼び出しエラー: ' + e.message);
  }
  return { appeal: '', industry: '' };
}

/**
 * 1企業のフックポイントとテーマを1回のGeminiリクエストで生成する
 * @param {string} companyName
 * @param {string} desc - 企業説明（最大600文字）
 * @param {string} existingTheme - 既存テーマ（空なら生成）
 * @param {string} existingHook  - 既存フック（空なら生成）
 * @returns {{ theme: string, hook: string }}
 */
function generateHookAndTheme_(companyName, desc, existingTheme, existingHook) {
  const needTheme = !existingTheme;
  const needHook  = !existingHook;
  if (!needTheme && !needHook) return { theme: existingTheme, hook: existingHook };

  const keys = [];
  const keyDesc = [];
  if (needTheme) {
    keys.push('"theme"');
    keyDesc.push('「theme」: Meetupのテーマを20文字以内で1つ（例: AIを使ったサービス開発の裏側）');
  }
  if (needHook) {
    keys.push('"hook"');
    keyDesc.push('「hook」: カフェスタッフが来場者に声かけするための2〜3行のフック文（学生視点で興味を持たせる内容）');
  }

  const prompt =
    'あなたはカフェで開催される企業Meetupのコンテンツを作るアシスタントです。\n' +
    '以下の企業情報をもとに、指定のJSONキーを出力してください。\n\n' +
    '出力するキー:\n' + keyDesc.join('\n') + '\n\n' +
    '出力形式（JSONのみ、説明不要）:\n{' + keys.map(function(k) { return k + ': "..."'; }).join(', ') + '}\n\n' +
    '企業名: ' + companyName + '\n' +
    (desc ? '企業説明: ' + desc : '');

  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  try {
    const res = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      const result = JSON.parse(res.getContentText());
      const text = result.candidates[0].content.parts[0].text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { theme: parsed.theme || '', hook: parsed.hook || '' };
      }
      Logger.log('generateHookAndTheme_: JSONパース失敗 text=' + text.substring(0, 100));
    } else if (res.getResponseCode() === 429) {
      Logger.log('generateHookAndTheme_: レート制限 - ' + companyName);
    } else {
      Logger.log('generateHookAndTheme_: エラー ' + res.getResponseCode() + ' - ' + res.getContentText().substring(0, 150));
    }
  } catch (e) {
    Logger.log('generateHookAndTheme_ 呼び出しエラー: ' + e.message);
  }
  return { theme: '', hook: '' };
}

/**
 * 複数企業をまとめて1回のGeminiリクエストで業界分類する
 * @param {Array<{company, theme}>} companies
 * @returns {Object} { 企業名: 業界カテゴリ, ... }
 */
function classifyIndustriesBatch_(companies) {
  if (!GEMINI_API_KEY || companies.length === 0) return {};

  var lines = companies.map(function(c, i) {
    return (i + 1) + '. ' + c.company + (c.theme ? '（テーマ: ' + c.theme + '）' : '');
  }).join('\n');

  var prompt =
    '以下の企業リストについて、各企業の業界をカテゴリから1つ選んでJSON形式で返してください。\n\n' +
    'カテゴリ: IT・通信 / コンサルティング / 商社 / メーカー / 金融・保険 / マスコミ・広告 / 小売・流通 / 不動産・建設 / サービス / 医療・製薬 / エネルギー・インフラ / 食品・飲料 / 教育 / 非営利・NPO / その他\n\n' +
    '企業リスト:\n' + lines + '\n\n' +
    '出力形式（JSONのみ、説明不要）:\n{"企業名1": "カテゴリ", "企業名2": "カテゴリ"}';

  var apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  try {
    var res = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      var result = JSON.parse(res.getContentText());
      var text = result.candidates[0].content.parts[0].text.trim();
      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        Logger.log('Gemini 業界分類バッチ成功: ' + companies.length + '社');
        return JSON.parse(jsonMatch[0]);
      }
      Logger.log('Gemini 業界分類バッチ: JSONパース失敗 text=' + text.substring(0, 200));
    } else if (res.getResponseCode() === 429) {
      Logger.log('Gemini 業界分類バッチ: レート制限 詳細=' + res.getContentText().substring(0, 300));
    } else {
      Logger.log('Gemini 業界分類バッチ エラー: ' + res.getContentText().substring(0, 200));
    }
  } catch (e) {
    Logger.log('Gemini 業界分類バッチ 呼び出しエラー: ' + e.message);
  }
  return {};
}

/**
 * SHIRUCAFE管理画面にログインしてセッションCookieを返す
 */
function loginToShirucafe_() {
  // Step1: ログインページ取得 → CSRFトークンと初期Cookieを取得
  const loginPageRes = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/login', {
    muteHttpExceptions: true
  });
  Logger.log('ログインページ取得: HTTP ' + loginPageRes.getResponseCode());

  let cookies = parseCookiesFromResponse_(loginPageRes);
  Logger.log('初期Cookie: ' + JSON.stringify(Object.keys(cookies)));

  const html = loginPageRes.getContentText();

  // CSRFトークンを複数パターンで検索
  let csrfToken = null;
  const tokenPatterns = [
    /name="_token"\s+value="([^"]+)"/,
    /value="([^"]+)"\s+name="_token"/,
    /<meta\s+name="csrf-token"\s+content="([^"]+)"/
  ];
  for (let i = 0; i < tokenPatterns.length; i++) {
    const m = html.match(tokenPatterns[i]);
    if (m) { csrfToken = m[1]; break; }
  }

  if (!csrfToken) {
    Logger.log('CSRFトークンが見つかりません');
    return null;
  }
  Logger.log('CSRFトークン取得: ' + csrfToken.substring(0, 10) + '...');

  // Step2: ログインPOST
  const loginRes = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/login', {
    method: 'post',
    payload: '_token=' + encodeURIComponent(csrfToken)
      + '&email=' + encodeURIComponent(SHIRUCAFE_EMAIL)
      + '&password=' + encodeURIComponent(SHIRUCAFE_PASSWORD),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': buildCookieString_(cookies),
      'Referer': SHIRUCAFE_BASE_URL + '/login',
      'Origin': SHIRUCAFE_BASE_URL
    },
    followRedirects: false,
    muteHttpExceptions: true
  });

  Logger.log('ログインPOST: HTTP ' + loginRes.getResponseCode());
  const allHeaders = loginRes.getAllHeaders();
  Logger.log('レスポンスヘッダーキー: ' + JSON.stringify(Object.keys(allHeaders)));

  const newCookies = parseCookiesFromResponse_(loginRes);
  Logger.log('ログイン後Cookie: ' + JSON.stringify(Object.keys(newCookies)));
  Object.assign(cookies, newCookies);

  // セッションCookieが取得できているか確認
  if (!cookies['shirucafe_admin_session']) {
    Logger.log('セッションCookieが取得できませんでした');
    const location = allHeaders['Location'] || allHeaders['location'] || '（なし）';
    Logger.log('リダイレクト先: ' + location);
    return null;
  }

  // Step3: リダイレクト先を1回フォローしてセッションを確立
  const redirectUrl = allHeaders['Location'] || allHeaders['location'];
  if (redirectUrl) {
    const absUrl = redirectUrl.startsWith('http') ? redirectUrl : SHIRUCAFE_BASE_URL + redirectUrl;
    const redirectRes = UrlFetchApp.fetch(absUrl, {
      headers: { 'Cookie': buildCookieString_(cookies) },
      followRedirects: false,
      muteHttpExceptions: true
    });
    Logger.log('リダイレクト先: HTTP ' + redirectRes.getResponseCode());
    const redirectCookies = parseCookiesFromResponse_(redirectRes);
    Object.assign(cookies, redirectCookies);
  }

  Logger.log('ログイン成功');
  return cookies; // オブジェクトのまま返す（XSRF-TOKENも含めて使えるように）
}

/**
 * 指定日のイベント一覧を {企業名: reserveId} マップで返す
 * HTMLスケジュールページのInertia JSONから取得（取得できない場合は空マップ）
 * @param {Date} date
 * @param {Object} cookies
 * @returns {Object} {企業名: reserveId}
 */
function fetchEventIdsForDate_(date, cookies) {
  const dateStr = Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
  const idMap = {};
  const xsrfToken = decodeURIComponent(cookies['XSRF-TOKEN'] || '');

  const urlsToTry = [
    SHIRUCAFE_BASE_URL + '/?reserve_day=' + dateStr,
    SHIRUCAFE_BASE_URL + '/?date=' + dateStr,
  ];

  for (let ui = 0; ui < urlsToTry.length; ui++) {
    try {
      const res = UrlFetchApp.fetch(urlsToTry[ui], {
        headers: { 'Cookie': buildCookieString_(cookies), 'X-XSRF-TOKEN': xsrfToken },
        followRedirects: true,
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) continue;
      const html = res.getContentText();

      // Inertia JSONから解析
      const m = html.match(/data-page="([^"]+)"/);
      if (m) {
        try {
          const pj = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'));
          const pl = (pj.props || {}).shiru_reserves || (pj.props || {}).reserves || (pj.props || {}).data || [];
          if (Array.isArray(pl)) {
            pl.forEach(function(r) {
              const rid = String(r.id || r.reserve_id || r.shiru_reserve_id || '');
              const rn = String(r.sponsor_name || '').trim();
              if (rid && rn) idMap[rn] = rid;
            });
          }
          if (Object.keys(idMap).length > 0) {
            Logger.log('fetchEventIdsForDate_ ' + dateStr + ': ' + Object.keys(idMap).length + '件取得');
            return idMap;
          }
        } catch(ei) {}
      }
    } catch(e) {}
  }
  return idMap;
}

/**
 * 指定日のMeetup予定一覧を取得する
 * @param {Date} date
 * @param {Object} cookies - ログイン後のCookiesオブジェクト
 */
function fetchReservesByDate_(date, cookies) {
  const dateStr = Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd') + ' 00:00:00';
  const url = SHIRUCAFE_BASE_URL + '/api/shiru_reserves'
    + '?store_id_list=' + SHIRUCAFE_STORE_ID
    + '&reserve_day=' + encodeURIComponent(dateStr);

  const xsrfToken = decodeURIComponent(cookies['XSRF-TOKEN'] || '');

  try {
    const res = UrlFetchApp.fetch(url, {
      headers: {
        'Cookie': buildCookieString_(cookies),
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': xsrfToken
      },
      muteHttpExceptions: true
    });
    Logger.log(dateStr + ' HTTP ' + res.getResponseCode());
    const raw = res.getContentText();
    const data = JSON.parse(raw);

    // レスポンス構造が配列 or {reserves:[]} or {data:[]} に対応
    const reserves = Array.isArray(data) ? data : (data.reserves || data.shiru_reserves || data.data || []);

    // 初回のみフィールド名をログ出力（ID取得診断用）
    if (reserves.length > 0) {
      Logger.log(dateStr + ' reserve[0]フィールド: ' + JSON.stringify(Object.keys(reserves[0])));
    }
    return reserves;
  } catch (e) {
    Logger.log(dateStr + ' の取得エラー: ' + e.message);
    return [];
  }
}

/**
 * レスポンスヘッダーからSet-CookieをパースしてObjectで返す
 * ヘッダー名の大文字小文字差異に対応
 */
function parseCookiesFromResponse_(response) {
  const cookies = {};
  const headers = response.getAllHeaders();

  // Set-Cookie / set-cookie どちらの表記にも対応
  let setCookie = null;
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === 'set-cookie') {
      setCookie = headers[keys[i]];
      break;
    }
  }
  if (!setCookie) return cookies;

  const cookieList = Array.isArray(setCookie) ? setCookie : [setCookie];
  cookieList.forEach(function (c) {
    const nameValue = c.split(';')[0];
    const idx = nameValue.indexOf('=');
    if (idx > 0) {
      const name = nameValue.substring(0, idx).trim();
      const value = nameValue.substring(idx + 1).trim();
      cookies[name] = value;
    }
  });
  return cookies;
}

/**
 * CookieオブジェクトをHTTPヘッダー用の文字列に変換
 */
function buildCookieString_(cookieObj) {
  return Object.keys(cookieObj).map(function (k) {
    return k + '=' + cookieObj[k];
  }).join('; ');
}

/**
 * Meetup予定シートのE列（テーマ）・G列（フックポイント）が空の行を補完する
 * E列: SHIRUCAFEの /reserve/detail/{id} から reserve_theme を取得
 * G列: テンプレートで生成
 */
function fillMissingMeetupData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log('fillMissingMeetupData: データなし');
    return;
  }

  if (!sheet.getRange(1, 9).getValue()) {
    sheet.getRange(1, 9).setValue('reserveID');
  }

  const data = sheet.getDataRange().getValues();

  const targetRows = [];
  for (let i = 1; i < data.length; i++) {
    // E列(対象卒年)、F列(テーマ)、G列(詳細)、H列(フック)が空の行を補完対象とする
    if (!data[i][4] || !data[i][5] || !data[i][6] || !data[i][7]) {
      targetRows.push(i + 1);
    }
  }

  if (targetRows.length === 0) {
    Logger.log('fillMissingMeetupData: 補完対象なし');
    return;
  }
  Logger.log('fillMissingMeetupData: 補完対象 ' + targetRows.length + '行');

  const cookies = loginToShirucafe_();
  if (!cookies) { Logger.log('fillMissingMeetupData: ログイン失敗'); return; }

  // ホームページ + 補完対象の日付別ページから { reserveId → 周辺テキスト } マップを構築
  const targetDates = targetRows.map(function (r) { return data[r - 1][0]; });
  const idContextMap = buildIdContextMap_(cookies, targetDates);

  let updatedCount = 0;
  targetRows.forEach(function (rowNum) {
    const rowData = data[rowNum - 1];
    const companyName = String(rowData[1] || '').trim(); // B列: 企業名
    const kind = String(rowData[3] || '').trim(); // D列: 種別
    const description = String(rowData[5] || '').trim(); // F列: 企業説明

    if (!companyName) return;

    // I列のreserveID → なければコンテキストマップから企業名で検索（法人格除きフォールバック込み）
    let reserveId = String(rowData[8] || '').trim();
    if (!reserveId) {
      reserveId = findReserveIdByCompanyName_(companyName, idContextMap);
    }

    // E-H列: SHIRUCAFEから取得
    if (reserveId && cookies) {
      const fields = fetchMeetupFields_(reserveId, cookies, companyName);

      if (!rowData[4] && fields.targetYear) {
        sheet.getRange(rowNum, 5).setValue(fields.targetYear);
        updatedCount++;
      }
      if (!rowData[5] && fields.theme) {
        sheet.getRange(rowNum, 6).setValue(fields.theme);
        updatedCount++;
      }
      if (!rowData[6] && fields.industry) {
        sheet.getRange(rowNum, 7).setValue(fields.industry);
        updatedCount++;
      }
      if (!rowData[7] && fields.hookPoint) {
        sheet.getRange(rowNum, 8).setValue(fields.hookPoint);
        updatedCount++;
      }
    }

    // I列（reserveID）: 空なら今回見つけたIDを書き込む
    if (!rowData[8] && reserveId) {
      sheet.getRange(rowNum, 9).setValue(reserveId);
      updatedCount++;
    }
  });

  Logger.log('fillMissingMeetupData完了: ' + updatedCount + '行更新');
}

/**
 * 企業IDマスターシートを初期化する（存在しない場合は作成）
 * メニューから手動実行可能
 */
function initCompanyIdMasterSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_COMPANY_IDS);
    sheet.getRange(1, 1, 1, 4).setValues([['企業名', 'テーマ', '業界', 'アピールポイント']]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 250);
    sheet.setColumnWidth(2, 250);
    sheet.setColumnWidth(3, 150);
    sheet.setColumnWidth(4, 300);
    ss.setActiveSheet(sheet);
    SpreadsheetApp.getUi().alert('「企業IDマスター」シートを作成しました。');
  } else {
    ss.setActiveSheet(sheet);
    SpreadsheetApp.getUi().alert('「企業IDマスター」シートは既に存在します。\n現在 ' + (sheet.getLastRow() - 1) + ' 件登録されています。');
  }
}

/**
 * 企業IDマスターを新フォーマット（企業名・テーマ・業界の3列）に整形する
 * 旧フォーマット（6列: 企業名, reserveID, 卒年, テーマ, 業界, フック）から移行する際に1回実行
 */
function reformatCompanyIdMaster() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log('reformatCompanyIdMaster: データなし');
    return;
  }
  const lastRow = sheet.getLastRow();
  const numCols = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];

  // 新フォーマット判定: 3列以下 かつ B列ヘッダーが「テーマ」
  const isNewFormat = numCols <= 3 && String(header[1] || '') === 'テーマ';
  if (isNewFormat) {
    Logger.log('すでに新フォーマットです');
    return;
  }

  // ヘッダー名でテーマ・業界列インデックスを動的に探す
  let themeIdx = -1;
  let industryIdx = -1;
  header.forEach(function(h, i) {
    const s = String(h || '');
    if (s === 'テーマ') themeIdx = i;
    if (s === '業界') industryIdx = i;
  });
  // 見つからなければ旧フォーマットのデフォルト位置（D列=3, E列=4）を使用
  if (themeIdx < 0) themeIdx = 3;
  if (industryIdx < 0) industryIdx = 4;
  Logger.log('テーマ列:' + (themeIdx+1) + ' 業界列:' + (industryIdx+1));

  const newData = data.map(function(row) {
    return [
      String(row[0] || '').trim(),
      String(row[themeIdx] || '').trim(),
      String(row[industryIdx] || '').trim()
    ];
  }).filter(function(row) { return row[0]; });
  Logger.log('変換: ' + newData.length + '件');

  // シートを再構築
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 3).setValues([['企業名', 'テーマ', '業界']]);
  if (newData.length > 0) {
    sheet.getRange(2, 1, newData.length, 3).setValues(newData);
  }
  // 余分な列を削除
  if (sheet.getLastColumn() > 3) {
    sheet.deleteColumns(4, sheet.getLastColumn() - 3);
  }
  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 250);
  sheet.setColumnWidth(3, 150);
  Logger.log('reformatCompanyIdMaster完了: ' + newData.length + '件');
}

/**
 * 企業IDマスターシートを読み込んで { 企業名 → reserveID } マップを返す
 * @returns {Object}
 */
function loadCompanyIdMaster_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet || sheet.getLastRow() <= 1) return {};

  const numCols = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];

  // ヘッダー名で列インデックスを動的に取得
  // D=AIアピール（1件固定）, E以降=スタッフアピール（蓄積）
  let themeIdx = 1, industryIdx = 2, aiAppealIdx = 3, staffAppealIdx = 4;
  header.forEach(function(h, i) {
    const s = String(h || '');
    if (s === 'テーマ') themeIdx = i;
    else if (s === '業界') industryIdx = i;
    else if (s === 'AIアピール') aiAppealIdx = i;
    else if (s === 'スタッフアピール') staffAppealIdx = i;
    // 旧フォーマット互換
    else if (s === 'アピールポイント' || s === 'hookPoint') { aiAppealIdx = i; staffAppealIdx = i + 1; }
  });

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();
  const map = {};
  data.forEach(function(row) {
    const name = String(row[0] || '').trim();
    if (!name) return;
    const aiAppeal = String(row[aiAppealIdx] || '').trim();
    const staffAppeals = [];
    for (var j = staffAppealIdx; j < numCols; j++) {
      var v = String(row[j] || '').trim();
      if (v) staffAppeals.push(v);
    }
    map[name] = {
      reserveId:    '',
      theme:        String(row[themeIdx]    || '').trim(),
      industry:     String(row[industryIdx] || '').trim(),
      aiAppeal:     aiAppeal,
      staffAppeals: staffAppeals,
      // 後方互換
      hookPoint:    staffAppeals.length > 0 ? staffAppeals[0] : aiAppeal,
      appealPoints: staffAppeals.length > 0 ? staffAppeals : (aiAppeal ? [aiAppeal] : [])
    };
  });
  Logger.log('企業IDマスター読込: ' + Object.keys(map).length + '件');
  return map;
}

/**
 * 企業IDマスターシートに保存する（企業名で重複チェック、なければ追記）
 * @param {string} companyName
 * @param {string} reserveId
 */
function saveToCompanyIdMaster_(companyName, reserveId, fields) {
  if (!companyName) return;
  const theme     = fields ? (fields.theme     || '') : '';
  const industry  = fields ? (fields.industry  || '') : '';
  const hookPoint = fields ? (fields.hookPoint || '') : '';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_COMPANY_IDS);
    sheet.getRange(1, 1, 1, 4).setValues([['企業名', 'テーマ', '業界', 'アピールポイント']]);
    sheet.setFrozenRows(1);
  }

  // ヘッダーで書き込む列インデックスを取得
  const numCols = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  let themeIdx = 1, industryIdx = 2, hookIdx = 3;
  header.forEach(function(h, i) {
    const s = String(h || '');
    if (s === 'テーマ') themeIdx = i;
    else if (s === '業界') industryIdx = i;
    else if (s === 'AIアピール' || s === 'アピールポイント' || s === 'hookPoint') hookIdx = i;
  });

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === companyName) {
        // 既存行: 空でない値のみ上書き
        const writeEnd = Math.max(themeIdx, industryIdx, hookIdx) + 1;
        const existing = sheet.getRange(i + 2, 1, 1, writeEnd).getValues()[0];
        if (theme)     existing[themeIdx]    = theme;
        if (industry)  existing[industryIdx] = industry;
        if (hookPoint) existing[hookIdx]     = hookPoint;
        sheet.getRange(i + 2, 1, 1, writeEnd).setValues([existing]);
        return;
      }
    }
  }
  // 新規行
  const newRow = ['', '', '', ''];
  newRow[0]         = companyName;
  newRow[themeIdx]    = theme;
  newRow[industryIdx] = industry;
  newRow[hookIdx]     = hookPoint;
  sheet.appendRow(newRow);
}

/**
 * Meetup予定シートにある企業で企業IDマスターに未登録（またはテーマ・業界が空）の企業を
 * マスターに追加し、SHIRUCAFEから取得したテーマ・業界・アピールポイントを書き込む
 * fetchAllUpcomingMeetups から毎日自動実行される
 * @param {Object} cookies
 */
function syncNewCompaniesToMaster_(cookies) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const meetupSheet = ss.getSheetByName(SHEET_MEETUP);
  if (!meetupSheet || meetupSheet.getLastRow() <= 1) return;

  const masterMap = loadCompanyIdMaster_();
  const nc = Math.max(meetupSheet.getLastColumn(), 6);
  const data = meetupSheet.getRange(2, 1, meetupSheet.getLastRow() - 1, nc).getValues();

  // 企業名 → reserveId のマップ（1社1IDのみ。IDがある行を優先）
  const companyReserveMap = {};
  data.forEach(function(row) {
    const company   = String(row[1] || '').trim();
    const reserveId = String(row[5] || '').trim();
    if (!company) return;
    if (!companyReserveMap[company] || reserveId) {
      companyReserveMap[company] = reserveId;
    }
  });

  const xsrfToken = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
  let added = 0;

  Object.keys(companyReserveMap).forEach(function(company) {
    const reserveId = companyReserveMap[company];
    const existing  = masterMap[company];

    // テーマが既に埋まっていればスキップ
    if (existing && existing.theme) return;

    if (reserveId) {
      Utilities.sleep(400);
      const fields = fetchMeetupFields_(reserveId, cookies, company);
      // テーマのみ自動保存（業界・アピールポイントは手動入力）
      saveToCompanyIdMaster_(company, reserveId, { theme: fields.theme || '' });
      Logger.log('syncNewCompaniesToMaster_: ' + company + ' テーマ=' + (fields.theme || '').substring(0, 20));
    } else {
      // IDなしでも企業名だけ登録（後でIDが埋まった時にテーマが取得される）
      if (!existing) {
        saveToCompanyIdMaster_(company, '', {});
        Logger.log('syncNewCompaniesToMaster_（ID未取得）: ' + company);
      }
    }
    added++;
  });

  Logger.log('syncNewCompaniesToMaster_完了: ' + added + '社処理');
}

/**
 * 企業IDマスターシートの各企業について、SHIRUCAFEから詳細情報を取得してC〜F列に書き込む
 * B列（reserveID）がある行のみ対象。C列（卒年）〜F列（フック）を更新する
 */
function refetchThemesFromSHIRUCAFE() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!masterSheet || masterSheet.getLastRow() <= 1) {
    Logger.log('refetchThemesFromSHIRUCAFE: 企業IDマスターにデータなし');
    SpreadsheetApp.getUi().alert('企業IDマスターにデータがありません。先にMeetupを取込してください。');
    return;
  }

  const data = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 6).getValues();

  // B列（reserveID）がある行を対象にする
  const targetRows = [];
  for (let i = 0; i < data.length; i++) {
    const reserveId = String(data[i][1] || '').trim();
    if (reserveId) targetRows.push({ rowNum: i + 2, data: data[i] });
  }
  if (targetRows.length === 0) {
    Logger.log('refetchThemesFromSHIRUCAFE: reserveIDある行なし');
    return;
  }
  Logger.log('refetchThemesFromSHIRUCAFE: 対象 ' + targetRows.length + '件');

  const cookies = loginToShirucafe_();
  if (!cookies) { Logger.log('refetchThemesFromSHIRUCAFE: ログイン失敗'); return; }

  let updatedCount = 0;
  targetRows.forEach(function(item) {
    const companyName = String(item.data[0] || '').trim();
    const reserveId = String(item.data[1] || '').trim();

    const fields = fetchMeetupFields_(reserveId, cookies, companyName);

    if (fields.targetYear || fields.theme || fields.industry || fields.hookPoint) {
      masterSheet.getRange(item.rowNum, 3, 1, 4).setValues([[
        fields.targetYear || item.data[2],
        fields.theme      || item.data[3],
        fields.industry   || item.data[4],
        fields.hookPoint  || item.data[5]
      ]]);
      updatedCount++;
      Logger.log('更新完了 (' + companyName + '): テーマ=' + (fields.theme || '').substring(0, 20));
    } else {
      Logger.log('各フィールド取得失敗 (' + companyName + ' ID=' + reserveId + ')');
    }
  });

  Logger.log('refetchThemesFromSHIRUCAFE完了: ' + updatedCount + '件更新');
}

/**
 * /reserve/detail/{id} から 4つのフィールドを取得する
 * (対象卒年, Meetupのテーマ, イベントの詳細, フック)
 * @param {string} reserveId
 * @param {Object} cookies
 * @returns {Object} 
 */
function fetchMeetupFields_(reserveId, cookies, companyName) {
  const result = { targetYear: '', theme: '', industry: '', hookPoint: '', sponsorName: '', imageUrl: '' };
  if (!reserveId) return result;
  try {
    // HTMLスクレイピングではなくJSON APIを使用（確実にフィールドを取得）
    const xsrfToken = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
    const res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/api/shiru_reserves/' + reserveId, {
      headers: {
        'Cookie': buildCookieString_(cookies),
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': xsrfToken
      },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('fetchMeetupFields_ HTTP ' + res.getResponseCode() + ' (ID=' + reserveId + ')');
      return result;
    }
    const apiData = JSON.parse(res.getContentText());
    const record = apiData.reserve || apiData;

    // ① Meetupのテーマ (reserve_theme)
    result.theme = decodeHtmlEntities_(String(record.reserve_theme || '').trim());

    // ② 対象卒年 (reserve_grade_year: "2026,2027,2028,2029" → "26卒 27卒 28卒 29卒")
    if (record.reserve_grade_year) {
      const years = String(record.reserve_grade_year).split(',')
        .map(function(y) {
          const yr = y.trim();
          if (!yr) return '';
          return (yr.length === 4 ? yr.slice(2) : yr) + '卒';
        })
        .filter(function(v) { return v; });
      result.targetYear = [...new Set(years)].sort().join(' ');
    }

    // ③ 業界タグ (event_detailからハッシュタグ抽出)
    if (record.event_detail) {
      result.industry = extractIndustryTags_(decodeHtmlEntities_(String(record.event_detail)));
    }

    // ④ 企業名 (sponsor.name)
    if (record.sponsor && record.sponsor.name) {
      result.sponsorName = String(record.sponsor.name).trim();
    }

    // ⑤ イメージURL（meetup_image_url = S3フルURL）
    result.imageUrl = String(record.meetup_image_url || '').trim();

    Logger.log('Fields取得 (ID=' + reserveId + '): テーマ=' + result.theme.substring(0, 20) + ', 卒年=' + result.targetYear + ', 業界=' + result.industry.substring(0, 20) + ', 画像=' + (result.imageUrl ? 'あり' : 'なし'));
  } catch (e) {
    Logger.log('fetchMeetupFields_ エラー (ID=' + reserveId + '): ' + e.message);
  }
  return result;
}

// ====== 以下は旧HTML版の残骸（参照のみ・実行されない）======
// eslint-disable-next-line no-unused-vars
function fetchMeetupFields_html_legacy_(reserveId, cookies, companyName) {
  let result = { targetYear: '', theme: '', industry: '', hookPoint: '', sponsorName: '' };
  try {
    const res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/reserve/detail/' + reserveId, {
      headers: { 'Cookie': buildCookieString_(cookies) },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return result;
    const html = res.getContentText();

    const extractTd = (labelRegexStr) => {
      // <th>ラベル</th>...<td>値</td> のパターン。間に多少のスペースやHTMLを許容
      const regex = new RegExp('<th[^>]*>[\\s\\S]*?(?:' + labelRegexStr + ')[\\s\\S]*?<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>', 'i');
      const match = html.match(regex);
      if (match) {
        let content = match[1];

        // 1. textareaの値を優先チェック
        const taM = content.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
        if (taM && taM[1].trim()) return taM[1].replace(/<[^>]+>/g, '').trim();

        // 2. checkboxフィールド（対象卒年などの複数選択）: checked なものだけ収集
        //    uncheckedも含む全inputをチェックする前に判定して誤抽出を防ぐ
        const allCbTags = [];
        const cbScanRe = /<input\b[^>]*>/gi;
        let cbScanM;
        while ((cbScanM = cbScanRe.exec(content)) !== null) {
          if (/type=["']checkbox["']/i.test(cbScanM[0])) allCbTags.push(cbScanM[0]);
        }
        if (allCbTags.length > 0) {
          const checkedVals = allCbTags
            .filter(function(tag) { return /\bchecked\b/i.test(tag); })
            .map(function(tag) {
              const vm = tag.match(/\bvalue=["']([^"']+)["']/i);
              if (!vm) return '';
              let val = vm[1].trim();
              // "27" のような2桁数値に「卒」を補完する
              if (/^\d{2}$/.test(val)) val += '卒';
              return val;
            })
            .filter(function(v) { return v; });
          return checkedVals.join(' ');
        }

        // 3. 通常のinput value（checkbox以外）
        const inM = content.match(/<input[^>]+value=["']([^"']+)["']/i);
        if (inM && inM[1].trim()) return inM[1].trim();

        // 4. select option selected（複数選択対応：全selectedを収集）
        const allSelOpts = [];
        const selRe = /<option[^>]+selected[^>]*>([\s\S]*?)<\/option>/gi;
        let selM;
        while ((selM = selRe.exec(content)) !== null) {
          const selTxt = selM[1].replace(/<[^>]+>/g, '').trim();
          if (selTxt) allSelOpts.push(selTxt);
        }
        if (allSelOpts.length > 0) return allSelOpts.join(' ');

        // 5. プレーンテキスト扱い
        return decodeHtmlEntities_(
          content.replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '')
        );
      }
      return '';
    };

    // --- ノイズ除去済みHTML（script/style/option除去）---
    const htmlNoNoise = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<option[^>]*>[\s\S]*?<\/option>/gi, '');

    // セクションラベルを区切りにHTMLブロックを返すヘルパー
    // ページ構造: 対象店舗 → 対象卒年 → Meetupタグ → オプション → Meetupのテーマ → イベントの詳細
    const SECTION_LABELS = ['対象店舗', '対象卒年', 'Meetupタグ', 'オプション', 'Meetupのテーマ', 'イベントの詳細'];
    const extractSection = function(label) {
      const idx = htmlNoNoise.indexOf(label);
      if (idx < 0) return '';
      const start = idx + label.length;
      let end = Math.min(start + 4000, htmlNoNoise.length);
      for (let i = 0; i < SECTION_LABELS.length; i++) {
        if (SECTION_LABELS[i] === label) continue;
        const nextIdx = htmlNoNoise.indexOf(SECTION_LABELS[i], start);
        if (nextIdx >= start && nextIdx < end) end = nextIdx;
      }
      return htmlNoNoise.substring(start, end);
    };

    // --- ① 対象卒年 ---
    const yearSection = extractSection('対象卒年');
    if (yearSection) {
      // checkedなcheckboxのvalueから卒年を収集
      const cbYears = [];
      const cbRe = /<input\b[^>]*>/gi;
      let cbM;
      while ((cbM = cbRe.exec(yearSection)) !== null) {
        const tag = cbM[0];
        if (!/type=["']checkbox["']/i.test(tag) || !/\bchecked\b/i.test(tag)) continue;
        const vm = tag.match(/\bvalue=["']([^"']+)["']/i);
        if (!vm) continue;
        let val = vm[1].trim();
        if (/^\d{2}$/.test(val)) val += '卒'; // "27" → "27卒"
        cbYears.push(val);
      }
      if (cbYears.length > 0) {
        result.targetYear = [...new Set(cbYears)].sort().join(' ');
      } else {
        // テキストから〇〇卒パターンを検索（フォールバック）
        const sectionText = yearSection.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const matches = sectionText.match(/\d{2}卒/g);
        if (matches) result.targetYear = [...new Set(matches)].sort().join(' ');
      }
    }

    // --- ② Meetupのテーマ ---
    const themeSection = extractSection('Meetupのテーマ');
    if (themeSection) {
      // textarea優先
      const taTM = themeSection.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
      if (taTM && taTM[1].trim()) {
        result.theme = decodeHtmlEntities_(taTM[1].replace(/<[^>]+>/g, '').trim());
      }
      // input value
      if (!result.theme) {
        const inM = themeSection.match(/<input[^>]+value=["']([^"']{2,})["']/i);
        if (inM) result.theme = decodeHtmlEntities_(inM[1].trim());
      }
      // セクション内テキストそのもの
      if (!result.theme) {
        const themeText = decodeHtmlEntities_(
          themeSection.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        );
        if (themeText.length > 2) result.theme = themeText;
      }
    }
    // 【...】フォールバック（セクション抽出できなかった場合）
    if (!result.theme) {
      const kakkoM = htmlNoNoise.match(/【([^】\r\n]{3,100})】([^<\r\n【]{0,200})/);
      if (kakkoM) result.theme = decodeHtmlEntities_(('【' + kakkoM[1] + '】' + kakkoM[2]).trim());
    }
    if (!result.theme) {
      const simpleM = htmlNoNoise.match(/【[^】\r\n]{3,100}】/);
      if (simpleM) result.theme = decodeHtmlEntities_(simpleM[0].trim());
    }

    // --- ③ 業界（イベントの詳細からハッシュタグ抽出、AIなし）---
    const evtSection = extractSection('イベントの詳細');
    let rawEventDetails = '';
    if (evtSection) {
      const taEM = evtSection.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
      if (taEM && taEM[1].trim()) {
        rawEventDetails = decodeHtmlEntities_(taEM[1].replace(/<[^>]+>/g, '').trim());
      }
      if (!rawEventDetails) {
        rawEventDetails = decodeHtmlEntities_(
          evtSection.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        );
      }
    }
    if (rawEventDetails) {
      result.industry = extractIndustryTags_(rawEventDetails);
    }

    // --- ④ フック（ページに既存値があれば取得）---
    result.hookPoint = extractTd('フック|フックポイント');
    if (!result.hookPoint) {
      const taHM = html.match(/<textarea[^>]+name=["'](?:hook_point|hook)["'][^>]*>([\s\S]*?)<\/textarea>/i);
      if (taHM && taHM[1].trim()) result.hookPoint = decodeHtmlEntities_(taHM[1].replace(/<[^>]+>/g, '').trim());
    }

    // --- ⑤ 企業名（sponsorName）取得 ---
    // 以下を順番に試し、最初に値が取れた時点で終了
    // ① Inertia JSON（data-page属性）の props.shiru_reserve.sponsor_name
    const inM0 = html.match(/data-page="([^"]+)"/);
    if (inM0) {
      try {
        const json0 = JSON.parse(inM0[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'));
        const r0 = (json0.props || {}).shiru_reserve || (json0.props || {}).reserve || (json0.props || {}).data || null;
        if (r0 && r0.sponsor_name) result.sponsorName = String(r0.sponsor_name).trim();
      } catch (e0) {}
    }
    // ② ページ内JSON（scriptタグ等）の "sponsor_name": "値" パターン
    if (!result.sponsorName) {
      const snJsonM = html.match(/"sponsor_name"\s*:\s*"([^"\\]+)"/);
      if (snJsonM) result.sponsorName = decodeHtmlEntities_(snJsonM[1]);
    }
    // ③ th/tdペア: 企業名 / スポンサー名 などのラベルを持つセル
    if (!result.sponsorName) {
      result.sponsorName = extractTd('企業名|スポンサー名?|会社名|団体名|企業・団体名');
    }
    // ④ input[name=sponsor_name] の value 属性
    if (!result.sponsorName) {
      const snM = html.match(/name=["']sponsor_name["'][^>]*value=["']([^"']+)["']/i)
               || html.match(/value=["']([^"']+)["'][^>]*name=["']sponsor_name["']/i);
      if (snM) result.sponsorName = snM[1].trim();
    }
    // ⑤ h1/h2/h3 見出しタグ（先頭の見出しが企業名になっていることが多い）
    if (!result.sponsorName) {
      const h1M = html.match(/<h[123][^>]*>\s*([^<]{2,60})\s*<\/h[123]>/i);
      if (h1M) result.sponsorName = h1M[1].trim();
    }
    // ⑥ ページタイトル（"企業名 | 管理画面" 形式）
    if (!result.sponsorName) {
      const titleM = html.match(/<title>\s*([^|｜<\n]{2,80})/i);
      if (titleM) result.sponsorName = titleM[1].trim();
    }

    // sponsorNameが取れなかった場合はログのみ
    if (!result.sponsorName) {
      Logger.log('sponsorName未取得 (ID=' + reserveId + ')');
    }
    Logger.log('Fields取得 (ID=' + reserveId + '): sponsorName=' + result.sponsorName.substring(0, 15) + ', テーマ=' + result.theme.substring(0, 10) + ', 業界=' + result.industry + ', 卒年=' + result.targetYear);
  } catch (e) {
    Logger.log('fetchMeetupFields_ エラー: ' + e.message);
  }
  return result;
}

/**
 * HTMLから /reserve/detail/{id} リンクを解析して idContextMap に追加する
 * @param {string} html
 * @param {Object} idContextMap - 結果を書き込むオブジェクト（破壊的変更）
 */
function extractIdsFromHtml_(html, idContextMap) {
  // <tr> 単位でIDとそのテキストを対応付け
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM;
  while ((trM = trRe.exec(html)) !== null) {
    const rowHtml = trM[1];
    const rowText = rowHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

    // パターンA: /reserve/detail/{id} リンク
    const linkM = rowHtml.match(/\/reserve\/detail\/(\d+)/);
    if (linkM) {
      const id = linkM[1];
      if (!idContextMap[id]) idContextMap[id] = rowText;
      continue;
    }

    // パターンB: #00066182 のようなゼロパディング形式（リンクなし）
    const hashM = rowHtml.match(/#0*(\d{4,8})\b/);
    if (hashM) {
      const id = hashM[1];
      if (!idContextMap[id]) idContextMap[id] = rowText;
    }
  }

  // フォールバック: ページ全体からリンク周辺300文字
  // /api/shiru_reserves/cancel/66054 や /reserve/detail/66054 など広くマッチ
  const idRe = /\/(?:api\/)?(?:reserve|shiru_reserve|shiru_reserves)\/(?:[a-z_]+\/)?(\d{4,8})(?:[^0-9]|$)/g;
  let idM2;
  while ((idM2 = idRe.exec(html)) !== null) {
    const id = idM2[1];
    if (idContextMap[id]) continue;
    const s = Math.max(0, idM2.index - 300);
    const e = Math.min(html.length, idM2.index + 300);
    idContextMap[id] = html.substring(s, e).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // フォールバック2: ページ全体から #XXXXXXXX 形式
  const hashRe = /#0*(\d{4,8})\b/g;
  let hashM2;
  while ((hashM2 = hashRe.exec(html)) !== null) {
    const id = hashM2[1];
    if (idContextMap[id]) continue;
    const s = Math.max(0, hashM2.index - 300);
    const e = Math.min(html.length, hashM2.index + 300);
    idContextMap[id] = html.substring(s, e).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/**
 * 日付別 JSON API を使って { reserveId → "企業名 時間 種別" } マップを構築する
 * /api/shiru_reserves（fetchReservesByDate_ と同エンドポイント）を利用
 * @param {Object} cookies
 * @param {Array<Date>} dates - 取得したい日付の配列（重複可、内部で自動dedup）
 * @returns {Object} idContextMap
 */
function buildIdContextMap_(cookies, dates) {
  const idContextMap = {};

  // ホームページの HTML からも補足（reserve/detail/{id} リンクを含む場合あり）
  try {
    const homeRes = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/', {
      headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html' },
      followRedirects: true, muteHttpExceptions: true
    });
    if (homeRes.getResponseCode() === 200) {
      extractIdsFromHtml_(homeRes.getContentText(), idContextMap);
      Logger.log('ホームページ(HTML): ' + Object.keys(idContextMap).length + '件');
    }
  } catch (e) { Logger.log('ホームページ取得エラー: ' + e.message); }

  // 日付別 JSON API で確実にID取得（/shiru_reserves HTML は 404 のため）
  const seenDates = {};
  dates.forEach(function (dateVal) {
    if (!dateVal || !(dateVal instanceof Date)) return;
    const dateStr = Utilities.formatDate(dateVal, TIMEZONE, 'yyyy-MM-dd');
    if (seenDates[dateStr]) return;
    seenDates[dateStr] = true;

    const reserves = fetchReservesByDate_(dateVal, cookies);
    reserves.forEach(function (r) {
      const id = String(r.id || r.reserve_id || '');
      const name = String(r.sponsor_name || '').trim();
      if (!id) return;
      idContextMap[id] = [name, r.time || '', r.kind || ''].join(' ');
      if (name) saveToCompanyIdMaster_(name, id); // 新規なら自動保存
    });
    Logger.log(dateStr + ' API: ' + reserves.length + '件 / 累計 ' + Object.keys(idContextMap).length + '件');
  });

  Logger.log('ID-contextMap合計: ' + Object.keys(idContextMap).length + '件');
  return idContextMap;
}

/**
 * idContextMap から企業名に対応する reserveId を検索する
 * 完全一致 → 法人格除きフォールバック の順で試みる
 * @param {string} companyName
 * @param {Object} idContextMap
 * @returns {string} reserveId（見つからない場合は ''）
 */
function findReserveIdByCompanyName_(companyName, idContextMap) {
  if (!companyName || Object.keys(idContextMap).length === 0) return '';

  // 1. 完全一致
  for (const id in idContextMap) {
    if (idContextMap[id].indexOf(companyName) !== -1) return id;
  }

  // 2. 株式会社等の法人格を除いてマッチ（前後どちらに付いてもOK）
  const corpSuffixes = /^(株式会社|有限会社|合同会社|一般社団法人|公益財団法人|公益社団法人|特定非営利活動法人|NPO法人|社会福祉法人|学校法人)/;
  const corpPrefixes = /(株式会社|有限会社|合同会社|一般社団法人|公益財団法人|公益社団法人|特定非営利活動法人|NPO法人|社会福祉法人|学校法人)$/;
  const cleanName = companyName.replace(corpSuffixes, '').replace(corpPrefixes, '').trim();
  if (cleanName && cleanName !== companyName) {
    for (const id in idContextMap) {
      if (idContextMap[id].indexOf(cleanName) !== -1) return id;
    }
  }

  return '';
}

/**
 * Meetup予定シートのF列（予約ID）が空の行にIDを補完する（手動実行用）
 * fillMissingIdsFromHtml_ の公開ラッパー
 */
function fillMissingIds() {
  const cookies = loginToShirucafe_();
  if (!cookies) { Logger.log('ログイン失敗'); return; }
  fillMissingIdsFromHtml_(cookies, false);
}

/**
 * Meetup予定シートのF列（予約ID）が空の行にIDを補完する
 * ① /api/calendar_reserves でID直接取得（FullCalendarのイベントソースAPI）
 * ② /reserve ページのHTMLリンク（/reserve/detail/ID形式）からID収集 → /api/shiru_reserves/{id} で照合
 * @param {Object} cookies
 */
function fillMissingIdsFromHtml_(cookies, fastMode) {
  // fastMode=true: fetchMeetupFields_省略（速度優先。fetchAllUpcomingMeetups内から呼ぶ場合）
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Meetup予定シートのF列（予約ID）が空の行を収集
  const meetupSheet = ss.getSheetByName(SHEET_MEETUP);
  const meetupIdTargets = {}; // "企業名_YYYY-MM-DD" → [行番号, ...]
  if (meetupSheet && meetupSheet.getLastRow() > 1) {
    const nc = meetupSheet.getLastColumn();
    const mData = meetupSheet.getRange(2, 1, meetupSheet.getLastRow() - 1, Math.max(nc, 6)).getValues();
    mData.forEach(function(mRow, mi) {
      const d = mRow[0];
      const cn = String(mRow[1] || '').trim();
      const eid = String(mRow[5] || '').trim();
      if (cn && !eid && d) {
        const ds = Utilities.formatDate(new Date(d), TIMEZONE, 'yyyy-MM-dd');
        const k = cn + '_' + ds;
        if (!meetupIdTargets[k]) meetupIdTargets[k] = [];
        meetupIdTargets[k].push(mi + 2);
      }
    });
  }
  Logger.log('fillMissingIdsFromHtml: Meetup予定F列空行 ' + Object.keys(meetupIdTargets).length + '件');

  try {
    const allDetailIds = [];
    const addIdsFromPage_ = function(pageHtml) {
      // /reserve/detail/{id} リンクを収集
      const re = /\/reserve\/detail\/(\d+)/g;
      let m;
      while ((m = re.exec(pageHtml)) !== null) {
        if (allDetailIds.indexOf(m[1]) === -1) allDetailIds.push(m[1]);
      }
    };

    // ── ① /api/calendar_reserves で全イベントのIDを直接取得（FullCalendarのイベントソースAPI） ──
    try {
      Utilities.sleep(300);
      const today_ = new Date();
      // 今月初日〜3ヶ月後末日
      const calStartStr = Utilities.formatDate(new Date(today_.getFullYear(), today_.getMonth(), 1), TIMEZONE, 'yyyy-MM-dd') + 'T00:00:00+09:00';
      const calEndDate = new Date(today_.getFullYear(), today_.getMonth() + 3, 0);
      const calEndStr = Utilities.formatDate(calEndDate, TIMEZONE, 'yyyy-MM-dd') + 'T23:59:59+09:00';
      const calApiUrl = SHIRUCAFE_BASE_URL + '/api/calendar_reserves?start=' + encodeURIComponent(calStartStr) + '&end=' + encodeURIComponent(calEndStr) + '&store_id=' + SHIRUCAFE_STORE_ID;
      Logger.log('calendar_reserves API URL: ' + calApiUrl);
      const calApiRes = UrlFetchApp.fetch(calApiUrl, {
        headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        muteHttpExceptions: true
      });
      Logger.log('calendar_reserves HTTP=' + calApiRes.getResponseCode());
      if (calApiRes.getResponseCode() === 200) {
        const calEvents = JSON.parse(calApiRes.getContentText());
        if (Array.isArray(calEvents) && calEvents.length > 0) {
          Logger.log('calendar_reserves: ' + calEvents.length + '件 fields=' + JSON.stringify(Object.keys(calEvents[0])));
          calEvents.forEach(function(ev) {
            const eid = String(ev.id || ev.reserve_id || ev.shiru_reserve_id || '');
            const ename = String(ev.title || ev.sponsor_name || ev.name || '').trim();
            const eday = String(ev.start || ev.reserve_day || '').substring(0, 10);
            if (eid && allDetailIds.indexOf(eid) === -1) allDetailIds.push(eid);
            if (eid && ename && eday) {
              const mKey = ename + '_' + eday;
              if (meetupIdTargets[mKey]) {
                meetupIdTargets[mKey].forEach(function(rowNum) {
                  meetupSheet.getRange(rowNum, 6).setValue(eid);
                });
                Logger.log('calendar_reserves書込: ' + ename + '(' + eday + ') → ' + eid);
                delete meetupIdTargets[mKey];
              }
            }
          });
          Logger.log('calendar_reserves処理後 F列残: ' + Object.keys(meetupIdTargets).length + '件');
        } else {
          Logger.log('calendar_reserves: 空配列 or 非配列 body=' + calApiRes.getContentText().substring(0, 200));
        }
      } else {
        Logger.log('calendar_reserves エラー body=' + calApiRes.getContentText().substring(0, 200));
      }
    } catch (eCal) { Logger.log('calendar_reserves エラー: ' + eCal.message); }

    // ── ② /reserve ページをページネーションでスキャン（30件/ページ、フォールバック） ──
    for (let pg = 1; pg <= 15; pg++) {
      if (Object.keys(meetupIdTargets).length === 0) break;
      try {
        Utilities.sleep(200);
        const pageUrl = SHIRUCAFE_BASE_URL + '/reserve' + (pg > 1 ? '?page=' + pg : '');
        const listRes = UrlFetchApp.fetch(pageUrl, {
          headers: { 'Cookie': buildCookieString_(cookies), 'Accept': 'text/html' },
          followRedirects: true, muteHttpExceptions: true
        });
        if (listRes.getResponseCode() !== 200) { Logger.log('/reserve page=' + pg + ' HTTP=' + listRes.getResponseCode()); break; }
        const before = allDetailIds.length;
        addIdsFromPage_(listRes.getContentText());
        Logger.log('/reserve page=' + pg + ': +' + (allDetailIds.length - before) + '件 (計' + allDetailIds.length + '件)');
        if (allDetailIds.length === before && pg > 2) break; // 2ページ連続で新規IDなければ終了
      } catch (eL) { Logger.log('/reserve page=' + pg + ' エラー: ' + eL.message); break; }
    }

    Logger.log('収集detailID総数: ' + allDetailIds.length + ' / F列残: ' + Object.keys(meetupIdTargets).length + '件');
    // 診断: meetupIdTargetsのサンプルを出力
    const mKeys = Object.keys(meetupIdTargets);
    Logger.log('meetupIdTargetsサンプル: ' + mKeys.slice(0, 3).join(' / ') + ' (計' + mKeys.length + '件)');

    // ── ③ /api/shiru_reserves/{id} で企業名・日付を照合してF列更新 ──
    const xsrfToken = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
    allDetailIds.forEach(function(rid) {
      if (Object.keys(meetupIdTargets).length === 0) return; // F列が全部埋まったら終了
      try {
        Utilities.sleep(300);
        const apiRes = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/api/shiru_reserves/' + rid, {
          headers: {
            'Cookie': buildCookieString_(cookies),
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken
          },
          muteHttpExceptions: true
        });
        const code = apiRes.getResponseCode();
        if (code === 200) {
          const data = JSON.parse(apiRes.getContentText());
          const record = data.reserve || data;
          const sName = String(record.sponsor_name || (record.sponsor && record.sponsor.name) || '').trim();
          const rDay = String(record.reserve_day || '').substring(0, 10); // "2026-03-06"
          // Meetup予定 F列更新（企業名×日付で一致）
          if (sName && rDay && meetupSheet) {
            const mKey = sName + '_' + rDay;
            if (meetupIdTargets[mKey]) {
              meetupIdTargets[mKey].forEach(function(rowNum) {
                meetupSheet.getRange(rowNum, 6).setValue(rid);
              });
              Logger.log('Meetup予定F列更新: ' + sName + '(' + rDay + ') → ' + rid);
              delete meetupIdTargets[mKey];
            }
          }
        } else if (code !== 429) {
          Logger.log('API (ID=' + rid + '): HTTP ' + code);
        }
      } catch (e2) {
        Logger.log('API取得エラー (ID=' + rid + '): ' + e2.message);
      }
    });

  } catch (e) {
    Logger.log('fillMissingIdsFromHtml エラー: ' + e.message);
  }

  const remaining = Object.keys(meetupIdTargets);
  Logger.log('fillMissingIdsFromHtml完了: Meetup予定F列残=' + remaining.length + '件');
  if (remaining.length > 0) {
    Logger.log('未取得一覧:\n' + remaining.join('\n'));
  }
}

/**
 * HTML エンティティを文字に戻す
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities_(text) {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // &amp; は最後に変換
}

/**
 * イベント詳細テキストからハッシュタグ形式で業界タグを抽出する
 * 対応形式: #(xxx)、#xxx、＃xxx（全角）／「〇〇卒」タグは除外
 * @param {string} text
 * @returns {string}
 */
function extractIndustryTags_(text) {
  if (!text) return '';
  const tags = [];
  const hashParenRe = /#\(([^)]+)\)/g;
  let hm;
  while ((hm = hashParenRe.exec(text)) !== null) {
    const tag = hm[1].trim();
    if (!/\d+卒/.test(tag)) tags.push(tag);
  }
  if (tags.length === 0) {
    const hashTextRe = /[#＃]([^\s　#＃、。・\n\r\/]{2,50})/gu;
    let hm2;
    while ((hm2 = hashTextRe.exec(text)) !== null) {
      const tag = hm2[1].trim();
      if (!/\d+卒/.test(tag)) tags.push(tag);
    }
  }
  return [...new Set(tags)].join('、');
}


/**
 * Gemini API を使って長文の「イベントの詳細」を簡潔に要約する
 * @param {string} companyName
 * @param {string} rawDetails - スクラップした生のイベント詳細
 * @returns {string} - 約100文字〜150文字の要約文
 */
function summarizeEventDetails_(companyName, rawDetails) {
  if (!rawDetails) return '';
  if (rawDetails.length <= 150) return rawDetails.replace(/\n+/g, ' '); // 短い場合はそのまま（改行削除）

  if (!GEMINI_API_KEY) return rawDetails.substring(0, 150).replace(/\n+/g, ' ') + '...';

  const prompt = `あなたはカフェで行われる「企業Meetup（学生と企業の交流イベント）」の案内文を作成するアシスタントです。
以下の「イベント詳細」は文字数が多く冗長なため、LINE等で学生に読みやすく伝わるように、100文字〜150文字程度で**簡潔に要約**してください。
不要な挨拶や複雑な条件は省き、「結局何をするイベントなのか」を中心にまとめてください。

【企業名】: ${companyName}
【イベント詳細原文】:
${rawDetails.substring(0, 1500)}`;

  const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY;
  try {
    Utilities.sleep(4100); // 無料枠制限考慮
    const res = UrlFetchApp.fetch(apiUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      const result = JSON.parse(res.getContentText());
      const summary = result.candidates[0].content.parts[0].text.trim();
      Logger.log('イベント詳細要約成功 (' + companyName + ')');
      return summary;
    }
  } catch (e) {
    Logger.log('Gemini 詳細要約エラー: ' + e.message);
  }
  return rawDetails.substring(0, 150).replace(/\n+/g, ' ') + '...';
}


/**
 * 過去の日付の行をスプレッドシートから削除する
 * 毎朝0時のトリガーで自動実行
 */
function cleanupPastMeetups() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet || sheet.getLastRow() <= 1) return;

  // 過去グラフでMeetup補正を正しく反映するため30日分は残す
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 30);

  const data = sheet.getDataRange().getValues();
  let deleted = 0;

  for (let i = data.length - 1; i >= 1; i--) {
    const dateVal = data[i][0];
    if (dateVal instanceof Date && dateVal < cutoff) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }

  Logger.log('過去Meetup削除(30日超): ' + deleted + '件');
}

/**
 * 当週のMeetup予定をスプレッドシートから取得する
 * fetchMeetupSchedule が月曜8時に翌週データを更新した後、月曜9時に呼ばれる想定
 * @returns {{ meetups: Array, weekStart: Date, weekEnd: Date }}
 */
function getMeetupsForWeek_() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() + daysUntilNextMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { meetups: [], weekStart: weekStart, weekEnd: weekEnd };
  }

  const data = sheet.getDataRange().getValues();

  // 企業IDマスターから詳細情報をJOIN
  const masterMap = loadCompanyIdMaster_();

  const meetups = [];

  for (let i = 1; i < data.length; i++) {
    const dateVal = data[i][0];
    if (!dateVal) continue;
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) continue;

    const dMidnight = new Date(d);
    dMidnight.setHours(0, 0, 0, 0);
    if (dMidnight >= weekStart && dMidnight < weekEnd) {
      const companyName = String(data[i][1]).trim();
      const masterEntry = masterMap[companyName] || {};
      meetups.push({
        date: d,
        company: companyName,
        time: String(data[i][2]).trim(),
        kind: String(data[i][3]).trim(),
        targetYear: masterEntry.targetYear || '',
        theme: masterEntry.theme || '',
        industry: masterEntry.industry || '',
        hookPoint: masterEntry.hookPoint || ''
      });
    }
  }

  return { meetups: meetups, weekStart: weekStart, weekEnd: weekEnd };
}

/**
 * 週次Meetup共有メッセージを組み立てる
 * @param {Array} meetups - getMeetupsForWeek_() で取得した配列
 * @param {Date} weekStart - 週の開始日（月曜）
 * @param {Date} weekEnd   - 週の終了日（翌月曜・exclusive）
 * @returns {string}
 */
function buildWeeklyMeetupMessage_(meetups, weekStart, weekEnd) {
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  const ws = weekStart.getMonth() + 1 + '/' + weekStart.getDate();
  const weDate = new Date(weekEnd);
  weDate.setDate(weDate.getDate() - 1);
  const we = weDate.getMonth() + 1 + '/' + weDate.getDate();

  let text = '【来週のMeetup予定】' + ws + '\uFF5E' + we + '\n\n';

  // 日付ごとにグルーピング
  const grouped = {};
  const dateOrder = [];
  meetups.forEach(function (m) {
    const key = Utilities.formatDate(m.date, TIMEZONE, 'yyyy-MM-dd');
    if (!grouped[key]) {
      const d = m.date;
      const label = '\uD83D\uDCC5 ' + (d.getMonth() + 1) + '/' + d.getDate() + '(' + dayNames[d.getDay()] + ')';
      grouped[key] = { label: label, items: [] };
      dateOrder.push(key);
    }
    grouped[key].items.push(m);
  });

  dateOrder.sort();
  dateOrder.forEach(function (key) {
    const group = grouped[key];
    text += group.label + '\n';
    group.items.forEach(function (m) {
      text += '\uD83C\uDFE2 ' + m.company + '\n';
      text += '\u23F0 ' + m.time;
      if (m.kind) text += '  (' + m.kind + ')';
      text += '\n';
      if (m.theme) {
        text += '\uD83D\uDCCC ' + m.theme + '\n';
      }
      if (m.targetYear) {
        text += '\uD83C\uDF93 ' + m.targetYear + '\n';
      }
      if (m.industry) {
        text += '   ' + m.industry + '\n';
      }
      if (m.hookPoint) {
        text += '\uD83C\uDFAF ' + m.hookPoint + '\n';
      }
      text += '\n';
    });
  });

  return text.trimRight() + '\n';
}

/**
 * 参加数取得の診断用関数
 * ログに：IDマスター状況・API応答フィールド・名前一致チェックを出力する
 */
function diagnoseMeetupParticipation() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const meetupSheet = ss.getSheetByName(SHEET_MEETUP);
  if (!meetupSheet) { Logger.log('Meetup予定シートなし'); return; }

  const masterMap = loadCompanyIdMaster_();
  const masterWithId = Object.keys(masterMap).filter(function(k) { return masterMap[k].reserveId; });
  Logger.log('=== 企業IDマスター ===');
  Logger.log('総数: ' + Object.keys(masterMap).length + '社 / ID有り: ' + masterWithId.length + '社');
  if (masterWithId.length > 0) {
    Logger.log('ID有り企業例: ' + masterWithId.slice(0, 5).join(', '));
  }

  Logger.log('=== Meetup予定シート ===');
  const data = meetupSheet.getDataRange().getValues();
  Logger.log('行数(ヘッダー含む): ' + data.length);
  Logger.log('ヘッダー: ' + JSON.stringify(data[0]));
  for (let i = 1; i < Math.min(6, data.length); i++) {
    const name = String(data[i][1] || '').trim();
    const master = masterMap[name];
    Logger.log('行' + (i + 1) + ': [' + name + '] → ' + (master ? 'ID=' + (master.reserveId || '空') : 'マスター未登録'));
  }

  if (masterWithId.length === 0) {
    Logger.log('IDを持つ企業が0社 → 参加数取得不可。企業IDマスターを確認してください。');
    return;
  }

  // IDがある最初の企業でAPIをテスト
  const testCompany = masterWithId[0];
  const rid = masterMap[testCompany].reserveId;
  Logger.log('=== APIテスト: ' + testCompany + ' (ID=' + rid + ') ===');

  const cookies = loginToShirucafe_();
  if (!cookies) { Logger.log('ログイン失敗'); return; }

  const xsrfToken = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
  try {
    const res = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/api/shiru_reserves/' + rid, {
      headers: {
        'Cookie': buildCookieString_(cookies),
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': xsrfToken
      },
      muteHttpExceptions: true
    });
    Logger.log('API HTTP: ' + res.getResponseCode());
    const apiData = JSON.parse(res.getContentText());
    const record = apiData.reserve || apiData;
    Logger.log('reserve フィールド一覧: ' + JSON.stringify(Object.keys(record)));
    // 学生・参加・定員系フィールドを全部出力（学生参加枠を特定するため）
    Logger.log('--- 学生/参加/定員系フィールド ---');
    Object.keys(record).forEach(function(k) {
      if (/student|result|number|count|attend|participant|reserve|frame|limit|cap|slot|quota|boshu|yoyaku|capacity/i.test(k)) {
        Logger.log('  ' + k + ' = ' + JSON.stringify(record[k]));
      }
    });
    // 数値型フィールドをすべて出力
    Logger.log('--- 数値型フィールド全件 ---');
    Object.keys(record).forEach(function(k) {
      const v = record[k];
      if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v) && v !== '')) {
        Logger.log('  ' + k + ' = ' + v);
      }
    });
    // shiru_reserve_stores の先頭要素を出力（学生参加枠がここにある可能性）
    if (Array.isArray(record.shiru_reserve_stores) && record.shiru_reserve_stores.length > 0) {
      const firstStore = record.shiru_reserve_stores[0];
      Logger.log('shiru_reserve_stores[0] フィールド: ' + JSON.stringify(Object.keys(firstStore)));
      Logger.log('shiru_reserve_stores[0] 内容: ' + JSON.stringify(firstStore));
    }
    // formsも確認
    if (apiData.forms) {
      Logger.log('forms キー: ' + JSON.stringify(Object.keys(apiData.forms)));
    }
    Logger.log('=== JSONAPIでは学生参加枠フィールドなし → 詳細HTMLページを確認 ===');
  } catch (e) {
    Logger.log('APIテストエラー: ' + e.message);
  }

  // 詳細HTMLページ（Inertia JSON）から学生参加枠を探す
  Logger.log('=== 詳細ページ (HTML/Inertia) テスト ===');
  try {
    Utilities.sleep(500);
    const xsrfToken2 = decodeURIComponent(cookies['XSRF-TOKEN'] || '');
    const detailRes = UrlFetchApp.fetch(SHIRUCAFE_BASE_URL + '/reserve/detail/' + rid, {
      headers: { 'Cookie': buildCookieString_(cookies), 'X-XSRF-TOKEN': xsrfToken2 },
      followRedirects: true,
      muteHttpExceptions: true
    });
    Logger.log('詳細ページ HTTP: ' + detailRes.getResponseCode());
    if (detailRes.getResponseCode() === 200) {
      const dHtml = detailRes.getContentText();
      const dm = dHtml.match(/data-page="([^"]+)"/);
      if (dm) {
        const dp = JSON.parse(dm[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&'));
        const props = dp.props || {};
        const dreserve = props.reserve || props.shiru_reserve || {};
        Logger.log('詳細ページ Inertia reserve フィールド: ' + JSON.stringify(Object.keys(dreserve)));
        // 学生・定員系フィールドを全出力
        Logger.log('--- 詳細ページ 学生/定員系フィールド ---');
        Object.keys(dreserve).forEach(function(k) {
          if (/student|limit|cap|frame|quota|boshu|slot/i.test(k)) {
            Logger.log('  ' + k + ' = ' + JSON.stringify(dreserve[k]));
          }
        });
        // 全数値フィールド
        Logger.log('--- 詳細ページ 数値フィールド ---');
        Object.keys(dreserve).forEach(function(k) {
          const v = dreserve[k];
          if (typeof v === 'number') Logger.log('  ' + k + ' = ' + v);
        });
        // APIと詳細ページの差分フィールド
        const apiKeys = ['reserve_id','sponsor_id','student_number','reserve_result_number','reserve_kind','reserve_theme'];
        const newKeys = Object.keys(dreserve).filter(function(k) { return apiKeys.indexOf(k) === -1; });
        if (newKeys.length > 0) Logger.log('詳細ページ追加フィールド(API未含む): ' + JSON.stringify(newKeys));
      } else {
        // Inertia JSONなし → HTMLテキストで「学生参加枠」周辺を検索
        Logger.log('Inertia data-page なし → HTMLテキスト解析');
        const cm = dHtml.match(/学生参加枠[\s\S]{0,300}/);
        if (cm) Logger.log('HTML学生参加枠周辺(先頭200字): ' + cm[0].substring(0, 200).replace(/\n/g, ' '));
      }
    }
  } catch (e2) {
    Logger.log('詳細ページテストエラー: ' + e2.message);
  }
  Logger.log('=== 診断完了 ===');
}

/**
 * Meetup予定シートの参加数（E列）だけを更新する（単独実行用）
 */
function updateParticipationOnly() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_MEETUP);
  if (!sheet) { Logger.log('Meetup予定シートなし'); return; }
  const cookies = loginToShirucafe_();
  if (!cookies) { Logger.log('ログイン失敗'); return; }
  updateMeetupParticipation_(sheet, cookies);
}

/**
 * 残席の定期更新トリガー用ラッパー
 * 2時間ごとに呼ばれるが、10〜18時の範囲外はスキップする
 */
function triggerParticipationUpdate() {
  const hour = Number(Utilities.formatDate(new Date(), TIMEZONE, 'H'));
  if (hour < 10 || hour > 18) {
    Logger.log('triggerParticipationUpdate: 対象時間外のためスキップ（' + hour + '時）');
    return;
  }
  Logger.log('triggerParticipationUpdate: 残席更新開始（' + hour + '時）');
  updateParticipationOnly();
}

/**
 * 日次更新ステップ1（毎朝設定時刻）
 * ① 30日分の新規イベントを差分追加
 * ② F列（予約ID）を補完
 * ③ E列（参加数）・G列（卒年）を更新
 */
function dailyMeetupUpdate() {
  Logger.log('=== dailyMeetupUpdate（ステップ1）開始 ===');
  fetchAllUpcomingMeetups();
  fillMissingIds();
  updateParticipationOnly();
  Logger.log('=== dailyMeetupUpdate（ステップ1）完了 ===');
}

/**
 * 日次更新ステップ2（設定時刻+1時間後）
 * ④ 業界を空の企業をGeminiで自動分類
 * ⑤ フォームの選択肢を企業IDマスターと同期
 */
function dailyMeetupUpdateStep2() {
  Logger.log('=== dailyMeetupUpdateStep2（ステップ2）開始 ===');
  fillIndustryWithGemini_();       // 業界分類（30社バッチ=1回）
  fillHookAndThemeWithGemini_();   // フック・テーマ生成（上限内で1社1回）
  if (isFormSyncEnabled_()) {
    syncMeetupFormChoices_();
  } else {
    Logger.log('フォーム同期: OFF（設定シートで無効化されています）');
  }
  Logger.log('=== dailyMeetupUpdateStep2（ステップ2）完了 ===');
}

/**
 * 日次更新トリガーを設定する
 * スプレッドシートの設定シートから基準時刻を読み取り、
 * ステップ1（基準時刻）とステップ2（基準時刻+1）の2つのトリガーを登録する
 * ★ 初回のみ手動で実行すること
 */
function setDailyMeetupTrigger() {
  deleteExistingTriggers_('fetchAllUpcomingMeetups');
  deleteExistingTriggers_('dailyMeetupUpdate');
  deleteExistingTriggers_('dailyMeetupUpdateStep2');

  // 設定シートから基準時刻を取得（デフォルト7時）
  var baseHour = 7;
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === 'Meetup日次更新実行時間（時）') {
          var v = parseInt(data[i][1], 10);
          if (!isNaN(v)) baseHour = v;
          break;
        }
      }
    }
  } catch (e) {
    Logger.log('設定読み取りエラー: ' + e.message);
  }

  ScriptApp.newTrigger('dailyMeetupUpdate')
    .timeBased()
    .atHour(baseHour)
    .everyDays(1)
    .create();

  ScriptApp.newTrigger('dailyMeetupUpdateStep2')
    .timeBased()
    .atHour(baseHour + 1)
    .everyDays(1)
    .create();

  Logger.log('Meetup日次更新トリガー設定完了（ステップ1: ' + baseHour + '時 / ステップ2: ' + (baseHour + 1) + '時）');
}

/**
 * 自動実行トリガーを設定する
 * ・毎週月曜 8:00 → Meetup取込（翌週分）
 * ・毎日 0:00   → 過去日の行を削除
 * ★ 初回のみ手動で実行すること
 */
function setMeetupTrigger() {
  const targets = ['fetchMeetupSchedule', 'cleanupPastMeetups'];
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return targets.indexOf(t.getHandlerFunction()) !== -1; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  // 毎週月曜 8:00 に取込
  ScriptApp.newTrigger('fetchMeetupSchedule')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  // 毎日 0:00 に過去日削除
  ScriptApp.newTrigger('cleanupPastMeetups')
    .timeBased()
    .atHour(0)
    .everyDays(1)
    .create();

  Logger.log('Meetupトリガー設定完了（取込: 毎週月曜8時 / 削除: 毎日0時）');
}

// ============================================================
// Google Form 企業選択肢同期
// ============================================================

/**
 * 設定シートの「フォーム同期」チェックボックスを読み込む（デフォルト: OFF）
 */
function isFormSyncEnabled_() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_SETTINGS);
    if (!sheet) return false;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === 'フォーム同期') {
        return data[i][1] === true || String(data[i][1]).toUpperCase() === 'TRUE';
      }
    }
  } catch (e) {
    Logger.log('フォーム同期設定取得エラー: ' + e.message);
  }
  return false; // 未設定時はOFF
}

/**
 * 既存GoogleFormの「【誘致に成功した企業】」セクションの選択肢質問を
 * 企業IDマスターの企業名で更新する
 * - LIST/MULTIPLE_CHOICEはCHECKBOX（複数選択）に変換する
 * - 次のセクション（アピールポイント記入欄）も同期する
 */
function syncMeetupFormChoices_() {
  const SECTION_TITLE = '【誘致に成功した企業】';

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log('syncMeetupFormChoices_: 企業IDマスターにデータなし');
    return 0;
  }

  const companies = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .getValues()
    .map(function(r) { return String(r[0] || '').trim(); })
    .filter(Boolean);

  if (companies.length === 0) { Logger.log('syncMeetupFormChoices_: 企業名0件'); return 0; }

  const form = FormApp.openById(MEETUP_FORM_ID);
  const items = form.getItems();

  // タイトルで対象セクションのPAGE_BREAKを検索
  var sec26PBIndex = -1;
  var sec27PBIndex = -1;
  var foundFirst = false;
  for (var i = 0; i < items.length; i++) {
    if (items[i].getType() !== FormApp.ItemType.PAGE_BREAK) continue;
    var pbTitle = String(items[i].getTitle() || '').trim();
    if (!foundFirst && pbTitle === SECTION_TITLE) {
      sec26PBIndex = i;
      foundFirst = true;
    } else if (foundFirst && sec27PBIndex < 0) {
      sec27PBIndex = i;
      break;
    }
  }

  if (sec26PBIndex < 0) {
    Logger.log('syncMeetupFormChoices_: セクション「' + SECTION_TITLE + '」が見つかりません');
    return 0;
  }

  // --- 企業選択チェックボックスを同期 ---
  syncFormSection26_(form, sec26PBIndex, sec27PBIndex, companies);

  Logger.log('syncMeetupFormChoices_完了: ' + companies.length + '社');
  return companies.length;
}

/**
 * 企業選択チェックボックスを更新/作成する
 * @param {GoogleAppsScript.Forms.Form} form
 * @param {number} sec26PBIndex - 「【誘致に成功した企業】」PAGE_BREAKのインデックス
 * @param {number} sec27PBIndex - 次のPAGE_BREAKのインデックス（-1なら末尾まで）
 * @param {string[]} companies
 */
function syncFormSection26_(form, sec26PBIndex, sec27PBIndex, companies) {
  var items = form.getItems();
  var endIndex = sec27PBIndex >= 0 ? sec27PBIndex : items.length;
  var foundItem = null;

  for (var i = sec26PBIndex + 1; i < endIndex; i++) {
    var t = items[i].getType();
    if (t === FormApp.ItemType.CHECKBOX ||
        t === FormApp.ItemType.LIST ||
        t === FormApp.ItemType.MULTIPLE_CHOICE) {
      foundItem = items[i];
      break;
    }
  }

  if (foundItem) {
    var ft = foundItem.getType();
    if (ft === FormApp.ItemType.CHECKBOX) {
      foundItem.asCheckboxItem().setChoiceValues(companies);
    } else if (ft === FormApp.ItemType.MULTIPLE_CHOICE) {
      foundItem.asMultipleChoiceItem().setChoiceValues(companies);
    } else {
      foundItem.asListItem().setChoiceValues(companies);
    }
    Logger.log('企業選択チェックボックス 選択肢更新: ' + companies.length + '社');
  } else {
    var newCb = form.addCheckboxItem();
    newCb.setTitle('企業を選択してください（複数選択可）');
    newCb.setChoiceValues(companies);
    var fi = form.getItems();
    form.moveItem(fi.length - 1, sec26PBIndex + 1);
    Logger.log('企業選択チェックボックス 新規作成: ' + companies.length + '社');
  }
}


/**
 * フォーム送信時にアピールポイントを企業IDマスターのD列以降に蓄積する
 * フォームのonSubmitトリガーとして動作する
 */
function onMeetupFormSubmit_(e) {
  var responses = e.response.getItemResponses();
  var selectedCompanies = [];
  var appealText = '';

  responses.forEach(function(ir) {
    var t = ir.getItem().getType();
    if (t === FormApp.ItemType.CHECKBOX) {
      var resp = ir.getResponse();
      if (Array.isArray(resp)) selectedCompanies = resp;
    }
    if (t === FormApp.ItemType.PARAGRAPH_TEXT &&
        ir.getItem().getTitle() === MEETUP_APPEAL_QUESTION_TITLE) {
      appealText = String(ir.getResponse() || '');
    }
  });

  Logger.log('onMeetupFormSubmit_: 選択企業=' + selectedCompanies.join(',') + ' テキスト長=' + appealText.length);

  // 「企業名: コメント」形式を1行ずつ解析して保存
  if (appealText) {
    appealText.split('\n').forEach(function(line) {
      var colonIdx = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':');
      if (colonIdx === -1) return;
      var company = line.substring(0, colonIdx).trim();
      var comment = line.substring(colonIdx + 1).trim();
      if (company && comment) appendAppealPoint_(company, comment);
    });
  }
}

/**
 * スタッフアピールポイントを企業IDマスターのE列以降に追記する
 */
function appendAppealPoint_(company, comment) {
  if (!company || !comment) return;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet || sheet.getLastRow() <= 1) return;

  // スタッフアピール開始列をヘッダーから取得（デフォルトE=5）
  const numCols = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var appealStartCol = 5; // E列（1-based）
  header.forEach(function(h, i) {
    if (String(h || '') === 'スタッフアピール') {
      appealStartCol = i + 1; // 1-based
    }
  });

  const names = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < names.length; i++) {
    if (String(names[i][0] || '').trim() !== company) continue;

    var rowNum = i + 2;
    var lastCol = sheet.getLastColumn();
    var readCols = Math.max(lastCol - appealStartCol + 1, 1);
    var rowVals = sheet.getRange(rowNum, appealStartCol, 1, readCols).getValues()[0];

    // 次の空列を探す（全部埋まっていれば末尾の次）
    var nextOffset = rowVals.length;
    for (var j = 0; j < rowVals.length; j++) {
      if (String(rowVals[j] || '').trim() === '') { nextOffset = j; break; }
    }

    sheet.getRange(rowNum, appealStartCol + nextOffset).setValue(comment);
    Logger.log('アピールポイント追加: ' + company + ' 列' + (appealStartCol + nextOffset) + ' = ' + comment.substring(0, 40));
    return;
  }
  Logger.log('appendAppealPoint_: 企業が見つかりません: ' + company);
}

/**
 * AIアピールポイントを企業IDマスターのD列（AIアピール列）に上書き保存する
 * @param {string} companyName
 * @param {string} appeal
 */
function setAiAppeal_(companyName, appeal) {
  if (!companyName || !appeal) return;
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet || sheet.getLastRow() <= 1) return;
  const numCols = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var aiCol = 4; // D列（1-based）
  header.forEach(function(h, i) {
    const s = String(h || '');
    if (s === 'AIアピール' || s === 'アピールポイント' || s === 'hookPoint') aiCol = i + 1;
  });
  const names = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < names.length; i++) {
    if (String(names[i][0] || '').trim() === companyName) {
      sheet.getRange(i + 2, aiCol).setValue(appeal);
      Logger.log('AIアピール設定: ' + companyName + ' → ' + appeal.substring(0, 50));
      return;
    }
  }
}

/**
 * 企業IDマスターのヘッダーを新フォーマットに移行する（手動1回実行）
 * 「アピールポイント」→「AIアピール」に変更し、E列に「スタッフアピール」ヘッダーを追加する
 */
function migrateCompanyIdMasterHeader() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_COMPANY_IDS);
  if (!sheet) { Logger.log('企業IDマスターシートが見つかりません'); return; }
  const numCols = Math.max(sheet.getLastColumn(), 5);
  const header = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var changed = false;
  for (var i = 0; i < header.length; i++) {
    const s = String(header[i] || '');
    if (s === 'アピールポイント' || s === 'hookPoint') {
      header[i] = 'AIアピール';
      if (!header[i + 1] || header[i + 1] === '') header[i + 1] = 'スタッフアピール';
      changed = true;
      break;
    }
    if (s === 'AIアピール') {
      if (!header[i + 1] || header[i + 1] === '') { header[i + 1] = 'スタッフアピール'; changed = true; }
      break;
    }
  }
  if (changed) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    Logger.log('企業IDマスターヘッダー移行完了: ' + header.join(' | '));
    SpreadsheetApp.getUi().alert('完了', 'ヘッダーを移行しました。\n' + header.join(' | '), SpreadsheetApp.getUi().ButtonSet.OK);
  } else {
    Logger.log('企業IDマスターヘッダー: 移行済みまたは対象なし');
    SpreadsheetApp.getUi().alert('既に移行済みか、対象ヘッダーが見つかりませんでした。');
  }
}

/**
 * フォーム送信トリガーを設定する（初回のみ手動実行）
 */
function setupMeetupFormTrigger() {
  // 既存の同名トリガーを削除
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'onMeetupFormSubmit_'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('onMeetupFormSubmit_')
    .forForm(MEETUP_FORM_ID)
    .onFormSubmit()
    .create();

  Logger.log('Meetupフォーム送信トリガーを設定しました');
  SpreadsheetApp.getUi().alert('フォーム送信トリガーを設定しました。');
}

/**
 * メニューから手動実行するフォーム同期ラッパー
 */
function menuSyncMeetupForm() {
  var count = syncMeetupFormChoices_();
  if (count > 0) {
    SpreadsheetApp.getUi().alert('フォームの選択肢を更新しました（' + count + '社）。');
  } else {
    SpreadsheetApp.getUi().alert('更新できませんでした。ログを確認してください。');
  }
}

/**
 * 指定期間内の対面Meetup一覧を返す（シフトカレンダー用）
 * 満席でも表示する。オンライン種別のみ除外。
 * @param {string} from - YYYY-MM-DD
 * @param {string} to   - YYYY-MM-DD
 * @returns {{ ok: boolean, meetups: Object }} meetups = { 'YYYY-MM-DD': [{company, time, kind}] }
 */
function getInPersonMeetups_(from, to) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_MEETUP);
    if (!sheet || sheet.getLastRow() <= 1) {
      Logger.log('getInPersonMeetups_: シートなし or データなし');
      return { ok: true, meetups: {} };
    }

    const lastRow = sheet.getLastRow();
    const numCols = Math.max(sheet.getLastColumn(), 4);
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const meetups = {};

    for (var i = 0; i < data.length; i++) {
      const dateVal = data[i][0];
      if (!dateVal) continue;
      const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
      if (isNaN(d.getTime())) continue;

      const dateStr = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
      if (from && dateStr < from) continue;
      if (to && dateStr > to) continue;

      const kind    = String(data[i][3] || '').trim();
      const company = String(data[i][1] || '').trim();
      if (!company) continue;

      // オンライン専用は除外（「オンライン」を含みかつ「対面」を含まない）
      const kindLower = kind.toLowerCase();
      if (kind.includes('オンライン') && !kind.includes('対面')) continue;

      if (!meetups[dateStr]) meetups[dateStr] = [];
      meetups[dateStr].push({ company: company, time: String(data[i][2] || '').trim(), kind: kind });
    }

    Logger.log('getInPersonMeetups_: ' + from + '〜' + to + ' 件数=' + Object.keys(meetups).length + '日');
    return { ok: true, meetups: meetups };
  } catch (e) {
    Logger.log('getInPersonMeetups_ error: ' + e.message);
    return { ok: true, meetups: {} };
  }
}
