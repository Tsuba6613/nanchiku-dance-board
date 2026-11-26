// Counts today's absence/late/early-leave reports from the form response
// sheet and writes counts.json. Mirrors the board page logic in index.html:
// Asia/Tokyo today filter, latest submission wins per person+grade+date+type,
// and the same excluded test rows.
import { writeFile } from 'node:fs/promises';

const SHEET_ID = '1G8Ilv3xgviYQTzijVA3FcS7WhXfe8PbgHwdk6igkd4s';
const GID = '688626295';
const TYPES = ['欠席', '遅刻', '早退'];
const EXCLUDED_ROWS = [
  { name: '南筑太郎', grade: '2年', date: '11-20', type: '遅刻' },
  { name: '久保 結愛琉', grade: '1年', date: '12-25', type: '遅刻' },
];

const pad = (n) => String(n).padStart(2, '0');

function todayParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return { year: map.year, month: map.month, day: map.day, key: `${map.month}-${map.day}` };
}

function cellValue(cell) {
  if (!cell) return '';
  if (cell.v !== undefined && cell.v !== null) return cell.v;
  if (cell.f !== undefined && cell.f !== null) return cell.f;
  return '';
}

function parseGvizDate(value, formatted) {
  if (typeof value === 'string' && value.startsWith('Date(')) {
    const nums = value.match(/\d+/g) || [];
    if (nums.length >= 3) {
      return new Date(+nums[0], +nums[1], +nums[2], +(nums[3] || 0), +(nums[4] || 0), +(nums[5] || 0)).getTime();
    }
  }
  const text = String(formatted || value || '').trim();
  const m = text.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeDateCell(cell) {
  const value = cellValue(cell);
  const formatted = cell && cell.f ? cell.f : '';
  if (typeof value === 'string' && value.startsWith('Date(')) {
    const nums = value.match(/\d+/g) || [];
    if (nums.length >= 3) return `${pad(+nums[1] + 1)}-${pad(+nums[2])}`;
  }
  const text = String(value || formatted || '').trim();
  let m = text.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return `${pad(+m[2])}-${pad(+m[3])}`;
  m = text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return `${pad(+m[1])}-${pad(+m[2])}`;
  m = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) return `${pad(+m[1])}-${pad(+m[2])}`;
  return text;
}

const isExcluded = (row) => EXCLUDED_ROWS.some(
  (ex) => row.name === ex.name && row.grade === ex.grade && row.date === ex.date && row.type === ex.type,
);

function parseRows(resp) {
  const rows = (resp && resp.table && resp.table.rows) || [];
  const parsed = [];
  rows.forEach((row, index) => {
    const c = (row && row.c) || [];
    const item = {
      timestamp: parseGvizDate(cellValue(c[0]), c[0] && c[0].f),
      index,
      name: String(cellValue(c[1]) || '').trim(),
      grade: String(cellValue(c[2]) || '').trim(),
      date: normalizeDateCell(c[3]),
      type: String(cellValue(c[4]) || '').trim(),
    };
    if (item.name && TYPES.includes(item.type)) parsed.push(item);
  });
  return parsed;
}

async function main() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`gviz fetch failed: ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

  const today = todayParts();
  const byKey = new Map();
  for (const row of parseRows(json)) {
    if (row.date !== today.key || isExcluded(row)) continue;
    const key = [row.name, row.grade, row.date, row.type].join('|');
    const prev = byKey.get(key);
    if (!prev || row.timestamp > prev.timestamp || (row.timestamp === prev.timestamp && row.index > prev.index)) {
      byKey.set(key, row);
    }
  }
  const counts = { '欠席': 0, '遅刻': 0, '早退': 0 };
  for (const row of byKey.values()) counts[row.type] += 1;

  const out = {
    date: `${today.year}-${today.month}-${today.day}`,
    absent: counts['欠席'],
    late: counts['遅刻'],
    early: counts['早退'],
    total: byKey.size,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(new URL('../counts.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
  await writeFile(new URL('../counts.js', import.meta.url), `window.__nanchikuCounts = ${JSON.stringify(out)};\n`);
  console.log(JSON.stringify(out));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
