// ============================================================
// staffService.gs - スタッフ管理 CRUD
// ============================================================

var STAFF_HEADERS = ['スタッフ名', 'LINE WORKSアカウントID', '有効', '登録日'];

/**
 * スタッフ一覧を取得する
 * @returns {{ success: boolean, data: { staff: Array } }}
 */
function getStaffList() {
  var sheet = getOrCreateSheet(SHEET_STAFF, STAFF_HEADERS);
  var data = sheet.getDataRange().getValues();
  var staff = [];

  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0]).trim();
    if (!name) continue;
    staff.push({
      name: name,
      accountId: String(data[i][1]).trim(),
      active: data[i][2] !== false && data[i][2] !== 'FALSE',
      registeredDate: data[i][3] ? formatDateISO(new Date(data[i][3])) : ''
    });
  }

  return { success: true, data: { staff: staff } };
}

/**
 * スタッフを追加または編集する
 * @param {string} name - スタッフ名
 * @param {string} accountId - LINE WORKSアカウントID
 * @param {string} [originalName] - 編集時：変更前の名前
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function updateStaff(name, accountId, originalName) {
  if (!name || !name.trim()) {
    return { success: false, error: 'スタッフ名を入力してください' };
  }

  var sheet = getOrCreateSheet(SHEET_STAFF, STAFF_HEADERS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var data = sheet.getDataRange().getValues();
    var editTarget = originalName ? originalName.trim() : null;

    // 編集の場合：既存行を更新
    if (editTarget) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === editTarget) {
          sheet.getRange(i + 1, 1).setValue(name.trim());
          sheet.getRange(i + 1, 2).setValue(accountId ? accountId.trim() : '');
          return { success: true, data: { action: 'updated', name: name.trim() } };
        }
      }
      return { success: false, error: '編集対象のスタッフが見つかりません: ' + editTarget };
    }

    // 新規追加：重複チェック
    for (var j = 1; j < data.length; j++) {
      if (String(data[j][0]).trim() === name.trim()) {
        return { success: false, error: 'このスタッフ名は既に登録されています: ' + name };
      }
    }

    sheet.appendRow([name.trim(), accountId ? accountId.trim() : '', true, new Date()]);
    return { success: true, data: { action: 'created', name: name.trim() } };
  } finally {
    lock.releaseLock();
  }
}

/**
 * スタッフを削除する
 * @param {string} name
 * @returns {{ success: boolean }}
 */
function deleteStaff(name) {
  if (!name) {
    return { success: false, error: 'スタッフ名を指定してください' };
  }

  var sheet = getOrCreateSheet(SHEET_STAFF, STAFF_HEADERS);
  var data = sheet.getDataRange().getValues();

  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === name.trim()) {
      sheet.deleteRow(i + 1);
      return { success: true, data: { deleted: name } };
    }
  }

  return { success: false, error: 'スタッフが見つかりません: ' + name };
}

/**
 * スタッフマッピング（名前 → アカウントID）を取得する
 * @returns {Object} { 'スタッフ名': 'account@xxx.com', ... }
 */
function getStaffMapping() {
  var sheet = getOrCreateSheet(SHEET_STAFF, STAFF_HEADERS);
  var data = sheet.getDataRange().getValues();
  var mapping = {};

  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0]).trim();
    var accountId = String(data[i][1]).trim();
    var active = data[i][2] !== false && data[i][2] !== 'FALSE';
    if (name && accountId && active) {
      mapping[name] = accountId;
    }
  }

  return mapping;
}
