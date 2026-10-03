const fs = require('fs');

function replaceAll(file, pairs, needImport) {
  let r = fs.readFileSync(file, 'utf8');
  if (r.charCodeAt(0) === 0xFEFF) r = r.substring(1);

  for (const [find, repl] of pairs) {
    while (r.includes(find)) r = r.split(find).join(repl);
  }

  // 检查已有 import
  const importLine = "import { OBTAIN, VIA, CATEGORY, REFRESH_START, STATION_KIND, CONTENT, FILTER_ALL } from '@/constants';";
  if (needImport && !r.includes("@/constants")) {
    // 插入：找第一个 import 语句
    const firstImport = r.indexOf('import ');
    if (firstImport >= 0) {
      const lineStart = r.lastIndexOf('\n', firstImport);
      r = r.substring(0, lineStart + 1) + importLine + '\n' + r.substring(lineStart + 1);
    } else {
      r = importLine + '\n' + r;
    }
  }

  fs.writeFileSync(file, r, 'utf8');
  console.log(`✅ ${file.split('/').pop()}`);
}

const OBTAIN_PAIRS = [
  ["'刷新'", 'OBTAIN.REFRESH'],
  ["'购买'", 'OBTAIN.BUY'],
  ["'无限'", 'OBTAIN.INFINITE'],
  ["'库存'", 'OBTAIN.STOCK'],
  ["'客流'", 'OBTAIN.PASSENGER'],
];

const STATION_KIND_PAIRS = [
  ["'刷新'", 'STATION_KIND.REFRESH'],
  ["'购买'", 'STATION_KIND.BUY'],
];

const VIA_PAIRS = [
  ["'produce'", 'VIA.PRODUCE'],
  ["'external'", 'VIA.EXTERNAL'],
  ["'refresh'", 'VIA.REFRESH'],
  ["'infinite'", 'VIA.INFINITE'],
  ["'auto'", 'VIA.AUTO'],
  ["'unknown'", 'VIA.UNKNOWN'],
  ["'power-tag'", 'VIA.POWER_TAG'],
];

const CATEGORY_PAIRS = [
  ["'raw'", 'CATEGORY.RAW'],
  ["'processed'", 'CATEGORY.PROCESSED'],
  ["'compound'", 'CATEGORY.COMPOUND'],
];

const REFRESH_START_PAIRS = [
  ["'timed'", 'REFRESH_START.TIMED'],
  ["'unlock'", 'REFRESH_START.UNLOCK'],
];

// === breakdown.ts ===
replaceAll('src/engine/breakdown.ts', [
  ...OBTAIN_PAIRS,
  ...VIA_PAIRS,
  ...CATEGORY_PAIRS,
], true);

// === LevelsPage.vue ===
replaceAll('src/pages/LevelsPage.vue', [
  // 注意：kind 字段用 STATION_KIND，obtain 用 OBTAIN
  // 先替换 obtain，再替换 kind（'刷新' 和 '购买' 在两处都出现）
  ["inst.obtain === '刷新'", 'inst.obtain === OBTAIN.REFRESH'],
  ["inst.obtain === '购买'", 'inst.obtain === OBTAIN.BUY'],
  ["inst.obtain === '无限'", 'inst.obtain === OBTAIN.INFINITE'],
  ["inst.obtain === '客流'", 'inst.obtain === OBTAIN.PASSENGER'],
  ["inst.obtain === '库存'", 'inst.obtain === OBTAIN.STOCK'],
  ["obtain === '刷新'", 'obtain === OBTAIN.REFRESH'],
  ["obtain === '购买'", 'obtain === OBTAIN.BUY'],
  ["obtain === '无限'", 'obtain === OBTAIN.INFINITE'],
  // s.kind 的替换
  ["s.kind === '刷新'", 's.kind === STATION_KIND.REFRESH'],
  ["s.kind === '购买'", 's.kind === STATION_KIND.BUY'],
  ["s.kind !== '刷新'", 's.kind !== STATION_KIND.REFRESH'],
  ["s.kind !== '购买'", 's.kind !== STATION_KIND.BUY'],
  ["kind === '刷新'", 'kind === STATION_KIND.REFRESH'],
  ["kind === '购买'", 'kind === STATION_KIND.BUY'],
  ["merged.kind === '购买'", 'merged.kind === STATION_KIND.BUY'],
  ["si.kind === '购买'", 'si.kind === STATION_KIND.BUY'],
  // obtain 收集器里的硬编码（add('刷新')）
  ["kinds.add('刷新')", 'kinds.add(STATION_KIND.REFRESH)'],
  ["kinds.add('购买')", 'kinds.add(STATION_KIND.BUY)'],
  ["availKinds.add('刷新')", 'availKinds.add(STATION_KIND.REFRESH)'],
  ["availKinds.add('购买')", 'availKinds.add(STATION_KIND.BUY)'],
  ["keepKind = inst.obtain", 'keepKind = inst.obtain'],
  // refreshStart
  ["s.refreshStart === 'timed'", 's.refreshStart === REFRESH_START.TIMED'],
  ["s.refreshStart === 'unlock'", 's.refreshStart === REFRESH_START.UNLOCK'],
  ["station.refreshStart === 'unlock'", 'station.refreshStart === REFRESH_START.UNLOCK'],
  // filter 'all'
  ["contentTypeFilter === 'all'", "contentTypeFilter === FILTER_ALL"],
  ["contentTypeFilter !== 'all'", "contentTypeFilter !== FILTER_ALL"],
  // obtain 收集 kind
  ["e.obtain === '刷新'", 'e.obtain === OBTAIN.REFRESH'],
  ["e.obtain === '购买'", 'e.obtain === OBTAIN.BUY'],
], true);

// === GoalEditor.vue ===
replaceAll('src/components/GoalEditor.vue', [
  ...CATEGORY_PAIRS,
], true);

// === TreeNode.vue ===
replaceAll('src/components/TreeNode.vue', [
  // stationKind 用 STATION_KIND
  ["r.stationKind === '刷新'", 'r.stationKind === STATION_KIND.REFRESH'],
  ["r.stationKind === '购买'", 'r.stationKind === STATION_KIND.BUY'],
  // via
  ["node.via === 'power-tag'", 'node.via === VIA.POWER_TAG'],
  ["node.via !== 'power-tag'", 'node.via !== VIA.POWER_TAG'],
  ["node.via !== 'unknown'", 'node.via !== VIA.UNKNOWN'],
  ["node.via === 'unknown'", 'node.via === VIA.UNKNOWN'],
  ["node.via === 'external'", 'node.via === VIA.EXTERNAL'],
  ["node.via === 'refresh'", 'node.via === VIA.REFRESH'],
  ["node.via === 'infinite'", 'node.via === VIA.INFINITE'],
  ["node.via === 'auto'", 'node.via === VIA.AUTO'],
  ["case 'refresh':", 'case VIA.REFRESH:'],
  ["case 'external':", 'case VIA.EXTERNAL:'],
  ["case 'infinite':", 'case VIA.INFINITE:'],
  ["case 'auto':", 'case VIA.AUTO:'],
], true);

// === InstancesPage.vue ===
replaceAll('src/pages/InstancesPage.vue', [
  ...CATEGORY_PAIRS,
  ["filterObtain.value !== 'all'", "filterObtain.value !== FILTER_ALL"],
], true);

// === game.ts ===
replaceAll('src/stores/game.ts', [
  ["s.kind === '刷新'", 's.kind === STATION_KIND.REFRESH'],
  ["s.kind === '购买'", 's.kind === STATION_KIND.BUY'],
  ["lv.category === '游戏本体'", 'lv.category === CONTENT.BASE'],
], true);
