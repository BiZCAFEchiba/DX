var CORNER_QUESTIONS_PROP_KEY = 'CORNER_QUESTIONS';
var CORNER_CONTENT_PROP_KEY = 'CORNER_CONTENT';
var CORNER_PAGE_VIEWS_PROP_KEY = 'CORNER_PAGE_VIEWS';

function getCornerQuestionList_(staffMode) {
  var items = loadCornerQuestions_();
  if (!staffMode) {
    items = items.filter(function(item) { return item.published === true; });
  }
  return items;
}

function getCornerQuestionDetail_(id, staffMode) {
  var item = findCornerQuestionById_(id);
  if (!item) return null;
  if (!staffMode && item.published !== true) return null;
  return item;
}

function submitCornerQuestion_(payload) {
  var nickname = String(payload.nickname || '').trim();
  var title = String(payload.title || '').trim();
  var body = String(payload.body || '').trim();
  var category = normalizeCornerQuestionCategory_(payload.category);

  if (!title) return { ok: false, error: 'title_required' };
  if (!body) return { ok: false, error: 'body_required' };

  var items = loadCornerQuestions_();
  var now = getCornerNowIso_();
  var item = buildCornerQuestionItem_({
    id: String(new Date().getTime()),
    nickname: nickname || '匿名',
    category: category,
    title: title,
    body: body,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    published: false,
    answerBody: '',
    answeredAt: '',
    answeredBy: '',
    tags: payload.tags || []
  });
  items.unshift(item);
  saveCornerQuestions_(items);
  return { ok: true, id: item.id };
}

function saveCornerQuestion_(payload) {
  var items = loadCornerQuestions_();
  var now = getCornerNowIso_();
  var id = String(payload.id || '').trim();
  if (!id) return { ok: false, error: 'id_required' };

  var index = -1;
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === id) {
      index = i;
      break;
    }
  }
  if (index === -1) return { ok: false, error: 'not_found' };

  var current = items[index];
  var next = {
    id: current.id,
    nickname: sanitizeCornerText_(pickDefined_(payload.nickname, current.nickname || '匿名')),
    category: normalizeCornerQuestionCategory_(pickDefined_(payload.category, current.category || 'other')),
    title: sanitizeCornerText_(pickDefined_(payload.title, current.title || '')),
    body: sanitizeCornerText_(pickDefined_(payload.body, current.body || '')),
    createdAt: current.createdAt || now,
    updatedAt: now,
    published: pickDefined_(payload.published, current.published === true) === true,
    answerBody: sanitizeCornerText_(pickDefined_(payload.answerBody, current.answerBody || '')),
    answeredBy: sanitizeCornerText_(pickDefined_(payload.answeredBy, current.answeredBy || '')),
    answeredAt: current.answeredAt || '',
    tags: pickDefined_(payload.tags, current.tags || []),
    status: sanitizeCornerText_(pickDefined_(payload.status, current.status || ''))
  };

  if (next.answerBody) {
    next.answeredAt = current.answerBody !== next.answerBody || !current.answeredAt ? now : (current.answeredAt || now);
  } else {
    next.answeredAt = '';
    next.answeredBy = '';
  }

  next = buildCornerQuestionItem_(next);
  items[index] = next;
  saveCornerQuestions_(items);
  return { ok: true, id: next.id };
}

function deleteCornerQuestion_(id) {
  var targetId = sanitizeCornerText_(id);
  if (!targetId) return { ok: false, error: 'id_required' };
  var items = loadCornerQuestions_();
  var nextItems = items.filter(function(item) { return item.id !== targetId; });
  if (nextItems.length === items.length) return { ok: false, error: 'not_found' };
  saveCornerQuestions_(nextItems);
  return { ok: true, id: targetId };
}

function getCornerContent_(staffMode) {
  var content = loadCornerContent_();
  return staffMode ? content : filterPublishedCornerContent_(content);
}

function saveCornerSection_(sectionKey, rawData) {
  var key = sanitizeCornerText_(sectionKey);
  if (!key) return { ok: false, error: 'section_required' };

  var content = loadCornerContent_();
  var data;
  try {
    data = JSON.parse(rawData || '{}');
  } catch (err) {
    return { ok: false, error: 'invalid_json' };
  }

  if (key === 'questionCategories') {
    content.questionCategories = normalizeCornerQuestionCategories_(data);
    remapCornerQuestionCategories_(content.questionCategories);
  } else if (key === 'worries') {
    content.worries = normalizeCornerWorriesSection_(data);
  } else if (key === 'participation') {
    content.participation = normalizeCornerParticipationSection_(data);
  } else if (key === 'staffColumns') {
    content.staffColumns = normalizeCornerStaffSection_(data);
  } else {
    return { ok: false, error: 'invalid_section' };
  }

  saveCornerContent_(content);
  return { ok: true, section: key };
}

function voteCornerParticipation_(themeId, optionId) {
  var targetThemeId = sanitizeCornerText_(themeId);
  var targetOptionId = sanitizeCornerText_(optionId);
  if (!targetThemeId) return { ok: false, error: 'theme_required' };
  if (!targetOptionId) return { ok: false, error: 'option_required' };

  var content = loadCornerContent_();
  var themes = content.participation && Array.isArray(content.participation.themes) ? content.participation.themes : [];
  var theme = null;
  for (var i = 0; i < themes.length; i++) {
    if (themes[i].id === targetThemeId) {
      theme = themes[i];
      break;
    }
  }
  if (!theme || theme.published === false) return { ok: false, error: 'theme_not_found' };

  var option = null;
  for (var j = 0; j < theme.options.length; j++) {
    if (theme.options[j].id === targetOptionId) {
      option = theme.options[j];
      break;
    }
  }
  if (!option) return { ok: false, error: 'option_not_found' };

  option.votes = parseCornerVoteCount_(option.votes) + 1;
  saveCornerContent_(content);
  return {
    ok: true,
    themeId: targetThemeId,
    optionId: targetOptionId,
    theme: copyCornerObject_(theme)
  };
}

function loadCornerQuestions_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CORNER_QUESTIONS_PROP_KEY) || '[]';
  try {
    var items = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    return items
      .map(function(item) { return buildCornerQuestionItem_(item || {}); })
      .sort(function(a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
  } catch (err) {
    return [];
  }
}

function saveCornerQuestions_(items) {
  PropertiesService.getScriptProperties().setProperty(CORNER_QUESTIONS_PROP_KEY, JSON.stringify(items));
}

function findCornerQuestionById_(id) {
  if (!id) return null;
  var items = loadCornerQuestions_();
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === id) return items[i];
  }
  return null;
}

function buildCornerQuestionItem_(item) {
  var body = sanitizeCornerText_(item.body || '');
  var answerBody = sanitizeCornerText_(item.answerBody || '');
  var published = item.published === true;
  var status = answerBody ? 'answered' : (published ? 'published' : 'pending');
  var createdAt = sanitizeCornerText_(item.createdAt || getCornerNowIso_());
  var category = normalizeCornerQuestionCategory_(item.category || 'other');
  var tags = Array.isArray(item.tags) ? item.tags.map(sanitizeCornerText_).filter(Boolean) : [];

  return {
    id: sanitizeCornerText_(item.id || String(new Date().getTime())),
    nickname: sanitizeCornerText_(item.nickname || '匿名'),
    category: category,
    title: sanitizeCornerText_(item.title || ''),
    body: body,
    createdAt: createdAt,
    updatedAt: sanitizeCornerText_(item.updatedAt || createdAt),
    status: status,
    published: published,
    answerBody: answerBody,
    answeredAt: sanitizeCornerText_(item.answeredAt || ''),
    answeredBy: sanitizeCornerText_(item.answeredBy || ''),
    tags: tags,
    previewText: buildCornerPreviewText_(body),
    displayDate: formatCornerDisplayDate_(createdAt),
    answeredDisplayDate: formatCornerDisplayDate_(item.answeredAt || '')
  };
}

function buildCornerPreviewText_(body) {
  var text = sanitizeCornerText_(body).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= 90) return text;
  return text.slice(0, 90) + '...';
}

function loadCornerContent_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CORNER_CONTENT_PROP_KEY) || '';
  if (!raw) return getDefaultCornerContent_();
  try {
    return normalizeCornerContent_(JSON.parse(raw));
  } catch (err) {
    return getDefaultCornerContent_();
  }
}

function saveCornerContent_(content) {
  PropertiesService.getScriptProperties().setProperty(
    CORNER_CONTENT_PROP_KEY,
    JSON.stringify(normalizeCornerContent_(content))
  );
}

function getDefaultCornerContent_() {
  return normalizeCornerContent_({
    questionCategories: [
      { id: 'job-hunt', label: '就活関連', sortOrder: 10, published: true },
      { id: 'class', label: '単位・授業関連', sortOrder: 20, published: true },
      { id: 'other', label: 'その他', sortOrder: 30, published: true },
      { id: 'industry', label: '業界・企業関連', sortOrder: 40, published: true }
    ],
    worries: {
      title: 'スタッフがお悩み答えます!',
      note: 'カテゴリごとに、よくある相談とスタッフからのひとことをまとめています。',
      categories: [
        {
          id: 'worry-job-hunt',
          key: 'job-hunt',
          title: '就活関連',
          accent: 'career',
          published: true,
          sortOrder: 10,
          entries: [
            {
              id: 'worry-job-hunt-1',
              question: '自己分析はどこから始めるのがよいですか?',
              answer: 'まずは、これまで楽しかったことや頑張れた経験を3つほど書き出してみるのがおすすめです。',
              published: true,
              sortOrder: 10
            },
            {
              id: 'worry-job-hunt-2',
              question: 'インターンに参加していなくても大丈夫ですか?',
              answer: '大丈夫です。参加有無だけでなく、そこから何を学びどう動いたかが大切です。',
              published: true,
              sortOrder: 20
            }
          ]
        },
        {
          id: 'worry-class',
          key: 'class',
          title: '単位・授業関連',
          accent: 'study',
          published: true,
          sortOrder: 20,
          entries: [
            {
              id: 'worry-class-1',
              question: '授業と就活の両立が不安です。',
              answer: '先に締切のある予定を見える化して、週ごとに動く内容を軽く分けると整理しやすいです。',
              published: true,
              sortOrder: 10
            }
          ]
        },
        {
          id: 'worry-other',
          key: 'other',
          title: 'その他何でも!!',
          accent: 'other',
          published: true,
          sortOrder: 30,
          entries: [
            {
              id: 'worry-other-1',
              question: 'BizCAFEはどんなときに使うのがおすすめですか?',
              answer: '相談したいとき、予定の合間に休憩したいとき、スタッフと気軽に話したいときに使ってもらえます。',
              published: true,
              sortOrder: 10
            }
          ]
        }
      ]
    },
    participation: {
      title: '参加型コーナー',
      prompt: 'みんなの声をちょっとずつ集めるコーナーです。',
      note: '公開中テーマをひとつ選んで投票できます。',
      stickyNote: '気軽に選んでみてください!',
      themes: [
        {
          id: 'theme-origin',
          title: 'みんなの出身地',
          description: '出身地に近い地域を選んでください。',
          published: true,
          sortOrder: 10,
          options: [
            { id: 'hokkaido', label: '北海道', votes: 1, sortOrder: 10 },
            { id: 'tohoku', label: '東北', votes: 2, sortOrder: 20 },
            { id: 'kanto', label: '関東', votes: 6, sortOrder: 30 },
            { id: 'chubu', label: '中部', votes: 3, sortOrder: 40 },
            { id: 'kansai', label: '関西', votes: 2, sortOrder: 50 },
            { id: 'kyushu', label: '九州', votes: 1, sortOrder: 60 }
          ]
        }
      ]
    },
    staffColumns: {
      title: 'スタッフ紹介・コラム',
      staff: [
        {
          id: 'staff-1',
          name: 'Aoi',
          role: '3年 / 就活相談スタッフ',
          profile: '就活の進め方や自己分析の相談を担当。まずは雑談からでも大丈夫です。',
          tags: ['就活', '自己分析'],
          published: true,
          sortOrder: 10
        },
        {
          id: 'staff-2',
          name: 'Riku',
          role: '4年 / 業界研究サポート',
          profile: '業界研究や企業比較の始め方を一緒に整理します。',
          tags: ['業界研究', '企業比較'],
          published: true,
          sortOrder: 20
        }
      ],
      columns: [
        {
          id: 'column-1',
          title: 'BizCAFEスタッフが考える、就活の最初の一歩',
          body: 'まずは興味のあることを3つ書き出してみるだけでも前に進めます。',
          published: true,
          sortOrder: 10
        }
      ]
    }
  });
}

function normalizeCornerContent_(content) {
  var source = content || {};
  return {
    questionCategories: normalizeCornerQuestionCategories_(source.questionCategories),
    worries: normalizeCornerWorriesSection_(source.worries || {}),
    participation: normalizeCornerParticipationSection_(source.participation || {}),
    staffColumns: normalizeCornerStaffSection_(source.staffColumns || {})
  };
}

function filterPublishedCornerContent_(content) {
  var normalized = normalizeCornerContent_(content);
  normalized.questionCategories = normalized.questionCategories.filter(function(item) {
    return item.published !== false;
  });
  normalized.worries.categories = normalized.worries.categories
    .filter(function(category) { return category.published; })
    .map(function(category) {
      var next = copyCornerObject_(category);
      next.entries = next.entries.filter(function(entry) { return entry.published; });
      return next;
    })
    .filter(function(category) { return category.entries.length > 0; });
  normalized.participation.themes = normalized.participation.themes
    .filter(function(theme) { return theme.published; })
    .map(function(theme) {
      var nextTheme = copyCornerObject_(theme);
      nextTheme.options = (nextTheme.options || []).filter(function(option) {
        return option.published !== false;
      });
      return nextTheme;
    })
    .filter(function(theme) { return theme.options.length > 0; });
  normalized.staffColumns.staff = normalized.staffColumns.staff.filter(function(item) { return item.published; });
  normalized.staffColumns.columns = normalized.staffColumns.columns.filter(function(item) { return item.published; });
  return normalized;
}

function normalizeCornerQuestionCategories_(categories) {
  var list = Array.isArray(categories) ? categories : [];
  var normalized = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {};
    normalized.push({
      id: sanitizeCornerText_(item.id || ('category-' + (i + 1))),
      label: sanitizeCornerText_(item.label || 'カテゴリ'),
      sortOrder: parseCornerSortOrder_(item.sortOrder, (i + 1) * 10),
      published: item.published !== false
    });
  }

  if (!normalized.length) {
    normalized = [
      { id: 'job-hunt', label: '就活関連', sortOrder: 10, published: true },
      { id: 'class', label: '単位・授業関連', sortOrder: 20, published: true },
      { id: 'other', label: 'その他', sortOrder: 30, published: true },
      { id: 'industry', label: '業界・企業関連', sortOrder: 40, published: true }
    ];
  }

  var hasOther = false;
  normalized.forEach(function(item) {
    if (item.id === 'other') hasOther = true;
  });
  if (!hasOther) {
    normalized.push({ id: 'other', label: '未分類', sortOrder: 9990, published: true });
  }

  normalized.sort(sortCornerByOrder_);
  return normalized;
}

function normalizeCornerWorriesSection_(section) {
  var next = {
    title: sanitizeCornerText_(section.title || 'スタッフがお悩み答えます!'),
    note: sanitizeCornerText_(section.note || ''),
    categories: []
  };
  var categories = Array.isArray(section.categories) ? section.categories : [];
  for (var i = 0; i < categories.length; i++) {
    var category = categories[i] || {};
    var item = {
      id: sanitizeCornerText_(category.id || ('worry-category-' + (i + 1))),
      key: sanitizeCornerText_(category.key || ('worry-' + (i + 1))),
      title: sanitizeCornerText_(category.title || 'カテゴリ'),
      accent: sanitizeCornerText_(category.accent || ''),
      published: category.published !== false,
      sortOrder: parseCornerSortOrder_(category.sortOrder, (i + 1) * 10),
      entries: []
    };
    var entries = Array.isArray(category.entries) ? category.entries : [];
    for (var j = 0; j < entries.length; j++) {
      var entry = entries[j] || {};
      item.entries.push({
        id: sanitizeCornerText_(entry.id || (item.id + '-entry-' + (j + 1))),
        question: sanitizeCornerText_(entry.question || ''),
        answer: sanitizeCornerText_(entry.answer || ''),
        published: entry.published !== false,
        sortOrder: parseCornerSortOrder_(entry.sortOrder, (j + 1) * 10)
      });
    }
    item.entries.sort(sortCornerByOrder_);
    next.categories.push(item);
  }
  next.categories.sort(sortCornerByOrder_);
  return next;
}

function normalizeCornerParticipationSection_(section) {
  var next = {
    title: sanitizeCornerText_(section.title || '参加型コーナー'),
    prompt: sanitizeCornerText_(section.prompt || ''),
    note: sanitizeCornerText_(section.note || ''),
    stickyNote: sanitizeCornerText_(section.stickyNote || ''),
    themes: []
  };
  var themes = Array.isArray(section.themes) ? section.themes : [];
  if (!themes.length && Array.isArray(section.tags) && section.tags.length) {
    themes = [{
      id: 'theme-origin',
      title: 'みんなの出身地',
      description: sanitizeCornerText_(section.prompt || ''),
      published: true,
      sortOrder: 10,
      options: section.tags.map(function(tag, index) {
        return {
          id: sanitizeCornerText_(tag.id || ('region-' + (index + 1))),
          label: sanitizeCornerText_(tag.label || ''),
          votes: parseCornerVoteCount_(tag.count),
          published: tag.published !== false,
          sortOrder: parseCornerSortOrder_(tag.sortOrder, (index + 1) * 10)
        };
      })
    }];
  }
  for (var i = 0; i < themes.length; i++) {
    var theme = themes[i] || {};
    var normalizedTheme = {
      id: sanitizeCornerText_(theme.id || ('theme-' + (i + 1))),
      title: sanitizeCornerText_(theme.title || 'テーマ'),
      description: sanitizeCornerText_(theme.description || ''),
      published: theme.published !== false,
      sortOrder: parseCornerSortOrder_(theme.sortOrder, (i + 1) * 10),
      options: []
    };
    var options = Array.isArray(theme.options) ? theme.options : [];
    for (var j = 0; j < options.length; j++) {
      var option = options[j] || {};
      normalizedTheme.options.push({
        id: sanitizeCornerText_(option.id || (normalizedTheme.id + '-option-' + (j + 1))),
        label: sanitizeCornerText_(option.label || ''),
        votes: parseCornerVoteCount_(option.votes),
        published: option.published !== false,
        sortOrder: parseCornerSortOrder_(option.sortOrder, (j + 1) * 10)
      });
    }
    normalizedTheme.options.sort(sortCornerByOrder_);
    next.themes.push(normalizedTheme);
  }
  next.themes.sort(sortCornerByOrder_);
  return next;
}

function normalizeCornerStaffSection_(section) {
  var next = {
    title: sanitizeCornerText_(section.title || 'スタッフ紹介・コラム'),
    staff: [],
    columns: []
  };
  var staff = Array.isArray(section.staff) ? section.staff : [];
  for (var i = 0; i < staff.length; i++) {
    var item = staff[i] || {};
    next.staff.push({
      id: sanitizeCornerText_(item.id || ('staff-entry-' + (i + 1))),
      name: sanitizeCornerText_(item.name || ''),
      role: sanitizeCornerText_(item.role || ''),
      profile: sanitizeCornerText_(item.profile || ''),
      tags: normalizeCornerTagList_(item.tags),
      published: item.published !== false,
      sortOrder: parseCornerSortOrder_(item.sortOrder, (i + 1) * 10)
    });
  }
  next.staff.sort(sortCornerByOrder_);

  var columns = Array.isArray(section.columns) ? section.columns : [];
  for (var j = 0; j < columns.length; j++) {
    var column = columns[j] || {};
    next.columns.push({
      id: sanitizeCornerText_(column.id || ('column-entry-' + (j + 1))),
      title: sanitizeCornerText_(column.title || ''),
      body: sanitizeCornerText_(column.body || ''),
      published: column.published !== false,
      sortOrder: parseCornerSortOrder_(column.sortOrder, (j + 1) * 10)
    });
  }
  next.columns.sort(sortCornerByOrder_);
  return next;
}

function normalizeCornerTagList_(tags) {
  if (Array.isArray(tags)) {
    return tags.map(sanitizeCornerText_).filter(Boolean);
  }
  return sanitizeCornerText_(tags || '')
    .split(',')
    .map(function(tag) { return sanitizeCornerText_(tag); })
    .filter(Boolean);
}

function normalizeCornerQuestionCategory_(categoryId) {
  var category = sanitizeCornerText_(categoryId || 'other');
  var map = getCornerQuestionCategoryMap_();
  if (map[category]) return category;
  if (map.other) return 'other';
  var keys = Object.keys(map);
  return keys.length ? keys[0] : 'other';
}

function remapCornerQuestionCategories_(categories) {
  var items = loadCornerQuestions_();
  var nextItems = [];
  var map = {};
  categories.forEach(function(category) {
    map[category.id] = true;
  });
  var fallbackId = map.other ? 'other' : (categories[0] ? categories[0].id : 'other');

  for (var i = 0; i < items.length; i++) {
    var item = copyCornerObject_(items[i]);
    if (!map[item.category]) {
      item.category = fallbackId;
      item.updatedAt = getCornerNowIso_();
    }
    nextItems.push(buildCornerQuestionItem_(item));
  }
  saveCornerQuestions_(nextItems);
}

function getCornerQuestionCategoryMap_() {
  var content = loadCornerContent_();
  var map = {};
  (content.questionCategories || []).forEach(function(item) {
    if (item && item.id) map[item.id] = item;
  });
  return map;
}

function parseCornerSortOrder_(value, fallback) {
  var num = parseInt(value, 10);
  return isNaN(num) ? fallback : num;
}

function parseCornerVoteCount_(value) {
  var num = parseInt(value, 10);
  return isNaN(num) || num < 0 ? 0 : num;
}

function sortCornerByOrder_(a, b) {
  return parseCornerSortOrder_(a.sortOrder, 0) - parseCornerSortOrder_(b.sortOrder, 0);
}

function copyCornerObject_(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function formatCornerDisplayDate_(isoText) {
  if (!isoText) return '';
  var date = new Date(isoText);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, TIMEZONE, 'yyyy/MM/dd');
}

function getCornerNowIso_() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function sanitizeCornerText_(value) {
  return String(value || '').trim();
}

function pickDefined_(value, fallback) {
  return typeof value === 'undefined' ? fallback : value;
}

function normalizeCornerParticipationSection_(section) {
  var next = {
    title: sanitizeCornerText_(section.title || '参加型コーナー'),
    prompt: sanitizeCornerText_(section.prompt || ''),
    note: sanitizeCornerText_(section.note || ''),
    stickyNote: sanitizeCornerText_(section.stickyNote || ''),
    themes: []
  };
  var themes = Array.isArray(section.themes) ? section.themes : [];
  for (var i = 0; i < themes.length; i++) {
    var theme = themes[i] || {};
    var normalizedTheme = {
      id: sanitizeCornerText_(theme.id || ('theme-' + (i + 1))),
      title: sanitizeCornerText_(theme.title || 'テーマ'),
      description: sanitizeCornerText_(theme.description || ''),
      published: theme.published !== false,
      sortOrder: parseCornerSortOrder_(theme.sortOrder, (i + 1) * 10),
      options: []
    };
    var options = Array.isArray(theme.options) ? theme.options : [];
    for (var j = 0; j < options.length; j++) {
      var option = options[j] || {};
      normalizedTheme.options.push({
        id: sanitizeCornerText_(option.id || (normalizedTheme.id + '-option-' + (j + 1))),
        label: sanitizeCornerText_(option.label || ''),
        votes: parseCornerVoteCount_(option.votes),
        published: option.published !== false,
        sortOrder: parseCornerSortOrder_(option.sortOrder, (j + 1) * 10)
      });
    }
    normalizedTheme.options = normalizedTheme.options
      .filter(function(option) { return option.label; })
      .sort(sortCornerByOrder_);
    if (normalizedTheme.title && normalizedTheme.options.length) {
      next.themes.push(normalizedTheme);
    }
  }
  next.themes.sort(sortCornerByOrder_);
  return next;
}

function getDefaultCornerContent_() {
  return normalizeCornerContent_({
    questionCategories: [
      { id: 'job-hunt', label: '就活関連', sortOrder: 10, published: true },
      { id: 'class', label: '単位・授業関連', sortOrder: 20, published: true },
      { id: 'other', label: 'その他', sortOrder: 30, published: true },
      { id: 'industry', label: '業界・企業関連', sortOrder: 40, published: true }
    ],
    worries: {
      title: 'スタッフがお悩み答えます!',
      note: 'カテゴリごとに、よくある質問とスタッフからのひとことをまとめています。',
      categories: [
        {
          id: 'worry-job-hunt',
          key: 'job-hunt',
          title: '就活関連',
          accent: 'career',
          published: true,
          sortOrder: 10,
          entries: [
            {
              id: 'worry-job-hunt-1',
              question: '自己分析はどこから始めるのがよいですか?',
              answer: 'まずはこれまで楽しかったことや大変だったことを3つほど書き出してみるのがおすすめです。',
              published: true,
              sortOrder: 10
            },
            {
              id: 'worry-job-hunt-2',
              question: 'インターンに参加していなくても大丈夫ですか?',
              answer: '大丈夫です。参加していない理由よりも、今から何を学ぶかの方が大事です。',
              published: true,
              sortOrder: 20
            }
          ]
        },
        {
          id: 'worry-class',
          key: 'class',
          title: '単位・授業関連',
          accent: 'study',
          published: true,
          sortOrder: 20,
          entries: [
            {
              id: 'worry-class-1',
              question: '授業と就活の両立が不安です。',
              answer: '学期の予定を先に見える化して、忙しい週を早めに把握しておくと調整しやすくなります。',
              published: true,
              sortOrder: 10
            }
          ]
        },
        {
          id: 'worry-other',
          key: 'other',
          title: 'その他何でも!!',
          accent: 'other',
          published: true,
          sortOrder: 30,
          entries: [
            {
              id: 'worry-other-1',
              question: 'BizCAFEはどんなときに使うのがおすすめですか?',
              answer: '一人で集中したいときにも、スタッフと気軽に話したいときにも使いやすい場所です。',
              published: true,
              sortOrder: 10
            }
          ]
        }
      ]
    },
    participation: {
      title: '参加型コーナー',
      prompt: 'みんなの声をちょっとずつ集めるコーナーです。',
      note: '公開中テーマをひとつ選んで投票できます。',
      stickyNote: '気になるテーマがあれば気軽に参加してみてください!',
      themes: []
    },
    staffColumns: {
      title: 'スタッフ紹介・コラム',
      staff: [
        {
          id: 'staff-1',
          name: 'Aoi',
          role: '3年 / 就活相談スタッフ',
          profile: '就活の進め方や自己分析の相談が得意です。まずは話しながら整理したい人向けです。',
          tags: ['就活', '自己分析'],
          published: true,
          sortOrder: 10
        },
        {
          id: 'staff-2',
          name: 'Riku',
          role: '4年 / 業界研究サポート',
          profile: '業界研究や企業比較の始め方を一緒に整理できます。',
          tags: ['業界研究', '企業比較'],
          published: true,
          sortOrder: 20
        }
      ],
      columns: [
        {
          id: 'column-1',
          title: 'BizCAFEスタッフが考える、就活の最初の一歩',
          body: 'まずは完璧を目指さず、気になることを言葉にしてみるだけでも前に進みます。',
          published: true,
          sortOrder: 10
        }
      ]
    }
  });
}

function trackCornerPageView_(pageKey) {
  var key = sanitizeCornerText_(pageKey);
  if (!key) return { ok: false, error: 'page_key_required' };
  var counts = loadCornerPageViews_();
  counts[key] = Number(counts[key] || 0) + 1;
  saveCornerPageViews_(counts);
  return { ok: true, pageKey: key, count: counts[key] };
}

function getCornerPageViews_() {
  return loadCornerPageViews_();
}

function loadCornerPageViews_() {
  var defaults = {
    congestion: 0,
    calendar: 0,
    qa: 0,
    notices: 0,
    free_board: 0,
    recruit: 0
  };
  var raw = PropertiesService.getScriptProperties().getProperty(CORNER_PAGE_VIEWS_PROP_KEY);
  if (!raw) return defaults;
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    Object.keys(parsed).forEach(function(key) {
      defaults[key] = Number(parsed[key] || 0);
    });
    return defaults;
  } catch (err) {
    return defaults;
  }
}

function saveCornerPageViews_(counts) {
  PropertiesService.getScriptProperties().setProperty(
    CORNER_PAGE_VIEWS_PROP_KEY,
    JSON.stringify(counts || {})
  );
}

function parseCornerDateTimeValue_(value) {
  var text = sanitizeCornerText_(value);
  if (!text) return '';
  var date = new Date(text);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function getCornerNowDate_() {
  return new Date(getCornerNowIso_());
}

function getCornerThemeLifecycleStatus_(theme, nowDate) {
  var now = nowDate || getCornerNowDate_();
  if (!theme || theme.published === false) return 'hidden';
  var start = theme.startAt ? new Date(theme.startAt) : null;
  var end = theme.endAt ? new Date(theme.endAt) : null;
  if (!theme.startAt && !theme.endAt) return 'always';
  if (start && !isNaN(start.getTime()) && now < start) return 'upcoming';
  if (end && !isNaN(end.getTime()) && now > end) return 'ended';
  return 'active';
}

function normalizeCornerParticipationSection_(section) {
  var next = {
    title: sanitizeCornerText_(section.title || '参加型コーナー'),
    prompt: sanitizeCornerText_(section.prompt || ''),
    note: sanitizeCornerText_(section.note || ''),
    stickyNote: sanitizeCornerText_(section.stickyNote || ''),
    themes: []
  };
  var themes = Array.isArray(section.themes) ? section.themes : [];
  for (var i = 0; i < themes.length; i++) {
    var theme = themes[i] || {};
    var normalizedTheme = {
      id: sanitizeCornerText_(theme.id || ('theme-' + (i + 1))),
      title: sanitizeCornerText_(theme.title || 'テーマ'),
      description: sanitizeCornerText_(theme.description || ''),
      published: theme.published !== false,
      sortOrder: parseCornerSortOrder_(theme.sortOrder, (i + 1) * 10),
      startAt: parseCornerDateTimeValue_(theme.startAt || ''),
      endAt: parseCornerDateTimeValue_(theme.endAt || ''),
      options: []
    };
    var options = Array.isArray(theme.options) ? theme.options : [];
    for (var j = 0; j < options.length; j++) {
      var option = options[j] || {};
      normalizedTheme.options.push({
        id: sanitizeCornerText_(option.id || (normalizedTheme.id + '-option-' + (j + 1))),
        label: sanitizeCornerText_(option.label || ''),
        votes: parseCornerVoteCount_(option.votes),
        published: option.published !== false,
        sortOrder: parseCornerSortOrder_(option.sortOrder, (j + 1) * 10)
      });
    }
    normalizedTheme.options = normalizedTheme.options
      .filter(function(option) { return option.label; })
      .sort(sortCornerByOrder_);
    if (normalizedTheme.title && normalizedTheme.options.length) {
      next.themes.push(normalizedTheme);
    }
  }
  next.themes.sort(sortCornerByOrder_);
  return next;
}

function filterPublishedCornerContent_(content) {
  var normalized = normalizeCornerContent_(content);
  var now = getCornerNowDate_();
  normalized.questionCategories = normalized.questionCategories.filter(function(item) {
    return item.published !== false;
  });
  normalized.worries.categories = normalized.worries.categories
    .filter(function(category) { return category.published; })
    .map(function(category) {
      var next = copyCornerObject_(category);
      next.entries = next.entries.filter(function(entry) { return entry.published; });
      return next;
    })
    .filter(function(category) { return category.entries.length > 0; });
  normalized.participation.themes = normalized.participation.themes
    .filter(function(theme) {
      var status = getCornerThemeLifecycleStatus_(theme, now);
      return status === 'active' || status === 'always' || status === 'upcoming';
    })
    .map(function(theme) {
      var nextTheme = copyCornerObject_(theme);
      nextTheme.options = (nextTheme.options || []).filter(function(option) {
        return option.published !== false;
      });
      return nextTheme;
    })
    .filter(function(theme) { return theme.options.length > 0; });
  normalized.staffColumns.staff = normalized.staffColumns.staff.filter(function(item) { return item.published; });
  normalized.staffColumns.columns = normalized.staffColumns.columns.filter(function(item) { return item.published; });
  return normalized;
}

function voteCornerParticipation_(themeId, optionId) {
  var targetThemeId = sanitizeCornerText_(themeId);
  var targetOptionId = sanitizeCornerText_(optionId);
  if (!targetThemeId) return { ok: false, error: 'theme_required' };
  if (!targetOptionId) return { ok: false, error: 'option_required' };

  var content = loadCornerContent_();
  var themes = content.participation && Array.isArray(content.participation.themes) ? content.participation.themes : [];
  var theme = null;
  for (var i = 0; i < themes.length; i++) {
    if (themes[i].id === targetThemeId) {
      theme = themes[i];
      break;
    }
  }
  if (!theme) return { ok: false, error: 'theme_not_found' };
  var themeStatus = getCornerThemeLifecycleStatus_(theme, getCornerNowDate_());
  if (themeStatus !== 'active' && themeStatus !== 'always') {
    return { ok: false, error: 'theme_inactive' };
  }

  var option = null;
  for (var j = 0; j < theme.options.length; j++) {
    if (theme.options[j].id === targetOptionId) {
      option = theme.options[j];
      break;
    }
  }
  if (!option || option.published === false) return { ok: false, error: 'option_not_found' };

  option.votes = parseCornerVoteCount_(option.votes) + 1;
  saveCornerContent_(content);
  return {
    ok: true,
    themeId: targetThemeId,
    optionId: targetOptionId,
    theme: copyCornerObject_(theme)
  };
}
