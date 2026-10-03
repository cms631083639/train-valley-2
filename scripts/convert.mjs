// 飞书导出 xlsx → 工具内置 JSON（src/data/tv2.json）
// 用法：node scripts/convert.mjs "train valley 2.xlsx"
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';

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

// ---------- 物资主表 → ResourceInstance ----------
const instances = sheetRows('物资主表')
  .filter((r) => s(r['物资名称']) !== '')
  .map((r) => ({
    id: s(r['物资ID']),
    name: s(r['物资名称']),
    inputs: s(r['配方物资类型']).split(/[,，]/).map(s).filter(Boolean),
    external: s(r['外部获取']) === '1',
    obtain: s(r['获取方式']) || null,
    needsPower: s(r['电力依赖']) === '1',
    perOut: num(r['单次产出']) ?? 1,
    perIn: num(r['单次消耗']) ?? 1,
  }));

// ---------- 关卡 → Level（constraints 只保留非空列） ----------
const CONSTRAINT_COLS = [
  '运送列车', '不停车', '不掉头', '不升车', '买车限制',
  '避免碰撞', '碰撞数量', '避免错站', '进错站数',
  '不摧毁物品', '摧毁物价值', '不摧毁铺片', '铺片限制',
  '不造桥', '桥梁限制', '建造桥梁', '不造隧道', '隧道限制', '建造隧道',
];

const goalRows = sheetRows('关卡目标').filter(
  (r) => s(r['关卡']) !== '' && s(r['目标物资']) !== '',
);

const levels = sheetRows('关卡')
  .filter((r) => s(r['名称']) !== '')
  .map((r) => {
    const constraints = {};
    for (const c of CONSTRAINT_COLS) if (s(r[c]) !== '') constraints[c] = s(r[c]);
    const name = s(r['名称']);
    return {
      id: name,
      name,
      contentType: s(r['内容类型']),
      category: s(r['内容分类']) === '游戏本体' ? '游戏本体' : 'DLC',
      chapter: s(r['章节']),
      seconds: num(r['秒数']),
      bestTime: s(r['最佳时间']),
      earn: s(r['挣钱']),
      spend: s(r['花钱']),
      constraints,
      goals: goalRows
        .filter((g) => s(g['关卡']) === name)
        .map((g) => ({ resourceId: s(g['目标物资']), qty: num(g['数量']) ?? 1 })),
    };
  });

// ---------- 列车 → TrainLevel ----------
const trains = sheetRows('列车')
  .filter((r) => s(r['等级']) !== '')
  .map((r) => ({
    level: num(r['等级']) ?? 0,
    capacity: num(r['载货量']) ?? 0,
    price: num(r['价格']) ?? 0,
    upgrade: num(r['升级']),
    upgradable: s(r['可升级']) === '1',
  }));

const data = { instances, levels, trains };
writeFileSync('src/data/tv2.json', JSON.stringify(data), 'utf8');
console.log(`instances=${instances.length} levels=${levels.length} (本体=${levels.filter((l) => l.category === '游戏本体').length}) trains=${trains.length} goals=${goalRows.length}`);
