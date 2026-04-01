#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function usage() {
  console.log('Usage: node tools/parse-shift-bands.js <pdf-path> [--start-hour=9] [--minutes-per-slot=10]');
}

function parseArgs(argv) {
  const args = { pdfPath: '', startHour: 9, minutesPerSlot: 10 };
  for (const token of argv.slice(2)) {
    if (token.startsWith('--start-hour=')) {
      args.startHour = Number(token.split('=')[1] || '9');
    } else if (token.startsWith('--minutes-per-slot=')) {
      args.minutesPerSlot = Number(token.split('=')[1] || '10');
    } else if (!args.pdfPath) {
      args.pdfPath = token;
    }
  }
  return args;
}

function extractStreams(buffer) {
  const streams = [];
  const pattern = /stream\r?\n/g;
  let match;
  while ((match = pattern.exec(buffer.toString('latin1'))) !== null) {
    const start = match.index + match[0].length;
    const end = buffer.indexOf(Buffer.from('endstream'), start);
    if (end < 0) continue;
    const raw = buffer.subarray(start, end).toString('latin1').replace(/[\r\n]+$/, '');
    try {
      streams.push(zlib.inflateSync(Buffer.from(raw, 'latin1')).toString('latin1'));
    } catch (e) {
      // ignore non-Flate streams
    }
  }
  return streams;
}

function isNearly(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}

function normalizeColor(color) {
  return color.map(function(v) { return Math.round(v * 1000000) / 1000000; });
}

function isBlack(color) {
  return color[0] < 0.05 && color[1] < 0.05 && color[2] < 0.05;
}

function isGray(color) {
  const max = Math.max(color[0], color[1], color[2]);
  const min = Math.min(color[0], color[1], color[2]);
  const avg = (color[0] + color[1] + color[2]) / 3;
  return (max - min) < 0.02 && avg > 0.7 && avg < 0.95;
}

function isActiveColor(color) {
  return !isBlack(color) && !isGray(color);
}

function bbox(points) {
  const xs = points.map(function(p) { return p[0]; });
  const ys = points.map(function(p) { return p[1]; });
  return {
    x1: Math.min.apply(null, xs),
    y1: Math.min.apply(null, ys),
    x2: Math.max.apply(null, xs),
    y2: Math.max.apply(null, ys)
  };
}

function parseRects(content) {
  let color = null;
  let currentPath = [];
  let subpaths = [];
  const rects = [];

  function flushFill() {
    if (currentPath.length) {
      subpaths.push(currentPath);
      currentPath = [];
    }
    if (!color) {
      subpaths = [];
      return;
    }
    for (const points of subpaths) {
      if (points.length < 4) continue;
      const box = bbox(points);
      box.w = box.x2 - box.x1;
      box.h = box.y2 - box.y1;
      box.color = color;
      rects.push(box);
    }
    subpaths = [];
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let m = line.match(/^([0-9.]+) ([0-9.]+) ([0-9.]+) rg$/);
    if (m) {
      color = normalizeColor([Number(m[1]), Number(m[2]), Number(m[3])]);
      currentPath = [];
      subpaths = [];
      continue;
    }

    m = line.match(/^([0-9.]+) ([0-9.]+) m$/);
    if (m) {
      if (currentPath.length) subpaths.push(currentPath);
      currentPath = [[Number(m[1]), Number(m[2])]];
      continue;
    }

    m = line.match(/^([0-9.]+) ([0-9.]+) l$/);
    if (m) {
      currentPath.push([Number(m[1]), Number(m[2])]);
      continue;
    }

    m = line.match(/^([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+) re$/);
    if (m) {
      if (currentPath.length) subpaths.push(currentPath);
      const x = Number(m[1]);
      const y = Number(m[2]);
      const w = Number(m[3]);
      const h = Number(m[4]);
      currentPath = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      continue;
    }

    if (line === 'h') {
      if (currentPath.length) {
        subpaths.push(currentPath);
        currentPath = [];
      }
      continue;
    }

    if (line === 'f' || line === 'f*' || line === 'B' || line === 'B*') {
      flushFill();
    }
  }

  flushFill();
  return rects;
}

function uniqueSorted(values, epsilon) {
  const sorted = values.slice().sort(function(a, b) { return a - b; });
  const result = [];
  for (const value of sorted) {
    if (!result.length || !isNearly(value, result[result.length - 1], epsilon)) {
      result.push(value);
    }
  }
  return result;
}

function inferGrid(rects) {
  const verticals = rects.filter(function(rect) {
    return isBlack(rect.color) && rect.w <= 2.0 && rect.h >= 15;
  });
  const xs = uniqueSorted(verticals.map(function(rect) { return rect.x2; }), 1.2);
  if (xs.length < 4) return null;

  let bestStart = -1;
  let bestEnd = -1;
  for (let i = 0; i < xs.length - 1; i++) {
    let j = i;
    while (j + 1 < xs.length) {
      const diff = xs[j + 1] - xs[j];
      if (diff < 8 || diff > 20) break;
      j++;
    }
    if ((j - i) > (bestEnd - bestStart)) {
      bestStart = i;
      bestEnd = j;
    }
  }

  if (bestStart < 0 || bestEnd - bestStart < 3) return null;
  const scheduleXs = xs.slice(bestStart, bestEnd + 1);
  const diffs = [];
  for (let i = 0; i < scheduleXs.length - 1; i++) {
    const diff = scheduleXs[i + 1] - scheduleXs[i];
    if (diff >= 8 && diff <= 20) diffs.push(diff);
  }
  if (!diffs.length) return null;
  diffs.sort(function(a, b) { return a - b; });
  const slotWidth = diffs[Math.floor(diffs.length / 2)];
  return { startX: scheduleXs[0], slotWidth: slotWidth, xLines: scheduleXs };
}

function groupRows(activeRects) {
  const rows = [];
  const sorted = activeRects.slice().sort(function(a, b) {
    if (Math.abs(a.y1 - b.y1) > 0.01) return a.y1 - b.y1;
    return a.x1 - b.x1;
  });

  for (const rect of sorted) {
    let row = rows.find(function(item) { return isNearly(item.y, rect.y1, 2.5); });
    if (!row) {
      row = { y: rect.y1, rects: [] };
      rows.push(row);
    }
    row.rects.push(rect);
  }

  rows.sort(function(a, b) { return a.y - b.y; });
  return rows;
}

function splitDayBlocks(rows) {
  const blocks = [];
  let current = [];
  for (const row of rows) {
    if (current.length && (row.y - current[current.length - 1].y) > 40) {
      blocks.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function slotToTime(slotIndex, startHour, minutesPerSlot) {
  const totalMinutes = Math.round(startHour * 60 + slotIndex * minutesPerSlot);
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return hours + ':' + minutes;
}

function findNearestLineIndex(x, xLines) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < xLines.length; i++) {
    const distance = Math.abs(xLines[i] - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = intervals.slice().sort(function(a, b) { return a.startSlot - b.startSlot; });
  const merged = [Object.assign({}, sorted[0])];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.startSlot <= prev.endSlot) {
      prev.endSlot = Math.max(prev.endSlot, curr.endSlot);
      prev.colors = prev.colors.concat(curr.colors);
    } else {
      merged.push(Object.assign({}, curr));
    }
  }
  return merged;
}

function analyzePage(rects, startHour, minutesPerSlot) {
  const grid = inferGrid(rects);
  const activeRects = rects.filter(function(rect) {
    return isActiveColor(rect.color) && rect.w > 20 && rect.h > 10 && rect.h < 25;
  });
  const rows = groupRows(activeRects);
  const dayBlocks = splitDayBlocks(rows);

  return {
    grid: grid,
    dayBlocks: dayBlocks.map(function(block, blockIndex) {
      return {
        index: blockIndex + 1,
        rows: block.map(function(row, rowIndex) {
          const rawIntervals = row.rects.map(function(rect) {
            const startSlot = grid ? findNearestLineIndex(rect.x1, grid.xLines) : null;
            const endSlot = grid ? findNearestLineIndex(rect.x2, grid.xLines) : null;
            return {
              startSlot: startSlot,
              endSlot: endSlot,
              colors: [rect.color]
            };
          }).filter(function(interval) {
            return interval.startSlot !== null && interval.endSlot !== null && interval.endSlot > interval.startSlot;
          });
          const merged = mergeIntervals(rawIntervals);
          return {
            row: rowIndex + 1,
            y: Math.round(row.y * 100) / 100,
            intervals: merged.map(function(interval) {
              return {
                start: slotToTime(interval.startSlot, startHour, minutesPerSlot),
                end: slotToTime(interval.endSlot, startHour, minutesPerSlot),
                segmentCount: interval.colors.length
              };
            })
          };
        })
      };
    })
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.pdfPath) {
    usage();
    process.exit(1);
  }

  const absolutePath = path.resolve(args.pdfPath);
  const buffer = fs.readFileSync(absolutePath);
  const streams = extractStreams(buffer);
  const pages = [];

  for (const stream of streams) {
    const rects = parseRects(stream);
    const activeCount = rects.filter(function(rect) { return isActiveColor(rect.color) && rect.w > 20 && rect.h > 10 && rect.h < 25; }).length;
    if (activeCount === 0) continue;
    pages.push(analyzePage(rects, args.startHour, args.minutesPerSlot));
  }

  console.log(JSON.stringify({
    pdf: absolutePath,
    pageCount: pages.length,
    pages: pages
  }, null, 2));
}

main();
