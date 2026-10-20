// 从本地已下载的飞书 Base ndjson 文件同步关卡目标到 src/data/tv2.json
// 前置：先用 lark-cli 下载最新的 3 张表（关卡、物资主表、关卡目标）
//    lark-cli base +record-list --base-token 'GwhybMnDVaxyoesbxM5copADnQf' \
//      --table-id <TABLES.LEVELS>     --as user --page-size 300 --format ndjson
//    lark-cli base +record-list --base-token 'GwhybMnDVaxyoesbxM5copADnQf' \
//      --table-id <TABLES.INSTANCES>  --as user --page-size 300 --format ndjson
//    lark-cli base +record-list --base-token 'GwhybMnDVaxyoesbxM5copADnQf' \
//      --table-id <TABLES.GOALS>      --as user --page-size 300 --format ndjson
//   （表 ID 见 scripts/feishu-fields.cjs）
// 用法：node scripts/sync-goals.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fields from './feishu-fields.cjs';

const { TABLES, INSTANCE_FIELDS, LEVEL_FIELDS, GOAL_FIELDS, text, num, links } = fields;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function latestNdjson(prefix) {
  const files = readdirSync(ROOT).filter(
    (f) => f.startsWith(prefix) && f.endsWith('.ndjson'),
  );
  if (!files.length) {
    console.error(`❌ 找不到 ${prefix} 开头的 ndjson 文件，请先下载飞书 Base 数据`);
    process.exit(1);
  }
  files.sort();
  return join(ROOT, files[files.length - 1]);
}

function parseNdjson(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim());
  const records = [];
  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj.record_id) records.push(obj);
  }
  return records;
}

console.log('📥 读取本地 ndjson 文件…');
const lvlFile = latestNdjson(TABLES.LEVELS);
const instFile = latestNdjson(TABLES.INSTANCES);
const goalFile = latestNdjson(TABLES.GOALS);
console.log('  关卡表 →', lvlFile.split(/[\\/]/).pop());
console.log('  物资表 →', instFile.split(/[\\/]/).pop());
console.log('  目标表 →', goalFile.split(/[\\/]/).pop());

const lvlRecs = parseNdjson(lvlFile);
const instRecs = parseNdjson(instFile);
const goalRecs = parseNdjson(goalFile);
console.log(`✅ 关卡 ${lvlRecs.length} · 物资 ${instRecs.length} · 目标 ${goalRecs.length}`);

// 映射：飞书 record_id → 本地标识
const lvlMap = new Map(lvlRecs.map((r) => [r.record_id, text(r, LEVEL_FIELDS.NAME).trim()]));
const instMap = new Map(instRecs.map((r) => [r.record_id, text(r, INSTANCE_FIELDS.ID).trim()]));

// 按关卡分组目标
const goalsByLevel = new Map();
for (const g of goalRecs) {
  const lvlIds = links(g, GOAL_FIELDS.LEVEL);
  const resIds = links(g, GOAL_FIELDS.RESOURCE);
  const qty = num(g, GOAL_FIELDS.QTY, null);
  if (!lvlIds.length || !resIds.length || qty == null) continue;

  for (const lvlId of lvlIds) {
    const lvlName = lvlMap.get(lvlId);
    if (!lvlName) {
      console.warn(`⚠️ 关卡 record_id ${lvlId} 未映射到名称，跳过`);
      continue;
    }
    for (const resId of resIds) {
      const resInstId = instMap.get(resId);
      if (!resInstId) {
        console.warn(`⚠️ 物资 record_id ${resId} 未映射到物资ID，跳过`);
        continue;
      }
      if (!goalsByLevel.has(lvlName)) goalsByLevel.set(lvlName, []);
      const arr = goalsByLevel.get(lvlName);
      const exist = arr.find((x) => x.resourceId === resInstId);
      if (exist) exist.qty += qty;
      else arr.push({ resourceId: resInstId, qty });
    }
  }
}

console.log(`\n📋 已录入 ${goalsByLevel.size} 个关卡的目标：`);
for (const [lvl, gs] of goalsByLevel) {
  console.log(`  ${lvl} → ${gs.map((g) => `${g.resourceId}×${g.qty}`).join(', ')}`);
}

// 写入 tv2.json
const tv2Path = join(ROOT, 'src/data/tv2.json');
const tv2 = JSON.parse(readFileSync(tv2Path, 'utf8'));
let updated = 0;
for (const lvl of tv2.levels) {
  const gs = goalsByLevel.get(lvl.name);
  if (gs) {
    lvl.goals = gs;
    updated++;
  }
}

writeFileSync(tv2Path, JSON.stringify(tv2, null, 2), 'utf8');
console.log(`\n💾 已写入 tv2.json，更新了 ${updated} 个关卡`);
