/**
 * BigQuery から店舗進捗データを取得する
 * @param {string[]} yearMonths - ["2026-03","2027-01"] 形式（年またぎ対応）
 * @param {string} storeName - 店舗名（例: 'BiZCAFE（千葉大学）店'）
 * @returns {Object} { DU, Meetup, MCS } それぞれ { actual, target }
 */
function getStoreProgress(yearMonths, storeName) {
  var jobProjectId  = 'bizcafe423';
  var dataProjectId = 'fair-solution-453613-e2';
  var datasetId     = '202506';

  if (!yearMonths || yearMonths.length === 0) return null;

  var tbl = function(name) {
    return '`' + dataProjectId + '`' + '.`' + datasetId + '`' + '.`' + name + '`';
  };

  // 月ごとの日付範囲条件を OR で結合（年またぎ対応）
  var dateConditions = yearMonths.map(function(ym) {
    var parts = ym.split('-');
    var y = parseInt(parts[0]), m = parseInt(parts[1]);
    var start = y + '-' + pad2_(m) + '-01';
    var lastDay = new Date(y, m, 0).getDate();
    var end = y + '-' + pad2_(m) + '-' + pad2_(lastDay);
    return "(date >= '" + start + "' AND date <= '" + end + "')";
  });
  var dateWhere = '(' + dateConditions.join(' OR ') + ')';

  // Meetup参加用（reservation_day カラム）
  var meetupDateConditions = yearMonths.map(function(ym) {
    var parts = ym.split('-');
    var y = parseInt(parts[0]), m = parseInt(parts[1]);
    var start = y + '-' + pad2_(m) + '-01';
    var lastDay = new Date(y, m, 0).getDate();
    var end = y + '-' + pad2_(m) + '-' + pad2_(lastDay);
    return "(reservation_day >= '" + start + "' AND reservation_day <= '" + end + "')";
  });
  var meetupDateWhere = '(' + meetupDateConditions.join(' OR ') + ')';

  // 目標値用（target_month の月初 IN リスト）
  var monthList = yearMonths.map(function(ym) {
    var parts = ym.split('-');
    return "'" + parts[0] + '-' + parts[1] + "-01'";
  }).join(',');

  try {
    var duQuery = "SELECT COALESCE(SUM(visit_du), 0) AS actual"
      + " FROM " + tbl('日次データ')
      + " WHERE " + dateWhere
      + " AND store = '" + storeName + "'";

    var meetupQuery = "SELECT COUNT(*) AS actual"
      + " FROM " + tbl('Meetup参加')
      + " WHERE " + meetupDateWhere
      + " AND store = '" + storeName + "'"
      + " AND cancell IS NULL"
      + " AND meetup_type = 'オンライン'";

    var mcsQuery = "SELECT COALESCE(SUM(viewing), 0) AS actual"
      + " FROM " + tbl('MCS')
      + " WHERE " + dateWhere
      + " AND store = '" + storeName + "'";

    // 目標値は1行=1日分の日次目標 → target_day で DISTINCT して月ごとに1行に集約してからSUM
    var goalDateConditions = yearMonths.map(function(ym) {
      var parts = ym.split('-');
      var y = parseInt(parts[0]), m = parseInt(parts[1]);
      var start = y + '-' + pad2_(m) + '-01';
      var lastDay = new Date(y, m, 0).getDate();
      var end = y + '-' + pad2_(m) + '-' + pad2_(lastDay);
      return "(target_day >= '" + start + "' AND target_day <= '" + end + "')";
    });
    var goalDateWhere = '(' + goalDateConditions.join(' OR ') + ')';

    var goalQuery = "SELECT"
      + " COALESCE(SUM(DU_goal), 0) AS du_goal,"
      + " COALESCE(SUM(Meetup_goal), 0) AS meetup_goal,"
      + " COALESCE(SUM(MCS_goal), 0) AS mcs_goal"
      + " FROM ("
      + "   SELECT target_day, MAX(DU_goal) AS DU_goal, MAX(Meetup_goal) AS Meetup_goal, MAX(MCS_goal) AS MCS_goal"
      + "   FROM " + tbl('目標値')
      + "   WHERE store = '" + storeName + "'"
      + "   AND " + goalDateWhere
      + "   GROUP BY target_day"
      + " )";

    var duActual     = runBqQuery_(jobProjectId, duQuery);
    var meetupActual = runBqQuery_(jobProjectId, meetupQuery);
    var mcsActual    = runBqQuery_(jobProjectId, mcsQuery);
    var goals        = runBqQuery_(jobProjectId, goalQuery);

    var duAct      = duActual     && duActual[0]     ? Number(duActual[0].actual)     : 0;
    var meetupAct  = meetupActual && meetupActual[0] ? Number(meetupActual[0].actual) : 0;
    var mcsAct     = mcsActual    && mcsActual[0]    ? Number(mcsActual[0].actual)    : 0;
    var duGoal     = goals        && goals[0]        ? Number(goals[0].du_goal)       : 0;
    var meetupGoal = goals        && goals[0]        ? Number(goals[0].meetup_goal)   : 0;
    var mcsGoal    = goals        && goals[0]        ? Number(goals[0].mcs_goal)      : 0;

    return {
      DU:     { actual: duAct,     target: duGoal     },
      Meetup: { actual: meetupAct, target: meetupGoal },
      MCS:    { actual: mcsAct,    target: mcsGoal    }
    };

  } catch (e) {
    Logger.log('getStoreProgress error: ' + e.message);
    return { error: e.message };
  }
}

/**
 * BigQuery から店舗進捗データ（日次）を取得する
 * @param {string[]} yearMonths - ["2026-03"] 形式
 * @param {string} storeName - 店舗名
 * @returns {Object} { DU: { "2026-03-01": 10, ... }, Meetup: { ... }, MCS: { ... } }
 */
function getStoreProgressDaily(yearMonths, storeName) {
  var jobProjectId  = 'bizcafe423';
  var dataProjectId = 'fair-solution-453613-e2';
  var datasetId     = '202506';

  if (!yearMonths || yearMonths.length === 0) return null;

  var tbl = function(name) {
    return '`' + dataProjectId + '`' + '.`' + datasetId + '`' + '.`' + name + '`';
  };

  var dateConditions = yearMonths.map(function(ym) {
    var parts = ym.split('-');
    var y = parseInt(parts[0]), m = parseInt(parts[1]);
    var start = y + '-' + pad2_(m) + '-01';
    var lastDay = new Date(y, m, 0).getDate();
    var end = y + '-' + pad2_(m) + '-' + pad2_(lastDay);
    return "(date >= '" + start + "' AND date <= '" + end + "')";
  });
  var dateWhere = '(' + dateConditions.join(' OR ') + ')';

  var meetupDateConditions = yearMonths.map(function(ym) {
    var parts = ym.split('-');
    var y = parseInt(parts[0]), m = parseInt(parts[1]);
    var start = y + '-' + pad2_(m) + '-01';
    var lastDay = new Date(y, m, 0).getDate();
    var end = y + '-' + pad2_(m) + '-' + pad2_(lastDay);
    return "(reservation_day >= '" + start + "' AND reservation_day <= '" + end + "')";
  });
  var meetupDateWhere = '(' + meetupDateConditions.join(' OR ') + ')';

  try {
    var duQuery = "SELECT CAST(date AS STRING) as d, SUM(visit_du) AS actual"
      + " FROM " + tbl('日次データ')
      + " WHERE " + dateWhere + " AND store = '" + storeName + "'"
      + " GROUP BY d ORDER BY d";

    var meetupQuery = "SELECT CAST(reservation_day AS STRING) as d, COUNT(*) AS actual"
      + " FROM " + tbl('Meetup参加')
      + " WHERE " + meetupDateWhere + " AND store = '" + storeName + "'"
      + " AND cancell IS NULL AND meetup_type = 'オンライン'"
      + " GROUP BY d ORDER BY d";

    var mcsQuery = "SELECT CAST(date AS STRING) as d, SUM(viewing) AS actual"
      + " FROM " + tbl('MCS')
      + " WHERE " + dateWhere + " AND store = '" + storeName + "'"
      + " GROUP BY d ORDER BY d";

    var duResults     = runBqQuery_(jobProjectId, duQuery);
    var meetupResults = runBqQuery_(jobProjectId, meetupQuery);
    var mcsResults    = runBqQuery_(jobProjectId, mcsQuery);

    var res = { DU: {}, Meetup: {}, MCS: {} };
    if (duResults)     duResults.forEach(function(r) { res.DU[r.d] = Number(r.actual); });
    if (meetupResults) meetupResults.forEach(function(r) { res.Meetup[r.d] = Number(r.actual); });
    if (mcsResults)    mcsResults.forEach(function(r) { res.MCS[r.d] = Number(r.actual); });

    return res;
  } catch (e) {
    Logger.log('getStoreProgressDaily error: ' + e.message);
    return { error: e.message };
  }
}

/**
 * BigQuery クエリを実行して結果行の配列を返す
 */
function runBqQuery_(projectId, query) {
  var request = {
    query: query,
    useLegacySql: false,
    timeoutMs: 30000
  };
  var response = BigQuery.Jobs.query(request, projectId);

  if (!response.jobComplete) {
    var jobId = response.jobReference.jobId;
    var location = response.jobReference.location;
    for (var i = 0; i < 10; i++) {
      Utilities.sleep(1000);
      response = BigQuery.Jobs.getQueryResults(projectId, jobId, { location: location });
      if (response.jobComplete) break;
    }
  }

  var fields = response.schema ? response.schema.fields.map(function(f) { return f.name; }) : [];
  var rows = response.rows || [];
  return rows.map(function(row) {
    var obj = {};
    row.f.forEach(function(cell, i) { obj[fields[i]] = cell.v; });
    return obj;
  });
}

/** ゼロパディング（内部用） */
function pad2_(n) {
  return n < 10 ? '0' + n : '' + n;
}

/**
 * デバッグ用: 各テーブルの店舗名と3月実績を確認する
 * GASエディタからこの関数を実行してログを確認する
 */
function debugStoreProgress() {
  var jobProjectId  = 'bizcafe423';
  var dataProjectId = 'fair-solution-453613-e2';
  var datasetId     = '202506';
  var tbl = function(name) {
    return '`' + dataProjectId + '`' + '.`' + datasetId + '`' + '.`' + name + '`';
  };

  // 各テーブルのDISTINCT store値を確認
  var tables = ['日次データ', 'MCS', '目標値'];
  tables.forEach(function(t) {
    try {
      var rows = runBqQuery_('bizcafe423', 'SELECT DISTINCT store FROM ' + tbl(t) + ' LIMIT 10');
      Logger.log(t + ' の store値: ' + JSON.stringify(rows));
    } catch(e) { Logger.log(t + ' エラー: ' + e.message); }
  });

  // Meetup参加のカラム確認（store列があるか）
  try {
    var meetupRow = runBqQuery_('bizcafe423', 'SELECT * FROM ' + tbl('Meetup参加') + ' LIMIT 1');
    Logger.log('Meetup参加 カラム: ' + JSON.stringify(Object.keys(meetupRow[0] || {})));
  } catch(e) { Logger.log('Meetup参加 エラー: ' + e.message); }

  // 3月の各指標を確認（store未フィルタで全件）
  try {
    var du = runBqQuery_('bizcafe423', 'SELECT store, SUM(visit_du) AS total FROM ' + tbl('日次データ') + " WHERE date BETWEEN '2026-03-01' AND '2026-03-31' GROUP BY store");
    Logger.log('DU実績(全店): ' + JSON.stringify(du));
  } catch(e) { Logger.log('DU エラー: ' + e.message); }

  try {
    var mcs = runBqQuery_('bizcafe423', 'SELECT store, SUM(viewing) AS total FROM ' + tbl('MCS') + " WHERE date BETWEEN '2026-03-01' AND '2026-03-31' GROUP BY store");
    Logger.log('MCS実績(全店): ' + JSON.stringify(mcs));
  } catch(e) { Logger.log('MCS エラー: ' + e.message); }

  try {
    var goal = runBqQuery_('bizcafe423', 'SELECT store, DU_goal, Meetup_goal, MCS_goal FROM ' + tbl('目標値') + " WHERE DATE(target_month) = '2026-03-01'");
    Logger.log('目標値(3月): ' + JSON.stringify(goal));
  } catch(e) { Logger.log('目標値 エラー: ' + e.message); }
}
