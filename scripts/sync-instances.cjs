/**
 * 从飞书 Base 导出的 NDJSON 转换为项目 instances 格式
 * 用法：node scripts/sync-instances.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 找最新的 record 文件（脚本执行前先跑 lark-cli base +record-list）
const files = fs.readdirSync(ROOT).filter((f) => f.startsWith('tbl6df5T6NZ9vjo2_') && f.endsWith('.ndjson'));
files.sort((a, b) => fs.statSync(path.join(ROOT, b)).mtimeMs - fs.statSync(path.join(ROOT, a)).mtimeMs);
const NDJSON = path.join(ROOT, files[0]);
console.log(`使用 record 文件: ${files[0]}`);
const TV2 = path.join(ROOT, 'src/data/tv2.json');

// —— 1. 解析 NDJSON ——
const raw = fs.readFileSync(NDJSON, 'utf8');
const lines = raw.trim().split('\n').filter((l) => l.trim());
console.log(`NDJSON 有效记录: ${lines.length}`);

/** 飞书字段(中文) -> 项目字段 */
function mapInstance(rec) {
  const id = rec['物资ID'] || ''; // formula: 物资名称 + RIGHT(RECORD_ID(),2)
  const name = (rec['物资名称'] && rec['物资名称'][0]) || ''; // select: ['原木']
  const recipeRaw = rec['配方物资类型'] || []; // multi-select: ['工人','原木']
  const inputs = recipeRaw.map((r) => r).filter(Boolean);
  const external = !!rec['外部获取']; // checkbox — 能作为关卡外部物资站点候选
  const initialSetup = !!rec['初始配置']; // checkbox — 能作为关卡初始资源站点候选
  const obtain = (rec['获取方式'] && rec['获取方式'][0]) || ''; // select: ['刷新']['无限']['库存'] 始终解析
  const perOut = rec['单次产出'] ?? 1; // number
  const needsPower = !!rec['电力依赖']; // checkbox

  const inst = { id, name, inputs, perOut: Number(perOut) || 1 };
  if (external) inst.external = true;
  if (obtain) inst.obtain = obtain;
  if (needsPower) inst.needsPower = true;
  if (initialSetup) inst.initialSetup = true;
  return inst;
}

const baseInstances = lines.map((l) => mapInstance(JSON.parse(l)));

// —— 2. 加载本地 tv2.json ——
let tv2Raw = fs.readFileSync(TV2, 'utf8');
if (tv2Raw.charCodeAt(0) === 0xfeff) tv2Raw = tv2Raw.substring(1);
const tv2 = JSON.parse(tv2Raw);
const localInstMap = new Map(tv2.instances.map((i) => [i.id, i]));

// —— 3. Diff 对比 ——
const baseMap = new Map(baseInstances.map((i) => [i.id, i]));

const toAdd = [];
const toUpdate = [];
const toRemove = [];

for (const local of tv2.instances) {
  if (!baseMap.has(local.id)) toRemove.push(local.id);
}

for (const bi of baseInstances) {
  const local = localInstMap.get(bi.id);
  if (!local) {
    toAdd.push(bi);
    continue;
  }
  const changed =
    local.name !== bi.name ||
    JSON.stringify(local.inputs || []) !== JSON.stringify(bi.inputs) ||
    (local.perOut ?? 1) !== bi.perOut ||
    !!local.external !== !!bi.external ||
    (local.obtain || '') !== (bi.obtain || '') ||
    !!local.needsPower !== !!bi.needsPower ||
    !!local.initialSetup !== !!bi.initialSetup;
  if (changed) toUpdate.push({ old: local, nuw: bi });
}

console.log(`\n=== Diff 结果 ===`);
console.log(`新增: ${toAdd.length}`);
toAdd.forEach((i) => console.log(`  + ${i.id} ${i.name}${i.obtain ? ` [obtain=${i.obtain}]` : ''}${i.initialSetup ? ' [初始]' : ''}`));
console.log(`更新: ${toUpdate.length}`);
toUpdate.forEach(({ old, nuw }) => {
  const diffs = [];
  if (old.name !== nuw.name) diffs.push(`name: ${old.name}→${nuw.name}`);
  if (JSON.stringify(old.inputs || []) !== JSON.stringify(nuw.inputs)) diffs.push(`inputs`);
  if ((old.perOut ?? 1) !== nuw.perOut) diffs.push(`perOut: ${old.perOut}→${nuw.perOut}`);
  if (!!old.external !== !!nuw.external) diffs.push(`external: ${!!old.external}→${!!nuw.external}`);
  if ((old.obtain || '') !== (nuw.obtain || '')) diffs.push(`obtain: ${old.obtain||'空'}→${nuw.obtain||'空'}`);
  if (!!old.needsPower !== !!nuw.needsPower) diffs.push(`needsPower`);
  if (!!old.initialSetup !== !!nuw.initialSetup) diffs.push(`initialSetup`);
  console.log(`  ~ ${old.id} [${diffs.join(', ')}]`);
});
console.log(`删除（Base 已移除）: ${toRemove.length}`);
toRemove.forEach((id) => console.log(`  - ${id}`));

// —— 4. 应用更新 ——
tv2.instances = baseInstances;
fs.writeFileSync(TV2, JSON.stringify(tv2, null, 2), 'utf8');
console.log(`\n✅ tv2.json 已更新: ${tv2.instances.length} instances (${fs.statSync(TV2).size} bytes)`);
