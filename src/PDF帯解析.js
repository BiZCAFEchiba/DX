// ============================================================
// pdfBandParser.gs - PDFの塗り帯からシフト区間を抽出
// ============================================================

var PDF_BAND_START_HOUR = 9;
var PDF_BAND_MINUTES_PER_SLOT = 10;
var PDF_BAND_CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
var PDF_BAND_LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
var PDF_BAND_LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
var PDF_BAND_DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
var PDF_BAND_DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
var PDF_BAND_FIXED_LIT_TREE = null;
var PDF_BAND_FIXED_DIST_TREE = null;

function parseAllShiftsFromPdf_(pdfFile, text) {
  var normalizedText = normalizePdfText_(text);
  var ocrBlocks = extractOcrDayBlocks_(normalizedText);
  if (!pdfFile || ocrBlocks.length === 0) {
    return parseAllShiftsFromText_(normalizedText);
  }

  var bandBlocks = extractShiftBandBlocksFromPdf_(pdfFile);
  if (bandBlocks.length === 0) {
    Logger.log('塗り帯解析に失敗したため、OCRベースの解析を使用します');
    return parseAllShiftsFromText_(normalizedText);
  }

  var results = [];
  for (var i = 0; i < ocrBlocks.length; i++) {
    var ocrBlock = ocrBlocks[i];
    var bandBlock = bandBlocks[i];
    if (!bandBlock) {
      Logger.log('塗り帯ブロック不足のため、OCRフォールバック: ' + ocrBlock.date);
      var fallback = parseStaffLines(ocrBlock.lines).shifts;
      if (fallback.length > 0) {
        results.push({ date: ocrBlock.date, dayOfWeek: ocrBlock.dayOfWeek, shifts: fallback });
      }
      continue;
    }

    var rowMeta = extractOcrRowsFromBlock_(ocrBlock.lines);
    if (rowMeta.length === 0) {
      Logger.log('OCR行メタの抽出に失敗したため、OCRフォールバック: ' + ocrBlock.date);
      var fallbackRows = parseStaffLines(ocrBlock.lines).shifts;
      if (fallbackRows.length > 0) {
        results.push({ date: ocrBlock.date, dayOfWeek: ocrBlock.dayOfWeek, shifts: fallbackRows });
      }
      continue;
    }

    var shifts = mergeBandRowsWithOcrRows_(ocrBlock, rowMeta, bandBlock);
    if (shifts.length === 0) {
      Logger.log('塗り帯とOCRの結合に失敗したため、OCRフォールバック: ' + ocrBlock.date);
      shifts = parseStaffLines(ocrBlock.lines).shifts;
    }
    if (shifts.length > 0) {
      results.push({ date: ocrBlock.date, dayOfWeek: ocrBlock.dayOfWeek, shifts: shifts });
    }
  }

  return results.length > 0 ? results : parseAllShiftsFromText_(normalizedText);
}

function extractShiftBandBlocksFromPdf_(pdfFile) {
  try {
    var pdfBytes = pdfFile.getBlob().getBytes();
    var streams = extractFlateStreamsFromPdfBytes_(pdfBytes);
    var blocks = [];

    for (var i = 0; i < streams.length; i++) {
      var rects = parseColoredRectsFromPdfContent_(streams[i]);
      var page = analyzePdfRectPage_(rects);
      if (!page || !page.dayBlocks || page.dayBlocks.length === 0) continue;
      blocks = blocks.concat(page.dayBlocks);
    }

    Logger.log('塗り帯ブロック数: ' + blocks.length + ' (' + pdfFile.getName() + ')');
    return blocks;
  } catch (e) {
    Logger.log('塗り帯解析エラー: ' + e.message);
    return [];
  }
}

function extractOcrDayBlocks_(text) {
  var lines = normalizePdfText_(text).split('\n');
  var blocks = [];
  var current = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var dateMatch = line.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*[（(](.)[）)]/);
    if (dateMatch) {
      if (current) blocks.push(current);
      var parsedYear = parseInt(dateMatch[1], 10);
      var currentYear = new Date().getFullYear();
      if (Math.abs(parsedYear - currentYear) >= 2) {
        Logger.log('年のOCR誤認識を補正: ' + parsedYear + ' -> ' + currentYear + ' (' + dateMatch[2] + '月' + dateMatch[3] + '日)');
        parsedYear = currentYear;
      }
      current = {
        date: parsedYear + '-' + String(dateMatch[2]).padStart(2, '0') + '-' + String(dateMatch[3]).padStart(2, '0'),
        dayOfWeek: dateMatch[4],
        lines: []
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

function extractOcrRowsFromBlock_(blockLines) {
  var skipKeywords = ['スタッフ', '開始・終了', '時刻', '計:', 'ジョブカン', '管理画面'];
  var taskKeywords = ['清掃', '在報', '棚卸', '発注', '研修', 'MTG', 'ミーティング', '引継', '営業中研修', 'OP研修'];
  var namePatternSpaced = /^[\u3005\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Z々ァ-ヶー]+[\s　]+[\u3005\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Z々ァ-ヶー]+$/u;
  var namePatternUnspaced = /^[\u3005\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Z々ァ-ヶー]{3,8}$/u;
  var validNameChars = /^[\u3005\u3040-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}a-zA-Z々ァ-ヶー]+$/u;
  var standaloneNames = [];
  var standaloneTasks = [];
  var inlineRows = [];

  for (var i = 0; i < blockLines.length; i++) {
    var trimmed = normalizePdfLine_(blockLines[i]);
    if (!trimmed) continue;
    if (trimmed.indexOf('http') === 0) continue;
    if (/^\d+(?:\/\d+)?$/.test(trimmed)) continue;
    if (skipKeywords.some(function(kw) { return trimmed.indexOf(kw) !== -1; })) continue;

    var timeRanges = extractTimeRanges_(trimmed);
    if (timeRanges.length > 0) {
      var firstRange = timeRanges[0];
      var lastRange = timeRanges[timeRanges.length - 1];
      var namePartRaw = trimmed.substring(0, firstRange.index).trim();
      var namePart = namePartRaw.replace(/\s+/g, '');
      var afterTime = trimmed.substring(lastRange.index + lastRange.raw.length).trim();
      var isValidName = namePart && validNameChars.test(namePart) &&
        !taskKeywords.some(function(kw) { return namePart.indexOf(kw) !== -1; });
      if (isValidName) {
        inlineRows.push({
          name: namePart,
          tasks: extractTasks(namePartRaw + ' ' + afterTime, taskKeywords)
        });
      }
      continue;
    }

    var lineTasks = extractTasks(trimmed, taskKeywords);
    if (lineTasks.length > 0) {
      standaloneTasks.push(lineTasks);
      continue;
    }

    if (namePatternSpaced.test(trimmed) || namePatternUnspaced.test(trimmed)) {
      standaloneNames.push(trimmed.replace(/\s+/g, ''));
    }
  }

  if (standaloneNames.length === 0) return inlineRows;

  var rows = [];
  for (var ni = 0; ni < standaloneNames.length; ni++) {
    rows.push({
      name: standaloneNames[ni],
      tasks: standaloneTasks[ni] || []
    });
  }
  return rows.length >= inlineRows.length ? rows : inlineRows;
}

function mergeBandRowsWithOcrRows_(ocrBlock, rowMeta, bandBlock) {
  var shifts = [];
  var rowCount = Math.min(rowMeta.length, bandBlock.rows.length);

  if (rowMeta.length !== bandBlock.rows.length) {
    Logger.log('塗り帯/OCR 行数差異: ' + ocrBlock.date + ' OCR=' + rowMeta.length + ', BAND=' + bandBlock.rows.length);
  }

  for (var i = 0; i < rowCount; i++) {
    var row = rowMeta[i];
    var bandRow = bandBlock.rows[i];
    if (!bandRow || !bandRow.intervals || bandRow.intervals.length === 0) continue;

    for (var j = 0; j < bandRow.intervals.length; j++) {
      shifts.push({
        name: row.name,
        start: bandRow.intervals[j].start,
        end: bandRow.intervals[j].end,
        tasks: row.tasks || []
      });
    }
  }

  shifts.sort(function(a, b) { return a.start.localeCompare(b.start); });
  return shifts;
}

function analyzePdfRectPage_(rects) {
  var grid = inferPdfBandGrid_(rects);
  if (!grid) return null;
  var candidateRects = rects.filter(function(rect) {
    return isActiveBandColor_(rect.color) && rect.h > 10 && rect.h < 25;
  });
  extendPdfBandGridToCoverRects_(grid, candidateRects);
  var minBandWidth = Math.max(3, grid.slotWidth * 0.35);

  var activeRects = candidateRects.filter(function(rect) {
    return rect.w >= minBandWidth;
  });
  if (activeRects.length === 0) return null;

  var rows = groupPdfBandRows_(activeRects);
  var dayBlocks = splitPdfBandDayBlocks_(rows).map(function(block) {
    return {
      rows: block.map(function(row) {
        var rawIntervals = row.rects.map(function(rect) {
          return {
            startSlot: findNearestPdfBandLineIndex_(rect.x1, grid.xLines),
            endSlot: findNearestPdfBandLineIndex_(rect.x2, grid.xLines),
            colors: [rect.color]
          };
        }).filter(function(interval) {
          return interval.endSlot > interval.startSlot;
        });
        var merged = mergePdfBandIntervals_(rawIntervals);
        return {
          y: row.y,
          intervals: merged.map(function(interval) {
            return {
              start: slotIndexToBandTime_(interval.startSlot),
              end: slotIndexToBandTime_(interval.endSlot)
            };
          })
        };
      })
    };
  }).filter(function(block) {
    return block.rows.some(function(row) { return row.intervals.length > 0; });
  });

  return { grid: grid, dayBlocks: dayBlocks };
}

function extendPdfBandGridToCoverRects_(grid, rects) {
  if (!grid || !grid.xLines || grid.xLines.length === 0 || !rects || rects.length === 0) return;

  var maxRectX = Math.max.apply(null, rects.map(function(rect) { return rect.x2; }));
  var lastLine = grid.xLines[grid.xLines.length - 1];
  var safety = 0;

  while (lastLine + (grid.slotWidth * 0.4) < maxRectX && safety < 24) {
    lastLine = Math.round((lastLine + grid.slotWidth) * 1000000) / 1000000;
    grid.xLines.push(lastLine);
    safety++;
  }
}

function inferPdfBandGrid_(rects) {
  var verticals = rects.filter(function(rect) {
    return isPdfBandBlack_(rect.color) && rect.w <= 2.0 && rect.h >= 15;
  });
  var xs = uniqueSortedPdfValues_(verticals.map(function(rect) { return rect.x2; }), 1.2);
  if (xs.length < 4) return null;

  var bestStart = -1;
  var bestEnd = -1;
  for (var i = 0; i < xs.length - 1; i++) {
    var j = i;
    while (j + 1 < xs.length) {
      var diff = xs[j + 1] - xs[j];
      if (diff < 8 || diff > 20) break;
      j++;
    }
    if ((j - i) > (bestEnd - bestStart)) {
      bestStart = i;
      bestEnd = j;
    }
  }

  if (bestStart < 0 || bestEnd - bestStart < 3) return null;
  var scheduleXs = xs.slice(bestStart, bestEnd + 1);
  var diffs = [];
  for (var di = 0; di < scheduleXs.length - 1; di++) {
    var step = scheduleXs[di + 1] - scheduleXs[di];
    if (step >= 8 && step <= 20) diffs.push(step);
  }
  if (diffs.length === 0) return null;
  diffs.sort(function(a, b) { return a - b; });

  return {
    startX: scheduleXs[0],
    slotWidth: diffs[Math.floor(diffs.length / 2)],
    xLines: scheduleXs
  };
}

function groupPdfBandRows_(activeRects) {
  var rows = [];
  var sorted = activeRects.slice().sort(function(a, b) {
    if (Math.abs(a.y1 - b.y1) > 0.01) return a.y1 - b.y1;
    return a.x1 - b.x1;
  });

  for (var i = 0; i < sorted.length; i++) {
    var rect = sorted[i];
    var row = null;
    for (var j = 0; j < rows.length; j++) {
      if (Math.abs(rows[j].y - rect.y1) <= 2.5) {
        row = rows[j];
        break;
      }
    }
    if (!row) {
      row = { y: rect.y1, rects: [] };
      rows.push(row);
    }
    row.rects.push(rect);
  }

  rows.sort(function(a, b) { return a.y - b.y; });
  return rows;
}

function splitPdfBandDayBlocks_(rows) {
  var blocks = [];
  var current = [];

  for (var i = 0; i < rows.length; i++) {
    if (current.length > 0 && (rows[i].y - current[current.length - 1].y) > 40) {
      blocks.push(current);
      current = [];
    }
    current.push(rows[i]);
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

function mergePdfBandIntervals_(intervals) {
  if (!intervals || intervals.length === 0) return [];
  var sorted = intervals.slice().sort(function(a, b) { return a.startSlot - b.startSlot; });
  var merged = [sorted[0]];

  for (var i = 1; i < sorted.length; i++) {
    var prev = merged[merged.length - 1];
    var curr = sorted[i];
    if (curr.startSlot <= prev.endSlot) {
      prev.endSlot = Math.max(prev.endSlot, curr.endSlot);
      prev.colors = prev.colors.concat(curr.colors);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function slotIndexToBandTime_(slotIndex) {
  var totalMinutes = PDF_BAND_START_HOUR * 60 + slotIndex * PDF_BAND_MINUTES_PER_SLOT;
  var hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  var minutes = String(totalMinutes % 60).padStart(2, '0');
  return hours + ':' + minutes;
}

function findNearestPdfBandLineIndex_(x, xLines) {
  var bestIndex = 0;
  var bestDistance = Infinity;
  for (var i = 0; i < xLines.length; i++) {
    var distance = Math.abs(xLines[i] - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function uniqueSortedPdfValues_(values, epsilon) {
  var sorted = values.slice().sort(function(a, b) { return a - b; });
  var result = [];
  for (var i = 0; i < sorted.length; i++) {
    if (result.length === 0 || Math.abs(sorted[i] - result[result.length - 1]) > epsilon) {
      result.push(sorted[i]);
    }
  }
  return result;
}

function parseColoredRectsFromPdfContent_(content) {
  var color = null;
  var currentPath = [];
  var subpaths = [];
  var rects = [];
  var lines = String(content || '').split(/\r?\n/);

  function flushFill_() {
    if (currentPath.length > 0) {
      subpaths.push(currentPath);
      currentPath = [];
    }
    if (!color) {
      subpaths = [];
      return;
    }

    for (var si = 0; si < subpaths.length; si++) {
      var points = subpaths[si];
      if (points.length < 4) continue;
      var box = getPdfPathBoundingBox_(points);
      box.w = box.x2 - box.x1;
      box.h = box.y2 - box.y1;
      box.color = color;
      rects.push(box);
    }
    subpaths = [];
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    var colorMatch = line.match(/^([0-9.]+) ([0-9.]+) ([0-9.]+) rg$/);
    if (colorMatch) {
      color = normalizePdfBandColor_([Number(colorMatch[1]), Number(colorMatch[2]), Number(colorMatch[3])]);
      currentPath = [];
      subpaths = [];
      continue;
    }

    var grayFillMatch = line.match(/^([0-9.]+) g$/);
    if (grayFillMatch) {
      var gray = Number(grayFillMatch[1]);
      color = normalizePdfBandColor_([gray, gray, gray]);
      currentPath = [];
      subpaths = [];
      continue;
    }

    var cmykFillMatch = line.match(/^([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+) k$/);
    if (cmykFillMatch) {
      color = normalizePdfBandColor_(convertPdfCmykToRgb_([
        Number(cmykFillMatch[1]),
        Number(cmykFillMatch[2]),
        Number(cmykFillMatch[3]),
        Number(cmykFillMatch[4])
      ]));
      currentPath = [];
      subpaths = [];
      continue;
    }

    var moveMatch = line.match(/^([0-9.]+) ([0-9.]+) m$/);
    if (moveMatch) {
      if (currentPath.length > 0) subpaths.push(currentPath);
      currentPath = [[Number(moveMatch[1]), Number(moveMatch[2])]];
      continue;
    }

    var lineMatch = line.match(/^([0-9.]+) ([0-9.]+) l$/);
    if (lineMatch) {
      currentPath.push([Number(lineMatch[1]), Number(lineMatch[2])]);
      continue;
    }

    var rectMatch = line.match(/^([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+) re$/);
    if (rectMatch) {
      if (currentPath.length > 0) subpaths.push(currentPath);
      var x = Number(rectMatch[1]);
      var y = Number(rectMatch[2]);
      var w = Number(rectMatch[3]);
      var h = Number(rectMatch[4]);
      currentPath = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      continue;
    }

    if (line === 'h') {
      if (currentPath.length > 0) {
        subpaths.push(currentPath);
        currentPath = [];
      }
      continue;
    }

    if (line === 'f' || line === 'f*' || line === 'B' || line === 'B*') {
      flushFill_();
    }
  }

  flushFill_();
  return rects;
}

function getPdfPathBoundingBox_(points) {
  var xs = [];
  var ys = [];
  for (var i = 0; i < points.length; i++) {
    xs.push(points[i][0]);
    ys.push(points[i][1]);
  }
  return {
    x1: Math.min.apply(null, xs),
    y1: Math.min.apply(null, ys),
    x2: Math.max.apply(null, xs),
    y2: Math.max.apply(null, ys)
  };
}

function normalizePdfBandColor_(color) {
  return color.map(function(value) {
    return Math.round(value * 1000000) / 1000000;
  });
}

function convertPdfCmykToRgb_(cmyk) {
  var c = cmyk[0];
  var m = cmyk[1];
  var y = cmyk[2];
  var k = cmyk[3];
  return [
    1 - Math.min(1, c + k),
    1 - Math.min(1, m + k),
    1 - Math.min(1, y + k)
  ];
}

function isPdfBandBlack_(color) {
  return color[0] < 0.05 && color[1] < 0.05 && color[2] < 0.05;
}

function isPdfBandGray_(color) {
  var max = Math.max(color[0], color[1], color[2]);
  var min = Math.min(color[0], color[1], color[2]);
  var avg = (color[0] + color[1] + color[2]) / 3;
  return (max - min) < 0.02 && avg > 0.7 && avg < 0.95;
}

function isActiveBandColor_(color) {
  return !isPdfBandBlack_(color) && !isPdfBandGray_(color);
}

function extractFlateStreamsFromPdfBytes_(pdfBytes) {
  var normalizedBytes = normalizePdfByteArray_(pdfBytes);
  var pdfText = bytesToPdfLatin1_(normalizedBytes);
  var streams = [];
  var pattern = /stream\r?\n/g;
  var match;

  while ((match = pattern.exec(pdfText)) !== null) {
    var start = match.index + match[0].length;
    var end = pdfText.indexOf('endstream', start);
    if (end < 0) continue;

    var rawBytes = normalizedBytes.slice(start, end);
    while (rawBytes.length > 0 && (rawBytes[rawBytes.length - 1] === 10 || rawBytes[rawBytes.length - 1] === 13)) {
      rawBytes.pop();
    }

    try {
      streams.push(bytesToPdfLatin1_(inflateZlibBytes_(rawBytes)));
    } catch (e) {
      // ignore non-Flate streams
    }
  }

  return streams;
}

function normalizePdfByteArray_(bytes) {
  var result = new Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] & 255;
  }
  return result;
}

function bytesToPdfLatin1_(bytes) {
  var chunks = [];
  var chunkSize = 8192;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var slice = bytes.slice(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, slice));
  }
  return chunks.join('');
}

function inflateZlibBytes_(bytes) {
  if (!bytes || bytes.length < 2) throw new Error('Invalid zlib header');

  var cmf = bytes[0];
  var flg = bytes[1];
  if ((cmf & 15) !== 8) throw new Error('Unsupported zlib compression method');
  if ((((cmf << 8) + flg) % 31) !== 0) throw new Error('Invalid zlib checksum');

  var offset = 2;
  if (flg & 32) offset += 4;

  initFixedPdfBandTrees_();

  var reader = new PdfBandBitReader_(bytes, offset);
  var output = [];
  var isFinal = false;

  while (!isFinal) {
    isFinal = reader.readBits(1) === 1;
    var blockType = reader.readBits(2);

    if (blockType === 0) {
      reader.alignByte();
      var len = reader.readBits(16);
      var nlen = reader.readBits(16);
      if (((len ^ 65535) & 65535) !== (nlen & 65535)) {
        throw new Error('Stored block length mismatch');
      }
      for (var si = 0; si < len; si++) {
        output.push(reader.readBits(8));
      }
      continue;
    }

    if (blockType !== 1 && blockType !== 2) {
      throw new Error('Unsupported deflate block type: ' + blockType);
    }

    var trees = blockType === 1 ? {
      litTree: PDF_BAND_FIXED_LIT_TREE,
      distTree: PDF_BAND_FIXED_DIST_TREE
    } : buildDynamicPdfBandTrees_(reader);

    while (true) {
      var symbol = decodePdfBandSymbol_(reader, trees.litTree);
      if (symbol < 256) {
        output.push(symbol);
        continue;
      }
      if (symbol === 256) break;

      var lengthIndex = symbol - 257;
      if (lengthIndex < 0 || lengthIndex >= PDF_BAND_LENGTH_BASE.length) {
        throw new Error('Invalid length symbol: ' + symbol);
      }

      var copyLength = PDF_BAND_LENGTH_BASE[lengthIndex];
      var lengthExtra = PDF_BAND_LENGTH_EXTRA[lengthIndex];
      if (lengthExtra > 0) copyLength += reader.readBits(lengthExtra);

      var distSymbol = decodePdfBandSymbol_(reader, trees.distTree);
      if (distSymbol < 0 || distSymbol >= PDF_BAND_DIST_BASE.length) {
        throw new Error('Invalid distance symbol: ' + distSymbol);
      }

      var distance = PDF_BAND_DIST_BASE[distSymbol];
      var distExtra = PDF_BAND_DIST_EXTRA[distSymbol];
      if (distExtra > 0) distance += reader.readBits(distExtra);
      if (distance > output.length) throw new Error('Invalid copy distance');

      for (var ci = 0; ci < copyLength; ci++) {
        output.push(output[output.length - distance]);
      }
    }
  }

  return output;
}

function PdfBandBitReader_(bytes, offset) {
  this.bytes = bytes;
  this.pos = offset || 0;
  this.bitBuffer = 0;
  this.bitCount = 0;
}

PdfBandBitReader_.prototype.readBits = function(n) {
  while (this.bitCount < n) {
    if (this.pos >= this.bytes.length) throw new Error('deflate EOF');
    this.bitBuffer |= (this.bytes[this.pos++] & 255) << this.bitCount;
    this.bitCount += 8;
  }
  var mask = n === 32 ? 4294967295 : ((1 << n) - 1);
  var value = this.bitBuffer & mask;
  this.bitBuffer >>>= n;
  this.bitCount -= n;
  return value;
};

PdfBandBitReader_.prototype.alignByte = function() {
  this.bitBuffer = 0;
  this.bitCount = 0;
};

function initFixedPdfBandTrees_() {
  if (PDF_BAND_FIXED_LIT_TREE && PDF_BAND_FIXED_DIST_TREE) return;

  var litLengths = [];
  for (var i = 0; i <= 287; i++) {
    if (i <= 143) litLengths[i] = 8;
    else if (i <= 255) litLengths[i] = 9;
    else if (i <= 279) litLengths[i] = 7;
    else litLengths[i] = 8;
  }

  var distLengths = [];
  for (var di = 0; di < 32; di++) distLengths[di] = 5;

  PDF_BAND_FIXED_LIT_TREE = buildPdfBandHuffmanTree_(litLengths);
  PDF_BAND_FIXED_DIST_TREE = buildPdfBandHuffmanTree_(distLengths);
}

function buildDynamicPdfBandTrees_(reader) {
  var hlit = reader.readBits(5) + 257;
  var hdist = reader.readBits(5) + 1;
  var hclen = reader.readBits(4) + 4;
  var codeLengths = new Array(19);
  for (var i = 0; i < codeLengths.length; i++) codeLengths[i] = 0;

  for (var ci = 0; ci < hclen; ci++) {
    codeLengths[PDF_BAND_CODE_LENGTH_ORDER[ci]] = reader.readBits(3);
  }

  var codeTree = buildPdfBandHuffmanTree_(codeLengths);
  var allLengths = [];

  while (allLengths.length < hlit + hdist) {
    var symbol = decodePdfBandSymbol_(reader, codeTree);
    if (symbol <= 15) {
      allLengths.push(symbol);
    } else if (symbol === 16) {
      var repeatPrev = reader.readBits(2) + 3;
      var prev = allLengths.length > 0 ? allLengths[allLengths.length - 1] : 0;
      while (repeatPrev-- > 0) allLengths.push(prev);
    } else if (symbol === 17) {
      var repeatZeroShort = reader.readBits(3) + 3;
      while (repeatZeroShort-- > 0) allLengths.push(0);
    } else if (symbol === 18) {
      var repeatZeroLong = reader.readBits(7) + 11;
      while (repeatZeroLong-- > 0) allLengths.push(0);
    } else {
      throw new Error('Invalid code-length symbol: ' + symbol);
    }
  }

  var litLengths = allLengths.slice(0, hlit);
  var distLengths = allLengths.slice(hlit, hlit + hdist);
  while (litLengths.length < 286) litLengths.push(0);
  while (distLengths.length < 30) distLengths.push(0);

  return {
    litTree: buildPdfBandHuffmanTree_(litLengths),
    distTree: buildPdfBandHuffmanTree_(distLengths)
  };
}

function buildPdfBandHuffmanTree_(lengths) {
  var maxBits = 0;
  var minBits = 999;
  var counts = [];
  var nextCode = [];
  var table = {};

  for (var i = 0; i < lengths.length; i++) {
    var len = lengths[i] || 0;
    if (len === 0) continue;
    counts[len] = (counts[len] || 0) + 1;
    if (len > maxBits) maxBits = len;
    if (len < minBits) minBits = len;
  }

  if (maxBits === 0) return { table: table, minBits: 0, maxBits: 0 };

  counts[0] = counts[0] || 0;
  var code = 0;
  for (var bits = 1; bits <= maxBits; bits++) {
    code = (code + (counts[bits - 1] || 0)) << 1;
    nextCode[bits] = code;
  }

  for (var symbol = 0; symbol < lengths.length; symbol++) {
    var symbolLen = lengths[symbol] || 0;
    if (symbolLen === 0) continue;
    var assigned = nextCode[symbolLen]++;
    var reversed = reversePdfBandBits_(assigned, symbolLen);
    table[symbolLen + ':' + reversed] = symbol;
  }

  return { table: table, minBits: minBits, maxBits: maxBits };
}

function decodePdfBandSymbol_(reader, tree) {
  var code = 0;
  for (var len = 1; len <= tree.maxBits; len++) {
    code |= reader.readBits(1) << (len - 1);
    var key = len + ':' + code;
    if (Object.prototype.hasOwnProperty.call(tree.table, key)) {
      return tree.table[key];
    }
  }
  throw new Error('Huffman decode failed');
}

function reversePdfBandBits_(code, bitLength) {
  var reversed = 0;
  for (var i = 0; i < bitLength; i++) {
    reversed = (reversed << 1) | (code & 1);
    code >>>= 1;
  }
  return reversed;
}

function getOcrNamePatterns_() {
  var chars = '[\\u3005\\u3040-\\u9FFF\\uF900-\\uFAFF\\u{20000}-\\u{2FA1F}a-zA-Z々ァ-ヶー-]';
  return {
    spaced: new RegExp('^' + chars + '+\\s+' + chars + '+$', 'u'),
    unspaced: new RegExp('^' + chars + '{3,8}$', 'u'),
    valid: new RegExp('^' + chars + '+$', 'u')
  };
}

// Override: keep the existing flow, but allow names like "奈々子" and
// avoid carrying stray task rows from the block header into the first staff rows.
function extractOcrRowsFromBlock_(blockLines) {
  var skipKeywords = ['スタッフ', '開始・終了', '時刻', '計:', 'ジョブカン', '管理画面'];
  var taskKeywords = ['清掃', '在報', '棚卸', '発注', '研修', 'MTG', 'ミーティング', '引継', '営業中研修', 'OP研修'];
  var patterns = getOcrNamePatterns_();
  var standaloneNames = [];
  var standaloneTasks = [];
  var inlineRows = [];
  var hasSeenStaffRow = false;

  for (var i = 0; i < blockLines.length; i++) {
    var trimmed = normalizePdfLine_(blockLines[i]);
    if (!trimmed) continue;
    if (trimmed.indexOf('http') === 0) continue;
    if (/^\d+(?:\/\d+)?$/.test(trimmed)) continue;
    if (skipKeywords.some(function(kw) { return trimmed.indexOf(kw) !== -1; })) continue;

    var timeRanges = extractTimeRanges_(trimmed);
    if (timeRanges.length > 0) {
      var firstRange = timeRanges[0];
      var lastRange = timeRanges[timeRanges.length - 1];
      var namePartRaw = trimmed.substring(0, firstRange.index).trim();
      var namePart = namePartRaw.replace(/\s+/g, '');
      var afterTime = trimmed.substring(lastRange.index + lastRange.raw.length).trim();
      var isValidName = namePart && patterns.valid.test(namePart) &&
        !taskKeywords.some(function(kw) { return namePart.indexOf(kw) !== -1; });
      if (isValidName) {
        inlineRows.push({
          name: namePart,
          tasks: extractTasks(namePartRaw + ' ' + afterTime, taskKeywords)
        });
        hasSeenStaffRow = true;
      }
      continue;
    }

    var lineTasks = extractTasks(trimmed, taskKeywords);
    if (lineTasks.length > 0) {
      if (!hasSeenStaffRow) continue;
      standaloneTasks.push(lineTasks);
      continue;
    }

    if (patterns.spaced.test(trimmed) || patterns.unspaced.test(trimmed)) {
      standaloneNames.push(trimmed.replace(/\s+/g, ''));
      hasSeenStaffRow = true;
    }
  }

  if (standaloneNames.length === 0) return inlineRows;

  var rows = [];
  for (var ni = 0; ni < standaloneNames.length; ni++) {
    rows.push({
      name: standaloneNames[ni],
      tasks: standaloneTasks[ni] || []
    });
  }
  return rows.length >= inlineRows.length ? rows : inlineRows;
}
