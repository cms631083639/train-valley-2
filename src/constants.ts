/**
 * 业务常量枚举 —— 所有代码逻辑判断都用这里导出的常量，禁止直接写字符串。
 * 对应的 TypeScript type 在 src/types.ts 里定义。
 */

// ———————————————— 获取方式 ObtainMethod ————————————————
export const OBTAIN = {
  REFRESH: '刷新',
  BUY: '购买',
  INFINITE: '无限',
  STOCK: '库存',
  PASSENGER: '客流',
} as const;
export type ObtainConst = (typeof OBTAIN)[keyof typeof OBTAIN];

// ———————————————— 站点外部类型 StationExternalKind ————————————————
export const STATION_KIND = {
  REFRESH: '刷新',
  BUY: '购买',
  STOCK: '库存',
  PASSENGER: '客流',
} as const;

// ———————————————— 刷新开始方式 RefreshStart ————————————————
export const REFRESH_START = {
  TIMED: 'timed',
  UNLOCK: 'unlock',
} as const;

// ———————————————— 拆解来源 NodeVia ————————————————
export const VIA = {
  PRODUCE: 'produce',     // 工人生产
  EXTERNAL: 'external',   // 外部购买
  REFRESH: 'refresh',     // 定时刷新
  INFINITE: 'infinite',   // 无限供给（电力）
  AUTO: 'auto',           // 自动生产（机械师等）
  UNKNOWN: 'unknown',     // 未知（警告用）
  POWER_TAG: 'power-tag', // 多实例电力标记
  CO_PRODUCTION: 'co-production', // 拆卸组（共享配方，一次生产同时产出多实例）
} as const;

// ———————————————— 物资分类 ResourceCategory ————————————————
export const CATEGORY = {
  RAW: 'raw',             // 原料（外部获取 / 电力 / 单工人直接产）
  PROCESSED: 'processed', // 加工品（有 inputs 含"工人"且有其他依赖）
  COMPOUND: 'compound',   // 复合品（多级依赖链）
} as const;

// ———————————————— 内容分类 ContentCategory ————————————————
export const CONTENT = {
  BASE: '游戏本体',
  DLC: 'DLC',
} as const;

// ———————————————— 多实例选择策略 RecipeChoice ————————————————
export const RECIPE_CHOICE = {
  FEWEST_INPUTS: 'fewestInputs',
  SMALLEST_PER_CYCLE: 'smallestPerCycle',
  FIRST: 'first',
  MOST_INPUTS: 'mostInputs',
} as const;
export type RecipeChoiceConst = (typeof RECIPE_CHOICE)[keyof typeof RECIPE_CHOICE];

// ———————————————— 拆解策略 BreakdownStrategy ————————————————
export const BREAKDOWN_STRATEGY = {
  NORMAL: 'normal',
  SKIP_COPRODUCTION: 'skipCoProduction',
  MIN_COPRODUCTION: 'minCoProduction',
  MOST_INPUTS: 'mostInputs',
} as const;
export type BreakdownStrategyConst = (typeof BREAKDOWN_STRATEGY)[keyof typeof BREAKDOWN_STRATEGY];

// ———————————————— 筛选器 "全部" 哨兵值 ————————————————
export const FILTER_ALL = 'all' as const;
