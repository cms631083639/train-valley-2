/**
 * 挣钱测算领域派生逻辑（纯函数集合）。
 *
 * 核算口径：玩家列出的每一行 = 一个物资实例及其次数。把「被消耗、但未被已列出实例的产出覆盖」
 * 的物资，沿其生产实例继续递归展开，直到真正的外部叶子（工人 / 购买 / 刷新 / 初始库存 —— 即无配方的物资）。
 * 于是每一层物资各按其「类型价」计一次，上游每一层的工人价值也被计入 —— 即「生产链总价值」。
 *   - 产出收益 outputRevenue = Σ price(名) × produced(名)
 *   - 外部补算 externalRevenue = Σ 叶子缺口 × 单价
 *   - 合计 total = 产出收益 + 外部补算
 * 全程排除「电力」；缺 prices[名] 的按 0 计并标注。
 *
 * 多行合并时按「物资名」并集去重：共享的上游只计一次（故 total 可能小于各行独立链价值之和）。
 *
 * 只读现有数据（关卡 earnPlan + 实例库 + 物资单价 + 生产实例解析表），不写回任何引擎输入 ——
 * 玩家手动输入的计划完全旁路，绝不影响 breakdownGoals 的拆解结果。
 */
import type { EarnPlanRow, Level, ResourceInstance } from '@/types';
import { POWER_NAME } from '@/types';

/** 实例 id → 实例 的索引（对应 store.instById） */
export type EarnInstIndex = Map<string, ResourceInstance>;

/** 物资名 → 单价（对应 GameData.prices） */
export type EarnPriceIndex = Record<string, number>;

/** 物资名 → 该名用于递归展开的生产实例（调用方构造；仅含有配方 inputs.length>0 的实例） */
export type EarnProducerIndex = Map<string, ResourceInstance>;

/** 递归展开的最大轮数（防环 / 防未收敛） */
const EXPAND_MAX_ROUNDS = 64;

/** 挣钱测算的一行结果 */
export interface EarnPlanLine {
  /** 稳定行标识（与输入行一致） */
  uid?: string;
  /** 物资实例 id */
  resourceId: string;
  /** 该实例单独执行一次（qty=1）的完整链价值 */
  chainValue: number;
  /** 计划完成次数 */
  qty: number;
  /** 小计 = chainValue × qty */
  subtotal: number;
  /** 该实例产出名缺 prices 记录（按 0 计），供 UI 标注 */
  missingPrice: boolean;
}

/** 链外叶子明细（需要外部获取的缺口物资） */
export interface EarnExternalLine {
  /** 物资名 */
  name: string;
  /** 缺口数量 = max(0, 消耗 − 产出) */
  qty: number;
  /** 单价 */
  price: number;
  /** 小计 = price × qty */
  subtotal: number;
  /** 缺 prices 记录（按 0 计），供 UI 标注 */
  missingPrice: boolean;
}

/** 挣钱测算结果 */
export interface EarnPlanResult {
  /** 逐行结果（与输入行一一对应、顺序一致） */
  rows: EarnPlanLine[];
  /** 并集去重展开后的链外叶子明细（按首次出现顺序） */
  externals: EarnExternalLine[];
  /** 合计（多行并集去重后的 total） */
  total: number;
  /** 行小计合计 Σ rows.subtotal（各行独立链价值之和，可能因重叠 > total） */
  sumRowSubtotals: number;
}

/** 单次展开的内部结果 */
interface ExpandResult {
  /** 链外叶子明细 */
  externals: EarnExternalLine[];
  /** 合计 = 产出收益 + 外部补算 */
  total: number;
}

/**
 * 把一组行展开为「按物资名配平」的链：列出行产出直接计入 produced、配方输入计入 consumed，
 * 再对未被产出覆盖的消耗名沿其生产实例递归展开（上限 EXPAND_MAX_ROUNDS 轮，收敛即停），
 * 最后仍未覆盖且无生产实例的名即为链外叶子。全程排除「电力」。
 */
function expand(
  rows: EarnPlanRow[] | undefined,
  instances: EarnInstIndex,
  prices: EarnPriceIndex | undefined,
  producers: EarnProducerIndex | undefined,
): ExpandResult {
  /** 物资名 → 产出量（不含电力） */
  const produced = new Map<string, number>();
  /** 物资名 → 消耗量（不含电力），插入顺序即首次出现顺序 */
  const consumed = new Map<string, number>();

  // 1. 列出行：产出计入 produced、配方输入计入 consumed
  for (const row of rows ?? []) {
    const inst = row.resourceId ? instances.get(row.resourceId) : undefined;
    if (!inst || inst.name === POWER_NAME) continue;
    const qty = Number.isFinite(row.qty) ? row.qty : 0;
    produced.set(inst.name, (produced.get(inst.name) ?? 0) + (inst.perOut ?? 1) * qty);
    for (const n of inst.inputs) {
      if (n === POWER_NAME) continue;
      consumed.set(n, (consumed.get(n) ?? 0) + qty);
    }
  }

  // 2. 迭代展开：未被产出覆盖的消耗名，沿其生产实例递归展开（补齐缺口所需的整数个周期）
  for (let round = 0; round < EXPAND_MAX_ROUNDS; round++) {
    let changed = false;
    for (const [name, used] of consumed) {
      const have = produced.get(name) ?? 0;
      if (used <= have) continue;
      const p = producers?.get(name);
      if (!p || p.inputs.length === 0) continue;
      const perOut = p.perOut ?? 1;
      const cycles = Math.ceil((used - have) / perOut);
      produced.set(name, have + cycles * perOut);
      for (const n of p.inputs) {
        if (n === POWER_NAME) continue;
        consumed.set(n, (consumed.get(n) ?? 0) + cycles);
      }
      changed = true;
    }
    if (!changed) break;
  }

  // 3. 仍未覆盖且无生产实例的名 → 链外叶子
  const externals: EarnExternalLine[] = [];
  let externalRevenue = 0;
  for (const [name, used] of consumed) {
    const deficit = used - (produced.get(name) ?? 0);
    if (deficit <= 0) continue;
    const p = producers?.get(name);
    if (p && p.inputs.length > 0) continue; // 有生产实例的缺口应由上面展开消化
    const price = prices?.[name] ?? 0;
    const subtotal = price * deficit;
    externalRevenue += subtotal;
    externals.push({ name, qty: deficit, price, subtotal, missingPrice: prices?.[name] === undefined });
  }

  // 4. 产出收益 = Σ price(名) × produced(名)
  let outputRevenue = 0;
  for (const [name, qty] of produced) {
    outputRevenue += (prices?.[name] ?? 0) * qty;
  }

  return { externals, total: outputRevenue + externalRevenue };
}

/**
 * 挣钱测算：返回逐行链价值 + 并集去重合计。
 * - 逐行 chainValue = 该实例单独执行一次（qty=1）的完整链价值（对该单行跑一次 expand 的 total）
 * - total = 对所有行合并跑一次 expand（并集去重：共享上游只计一次）
 * 缺失实例 / 空行的行按 0 计（并保留行以与输入一一对应）；缺 prices 的物资名按 0 计并标注。
 */
export function computeEarnPlan(
  rows: EarnPlanRow[] | undefined,
  instances: EarnInstIndex,
  prices: EarnPriceIndex | undefined,
  producers?: EarnProducerIndex,
): EarnPlanResult {
  const out: EarnPlanLine[] = [];
  let sumRowSubtotals = 0;

  for (const row of rows ?? []) {
    const inst = row.resourceId ? instances.get(row.resourceId) : undefined;
    const qty = Number.isFinite(row.qty) ? row.qty : 0;
    // 单实例（qty=1）的完整链价值
    const chainValue = expand([{ resourceId: row.resourceId, qty: 1 }], instances, prices, producers).total;
    const subtotal = chainValue * qty;
    sumRowSubtotals += subtotal;
    out.push({
      uid: row.uid,
      resourceId: row.resourceId,
      chainValue,
      qty,
      subtotal,
      missingPrice: !!inst && inst.name !== POWER_NAME && prices?.[inst.name] === undefined,
    });
  }

  const union = expand(rows, instances, prices, producers);

  return { rows: out, externals: union.externals, total: union.total, sumRowSubtotals };
}

/** 关卡挣钱目标值：Number(level.earn)，空 / 非法 → 0 */
export function earnTargetOf(level: Level | undefined): number {
  const n = Number(level?.earn);
  return Number.isFinite(n) ? n : 0;
}
