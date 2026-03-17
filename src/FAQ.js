// ============================================================
// FAQ.js - よくある質問 Q&A 管理
// ============================================================

var FAQ_PROP_KEY = 'FAQ_DATA';

/**
 * Q&Aリストを返す
 * @param {boolean} includeHidden - trueの場合は非表示も含む（スタッフ用）
 */
function getFAQList_(includeHidden) {
  var raw = PropertiesService.getScriptProperties().getProperty(FAQ_PROP_KEY) || '[]';
  var items;
  try { items = JSON.parse(raw); } catch (e) { items = []; }
  if (!includeHidden) items = items.filter(function(i) { return i.visible !== false; });
  return items;
}

/**
 * Q&Aアイテムを保存（新規 or 更新）
 * @param {string} id - 空文字の場合は新規作成
 * @param {string} question
 * @param {string} answer
 * @param {boolean} visible
 */
function saveFAQItem_(id, question, answer, visible) {
  var props = PropertiesService.getScriptProperties();
  var items;
  try { items = JSON.parse(props.getProperty(FAQ_PROP_KEY) || '[]'); } catch (e) { items = []; }

  var now = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");

  if (id) {
    var found = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        items[i] = { id: id, question: question, answer: answer, visible: visible, updatedAt: now };
        found = true; break;
      }
    }
    if (!found) items.push({ id: id, question: question, answer: answer, visible: visible, updatedAt: now });
  } else {
    id = String(Date.now());
    items.push({ id: id, question: question, answer: answer, visible: visible, updatedAt: now });
  }

  props.setProperty(FAQ_PROP_KEY, JSON.stringify(items));
  return { ok: true, id: id };
}

/**
 * Q&Aアイテムを削除
 */
function deleteFAQItem_(id) {
  var props = PropertiesService.getScriptProperties();
  var items;
  try { items = JSON.parse(props.getProperty(FAQ_PROP_KEY) || '[]'); } catch (e) { items = []; }
  items = items.filter(function(i) { return i.id !== id; });
  props.setProperty(FAQ_PROP_KEY, JSON.stringify(items));
  return { ok: true };
}
