# -*- coding: utf-8 -*-
import os

path = r'c:/BizCAFE/shift-reminder/src/メイン処理.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. doPost の 'getShiftAgents' アクションを notifyShiftChange 等含めて上書き
# 元のコードを確認 (view_file で見た内容)
target_dopost = """      // シフト交代の「承認者」候補（G列にチェックがあるスタッフ）を取得
      if (body.action === 'getShiftAgents') {
        var agents = getShiftAgentStaff_();
        return ContentService.createTextOutput(JSON.stringify({ ok: true, data: agents }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid_action' }))
        .setMimeType(ContentService.MimeType.JSON);
    }"""

new_dopost = """      if (body.action === 'boardUploadImage') {
        var uploadResult = uploadBoardImage_(body.fileData, body.fileName);
        return ContentService.createTextOutput(JSON.stringify(uploadResult)).setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'notifyShiftChange') {
        var res = notifyShiftChange_({date:body.date||'',originalStaff:body.originalStaff||'',originalTime:body.originalTime||'',agentStaff:body.agentStaff||'',reason:body.reason||'',notifyGroup:body.notifyGroup!==false,notifyAgent:body.notifyAgent===true});
        return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'notifyShiftTrouble') {
        var remainingOpe = calculateRemainingOpeCount_(body.date, body.staffName, body.start, body.end);
        var res = notifyShiftTrouble_({staffName:body.staffName||'',date:body.date||'',time:(body.start||'') + '-' + (body.end||''),reason:body.reason||'',remainingOpe:remainingOpe});
        return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'getShiftAgents') {
        var agents = getShiftAgentStaff();
        return ContentService.createTextOutput(JSON.stringify({ ok: true, data: agents })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid_action' })).setMimeType(ContentService.MimeType.JSON);
    }"""

# 2. doGet にハンドラ挿入
target_doget = "  var param = (e && e.parameter) ? e.parameter : {};"
new_doget = target_doget + "\\n  // --- スタッフ用PWA API (共通アクション) ---\\n  var staffApiResult = handleStaffAppApi_(param);\\n  if (staffApiResult) return staffApiResult;"

# 3. 末尾に関数追加
new_function = """
/**
 * スタッフ用PWAアプリ（Google Apps Script WebApp）のデータAPIを処理する
 * pageパラメータによらず、getShifts, getStaff, getMeetings などを共通で処理可能にする
 */
function handleStaffAppApi_(param) {
  if (!param.action) return null;
  
  if (param.action === 'getShifts') {
    var data = getStaffShifts(param.date || '');
    return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  }
  if (param.action === 'getStaff') {
    return ContentService.createTextOutput(JSON.stringify(getStaff())).setMimeType(ContentService.MimeType.JSON);
  }
  if (param.action === 'getMeetings') {
    return ContentService.createTextOutput(JSON.stringify(kanbuGetMeetings_())).setMimeType(ContentService.MimeType.JSON);
  }
  if (param.action === 'getMeetingAttendance') {
    return ContentService.createTextOutput(JSON.stringify(kanbuGetAttendance_(param.date || ''))).setMimeType(ContentService.MimeType.JSON);
  }
  if (param.action === 'getStaffList') {
    return ContentService.createTextOutput(JSON.stringify(kanbuGetStaffList_())).setMimeType(ContentService.MimeType.JSON);
  }
  
  return null;
}
"""

content = content.replace(target_dopost, new_dopost)
content = content.replace(target_doget, new_doget)
if 'function handleStaffAppApi_' not in content:
    content += new_function

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated successfully")
