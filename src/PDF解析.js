// ============================================================
// pdfParser.gs - PDF→テキスト変換・シフトデータ抽出
// ============================================================

/**
 * PDFファイルをGoogleドキュメントに変換してテキストを抽出する
 * Advanced Drive Service（Drive API v2）を使用
 * @param {GoogleAppsScript.Drive.File} pdfFile
 * @returns {string|null} 抽出テキスト
 */
function extractTextFromPdf(pdfFile) {
  let docFile = null;
  try {
    const blob = pdfFile.getBlob();
    const resource = {
      title: '_temp_shift_ocr_' + Date.now(),
      mimeType: 'application/pdf'
    };

    // PDF → Googleドキュメントに変換（OCR有効）
    docFile = Drive.Files.insert(resource, blob, {
      ocr: true,
      ocrLanguage: 'ja'
    });

    // テキスト抽出
    const doc = DocumentApp.openById(docFile.id);
    const text = doc.getBody().getText();
    Logger.log('テキスト抽出完了: ' + pdfFile.getName() + ' (' + text.length + '文字)');
    return text;
  } catch (e) {
    Logger.log('PDF変換エラー: ' + e.message);
    return null;
  } finally {
    // 一時ドキュメントを削除
    if (docFile && docFile.id) {
      try {
        DriveApp.getFileById(docFile.id).setTrashed(true);
      } catch (e) {
        Logger.log('一時ファイル削除エラー: ' + e.message);
      }
    }
  }
}

/**
 * 翌日の日付を取得する（YYYY年MM月DD日 形式）
 * @returns {{ formatted: string, dateObj: Date, displayStr: string }}
 */
function getTomorrow() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');

  const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][tomorrow.getDay()];

  return {
    formatted: year + '年' + month + '月' + day + '日',
    dateObj: tomorrow,
    displayStr: year + '年' + parseInt(month) + '月' + parseInt(day) + '日（' + dayOfWeek + '）'
  };
}

/**
 * テキストから翌日のシフト情報を抽出する
 * @param {string} text - PDF全文テキスト
 * @param {{ formatted: string }} tomorrow - 翌日情報
 * @returns {Array<{ name: string, start: string, end: string, tasks: string[] }>}
 */
function parseShiftData(text, tomorrow) {
  // 日付パターンでテキストをブロック分割
  const datePattern = /(\d{4})年(\d{2})月(\d{2})日\((.)\)/g;
  const lines = text.split('\n');

  // 翌日の日付文字列（照合用）
  const tomorrowDate = tomorrow.formatted; // 例: "2026年02月13日"

  let targetBlock = null;
  let currentBlock = null;
  let currentDate = null;

  for (const line of lines) {
    const dateMatch = line.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*[（(](.)[）)]/);
    if (dateMatch) {
      // 新しい日付ブロック開始
      if (currentDate === tomorrowDate && currentBlock) {
        targetBlock = currentBlock;
      }
      currentDate = dateMatch[1] + '年' + dateMatch[2] + '月' + dateMatch[3] + '日';
      currentBlock = [];
      continue;
    }
    if (currentBlock !== null) {
      currentBlock.push(line);
    }
  }
  // 最後のブロック処理
  if (currentDate === tomorrowDate && currentBlock) {
    targetBlock = currentBlock;
  }

  if (!targetBlock) {
    Logger.log('翌日(' + tomorrowDate + ')のシフトブロックが見つかりません');
    return [];
  }

  // ブロック内からスタッフ情報を抽出
  return parseStaffLines(targetBlock).shifts;
}

/**
 * 時刻文字列を HH:mm 形式（2桁）に正規化する
 * 例: "9:00" → "09:00", "10:30" → "10:30"
 */
function normalizeTime_(time) {
  const parts = time.split(':');
  return parts[0].padStart(2, '0') + ':' + parts[1];
}

/**
 * シフトブロックの行からスタッフ・時間・業務内容を抽出する
 *
 * ジョブカンPDFをGoogleドキュメントでOCR変換すると、テーブルの読み方が
 * 「行ごと」と「列ごと」の2パターンがある。
 *
 * 行ごと: 星野 竜大 15:30〜17:30 / 遠藤 慧音 13:30〜15:30
 * 列ごと: 星野 竜大 / 遠藤 慧音 / 15:30〜17:30 / 13:30〜15:30
 *
 * どちらにも対応するため、名前リストと時刻リストを別々に収集し
 * インデックス順にペア化する方式を採用する。
 *
 * @param {string[]} blockLines
 * @returns {Array<{ name: string, start: string, end: string, tasks: string[] }>}
 */
function parseStaffLines(blockLines) {
  // ヘッダー系のみスキップ。タスクキーワードは業務内容として読み取るためスキップしない
  const skipKeywords = ['スタッフ', '開始', '終了', '時刻', '計:'];
  const timePattern = /(\d{1,2}:\d{2})(?:[〜~～\-]|\s+)(\d{1,2}:\d{2})/;
  const taskKeywords = ['清掃', '在報', '棚卸', '発注', '研修', 'MTG', 'ミーティング', '引継', '営業中研修', 'OP研修'];

  // 名前パターン1: 姓 名（スペース区切り）
  const namePatternSpaced = /^[\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Zａ-ｚＡ-Ｚ]+[\s　]+[\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Zａ-ｚＡ-Ｚ]+$/u;
  // 名前パターン2: 姓名（スペースなし）3〜8文字 - OCRがスペースを認識しないケース（例: 北田あや）
  const namePatternUnspaced = /^[\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Zａ-ｚＡ-Ｚ]{3,8}$/u;
  // 名前部分の文字種チェック（OCRゴミ文字を除外 & タスクキーワードを除外）
  const validNameChars = /^[\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Zａ-ｚＡ-Ｚ]+$/u;

  const results = [];          // パターンA（同一行）で確定した結果
  const standaloneNames = [];  // 時刻なし名前行（列ごとOCR対応）
  const standaloneTimes = [];  // 名前なし時刻行（tasks フィールド付き）
  const standaloneTasks = [];  // 業務内容のみ行（インデックスでスタッフと対応）

  for (const line of blockLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (skipKeywords.some(function(kw) { return trimmed.includes(kw); })) continue;

    const timeMatch = trimmed.match(timePattern);

    if (timeMatch) {
      // 時刻行: 前後のテキストを確認
      const namePartRaw = trimmed.substring(0, trimmed.indexOf(timeMatch[0])).trim();
      const namePart = namePartRaw.replace(/[\s　]+/g, '');
      const afterTime = trimmed.substring(trimmed.indexOf(timeMatch[0]) + timeMatch[0].length).trim();

      // 名前部分が有効かつタスクキーワードを含まない → パターンA（同一行に名前＋時刻）
      var isValidName = namePart && validNameChars.test(namePart) &&
                        !taskKeywords.some(function(kw) { return namePart.includes(kw); });

      if (isValidName) {
        results.push({
          name: namePart,
          start: normalizeTime_(timeMatch[1]),
          end: normalizeTime_(timeMatch[2]),
          tasks: extractTasks(namePartRaw + ' ' + afterTime, taskKeywords)
        });
      } else {
        // 名前なし時刻行 → スタンドアロン。行内にタスクがあれば付属させる
        var inlineTasks = extractTasks(namePartRaw + ' ' + afterTime, taskKeywords);
        standaloneTimes.push({
          start: normalizeTime_(timeMatch[1]),
          end: normalizeTime_(timeMatch[2]),
          tasks: inlineTasks
        });
      }

    } else {
      var lineTasks = extractTasks(trimmed, taskKeywords);
      if (lineTasks.length > 0) {
        // 業務内容のみの行 → スタンドアロンタスクリストへ
        standaloneTasks.push(lineTasks);
      } else if (namePatternSpaced.test(trimmed) || namePatternUnspaced.test(trimmed)) {
        // 名前のみの行 → スタンドアロン名前リストへ
        standaloneNames.push(trimmed.replace(/[\s　]+/g, ''));
      }
      // それ以外（数字のみ、記号のみ、OCRゴミ等）は無視
    }
  }

  // スタンドアロン名前・時刻・タスクをインデックス順にペア化
  //
  // OCRが「列ごと」に読む場合（ジョブカンPDF特有）:
  //   [タスクA, タスクB] → [名前A, 名前B] → [時刻A, 時刻B]
  // OCRが「行ごと」に読む場合:
  //   [名前A] → [時刻A] → [タスクA] → [名前B] → ...
  // どちらも各リストの順序が一致するため、インデックス対応で正しくペア化できる
  var pairCount = Math.min(standaloneNames.length, standaloneTimes.length);
  for (var i = 0; i < pairCount; i++) {
    // 優先順位: 時刻行インライン > スタンドアロンタスク（重複除去してマージ）
    var timeTasks = standaloneTimes[i].tasks || [];
    var indexedTasks = standaloneTasks[i] || [];
    var taskMap = {};
    timeTasks.concat(indexedTasks).forEach(function(t) { taskMap[t] = true; });
    var allTasks = Object.keys(taskMap);

    results.push({
      name: standaloneNames[i],
      start: standaloneTimes[i].start,
      end: standaloneTimes[i].end,
      tasks: allTasks
    });
  }

  var unpairedNames = standaloneNames.slice(pairCount);
  if (unpairedNames.length > 0 || standaloneTimes.length > pairCount) {
    Logger.log('警告: 未ペア名前=' + unpairedNames.length + '件, 未ペア時刻=' + (standaloneTimes.length - pairCount) + '件');
  }

  results.sort(function(a, b) { return a.start.localeCompare(b.start); });

  Logger.log('スタッフ抽出結果: ' + results.length + '名 (同一行:' + (results.length - pairCount) + ', ペア化:' + pairCount + ', タスク件数:' + standaloneTasks.length + ')');
  return { shifts: results, unpairedNames: unpairedNames };
}

/**
 * ブロック先頭の名前行が出現するまでの時刻行を抽出する
 * OCRが前ブロックの時刻を次ブロック冒頭に読み込んでしまう場合（3/16問題）の対応
 * @param {string[]} blockLines
 * @param {number} maxCount - 最大何件取り出すか
 * @returns {{ times: Array<{start,end,tasks}>, remainingLines: string[] }}
 */
function extractLeadingTimes_(blockLines, maxCount) {
  const timePattern = /(\d{1,2}:\d{2})(?:[〜~～\-]|\s+)(\d{1,2}:\d{2})/;
  const taskKeywords = ['清掃', '在報', '棚卸', '発注', '研修', 'MTG', 'ミーティング', '引継', '営業中研修', 'OP研修'];
  const validNameChars = /^[\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Zａ-ｚＡ-Ｚ]+$/u;
  const namePatternSpaced = /^[\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Zａ-ｚＡ-Ｚ]+[\s　]+[\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Zａ-ｚＡ-Ｚ]+$/u;
  const namePatternUnspaced = /^[\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Zａ-ｚＡ-Ｚ]{3,8}$/u;
  const skipKeywords = ['スタッフ', '開始', '終了', '時刻', '計:'];

  const times = [];
  const consumedIndices = new Set();

  for (var i = 0; i < blockLines.length && times.length < maxCount; i++) {
    const trimmed = blockLines[i].trim();
    if (!trimmed) continue;
    if (skipKeywords.some(function(kw) { return trimmed.includes(kw); })) continue;

    // 名前行に当たったら終了
    const namePart = trimmed.replace(/[\s　]+/g, '');
    if (validNameChars.test(namePart) &&
        (namePatternSpaced.test(trimmed) || namePatternUnspaced.test(trimmed))) {
      break;
    }

    // 時刻行
    const timeMatch = trimmed.match(timePattern);
    if (timeMatch) {
      times.push({
        start: normalizeTime_(timeMatch[1]),
        end: normalizeTime_(timeMatch[2]),
        tasks: extractTasks(trimmed, taskKeywords)
      });
      consumedIndices.add(i);
    }
  }

  const remainingLines = blockLines.filter(function(_, i) { return !consumedIndices.has(i); });
  return { times: times, remainingLines: remainingLines };
}

/**
 * テキストから業務内容キーワードを抽出する
 * @param {string} text
 * @param {string[]} taskKeywords
 * @returns {string[]}
 */
function extractTasks(text, taskKeywords) {
  const found = [];
  // 「在報・棚卸」のようにセットで書かれるケースを先に処理
  if (text.includes('在報') && text.includes('棚卸')) {
    found.push('在報・棚卸');
  } else {
    if (text.includes('在報')) found.push('在報');
    if (text.includes('棚卸')) found.push('棚卸');
  }
  // その他のキーワード
  for (const kw of taskKeywords) {
    if (kw === '在報' || kw === '棚卸') continue; // 上で処理済み
    if (text.includes(kw)) found.push(kw);
  }
  return found;
}
