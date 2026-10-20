/**
 * 从飞书 Base 导出的 NDJSON（《物资类型》表）同步「物资名 → 单价」到 tv2.json 的 prices。
 * 用法：先跑 lark-cli base +record-list 下载 tbl6frIpsaHs4i6P_*.ndjson，再 node scripts/sync-prices.cjs
 */
const fs = require('fs');
const path = require('path');
const { TABLES, TYPE_FIELDS, text, num } = require('./feishu-fields.cjs');

const ROOT = path.resolve(__dirname, '..');
const files = fs.readdirSync(ROOT).filter((f) => f.startsWith(`${TABLES.TYPES}_`) && f.endsWith('.ndjson'));
files.sort((a, b) => fs.statSync(path.join(ROOT, b)).mtimeMs - fs.statSync(path.join(ROOT, a)).mtimeMs);
const NDJSON = path.join(ROOT, files[0]);
console.log(`使用 record 文件: ${files[0]}`);
const TV2 = path.join(ROOT, 'src/data/tv2.json');

// —— 1. 解析 NDJSON ——
const lines = fs.readFileSync(NDJSON, 'utf8').trim().split('\n').filter((l) => l.trim());
console.log(`NDJSON 有效记录: ${lines.length}`);

const prices = {};
for (const l of lines) {
  const rec = JSON.parse(l);
  const name = text(rec, TYPE_FIELDS.NAME); // 物资类型[0] = 物资名
  const price = Number(num(rec, TYPE_FIELDS.PRICE, 0)) || 0;
  if (name) prices[name] = price;
}

// —— 2. 加载本地 tv2.json，只更新 prices，其余字段与缩进保持不变 ——
let tv2Raw = fs.readFileSync(TV2, 'utf8');
if (tv2Raw.charCodeAt(0) === 0xfeff) tv2Raw = tv2Raw.substring(1);
const tv2 = JSON.parse(tv2Raw);

const before = Object.keys(tv2.prices ?? {}).length;
tv2.prices = prices;
fs.writeFileSync(TV2, JSON.stringify(tv2, null, 2), 'utf8');
console.log(`\n✅ prices 已更新: ${before} → ${Object.keys(prices).length} 项 (${fs.statSync(TV2).size} bytes)`);
