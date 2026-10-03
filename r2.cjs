const fs = require('fs');

function replaceAll(file, pairs, needImport) {
  let r = fs.readFileSync(file, 'utf8');
  if (r.charCodeAt(0) === 0xFEFF) r = r.substring(1);
  const original = r;

  for (const [find, repl] of pairs) {
    const before = r;
    while (r.includes(find)) r = r.split(find).join(repl);
  }

  const importLine = "import { OBTAIN, VIA, CATEGORY, REFRESH_START, STATION_KIND, CONTENT, FILTER_ALL } from '@/constants';";
  if (needImport && !r.includes("@/constants")) {
    const firstImport = r.indexOf('import ');
    if (firstImport >= 0) {
      const lineStart = r.lastIndexOf('\n', firstImport);
      r = r.substring(0, lineStart + 1) + importLine + '\n' + r.substring(lineStart + 1);
    } else {
      r = importLine + '\n' + r;
    }
  }

  if (r !== original) {
    fs.writeFileSync(file, r, 'utf8');
    console.log(`✅ ${file.split('/').pop()}`);
  } else {
    console.log(`⏭️  ${file.split('/').pop()} (无变化)`);
  }
}

// === LevelsPage.vue ===
replaceAll('src/pages/LevelsPage.vue', [
  // obtain 字段用 OBTAIN
  ["inst.obtain === '刷新'", 'inst.obtain === OBTAIN.REFRESH'],
  ["inst.obtain === '购买'", 'inst.obtain === OBTAIN.BUY'],
  ["inst.obtain === '无限'", 'inst.obtain === OBTAIN.INFINITE'],
  ["inst.obtain === '客流'", 'inst.obtain === OBTAIN.PASSENGER'],
  ["inst.obtain === '库存'", 'inst.obtain === OBTAIN.STOCK'],
  ["obtain === '刷新'", 'obtain === OBTAIN.REFRESH'],
  ["obtain === '购买'", 'obtain === OBTAIN.BUY'],
  ["obtain === '无限'", 'obtain === OBTAIN.INFINITE'],
  ["e.obtain === '刷新'", 'e.obtain === OBTAIN.REFRESH'],
  ["e.obtain === '购买'", 'e.obtain === OBTAIN.BUY'],
  // s.kind 用 STATION_KIND
  ["s.kind === '刷新'", 's.kind === STATION_KIND.REFRESH'],
  ["s.kind === '购买'", 's.kind === STATION_KIND.BUY'],
  ["s.kind !== '刷新'", 's.kind !== STATION_KIND.REFRESH'],
  ["s.kind !== '购买'", 's.kind !== STATION_KIND.BUY'],
  ["kind === '刷新'", 'kind === STATION_KIND.REFRESH'],
  ["kind === '购买'", 'kind === STATION_KIND.BUY'],
  ["merged.kind === '购买'", 'merged.kind === STATION_KIND.BUY'],
  ["si.kind === '购买'", 'si.kind === STATION_KIND.BUY'],
  // obtain 收集器 add()
  ["kinds.add('刷新')", 'kinds.add(STATION_KIND.REFRESH)'],
  ["kinds.add('购买')", 'kinds.add(STATION_KIND.BUY)'],
  ["availKinds.add('刷新')", 'availKinds.add(STATION_KIND.REFRESH)'],
  ["availKinds.add('购买')", 'availKinds.add(STATION_KIND.BUY)'],
  // refreshStart
  ["s.refreshStart === 'timed'", 's.refreshStart === REFRESH_START.TIMED'],
  ["s.refreshStart === 'unlock'", 's.refreshStart === REFRESH_START.UNLOCK'],
  ["station.refreshStart === 'unlock'", 'station.refreshStart === REFRESH_START.UNLOCK'],
  // filter all
  ["contentTypeFilter === 'all'", "contentTypeFilter === FILTER_ALL"],
  ["contentTypeFilter !== 'all'", "contentTypeFilter !== FILTER_ALL"],
], true);

// === GoalEditor.vue ===
replaceAll('src/components/GoalEditor.vue', [
  ["'raw'", 'CATEGORY.RAW'],
  ["'processed'", 'CATEGORY.PROCESSED'],
  ["'compound'", 'CATEGORY.COMPOUND'],
], true);

// === TreeNode.vue ===
replaceAll('src/components/TreeNode.vue', [
  ["r.stationKind === '刷新'", 'r.stationKind === STATION_KIND.REFRESH'],
  ["r.stationKind === '购买'", 'r.stationKind === STATION_KIND.BUY'],
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
  ["'raw'", 'CATEGORY.RAW'],
  ["'processed'", 'CATEGORY.PROCESSED'],
  ["'compound'", 'CATEGORY.COMPOUND'],
  ["filterObtain.value !== 'all'", "filterObtain.value !== FILTER_ALL"],
], true);

// === game.ts ===
replaceAll('src/stores/game.ts', [
  ["s.kind === '刷新'", 's.kind === STATION_KIND.REFRESH'],
  ["s.kind === '购买'", 's.kind === STATION_KIND.BUY'],
  ["lv.category === '游戏本体'", 'lv.category === CONTENT.BASE'],
], true);

console.log('\n=== DONE ===');
