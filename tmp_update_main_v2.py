# -*- coding: utf-8 -*-
import os

path = r'c:/BizCAFE/shift-reminder/src/メイン処理.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. handleWebhook (doPost内) の calendar アクションを拡張
# 既存の handleWebhook(e) の手前にある if (body.page === 'calendar') ブロックを修正

target_calendar = """    if (body.page === 'calendar') {
      if (body.action === 'requestShiftRecruitment') {
        var recruitResult = requestShiftRecruitment_({
          date:          body.date          || '',
          originalStaff: body.originalStaff || '',
          originalTime:  body.originalTime  || '',
          reason:        body.reason        || ''
        });
        return ContentService.createTextOutput(JSON.stringify(recruitResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'approveShiftRecruitment') {
        var approveResult = approveShiftRecruitment_({
          date:          body.date          || '',
          originalStaff: body.originalStaff || '',
          originalTime:  body.originalTime  || '',
          agentStaff:    body.agentStaff    || ''
        });
        return ContentService.createTextOutput(JSON.stringify(approveResult))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'getShiftAgents') {
        var agents = getShiftAgentStaff_();
        return ContentService.createTextOutput(JSON.stringify({ ok: true, data: agents }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid_action' }))
        .setMimeType(ContentService.MimeType.JSON);
    }"""

# シート更新を伴う新しいロジック
new_calendar = """    if (body.page === 'calendar') {
      // シート更新 + LINE通知 (交代)
      if (body.action === 'notifyShiftChange') {
        // 1. シートを書き換え (これが一番大切)
        var sheetUpdated = updateShiftStaff(body.date, body.originalStaff, body.agentStaff, body.newStart, body.newEnd);
        // 2. 通知
        var res = notifyShiftChange_({
          date: body.date || '',
          originalStaff: body.originalStaff || '',
          originalTime: body.originalTime || '',
          agentStaff: body.agentStaff || '',
          newStart: body.newStart || '',
          newEnd: body.newEnd || '',
          reason: body.reason || '',
          mode: body.mode || 'assign',
          notifyGroup: true,
          notifyAgent: body.notifyAgent === true
        });
        res.sheetUpdated = sheetUpdated;
        return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'requestShiftRecruitment') {
        var recruitResult = requestShiftRecruitment_({
          date: body.date || '',
          originalStaff: body.originalStaff || '',
          originalTime: body.originalTime || '',
          reason: body.reason || ''
        });
        return ContentService.createTextOutput(JSON.stringify(recruitResult)).setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'approveShiftRecruitment') {
        var approveResult = approveShiftRecruitment_({
          date: body.date || '',
          originalStaff: body.originalStaff || '',
          originalTime: body.originalTime || '',
          agentStaff: body.agentStaff || ''
        });
        return ContentService.createTextOutput(JSON.stringify(approveResult)).setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'getShiftAgents') {
        var agents = getShiftAgentStaff();
        return ContentService.createTextOutput(JSON.stringify({ ok: true, data: agents })).setMimeType(ContentService.MimeType.JSON);
      }
      if (body.action === 'boardUploadImage') {
        var uploadResult = uploadBoardImage_(body.fileData, body.fileName);
        return ContentService.createTextOutput(JSON.stringify(uploadResult)).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'invalid_action' })).setMimeType(ContentService.MimeType.JSON);
    }"""

content = content.replace(target_calendar, new_calendar)

# notifyShiftTrouble も追加 (前回の要件にある)
if 'notifyShiftTrouble' not in content:
    trouble_insert = """      if (body.action === 'notifyShiftTrouble') {
        var remainingOpe = calculateRemainingOpeCount_(body.date, body.staffName, body.start, body.end);
        var res = notifyShiftTrouble_({staffName:body.staffName||'',date:body.date||'',time:(body.start||'') + '-' + (body.end||''),reason:body.reason||'',remainingOpe:remainingOpe});
        return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
      }
"""
    content = content.replace("if (body.action === 'getShiftAgents')", trouble_insert + "      if (body.action === 'getShiftAgents')")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated successfully")
