const fs = require('fs'), path = require('path');

const CONSTS_IMPORT = "import { OBTAIN, VIA, CATEGORY, REFRESH_START, STATION_KIND, CONTENT, FILTER_ALL } from '@/constants';";

const files = {
  // engine/breakdown.ts
  'src/engine/breakdown.ts': [
    // 头部加 import（替换现有 import 块末尾）
    { 
      find: /(import type .*\n)+/,
      repl: (m) => m + CONSTS_IMPORT + '\n',
    },
    // OBTAIN
    { find: /inst\.obtain === '购买'/g, repl: "inst.obtain === OBTAIN.BUY" },
    { find: /inst\.obtain === '刷新'/g, repl: "inst.obtain === OBTAIN.REFRESH" },
    { find: /inst\.obtain === '无限'/g, repl: "inst.obtain === OBTAIN.INFINITE" },
    { find: /inst\.obtain === '客流'/g, repl: "inst.obtain === OBTAIN.PASSENGER" },
    { find: /inst\.obtain === '库存'/g, repl: "inst.obtain === OBTAIN.STOCK" },
    { find: /obtain === '刷新'/g, repl: "obtain === OBTAIN.REFRESH" },
    { find: /obtain === '购买'/g, repl: "obtain === OBTAIN.BUY" },
    { find: /obtain === '无限'/g, repl: "obtain === OBTAIN.INFINITE" },
    { find: /obtain === '客流'/g, repl: "obtain === OBTAIN.PASSENGER" },
    { find: /obtain === '库存'/g, repl: "obtain === OBTAIN.STOCK" },
    // VIA
    { find: /viaOfSupply\(inst\) === 'unknown'/g, repl: "viaOfSupply(inst) === VIA.UNKNOWN" },
    { find: /via === 'external'/g, repl: "via === VIA.EXTERNAL" },
    { find: /via === 'refresh'/g, repl: "via === VIA.REFRESH" },
    { find: /via === 'infinite'/g, repl: "via === VIA.INFINITE" },
    { find: /via === 'auto'/g, repl: "via === VIA.AUTO" },
    { find: /via === 'unknown'/g, repl: "via === VIA.UNKNOWN" },
    { find: /via === 'produce'/g, repl: "via === VIA.PRODUCE" },
    { find: /'external' \|\| via === 'refresh'/g, repl: "VIA.EXTERNAL || via === VIA.REFRESH" },
    { find: /'refresh' \|\| via === 'infinite'/g, repl: "VIA.REFRESH || via === VIA.INFINITE" },
    // return 值
    { find: /return 'external';/g, repl: "return VIA.EXTERNAL;" },
    { find: /return 'refresh';/g, repl: "return VIA.REFRESH;" },
    { find: /return 'infinite';/g, repl: "return VIA.INFINITE;" },
    { find: /return 'auto';/g, repl: "return VIA.AUTO;" },
    { find: /return 'unknown';/g, repl: "return VIA.UNKNOWN;" },
    { find: /category = 'raw'/g, repl: "category = CATEGORY.RAW" },
    { find: /category = 'processed'/g, repl: "category = CATEGORY.PROCESSED" },
    { find: /category = 'compound'/g, repl: "category = CATEGORY.COMPOUND" },
    { find: /category === 'raw'/g, repl: "category === CATEGORY.RAW" },
    { find: /category === 'processed'/g, repl: "category === CATEGORY.PROCESSED" },
    { find: /category === 'compound'/g, repl: "category === CATEGORY.COMPOUND" },
    { find: /sub !== 'raw'/g, repl: "sub !== CATEGORY.RAW" },
    { find: /node\.category === 'raw'/g, repl: "node.category === CATEGORY.RAW" },
    { find: /node\.via === 'external'/g, repl: "node.via === VIA.EXTERNAL" },
    { find: /node\.via === 'refresh'/g, repl: "node.via === VIA.REFRESH" },
    { find: /node\.via === 'infinite'/g, repl: "node.via === VIA.INFINITE" },
    { find: /node\.via === 'auto'/g, repl: "node.via === VIA.AUTO" },
    { find: /node\.via !== 'power-tag'/g, repl: "node.via !== VIA.POWER_TAG" },
    { find: /node\.via !== 'unknown'/g, repl: "node.via !== VIA.UNKNOWN" },
  ],
};

for (const [file, replaces] of Object.entries(files)) {
  let r = fs.readFileSync(file, 'utf8');
  if (r.charCodeAt(0) === 0xFEFF) r = r.substring(1);
  
  for (const rep of replaces) {
    if (typeof rep.find === 'string') {
      // literal replace
      if (r.includes(rep.find)) {
        r = r.split(rep.find).join(rep.repl);
        console.log(`[${file}] replaced: ${rep.find.substring(0, 50)}`);
      }
    } else {
      // regex
      const before = r;
      r = r.replace(rep.find, rep.repl);
      if (r !== before) console.log(`[${file}] regex replaced`);
    }
  }
  
  fs.writeFileSync(file, r, 'utf8');
  console.log(`--- ${file} done ---`);
}
