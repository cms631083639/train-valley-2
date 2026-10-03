const fs = require('fs');

function checkFile(file) {
  let r = fs.readFileSync(file, 'utf8');
  if (r.charCodeAt(0) === 0xFEFF) r = r.substring(1);
  const hardcoded = [
    "== '刷新'", "== '购买'", "== '无限'", "== '客流'", "== '库存'",
    "== 'raw'", "== 'processed'", "== 'compound'",
    "== 'refresh'", "== 'external'", "== 'infinite'", "== 'auto'", "== 'unknown'",
    "=== '刷新'", "=== '购买'", "=== '无限'", "=== '客流'", "=== '库存'",
    "=== 'raw'", "=== 'processed'", "=== 'compound'",
    "=== 'refresh'", "=== 'external'", "=== 'infinite'", "=== 'auto'", "=== 'unknown'",
    "=== 'timed'", "=== 'unlock'",
    "=== 'all'",
  ];
  const found = [];
  for (const h of hardcoded) {
    const idx = r.indexOf(h);
    if (idx >= 0) {
      const line = r.substring(0, idx).split('\n').length;
      const ctx = r.split('\n')[line - 1].trim().substring(0, 140);
      found.push({ h, line, ctx });
    }
  }
  return found;
}

const files = [
  'src/engine/breakdown.ts',
  'src/pages/LevelsPage.vue',
  'src/components/GoalEditor.vue',
  'src/components/TreeNode.vue',
  'src/pages/InstancesPage.vue',
  'src/stores/game.ts',
];

for (const f of files) {
  const results = checkFile(f);
  if (results.length === 0) {
    console.log(`✅ ${f.split('/').pop()}: CLEAN`);
  } else {
    console.log(`\n❌ ${f.split('/').pop()}: ${results.length} 处残留`);
    for (const r of results) {
      console.log(`  L${r.line}: ${r.ctx}`);
    }
  }
}
