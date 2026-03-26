// ============================================================
// Board.js - 掲示板記事管理
// ============================================================

var BOARD_PROP_KEY = 'BOARD_DATA';
var ARTICLE_VIEW_COUNTS_PROP_KEY = 'ARTICLE_VIEW_COUNTS';
var BOARD_IMAGE_FOLDER_ID = typeof DRIVE_FOLDER_ID !== 'undefined' ? DRIVE_FOLDER_ID : '';

function getBoardList_(options) {
  options = options || {};
  var includeUnpublished = options.includeUnpublished === true;
  var placement = options.placement || '';
  var limit = parseInt(options.limit || '0', 10);
  var items = loadBoardItems_().filter(function(item) {
    if (!includeUnpublished && item.published !== true) return false;
    if (placement === 'updates' && item.showInUpdates !== true) return false;
    if (placement === 'articles' && item.showInArticles !== true) return false;
    return true;
  });

  items.sort(function(a, b) {
    return boardSortValue_(b) - boardSortValue_(a);
  });

  if (limit > 0) items = items.slice(0, limit);
  var viewCounts = loadArticleViewCounts_();
  return items.map(function(item) {
    return normalizeBoardItemForResponse_(item, viewCounts);
  });
}

function getBoardItem_(id, includeUnpublished) {
  if (!id) return null;
  var items = loadBoardItems_();
  var viewCounts = loadArticleViewCounts_();
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === id) {
      if (!includeUnpublished && items[i].published !== true) return null;
      return normalizeBoardItemForResponse_(items[i], viewCounts);
    }
  }
  return null;
}

function saveBoardItem_(rawItem) {
  var item = normalizeBoardItemForSave_(rawItem || {});
  if (!item.title) return { ok: false, error: 'title_required' };
  if (!item.body) return { ok: false, error: 'body_required' };

  var now = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  var items = loadBoardItems_();
  var found = false;

  for (var i = 0; i < items.length; i++) {
    if (items[i].id === item.id) {
      item.createdAt = items[i].createdAt || now;
      item.updatedAt = now;
      items[i] = item;
      found = true;
      break;
    }
  }

  if (!found) {
    item.createdAt = now;
    item.updatedAt = now;
    items.push(item);
  }

  saveBoardItems_(items);
  return { ok: true, id: item.id };
}

function deleteBoardItem_(id) {
  if (!id) return { ok: false, error: 'id_required' };
  var items = loadBoardItems_().filter(function(item) {
    return item.id !== id;
  });
  saveBoardItems_(items);
  return { ok: true };
}

function loadBoardItems_() {
  var raw = PropertiesService.getScriptProperties().getProperty(BOARD_PROP_KEY) || '[]';
  try {
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeBoardItemForSave_);
  } catch (e) {
    return [];
  }
}

function saveBoardItems_(items) {
  PropertiesService.getScriptProperties().setProperty(BOARD_PROP_KEY, JSON.stringify(items || []));
}

function normalizeBoardItemForSave_(item) {
  item = item || {};
  var imageUrl = String(item.imageUrl || '').trim();
  var thumbnailUrl = String(item.thumbnailUrl || '').trim();
  return {
    id: String(item.id || '').trim() || String(new Date().getTime()),
    title: String(item.title || '').trim(),
    category: String(item.category || '').trim(),
    summary: String(item.summary || '').trim(),
    body: String(item.body || '').replace(/\r\n/g, '\n').trim(),
    date: normalizeBoardDate_(item.date),
    imageUrl: imageUrl,
    thumbnailUrl: thumbnailUrl,
    showInUpdates: item.showInUpdates === true || item.showInUpdates === 'true',
    showInArticles: item.showInArticles === true || item.showInArticles === 'true',
    published: item.published === true || item.published === 'true',
    createdAt: String(item.createdAt || '').trim(),
    updatedAt: String(item.updatedAt || '').trim()
  };
}

function normalizeBoardItemForResponse_(item, viewCounts) {
  var normalized = normalizeBoardItemForSave_(item);
  normalized.thumbnailUrl = normalized.thumbnailUrl || normalized.imageUrl;
  normalized.displayDate = normalized.date ? normalized.date.replace(/-/g, '/') : '';
  normalized.summary = normalized.summary || buildBoardSummary_(normalized.body);
  normalized.detailLink = 'articles/template.html?id=' + encodeURIComponent(normalized.id);
  normalized.viewCount = Number((viewCounts && viewCounts[normalized.id]) || 0);
  return normalized;
}

function normalizeBoardDate_(value) {
  var str = String(value || '').trim();
  if (!str) return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  return str.replace(/\//g, '-');
}

function boardSortValue_(item) {
  var dateValue = new Date((item.date || '').replace(/\//g, '-') + 'T00:00:00').getTime();
  var updatedValue = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
  if (isNaN(dateValue)) return updatedValue || 0;
  return dateValue * 1000000 + updatedValue;
}

function buildBoardSummary_(body) {
  var text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 80) return text;
  return text.slice(0, 80) + '...';
}

function uploadBoardImage_(params) {
  params = params || {};
  var folderId = BOARD_IMAGE_FOLDER_ID;
  if (!folderId) return { ok: false, error: 'folder_not_configured' };

  var dataUrl = String(params.dataUrl || '');
  var fileName = sanitizeBoardFileName_(params.fileName || 'board-image');
  if (!dataUrl) return { ok: false, error: 'data_required' };

  var match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return { ok: false, error: 'invalid_data_url' };

  var mimeType = match[1];
  var allowedMimeTypes = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
  };
  var extension = allowedMimeTypes[mimeType];
  if (!extension) return { ok: false, error: 'unsupported_mime_type' };

  var bytes = Utilities.base64Decode(match[2]);
  var blob = Utilities.newBlob(bytes, mimeType, fileName + extension);
  var folder = DriveApp.getFolderById(folderId);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    ok: true,
    fileId: file.getId(),
    fileName: file.getName(),
    url: 'https://drive.google.com/uc?export=view&id=' + file.getId()
  };
}

function sanitizeBoardFileName_(name) {
  return String(name || 'board-image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'board-image';
}

function loadArticleViewCounts_() {
  var raw = PropertiesService.getScriptProperties().getProperty(ARTICLE_VIEW_COUNTS_PROP_KEY) || '{}';
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    var next = {};
    Object.keys(parsed).forEach(function(key) {
      next[String(key)] = Number(parsed[key] || 0);
    });
    return next;
  } catch (err) {
    return {};
  }
}

function saveArticleViewCounts_(counts) {
  PropertiesService.getScriptProperties().setProperty(
    ARTICLE_VIEW_COUNTS_PROP_KEY,
    JSON.stringify(counts || {})
  );
}

function incrementArticleViewCount_(articleId) {
  var id = String(articleId || '').trim();
  if (!id) return { ok: false, error: 'article_id_required' };
  var counts = loadArticleViewCounts_();
  counts[id] = Number(counts[id] || 0) + 1;
  saveArticleViewCounts_(counts);
  return { ok: true, articleId: id, count: counts[id] };
}
