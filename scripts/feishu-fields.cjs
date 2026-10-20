/**
 * 飞书 Base 的唯一定义处：表 ID、字段名（含历史别名）、Excel 工作表/列名、constraints 列清单。
 *
 * 为什么要有这份字典：飞书侧改字段名（如 2026-10-18 把「物资名称」改成「物资类型」）时，
 * 若脚本里散落着裸字符串，改名后会静默取到 undefined；而本目录脚本多含整表替换写回，
 * 会直接把 tv2.json 的 name/inputs 写空。所以字段名一律在此定义一次，脚本只引用常量。
 *
 * 字段定义一律写成「别名数组」：[现行名, ...历史名]，取值时按顺序命中第一个存在的 key。
 */

/** 三张表的 table_id */
const TABLES = {
  LEVELS: 'tblvpgH6QxwfRgRn', // 关卡表
  INSTANCES: 'tbl6df5T6NZ9vjo2', // 物资主表
  GOALS: 'tbljsssYmtxnYFOF', // 关卡目标表
  TYPES: 'tbl6frIpsaHs4i6P', // 物资类型表（物资名 → 价格）
};

/** Excel 工作表名（convert.mjs 走 xlsx 导出这条历史路径） */
const SHEETS = {
  INSTANCES: '物资主表',
  LEVELS: '关卡',
  GOALS: '关卡目标',
  TRAINS: '列车',
};

/** 物资主表字段 */
const INSTANCE_FIELDS = {
  ID: ['物资ID'], // formula：物资名称 + RIGHT(RECORD_ID(),2)
  NAME: ['物资类型', '物资名称'], // select：2026-10-18 改名「物资名称」→「物资类型」
  RECIPE: ['物资生产配方', '配方物资类型'], // multi-select：同上改名
  EXTERNAL: ['外部获取'], // checkbox：可作为关卡外部物资站点候选
  INITIAL_SETUP: ['初始配置'], // checkbox：可作为关卡初始资源站点候选
  OBTAIN: ['获取方式'], // select：刷新/购买/无限/库存
  PER_OUT: ['单次产出'], // number
  PER_IN: ['单次消耗'], // number
  NEEDS_POWER: ['电力依赖'], // checkbox
  TOTAL_PRICE: ['总价'], // formula：配方单价 + 成品单价 = 每完成一个该实例可获得的总货币
};

/** 关卡表字段 */
const LEVEL_FIELDS = {
  NAME: ['名称'],
  CONTENT_TYPE: ['内容类型'],
  CONTENT_CATEGORY: ['内容分类'],
  CHAPTER: ['章节'],
  SECONDS: ['秒数'],
  BEST_TIME: ['最佳时间'],
  EARN: ['挣钱'],
  SPEND: ['花钱'],
};

/** 关卡目标表字段 */
const GOAL_FIELDS = {
  LEVEL: ['关卡'], // link → [{ id }]
  RESOURCE: ['目标物资'], // link → [{ id }]
  QTY: ['数量'], // number
};

/** 列车表字段 */
const TRAIN_FIELDS = {
  LEVEL: ['等级'],
  CAPACITY: ['载货量'],
  PRICE: ['价格'],
  UPGRADE: ['升级'],
  UPGRADABLE: ['可升级'],
};

/** 物资类型表字段（物资名 → 单价） */
const TYPE_FIELDS = {
  NAME: ['物资类型'], // select：物资名（如 原木）
  MONEY_NAME: ['物资名称'], // 文本：同 NAME
  PRICE: ['价格'], // formula/number：单份货币价值
  RATE: ['价格倍率'], // number：价格 / 1000
};

// constraints 参与星级的**列清单**已下沉到 shared/enums.js（TS 侧也要用，见 dev-standards §2）；
// 下面是飞书导入侧独有的「列类型划分」与「列名 → constraints key」映射。

/** 布尔型约束列（飞书打勾 → constraints 里记 '1'） */
const CONSTRAINT_BOOL_COLS = [
  '不停车', '不掉头', '不升车', '不造桥', '不造隧道', '避免碰撞', '避免错站', '不摧毁铺片', '不摧毁物品',
];

/** 数值型约束列（非空 → 原值字符串） */
const CONSTRAINT_NUM_COLS = [
  '碰撞数量', '进错站数', '摧毁限制', '摧毁物价值', '铺片限制', '桥梁限制', '隧道限制',
  '买车限制', '运送列车', '建造桥梁', '建造隧道',
];

/** 约束列名 → constraints key（列名与键名历史不一致的情况） */
const CONSTRAINT_ALIAS = {
  摧毁限制: '摧毁物价值',
};

// ————— 取值助手：统一「别名数组 + select / link / checkbox / number」各种形态 —————

/** 命中第一个存在的字段名，返回原始值（都不存在则 undefined） */
function pick(rec, def) {
  for (const key of def) if (rec[key] !== undefined) return rec[key];
  return undefined;
}

/** select / formula / 文本 → 首个字符串（缺失返回 ''） */
function text(rec, def) {
  const v = pick(rec, def);
  const first = Array.isArray(v) ? v[0] : v;
  return first == null ? '' : String(first);
}

/** multi-select → 字符串数组（缺失返回 []） */
function list(rec, def) {
  const v = pick(rec, def);
  return Array.isArray(v) ? v.filter(Boolean) : [];
}

/** checkbox → boolean */
function flag(rec, def) {
  return !!pick(rec, def);
}

/** number → 原始值，缺失/为空回落 fallback */
function num(rec, def, fallback) {
  return pick(rec, def) ?? fallback;
}

/** link 字段 → record_id 数组 */
function links(rec, def) {
  const v = pick(rec, def);
  return Array.isArray(v) ? v.map((x) => x.id) : [];
}

module.exports = {
  TABLES,
  SHEETS,
  INSTANCE_FIELDS,
  LEVEL_FIELDS,
  GOAL_FIELDS,
  TRAIN_FIELDS,
  TYPE_FIELDS,
  CONSTRAINT_BOOL_COLS,
  CONSTRAINT_NUM_COLS,
  CONSTRAINT_ALIAS,
  text,
  list,
  flag,
  num,
  links,
};
