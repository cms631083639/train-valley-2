// 从飞书原始 ndjson 重建 tv2.json 的关卡数据（修复 constraints 脏数据）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fields from './feishu-fields.cjs';

const {
  TABLES, LEVEL_FIELDS, text,
  CONSTRAINT_BOOL_COLS, CONSTRAINT_NUM_COLS, CONSTRAINT_ALIAS,
} = fields;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function latestNdjson(prefix) {
  const files = readdirSync(ROOT).filter((f) => f.startsWith(prefix) && f.endsWith('.ndjson'));
  if (!files.length) { console.error(`❌ 找不到 ${prefix}*.ndjson`); process.exit(1); }
  files.sort();
  return join(ROOT, files[files.length - 1]);
}

function parseNdjson(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  return lines.map((l) => JSON.parse(l)).filter((o) => o.record_id);
}

// constraints 中参与星级的列（需要正确识别值的类型）
const CONSTRAINT_BOOL = new Set(CONSTRAINT_BOOL_COLS);
const CONSTRAINT_NUM = new Set(CONSTRAINT_NUM_COLS);

// 字段名 → constraints 里的 key（飞书字段名可能和约束 key 有差异）
const FIELD_ALIAS = CONSTRAINT_ALIAS;

console.log('📥 读取 ndjson…');
const lvlFile = latestNdjson(TABLES.LEVELS);
const lvlRecs = parseNdjson(lvlFile);
console.log('  关卡表 →', lvlFile.split(/[\\/]/).pop(), `(${lvlRecs.length} 关)`);

const tv2Path = join(ROOT, 'src/data/tv2.json');
const tv2 = JSON.parse(readFileSync(tv2Path, 'utf8'));

// 记录修复结果
const fixes = [];

for (const rec of lvlRecs) {
  const name = text(rec, LEVEL_FIELDS.NAME).trim();
  const lvl = tv2.levels.find((l) => l.name === name);
  if (!lvl) { console.warn(`⚠️ tv2.json 里找不到关卡: ${name}`); continue; }

  // 重新构建 constraints：只保留有意义的值
  const newConstraints = {};

  for (const key of Object.keys(rec)) {
    const v = rec[key];
    let cleanKey = FIELD_ALIAS[key] || key;

    // 布尔列：只有 true（打勾）才进 constraints
    if (CONSTRAINT_BOOL.has(key)) {
      if (v === true) newConstraints[cleanKey] = '1';
      // v === false → 跳过（未打勾，不进星级）
      continue;
    }

    // 数值列：非 null 才进
    if (CONSTRAINT_NUM.has(key)) {
      if (v != null && v !== '' && v !== false) newConstraints[cleanKey] = String(v);
      continue;
    }
  }

  // 对比旧 vs 新
  const oldKeys = Object.keys(lvl.constraints || {}).sort().join(',');
  const newKeys = Object.keys(newConstraints).sort().join(',');
  if (oldKeys !== newKeys) {
    fixes.push({ name, old: lvl.constraints, fixed: newConstraints });
  }

  lvl.constraints = newConstraints;
}

console.log(`\n🔧 修复了 ${fixes.length} 关的 constraints：`);
for (const f of fixes) {
  const oldKeys = Object.keys(f.old || {});
  const newKeys = Object.keys(f.fixed);
  console.log(`  ${f.name}: ${oldKeys.length}列 → ${newKeys.length}列`);
  console.log(`    旧: ${JSON.stringify(f.old)}`);
  console.log(`    新: ${JSON.stringify(f.fixed)}`);
}

writeFileSync(tv2Path, JSON.stringify(tv2, null, 2), 'utf8');
console.log(`\n💾 已写入 tv2.json`);
