var CORNER_QUESTIONS_PROP_KEY = 'CORNER_QUESTIONS';
var CORNER_CONTENT_PROP_KEY = 'CORNER_CONTENT';

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
  var category = String(payload.category || '').trim();
  var title = String(payload.title || '').trim();
  var body = String(payload.body || '').trim();

  if (!title) return { ok: false, error: 'title_required' };
  if (!body) return { ok: false, error: 'body_required' };

  var items = loadCornerQuestions_();
  var now = getCornerNowIso_();
  var item = buildCornerQuestionItem_({
    id: String(new Date().getTime()),
    nickname: nickname || '匿名',
    category: category || 'other',
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
    category: sanitizeCornerText_(pickDefined_(payload.category, current.category || 'other')),
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

  if (key === 'worries') {
    content.worries = normalizeCornerWorriesSection_(data);
  } else if (key === 'participation') {
    content.participation = normalizeCornerParticipationSection_(data);
  } else if (key === 'industryQa') {
    content.industryQa = normalizeCornerIndustrySection_(data);
  } else if (key === 'staffColumns') {
    content.staffColumns = normalizeCornerStaffSection_(data);
  } else {
    return { ok: false, error: 'invalid_section' };
  }

  saveCornerContent_(content);
  return { ok: true, section: key };
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
  var category = sanitizeCornerText_(item.category || 'other');
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
              question: '自己分析は何から始めるのがいいですか？',
              answer: 'まずは、これまで楽しかった経験や頑張れた場面を書き出してみるのがおすすめです。',
              published: true,
              sortOrder: 10
            },
            {
              id: 'worry-job-hunt-2',
              question: 'インターンに参加していなくても大丈夫ですか？',
              answer: '大丈夫です。参加有無より、そこから何を学び、どう動いたかを言葉にできることが大切です。',
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
              answer: '予定が見える化できるとかなり楽になります。先に固定予定を書き出して、空き時間で動く形にすると整理しやすいです。',
              published: true,
              sortOrder: 10
            }
          ]
        },
        {
          id: 'worry-other',
          key: 'other',
          title: 'その他なんでも!',
          accent: 'other',
          published: true,
          sortOrder: 30,
          entries: [
            {
              id: 'worry-other-1',
              question: 'BizCAFEはどう使うのがおすすめですか？',
              answer: '空きコマの作業、イベント参加、スタッフとの雑談など、その日の気分で使い分けてもらって大丈夫です。',
              published: true,
              sortOrder: 10
            }
          ]
        }
      ]
    },
    participation: {
      title: '参加型コーナー',
      prompt: 'みんなの出身地は？',
      note: '初期版では地域タグでゆるく表現しています。',
      stickyNote: '気になる地域があったらスタッフにも聞いてみてください。',
      tags: [
        { id: 'region-hokkaido', label: '北海道', count: '1名', tone: 'blue', published: true, sortOrder: 10 },
        { id: 'region-tohoku', label: '東北', count: '2名', tone: 'teal', published: true, sortOrder: 20 },
        { id: 'region-kanto', label: '関東', count: '6名', tone: 'yellow', published: true, sortOrder: 30 },
        { id: 'region-chubu', label: '中部', count: '3名', tone: 'pink', published: true, sortOrder: 40 },
        { id: 'region-kansai', label: '関西', count: '2名', tone: 'green', published: true, sortOrder: 50 },
        { id: 'region-kyushu', label: '九州', count: '1名', tone: 'orange', published: true, sortOrder: 60 }
      ]
    },
    industryQa: {
      title: '業界・企業Q&Aコーナー',
      note: '気になる業界タグを押すと、そのテーマのQ&Aだけを見られます。',
      tags: [
        { id: 'it', label: 'IT', sortOrder: 10, published: true },
        { id: 'maker', label: 'メーカー', sortOrder: 20, published: true },
        { id: 'consulting', label: 'コンサル', sortOrder: 30, published: true },
        { id: 'trading', label: '商社', sortOrder: 40, published: true }
      ],
      items: [
        {
          id: 'industry-it-1',
          title: 'IT業界は文系でも挑戦できますか？',
          comment: '基礎から学びたい人向け',
          body: '文系から挑戦している先輩も多いです。業界理解に加えて、なぜITに興味を持ったのかを整理しておくと話しやすくなります。',
          tagId: 'it',
          published: true,
          sortOrder: 10
        },
        {
          id: 'industry-maker-1',
          title: 'メーカーは職種の幅が広いと聞きました。',
          comment: '職種理解の入口',
          body: '研究、技術、営業、企画など幅が広いです。まずは職種ごとに働き方がどう違うかを見ると理解しやすいです。',
          tagId: 'maker',
          published: true,
          sortOrder: 20
        },
        {
          id: 'industry-consulting-1',
          title: 'コンサル業界って何をしているの？',
          comment: '業界の基本',
          body: '課題整理や改善提案を通じて企業を支援する仕事です。まずは「誰のどんな課題を扱うか」で会社ごとの差を見るのがおすすめです。',
          tagId: 'consulting',
          published: true,
          sortOrder: 30
        },
        {
          id: 'industry-trading-1',
          title: '商社とメーカーの違いが分かりません。',
          comment: '比較のヒント',
          body: '商社はモノや事業をつなぐ立場、メーカーは自社でつくる立場という違いから見ると整理しやすいです。',
          tagId: 'trading',
          published: true,
          sortOrder: 40
        }
      ]
    },
    staffColumns: {
      title: 'スタッフ紹介・コラム',
      staff: [
        {
          id: 'staff-1',
          name: 'Aoi',
          role: '3年 / 就活伴走スタッフ',
          profile: '就活の進め方や、最初の一歩の踏み出し方を一緒に整理するのが得意です。',
          tags: ['就活', '自己分析'],
          published: true,
          sortOrder: 10
        },
        {
          id: 'staff-2',
          name: 'Riku',
          role: '4年 / 業界研究サポート',
          profile: '業界比較や企業研究の始め方を、分かりやすく伝えることを大切にしています。',
          tags: ['業界研究', '企業比較'],
          published: true,
          sortOrder: 20
        }
      ],
      columns: [
        {
          id: 'column-1',
          title: 'BizCAFEスタッフが考える、就活の最初の一歩',
          body: 'まずは完璧に進めようとせず、気になる業界を3つほど挙げてみるだけでも十分です。少しずつ輪郭を作っていきましょう。',
          published: true,
          sortOrder: 10
        },
        {
          id: 'column-2',
          title: '授業が忙しい時期の就活との向き合い方',
          body: '全部を同時に頑張るより、今週やることを絞る方が続きやすいです。スタッフにも気軽に相談してください。',
          published: true,
          sortOrder: 20
        }
      ]
    }
  });
}

function normalizeCornerContent_(content) {
  var source = content || {};
  return {
    worries: normalizeCornerWorriesSection_(source.worries || {}),
    participation: normalizeCornerParticipationSection_(source.participation || {}),
    industryQa: normalizeCornerIndustrySection_(source.industryQa || {}),
    staffColumns: normalizeCornerStaffSection_(source.staffColumns || {})
  };
}

function filterPublishedCornerContent_(content) {
  var normalized = normalizeCornerContent_(content);
  normalized.worries.categories = normalized.worries.categories
    .filter(function(category) { return category.published; })
    .map(function(category) {
      var next = copyCornerObject_(category);
      next.entries = next.entries.filter(function(entry) { return entry.published; });
      return next;
    })
    .filter(function(category) { return category.entries.length > 0; });

  normalized.participation.tags = normalized.participation.tags.filter(function(tag) { return tag.published; });
  normalized.industryQa.tags = normalized.industryQa.tags.filter(function(tag) { return tag.published; });
  normalized.industryQa.items = normalized.industryQa.items.filter(function(item) { return item.published; });
  normalized.staffColumns.staff = normalized.staffColumns.staff.filter(function(item) { return item.published; });
  normalized.staffColumns.columns = normalized.staffColumns.columns.filter(function(item) { return item.published; });
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
    tags: []
  };
  var tags = Array.isArray(section.tags) ? section.tags : [];
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i] || {};
    next.tags.push({
      id: sanitizeCornerText_(tag.id || ('region-tag-' + (i + 1))),
      label: sanitizeCornerText_(tag.label || ''),
      count: sanitizeCornerText_(tag.count || ''),
      tone: sanitizeCornerText_(tag.tone || ''),
      published: tag.published !== false,
      sortOrder: parseCornerSortOrder_(tag.sortOrder, (i + 1) * 10)
    });
  }
  next.tags.sort(sortCornerByOrder_);
  return next;
}

function normalizeCornerIndustrySection_(section) {
  var next = {
    title: sanitizeCornerText_(section.title || '業界・企業Q&Aコーナー'),
    note: sanitizeCornerText_(section.note || ''),
    tags: [],
    items: []
  };
  var rawTags = Array.isArray(section.tags) ? section.tags : [];
  var publishedTagIds = {};
  for (var i = 0; i < rawTags.length; i++) {
    var tag = rawTags[i] || {};
    var normalizedTag = {
      id: sanitizeCornerText_(tag.id || ('industry-tag-' + (i + 1))),
      label: sanitizeCornerText_(tag.label || ''),
      sortOrder: parseCornerSortOrder_(tag.sortOrder, (i + 1) * 10),
      published: tag.published !== false
    };
    if (normalizedTag.id) {
      next.tags.push(normalizedTag);
      publishedTagIds[normalizedTag.id] = true;
    }
  }
  next.tags.sort(sortCornerByOrder_);

  var items = Array.isArray(section.items) ? section.items : [];
  for (var j = 0; j < items.length; j++) {
    var item = items[j] || {};
    var tagId = sanitizeCornerText_(item.tagId || '');
    if (tagId && !publishedTagIds[tagId]) {
      tagId = '';
    }
    next.items.push({
      id: sanitizeCornerText_(item.id || ('industry-item-' + (j + 1))),
      title: sanitizeCornerText_(item.title || ''),
      comment: sanitizeCornerText_(item.comment || ''),
      body: sanitizeCornerText_(pickDefined_(item.body, item.answer || '')),
      tagId: tagId,
      published: item.published !== false,
      sortOrder: parseCornerSortOrder_(item.sortOrder, (j + 1) * 10)
    });
  }
  next.items.sort(sortCornerByOrder_);
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

function parseCornerSortOrder_(value, fallback) {
  var num = parseInt(value, 10);
  return isNaN(num) ? fallback : num;
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
