/**
 * 图标库（本地 SVG 雪橇 / Symbol 模式）
 *
 * 用法与阿里 iconfont.cn 的 Symbol 方案完全一致：
 *   <AppIcon name="wood" />  →  <svg><use href="#icon-wood" /></svg>
 *
 * 若要切换到 iconfont.cn：
 *   1. 在 iconfont 项目里生成 Symbol 链接（at.alicdn.com/t/c/font_xxx.js）
 *   2. 在 index.html 里 <script src="该链接"></script>
 *   3. 删掉 main.ts 里的 registerSprite() 调用
 *   只要图标 id 与本文件保持一致，组件与业务代码零改动。
 */

/** 图标内部 SVG 片段；统一 24x24 视口，线条用 currentColor 以便 Tailwind 控制颜色 */
export const ICONS: Record<string, string> = {
  // ============ 基础物资 ============
  wood: '<rect x="3" y="8" width="18" height="8" rx="4"/><ellipse cx="7" cy="12" rx="1.6" ry="3"/>',
  worker: '<circle cx="12" cy="6" r="2.6"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/><path d="M4 11h16"/>',
  plank: '<rect x="2.5" y="9" width="19" height="6" rx="1"/><path d="M8 9v6M14 9v6"/>',
  iron_ore: '<path d="M4 19 9 8l4 6 3-3 4 8z"/><path d="M9 8l2 4"/>',
  sand: '<path d="M3 19h18L12 6z"/><path d="M8 19l4-7 4 7"/>',
  stone: '<path d="M6 8l4-4 8 3 2 8-7 5-8-4z"/><path d="M10 4l1 8 11 3"/>',
  grain: '<path d="M12 21V9"/><path d="M12 9c0-3 2-5 4-6 0 3-1 5-4 6zM12 9c0-3-2-5-4-6 0 3 1 5 4 6zM12 15c0-3 2-4 4-5 0 3-1 4-4 5zM12 15c0-3-2-4-4-5 0 3 1 4 4 5z"/>',
  water: '<path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z"/>',
  coal: '<path d="M5 15l3-5 4 2 3-4 4 7-6 4z"/><circle cx="9" cy="15" r="1"/>',
  // ============ 加工 / 最终物资 ============
  glass: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 4v16M4 12h16"/>',
  pig_iron: '<path d="M4 16h16l-2-6H6z"/><path d="M8 10V7h8v3"/>',
  flour: '<path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M8 12c0-3 2-5 4-5s4 2 4 5"/>',
  rail: '<path d="M8 3 5 21M16 3l3 18"/><path d="M4 8h16M4 14h16M5 20h14"/>',
  bread: '<path d="M4 14a8 8 0 0 1 16 0v4H4z"/><path d="M8 14c0-3 1.5-5 4-5s4 2 4 5"/>',
  window: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M4 12h16"/>',
  passenger: '<rect x="5" y="3" width="14" height="18" rx="3"/><circle cx="12" cy="9" r="2"/><path d="M8 19c0-2.5 1.8-4 4-4s4 1.5 4 4"/>',
  // ============ 生产设施 ============
  forest: '<path d="M12 3 6 12h3l-4 6h14l-4-6h3z"/><path d="M12 18v3"/>',
  iron_mine: '<path d="M3 20 10 6l5 8 2-3 4 9z"/><path d="M14 4l6 4"/>',
  sand_pit: '<path d="M14 4 8 10l6 6 6-6z"/><path d="M11 13 4 20"/>',
  quarry: '<path d="M3 20l6-11 4 6 3-4 5 9z"/><path d="M9 9l-3-4M13 15l4-8"/>',
  farm: '<path d="M4 11 12 5l8 6v9H4z"/><path d="M12 5V3M9 20v-6h6v6"/>',
  coal_mine: '<path d="M4 9h16l-2 8H6z"/><circle cx="9" cy="19" r="1.6"/><circle cx="16" cy="19" r="1.6"/><path d="M8 9V6h8v3"/>',
  sawmill: '<circle cx="12" cy="12" r="7"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2M7 7l1.5 1.5M15.5 15.5 17 17M17 7l-1.5 1.5M8.5 15.5 7 17"/><circle cx="12" cy="12" r="2"/>',
  foundry: '<path d="M3 21V11l5 3V11l5 3V8l6 4v9z"/><path d="M7 21v-4M12 21v-4"/>',
  glassworks: '<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V5h3v5M15 21v-6h3v6"/>',
  mill: '<circle cx="12" cy="12" r="2"/><path d="M12 10V3M14 12h7M12 14v7M10 12H3"/>',
  bakery: '<rect x="3" y="7" width="18" height="14" rx="2"/><rect x="7" y="11" width="10" height="7" rx="1"/><path d="M7 7V4h10v3"/>',
  carpenter: '<path d="M4 9 9 4l4 4-5 5z"/><path d="M12 12l7 7"/><path d="M16 8l3 3"/>',
  town: '<path d="M3 21V9l6-4v16M9 21V13h6v8M15 21V7l6 4v10"/><path d="M5 12h2M11 16h2M17 12h2"/>',
  station: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 8 12 3l9 5"/><circle cx="12" cy="14" r="2.5"/><path d="M12 12.5V14l1 1"/>',
  // ============ 载具 ============
  locomotive: '<path d="M4 16V7h10l4 4v5"/><path d="M2 16h20"/><circle cx="7" cy="19" r="1.8"/><circle cx="16" cy="19" r="1.8"/><path d="M7 11h4"/>',
  wagon: '<rect x="3" y="7" width="18" height="9" rx="1"/><circle cx="8" cy="19" r="1.8"/><circle cx="16" cy="19" r="1.8"/><path d="M3 11h18"/>',
  // ============ 界面 ============
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 21 21"/>',
  import: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v4h16v-4"/>',
  export: '<path d="M12 21V9M8 13l4-4 4 4"/><path d="M4 7V3h16v4"/>',
  reset: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17.5v.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9"/><path d="M12 7v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  graph: '<circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="5" r="2.5"/><circle cx="19" cy="12" r="2.5"/><circle cx="12" cy="19" r="2.5"/><path d="M7 11 10 6M14 6l3 5M17 14l-3 4M10 14l-3-2"/>',
  book: '<path d="M4 4h7v16H4zM13 4h7v16h-7z"/><path d="M6 8h3M15 8h3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  // ============ 物资专用（Train Valley 2 主表）============
  power: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  cow: '<path d="M4 8c0-2 2-3 4-3M20 8c0-2-2-3-4-3"/><path d="M6 6c-1 3 0 8 2 10h8c2-2 3-7 2-10"/><circle cx="9" cy="11" r=".8"/><circle cx="15" cy="11" r=".8"/>',
  brick: '<rect x="3" y="6" width="18" height="4"/><rect x="3" y="11" width="18" height="4"/><rect x="3" y="16" width="18" height="3"/><path d="M9 6v4M15 6v4M6 11v4M12 11v4M18 11v4"/>',
  rubber: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>',
  ingot: '<path d="M4 16h16l-2-5H6zM7 11l1-3h8l1 3"/>',
  tool: '<path d="M14 6a3 3 0 0 0 4 4l3 3-3 3-3-3a3 3 0 0 0-4-4z"/><path d="M10 10 3 17l4 4 7-7"/>',
  jewelry: '<circle cx="12" cy="9" r="4"/><path d="M8 12 5 20h14l-3-8"/><path d="M10 8l2 2 2-2"/>',
  electric: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  oil: '<path d="M8 3h8v3l-2 2v3a4 4 0 1 1-4 0V8L8 6z"/><path d="M10 14h4"/>',
  fuel: '<rect x="6" y="8" width="9" height="12"/><path d="M15 11h3v6a2 2 0 0 1-4 0"/><path d="M8 8V5h5v3"/>',
  sheet: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M3 12h18"/>',
  polymer: '<circle cx="7" cy="8" r="2"/><circle cx="16" cy="7" r="2"/><circle cx="12" cy="16" r="2"/><path d="M8.5 9.5 11 14M14 8.5l-1.5 5M8 7.5 14 7"/>',
  canned: '<rect x="6" y="5" width="12" height="15" rx="2"/><path d="M6 9h12M6 16h12"/><circle cx="12" cy="12.5" r="2"/>',
  wire: '<path d="M4 8c3 0 3 8 6 8s3-8 6-8 3 8 4 8"/><path d="M3 8h2M19 16h2"/>',
  buildmat: '<path d="M3 20 12 4l9 16z"/><path d="M8 20l4-8 4 8"/>',
  cargo: '<rect x="4" y="7" width="16" height="12" rx="1"/><path d="M4 11h16M9 7v4M15 7v4"/>',
  machine: '<rect x="4" y="10" width="16" height="10" rx="1"/><circle cx="12" cy="15" r="3"/><path d="M8 10V6h8v4"/>',
  glue: '<path d="M9 3h6v4l1 2v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l1-2z"/><path d="M9 13h6"/>',
  mechanic: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3"/><path d="M15 5l3-2"/>',
  dynamite: '<rect x="7" y="8" width="10" height="13" rx="1"/><path d="M12 8V5l3-2"/><path d="M9 12h6M9 16h6"/>',
  car: '<path d="M5 13l1.5-4h11L19 13"/><rect x="3" y="13" width="18" height="5" rx="1.5"/><circle cx="7.5" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/>',
  plane: '<path d="M12 3v18M12 8 3 12l9-1 9 1z"/><path d="M9 19h6"/>',
  uranium: '<circle cx="12" cy="12" r="2"/><path d="M12 10a6 6 0 0 1 5 3 6 6 0 0 1-10 0 6 6 0 0 1 5-3z"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  bond: '<rect x="3" y="6" width="18" height="12" rx="1"/><circle cx="12" cy="12" r="3"/><path d="M6 9v6M18 9v6"/>',
  computer: '<rect x="4" y="4" width="16" height="10" rx="1"/><path d="M2 18h20M8 14v4M16 14v4"/>',
  rocket: '<path d="M12 3c3 2 4 6 4 9l-2 3h-4l-2-3c0-3 1-7 4-9z"/><circle cx="12" cy="9" r="1.5"/><path d="M8 15l-2 4 4-1M16 15l2 4-4-1"/>',
  candle: '<rect x="9" y="8" width="6" height="13" rx="1"/><path d="M12 8V6M12 3c1.5 1.5 1.5 2.5 0 3-1.5-.5-1.5-1.5 0-3z"/>',
  envelope: '<rect x="3" y="6" width="18" height="13" rx="1"/><path d="M3 7l9 7 9-7"/>',
  potion: '<path d="M10 3h4v4l3 8a4 4 0 0 1-10 0l3-8z"/><path d="M8.5 14h7"/>',
};

/** 物资/设施缺省图标 */
export const DEFAULT_ICON = 'box';
ICONS.box = '<path d="M12 3 21 8v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>';

/** 中文物资名 → 图标名（数据表里 name 为中文，图标 key 为英文） */
export const RESOURCE_ICON: Record<string, string> = {
  工人: 'worker',
  原木: 'wood',
  木板: 'plank',
  小麦: 'grain',
  砂土: 'sand',
  奶牛: 'cow',
  砖块: 'brick',
  玻璃: 'glass',
  天然橡胶: 'rubber',
  加工橡胶: 'rubber',
  煤炭: 'coal',
  铁矿: 'iron_ore',
  钢坯: 'ingot',
  家具: 'carpenter',
  金矿: 'iron_ore',
  金锭: 'ingot',
  铜矿: 'iron_ore',
  铜锭: 'ingot',
  工具: 'tool',
  首饰: 'jewelry',
  电器: 'electric',
  石油: 'oil',
  电力: 'power',
  燃料: 'fuel',
  钢板: 'sheet',
  聚合物: 'polymer',
  罐头食品: 'canned',
  电线: 'wire',
  建筑材料: 'buildmat',
  货物: 'cargo',
  机床: 'machine',
  胶水: 'glue',
  书籍: 'book',
  纸: 'paper',
  机械师: 'mechanic',
  炸药: 'dynamite',
  汽车: 'car',
  飞机: 'plane',
  铀: 'uranium',
  微型芯片: 'chip',
  债券: 'bond',
  计算机: 'computer',
  钱: 'coin',
  火箭: 'rocket',
  蜡烛: 'candle',
  信封: 'envelope',
  红色药水: 'potion',
  蓝色药水: 'potion',
};
ICONS.paper = '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/>';

let registered = false;

/** 把图标集合注入为 DOM 里的 <symbol>，只需在应用启动时调用一次 */
export function registerSprite(): void {
  if (registered || typeof document === 'undefined') return;
  registered = true;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('xmlns', ns);

  svg.innerHTML = Object.entries(ICONS)
    .map(
      ([name, body]) =>
        `<symbol id="icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
        `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`,
    )
    .join('');

  document.body.insertBefore(svg, document.body.firstChild);
}

/** 图标名是否存在 */
export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** 前缀回退：数据里常见的 id 命名 → 已有图标 */
const PREFIX_FALLBACK: [RegExp, string][] = [
  [/^loco(_|$)/, 'locomotive'],
  [/^wagon(_|$)/, 'wagon'],
];

/** 解析最终图标名：精确命中 → 中文物资名映射 → 前缀回退 → 通用 box */
export function resolveIcon(name: string): string {
  if (hasIcon(name)) return name;
  const mapped = RESOURCE_ICON[name];
  if (mapped && hasIcon(mapped)) return mapped;
  for (const [re, target] of PREFIX_FALLBACK) {
    if (re.test(name)) return target;
  }
  return DEFAULT_ICON;
}
