// ============================================================
// FAQ.js - Q&A管理（顧客が質問投稿、スタッフが回答）
// ============================================================

var FAQ_PROP_KEY = 'FAQ_DATA';

/**
 * Q&Aリストを返す
 * @param {boolean} staffMode - trueの場合は未回答・非表示も含む全件
 */
function getFAQList_(staffMode) {
  var items = loadFAQItems_();
  if (!staffMode) {
    // 顧客向け: 回答済み & 表示ONのみ
    items = items.filter(function(i) { return i.answer && i.visible !== false; });
  }
  return items;
}

/**
 * 顧客が質問を投稿する（answerなし・非公開状態で保存）
 */
function submitQuestion_(question) {
  if (!question) return { ok: false, error: 'empty' };
  var items = loadFAQItems_();
  var id = String(Date.now());
  var now = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  items.push({ id: id, question: question, answer: '', visible: false, createdAt: now, updatedAt: now });
  saveFAQItems_(items);
  return { ok: true, id: id };
}

/**
 * スタッフがQ&Aを保存（新規作成・編集・回答）
 */
function saveFAQItem_(id, question, answer, visible) {
  var items = loadFAQItems_();
  var now = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");

  if (id) {
    var found = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        items[i] = {
          id: id,
          question: question,
          answer: answer,
          visible: visible,
          createdAt: items[i].createdAt || now,
          updatedAt: now
        };
        found = true; break;
      }
    }
    if (!found) {
      items.push({ id: id, question: question, answer: answer, visible: visible, createdAt: now, updatedAt: now });
    }
  } else {
    id = String(Date.now());
    items.push({ id: id, question: question, answer: answer, visible: visible, createdAt: now, updatedAt: now });
  }

  saveFAQItems_(items);
  return { ok: true, id: id };
}

/**
 * Q&Aアイテムを削除
 */
function deleteFAQItem_(id) {
  var items = loadFAQItems_().filter(function(i) { return i.id !== id; });
  saveFAQItems_(items);
  return { ok: true };
}

function loadFAQItems_() {
  var raw = PropertiesService.getScriptProperties().getProperty(FAQ_PROP_KEY) || '[]';
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function saveFAQItems_(items) {
  PropertiesService.getScriptProperties().setProperty(FAQ_PROP_KEY, JSON.stringify(items));
}
