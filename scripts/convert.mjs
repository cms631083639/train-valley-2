// 飞书导出 xlsx → 工具内置 JSON（src/data/tv2.json）
// 用法：node scripts/convert.mjs "train valley 2.xlsx"
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';
import fields from './feishu-fields.cjs';
import { CONTENT, CONSTRAINT_COLS } from '../shared/enums.js';

const {
  SHEETS, INSTANCE_FIELDS, LEVEL_FIELDS, GOAL_FIELDS, TRAIN_FIELDS,
} = fields;

const file = process.argv[2] || 'train valley 2.xlsx';
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });

/** 工作表 → 以第一行为 key 的对象数组 */
function sheetRows(name) {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

const s = (v) => String(v ?? '').trim();
const num = (v) => {
  const n = Number(s(v));
  return s(v) === '' || Number.isNaN(n) ? null : n;
};

/** 取一列的值：字段定义是别名数组，命中第一个存在的列名（缺失回落 ''） */
function cell(row, def) {
  for (const key of def) if (row[key] !== undefined) return row[key];
  return '';
}

// ---------- 物资主表 → ResourceInstance ----------
const instances = sheetRows(SHEETS.INSTANCES)
  .filter((r) => s(cell(r, INSTANCE_FIELDS.NAME)) !== '')
  .map((r) => ({
    id: s(cell(r, INSTANCE_FIELDS.ID)),
    name: s(cell(r, INSTANCE_FIELDS.NAME)),
    inputs: s(cell(r, INSTANCE_FIELDS.RECIPE)).split(/[,，]/).map(s).filter(Boolean),
    external: s(cell(r, INSTANCE_FIELDS.EXTERNAL)) === '1',
    obtain: s(cell(r, INSTANCE_FIELDS.OBTAIN)) || null,
    needsPower: s(cell(r, INSTANCE_FIELDS.NEEDS_POWER)) === '1',
    perOut: num(cell(r, INSTANCE_FIELDS.PER_OUT)) ?? 1,
    perIn: num(cell(r, INSTANCE_FIELDS.PER_IN)) ?? 1,
    totalPrice: num(cell(r, INSTANCE_FIELDS.TOTAL_PRICE)) ?? 0,
  }));

// ---------- 关卡 → Level（constraints 只保留非空列） ----------
const goalRows = sheetRows(SHEETS.GOALS).filter(
  (r) => s(cell(r, GOAL_FIELDS.LEVEL)) !== '' && s(cell(r, GOAL_FIELDS.RESOURCE)) !== '',
);

const levels = sheetRows(SHEETS.LEVELS)
  .filter((r) => s(cell(r, LEVEL_FIELDS.NAME)) !== '')
  .map((r) => {
    const constraints = {};
    for (const c of CONSTRAINT_COLS) {
      const v = s(cell(r, [c]));
      if (v !== '') constraints[c] = v;
    }
    const name = s(cell(r, LEVEL_FIELDS.NAME));
    return {
      id: name,
      name,
      contentType: s(cell(r, LEVEL_FIELDS.CONTENT_TYPE)),
      category: s(cell(r, LEVEL_FIELDS.CONTENT_CATEGORY)) === CONTENT.BASE ? CONTENT.BASE : CONTENT.DLC,
      chapter: s(cell(r, LEVEL_FIELDS.CHAPTER)),
      seconds: num(cell(r, LEVEL_FIELDS.SECONDS)),
      bestTime: s(cell(r, LEVEL_FIELDS.BEST_TIME)),
      earn: s(cell(r, LEVEL_FIELDS.EARN)),
      spend: s(cell(r, LEVEL_FIELDS.SPEND)),
      constraints,
      goals: goalRows
        .filter((g) => s(cell(g, GOAL_FIELDS.LEVEL)) === name)
        .map((g) => ({
          resourceId: s(cell(g, GOAL_FIELDS.RESOURCE)),
          qty: num(cell(g, GOAL_FIELDS.QTY)) ?? 1,
        })),
    };
  });

// ---------- 列车 → TrainLevel ----------
const trains = sheetRows(SHEETS.TRAINS)
  .filter((r) => s(cell(r, TRAIN_FIELDS.LEVEL)) !== '')
  .map((r) => ({
    level: num(cell(r, TRAIN_FIELDS.LEVEL)) ?? 0,
    capacity: num(cell(r, TRAIN_FIELDS.CAPACITY)) ?? 0,
    price: num(cell(r, TRAIN_FIELDS.PRICE)) ?? 0,
    upgrade: num(cell(r, TRAIN_FIELDS.UPGRADE)),
    upgradable: s(cell(r, TRAIN_FIELDS.UPGRADABLE)) === '1',
  }));

const data = { instances, levels, trains };
writeFileSync('src/data/tv2.json', JSON.stringify(data), 'utf8');
console.log(`instances=${instances.length} levels=${levels.length} (本体=${levels.filter((l) => l.category === CONTENT.BASE).length}) trains=${trains.length} goals=${goalRows.length}`);
