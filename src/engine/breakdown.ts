/**
 * 物资拆解引擎（物资实例模型 + 动态分类）
 *
 * 输入：目标（物资实例 id + 数量）
 * 输出：沿配方链按"物资名称"反推到叶子的需求树 + 按原料汇总的最终需求表。
 *
 * 动态分类规则（不是静态字段，按配方链递归推导）：
 * - 原料(raw)：配方只有工人，或外部供给（刷新/购买/无限）。工人和电力本身永远是原料。
 * - 加工品(processed)：配方 = 工人 + 至少1种原料（不含任何加工品/复合品）。
 * - 复合品(compound)：配方含工人 + 至少1种加工品/复合品。
 *
 * 同一物资名可能有多个实例（不同关卡配方不同），分类按具体 recipe 推导。
 * 对于 UI 过滤场景，按最复杂分类展示（有 compound 就算 compound）。
 *
 * 电力隔离规则：电力只标记为"需通电"条件，自身消耗不计入总需求。
 */
import { POWER_NAME, WORKER_NAME } from '@/types';
import type { GameData, ResourceInstance, ResourceCategory, CoProductionGroup } from '@/types';
import { OBTAIN, VIA, CATEGORY } from '@/constants';

/** 同一物资名称存在多个生产实例时的选择策略 */
export type RecipeChoice = 'fewestInputs' | 'smallestPerCycle' | 'first' | 'mostInputs';

/** 拆解策略：控制拆卸组的使用方式 */
export type BreakdownStrategy = 'normal' | 'skipCoProduction' | 'minCoProduction' | 'mostInputs' | 'fewestInputs' | 'smallestPerCycle';

/** 节点解析方式 */
export type NodeVia = typeof VIA[keyof typeof VIA] | 'power';

export interface CoProductionOutputDetail {
  instanceId: string;
  name: string;
  perOut: number;
  produced: number;
  demanded: number;
}

export interface BreakdownNode {
  instanceId: string;
  name: string;
  qty: number;
  via: NodeVia;
  /** 动态分类（基于当前采用的实例配方） */
  category: ResourceCategory;
  obtain?: string;
  requiresPower: boolean;
  perCycle: number;
  cycles: number;
  inputNames: string[];
  children: BreakdownNode[];
  warning?: string;
  /** 拆卸组产出明细（仅 via='co-production' 时有值） */
  coOutputs?: CoProductionOutputDetail[];
}

/** 结构化警告：有 instance 的渲染视觉化配方，无 instance 的只显示 message */
export interface StructuredWarning {
  /** 文字说明（无 instance 时仅展示这个） */
  message: string;
  /** 选中的实例（可选，有就渲染配方模板） */
  instance?: ResourceInstance;
  /** 同名称但没被选中的其他实例 id（可选） */
  alternatives?: string[];
}

export interface BreakdownResult {
  roots: BreakdownNode[];
  /** 外部供给（空投购买 + 定时刷新） */
  externalNeeds: { name: string; qty: number; obtain: string }[];
  /** 生产站点负载 */
  productionLoad: { instanceId: string; name: string; cycles: number; requiresPower: boolean }[];
  /** 需通电站点 */
  powerNeeds: string[];
  /** 无限供给类（工人等） */
  infiniteNeeds: string[];
  /** ⭐ 最终基础原料汇总：从根目标沿配方链向下递归，所有叶子原料（按名称合并数量） */
  rawNeeds: { name: string; qty: number }[];
  /** 👷 工人总需求（虽然无限供应，但显示数量方便规划） */
  workerNeeds: number;
  /** ⚠️ 警告：需要用户行动（多实例未指定、生产链错误等） */
  warnings: StructuredWarning[];
  /** ✅ 已解决：自动选/已确认的实例（告知用） */
  resolved: StructuredWarning[];
}

interface Index {
  byName: Map<string, ResourceInstance[]>;
  byId: Map<string, ResourceInstance>;
  /** 关卡局部覆盖：每个 name 一个用户选择的实例，优先于全局 chooseProducer */
  localByName?: Map<string, ResourceInstance>;
  /** goals 里用户直接指定了具体实例的 name 集合 → 这些 name 在 resolved 里跳过（用户本身就是要它当根目标） */
  rootNames: Set<string>;
  /** 关卡物资站点已覆盖的 name 集合 → 这些 name 也跳过 resolved/warnings（关卡已确认） */
  stationSuppliedNames: Set<string>;
  /**
   * 关卡电力配置模式：
   * - 'none'   = 不配置电力 → 关卡里没有任何电力，needsPower=true 的实例不追加电力消耗
   * - 'single' = 单实例电力 → 用 powerSources[0] 作为关卡电力 override，正常展开
   * - 'multi'  = 多实例电力 → 只追加电力标记（⚡️ ×N），不展开 inputs（不算物资消耗）
   */
  powerMode: 'none' | 'single' | 'multi';
  /** 关卡选定的电力实例 id 数组（single 模式用 [0]，multi 模式只用于 UI 展示） */
  powerSources: string[];
  /**
   * 拆卸组已按 name 满足的产量汇总。
   * 在 breakdownGoals 展开拆卸组后填充，expandByName 自动扣除，
   * 避免同名的独立实例重复计算。
   */
  satisfiedByName?: Map<string, number>;
  /**
   * 需求探测开关（干跑阶段临时设置）。
   * 开启后 expandByName 会把每个名称的毛需求累加进来，
   * 供拆卸组按"全链缺口"推导拆分次数；干跑结束后立即置空。
   */
  demandProbe?: Map<string, number>;
}

function buildIndex(
  data: GameData,
  localInstances?: ResourceInstance[],
  overrides?: Record<string, string>,
  rootNames = new Set<string>(),
  stationSuppliedNames = new Set<string>(),
  powerSources: string[] = [],
): Index {
  const byName = new Map<string, ResourceInstance[]>();
  for (const it of data.instances) {
    const arr = byName.get(it.name) ?? [];
    arr.push(it);
    byName.set(it.name, arr);
  }

  // 🎯 推断电力模式
  const ps = powerSources.filter(Boolean);
  const powerMode: Index['powerMode'] =
    ps.length === 0 ? 'none' : ps.length === 1 ? 'single' : 'multi';

  let localByName: Map<string, ResourceInstance> | undefined;
  // 优先级（从低到高）：localInstances（goals 里的实例）< overrides（警告区用户显式选的）< powerSources[0]（关卡主电力）
  const hasOverrides = (overrides && Object.keys(overrides).length) || (localInstances && localInstances.length) || powerMode === 'single';
  if (hasOverrides) {
    localByName = new Map();
    if (localInstances) {
      for (const inst of localInstances) localByName.set(inst.name, inst);
    }
    if (overrides) {
      for (const [name, id] of Object.entries(overrides)) {
        const inst = byName.get(name)?.find((i) => i.id === id);
        if (inst) localByName.set(name, inst);
      }
    }
    // 🎯 single 模式：powerSources[0] 作为关卡电力 override（优先级最高）
    if (powerMode === 'single') {
      const mainId = ps[0];
      const pInst = byName.get(POWER_NAME)?.find((i) => i.id === mainId);
      if (pInst) localByName.set(POWER_NAME, pInst);
    }
  }
  return { byName, byId: new Map(data.instances.map((i) => [i.id, i])), localByName, rootNames, stationSuppliedNames, powerMode, powerSources: ps };
}

// ————————————————— 分类引擎 —————————————————

/**
 * 按名称分类（用于 UI 过滤 / 无特定实例时）。
 * 递归 + 记忆化 + 成环保护。取所有生产配方中最复杂的那一类。
 */
export function classifyName(name: string, data: GameData, localByName?: Map<string, ResourceInstance>): ResourceCategory {
  const memo = new Map<string, ResourceCategory>();
  return classifyNameImpl(name, data, memo, new Set(), localByName);
}

function classifyNameImpl(
  name: string,
  data: GameData,
  memo: Map<string, ResourceCategory>,
  trail: Set<string>,
  localByName?: Map<string, ResourceInstance>,
): ResourceCategory {
  if (name === WORKER_NAME) return CATEGORY.RAW; // 工人永远是原料（无限供应）
  // 电力不再硬编码 raw — 电力的类型取决于实际选的那个电力实例的 inputs
  // 电力lf（无inputs→raw）、电力Lb（仅工人→raw）、电力4n（工人+煤炭→processed）、电力0q（工人+铀→processed）、电力VV（工人+石油→processed）
  if (memo.has(name)) return memo.get(name)!;
  if (trail.has(name)) return CATEGORY.RAW; // 循环引用时兜底为原料（最简单）

  trail.add(name);

  // 优先用关卡局部指定的那个实例
  const local = localByName?.get(name);
  const producers = local
    ? [local]
    : data.instances.filter((i) => i.name === name && i.inputs.length > 0);
  const result = classifyByRecipes(producers, data, memo, trail, localByName);

  trail.delete(name);
  memo.set(name, result);
  return result;
}

/**
 * 按一组生产实例分类：取最复杂。
 */
function classifyByRecipes(
  producers: ResourceInstance[],
  data: GameData,
  memo: Map<string, ResourceCategory>,
  trail: Set<string>,
  localByName?: Map<string, ResourceInstance>,
): ResourceCategory {
  if (!producers.length) return CATEGORY.RAW; // 无生产配方 → 外部供给 → 原料

  let hasProcessed = false;
  let hasCompound = false;

  for (const p of producers) {
    const cat = classifyInputs(p.inputs, data, memo, trail, localByName);
    if (cat === CATEGORY.COMPOUND) hasCompound = true;
    else if (cat === CATEGORY.PROCESSED) hasProcessed = true;
  }

  if (hasCompound) return CATEGORY.COMPOUND;
  if (hasProcessed) return CATEGORY.PROCESSED;
  return CATEGORY.RAW;
}

/**
 * 按"某一条配方的输入列表"分类。
 * 去除工人和电力后：
 * - 剩余为空 → raw（只有工人）
 * - 剩余全是 raw → processed
 * - 剩余有 processed/compound → compound
 *
 * 可选 localByName：关卡局部实例索引（overrides + localInstances），
 * 传入后优先用关卡选的实例递归，找不到再 fallback 到全局 data.instances。
 */
function classifyInputs(
  inputs: string[],
  data: GameData,
  memo: Map<string, ResourceCategory>,
  trail: Set<string>,
  localByName?: Map<string, ResourceInstance>,
): ResourceCategory {
  // 只过滤工人（无限供应永远是 raw），电力要参与分类（它的类型由实际电力实例决定）
  const others = inputs.filter((n) => n !== WORKER_NAME);
  if (!others.length) return CATEGORY.RAW;

  let hasNonRaw = false;
  for (const n of others) {
    const sub = classifyNameImpl(n, data, memo, trail, localByName);
    if (sub !== CATEGORY.RAW) {
      hasNonRaw = true;
      break;
    }
  }
  return hasNonRaw ? CATEGORY.COMPOUND : CATEGORY.PROCESSED;
}

/**
 * 按具体实例的配方分类（拆解树中每个节点 + GoalEditor 类型列 都用这个）。
 * localByName 传入后优先用关卡局部实例递归，保证 GoalEditor 和拆解树分类一致。
 */
export function classifyInstance(
  inst: ResourceInstance,
  data: GameData,
  localByName?: Map<string, ResourceInstance>,
): ResourceCategory {
  if (!inst.inputs.length && !inst.needsPower) return CATEGORY.RAW;
  if (inst.name === WORKER_NAME) return CATEGORY.RAW; // 工人永远是原料

  // 构造分类用的 inputs 列表：真实 inputs +（needsPower 时加虚拟 '电力'）
  // 电力的类型由实际电力实例决定（通过 localByName → 关卡选的 override 或 fallback 全局）
  const catInputs = [...inst.inputs];
  if (inst.needsPower) catInputs.push(POWER_NAME);

  const memo = new Map<string, ResourceCategory>();
  return classifyInputs(catInputs, data, memo, new Set(), localByName);
}

// ————————————————— 核心拆解 —————————————————

function pickProducers(list: ResourceInstance[]): ResourceInstance[] {
  return list.filter((i) => i.inputs.length > 0);
}

function viaOfSupply(inst: ResourceInstance): NodeVia {
  if (inst.obtain === OBTAIN.BUY) return VIA.EXTERNAL;
  if (inst.obtain === OBTAIN.REFRESH) return VIA.REFRESH;
  if (inst.obtain === OBTAIN.INFINITE) return VIA.INFINITE;
  if (inst.obtain === OBTAIN.PASSENGER) return VIA.EXTERNAL;  // 客流也是外部供给
  if (inst.obtain === OBTAIN.STOCK) return VIA.EXTERNAL;  // 库存也是外部供给
  if (inst.external) return VIA.EXTERNAL;           // 兜底：任何 external=true 都算外部供给
  if (inst.needsPower) return VIA.AUTO;
  return VIA.UNKNOWN;
}

function pickSupply(list: ResourceInstance[]): ResourceInstance | undefined {
  const supplies = list.filter((i) => i.inputs.length === 0);
  return supplies.find((i) => viaOfSupply(i) !== VIA.UNKNOWN) ?? supplies[0];
}

function chooseProducer(candidates: ResourceInstance[], choice: RecipeChoice): ResourceInstance {
  if (candidates.length === 1) return candidates[0];
  const sorted = [...candidates];
  switch (choice) {
    case 'smallestPerCycle':
      sorted.sort((a, b) => (a.perOut ?? 1) - (b.perOut ?? 1) || a.inputs.length - b.inputs.length);
      break;
    case 'first':
      break;
    case 'mostInputs':
      sorted.sort((a, b) => b.inputs.length - a.inputs.length || (b.perOut ?? 1) - (a.perOut ?? 1));
      break;
    case 'fewestInputs':
    default:
      sorted.sort((a, b) => a.inputs.length - b.inputs.length);
  }
  return sorted[0];
}

/** 从已知实例展开（根节点 / 子节点都走这里，精确 instanceId） */
function expandInstance(
  inst: ResourceInstance,
  qty: number,
  idx: Index,
  choice: RecipeChoice,
  trail: string[],
  warnings: StructuredWarning[],
  resolved: StructuredWarning[],
  depth: number,
  data: GameData,
): BreakdownNode {
  if (depth > 20) {
    warnings.push({ message: `「${inst.name}」生产链超过最大深度，已停止展开` });
    return leaf(inst.name, qty, VIA.UNKNOWN, data, '', inst.id);
  }

  // 循环引用：trail 按 name 检测（同名多实例是同一个物资维度，比 instanceId 更精准）
  if (trail.includes(inst.name)) {
    const cyclePath = [...trail, inst.name].join(' → ');
    warnings.push({ message: `⚠️ 生产链循环：${cyclePath}` });
    return leaf(inst.name, qty, VIA.UNKNOWN, data, '', inst.id);
  }

  // 外部供给节点（无 inputs）
  if (!inst.inputs.length) {
    const via = viaOfSupply(inst);
    if (via === VIA.UNKNOWN) {
      warnings.push({ message: `「${inst.name}」(${inst.id}) 既无配方也无外部供给标记，需人工确认来源` });
      return leaf(inst.name, qty, VIA.UNKNOWN, data, '', inst.id, false, (inst.perOut ?? 1));
    }
    return leaf(inst.name, qty, via, data, inst.obtain ?? '', inst.id, inst.needsPower, (inst.perOut ?? 1));
  }

  // 有 inputs → 生产节点
  const perCycle = Math.max(1, (inst.perOut ?? 1));
  const cycles = Math.ceil(qty / perCycle);
  const category = classifyInstance(inst, data, idx.localByName);

  const children: BreakdownNode[] = [];
  const merged = new Map<string, number>();
  for (const input of inst.inputs) {
    if (input === WORKER_NAME) continue; // 工人：无限供应，不进 children
    if (input === POWER_NAME) continue; // 电力：不会出现在 inputs 里（needsPower 是独立标记）
    merged.set(input, (merged.get(input) ?? 0) + (inst.perIn ?? 1) * cycles);
  }
  const newTrail = [...trail, inst.name];
  for (const [iname, iqty] of merged) {
    children.push(expandByName(iname, iqty, idx, choice, newTrail, warnings, resolved, depth + 1, data));
  }
  // 🎯 如果该实例 needsPower=true：根据关卡电力模式决定怎么处理
  // - 'none'  = 关卡没有电力 → 完全不追加电力节点
  // - 'single'= 单实例电力 → 正常 expandByName('电力') 消耗
  // - 'multi' = 多实例电力 → 只追加一个标记 leaf（via=VIA.POWER_TAG），不算物资消耗
  if (inst.needsPower) {
    if (idx.powerMode === 'none') {
      // 此关没有电力 → 完全不追加（钢板不消耗任何电力）
    } else if (idx.powerMode === 'multi') {
      // 多实例电力 → 追加标记节点，告诉用户"这些 cycles 需要通电"，但不展开 inputs
      children.push({
        instanceId: '',
        name: POWER_NAME,
        qty: cycles,
        via: VIA.POWER_TAG,
        category: CATEGORY.RAW,
        requiresPower: false,
        perCycle: 1,
        cycles,
        inputNames: [],
        children: [],
      });
    } else {
	      // single 模式 → 正常追加，但如果电力已在 trail 中则跳过（避免供需循环）
	      if (newTrail.includes(POWER_NAME)) {
	        children.push({
	          instanceId: '',
	          name: POWER_NAME,
	          qty: cycles,
	          via: VIA.POWER_TAG,
	          category: CATEGORY.RAW,
	          requiresPower: false,
	          perCycle: 1,
	          cycles,
	          inputNames: [],
	          children: [],
	        });
	      } else {
	        children.push(expandByName(POWER_NAME, cycles, idx, choice, newTrail, warnings, resolved, depth + 1, data));
	      }
	    }
  }

  return {
    instanceId: inst.id,
    name: inst.name,
    qty,
    via: VIA.PRODUCE,
    category,
    requiresPower: !!inst.needsPower,
    perCycle,
    cycles,
    inputNames: [...inst.inputs],
    children,
  };
}

/**
 * 从名称展开（子节点 inputs 走这里，可能多实例）。
 * 同名称多实例时用 choice 策略选，并在 warnings 里提示。
 */
function expandByName(
  name: string,
  qty: number,
  idx: Index,
  choice: RecipeChoice,
  trail: string[],
  warnings: StructuredWarning[],
  resolved: StructuredWarning[],
  depth: number,
  data: GameData,
): BreakdownNode {
  // 🔍 需求探测（干跑阶段）：累加该名称的毛需求，供拆卸组按全链缺口推导次数
  if (idx.demandProbe) {
    idx.demandProbe.set(name, (idx.demandProbe.get(name) ?? 0) + qty);
  }

  // 🎯 拆卸组已满足的产量扣除
  if (idx.satisfiedByName) {
    const satisfied = idx.satisfiedByName.get(name) ?? 0;
    if (satisfied >= qty) {
      // 已全部满足，无需额外生产
      return leaf(name, 0, VIA.CO_PRODUCTION, data, '', name);
    }
    if (satisfied > 0) {
      // 已部分满足，只生产剩余部分
      qty = qty - satisfied;
    }
  }

  const list = idx.byName.get(name) ?? [];
  if (!list.length) {
    warnings.push({ message: `「${name}」在物资主表中不存在，无法拆解` });
    return leaf(name, qty, VIA.UNKNOWN, data);
  }

  const producers = pickProducers(list);
  const supply = pickSupply(list);
  // 所有可选实例（supply + 所有 producers），提前计算供所有分支用
  const allIds = list.map((p) => p.id);

  // 🎯 关卡局部覆盖：如果 localByName 里有这个 name，优先用用户选的那个实例
  // 但如果 name 已在 goals 里作为根目标被用户直接指定，或已被关卡物资站点覆盖 → 跳过 resolved（已确认）
  const isConfirmed = idx.rootNames.has(name) || idx.stationSuppliedNames.has(name);
  const local = idx.localByName?.get(name);
  if (local && producers.includes(local)) {
    if (!isConfirmed && !resolved.some((r) => r.message.startsWith(`「${name}」已确认`)))
      resolved.push({ message: `「${name}」已确认实例`, instance: local, alternatives: allIds });
    return expandInstance(local, qty, idx, choice, trail, warnings, resolved, depth, data);
  }
  // 🐛 修复：localByName 里的外部供给实例可能不是 pickSupply 返回的那个（同名多外部实例时），
	  // 所以要额外检查 local 是否无 inputs（即外部供给），而不仅靠 supply === local 引用相等
	  if (local && (!local.inputs.length || supply === local)) {
	    if (!isConfirmed && !resolved.some((r) => r.message.startsWith(`「${name}」已确认`)))
	      resolved.push({ message: `「${name}」已确认实例`, instance: local, alternatives: allIds });
	    return expandInstance(local, qty, idx, choice, trail, warnings, resolved, depth, data);
	  }

  // 去重：同名的多实例未指定警告 / 已自动选提示 都只保留第一条
  const warnDupKey = `「${name}」未指定实例`;
  const alreadyWarned = warnings.some((w) => w.message.startsWith(warnDupKey));
  const resDupKey = `「${name}」已自动选`;
  const alreadyResolved = resolved.some((r) => r.message.startsWith(resDupKey));

  if (!producers.length && supply) {
    // 只有外部供给一种选择 → 自动选，绿色提示
    if (!isConfirmed && !alreadyResolved) resolved.push({ message: `「${name}」已自动选外部供给`, instance: supply, alternatives: allIds });
    return expandInstance(supply, qty, idx, choice, trail, warnings, resolved, depth, data);
  }
  if (producers.length === 1 && !supply) {
    // 只有一个生产实例 → 自动选，绿色提示
    const chosen = producers[0];
    if (!isConfirmed && !alreadyResolved) resolved.push({ message: `「${name}」已自动选唯一生产实例`, instance: chosen, alternatives: allIds });
    return expandInstance(chosen, qty, idx, choice, trail, warnings, resolved, depth, data);
  }

  // ⚠️ 多实例可选 + 未指定 → 琥珀色警告，让用户确认
  const chosen = chooseProducer(producers, choice);
  // 多实例未指定：如果 name 已被 goals 指定或已被关卡站点覆盖 → 跳过警告
  if (!isConfirmed && !alreadyWarned)
    warnings.push({ message: `「${name}」未指定实例，默认按"${choice}"策略选择`, instance: chosen, alternatives: allIds });
  return expandInstance(chosen, qty, idx, choice, trail, warnings, resolved, depth, data);
}

function leaf(
  name: string,
  qty: number,
  via: NodeVia,
  data: GameData,
  obtain = '',
  instanceId = '',
  requiresPower = false,
  perCycle = 0,
): BreakdownNode {
  // 叶子节点的分类：外部供给/工人是 raw；电力/unknown 等走 classifyName（让电力也能按实际实例分类）
  let category: ResourceCategory;
  if (name === WORKER_NAME) category = CATEGORY.RAW;
  else if (via === VIA.EXTERNAL || via === VIA.REFRESH || via === VIA.INFINITE) category = CATEGORY.RAW;
  else if (via === VIA.AUTO) category = classifyName(name, data);
  else category = classifyName(name, data);

  return {
    instanceId,
    name,
    qty,
    via,
    category,
    obtain,
    requiresPower: requiresPower || via === 'power',
    perCycle,
    cycles: perCycle ? Math.ceil(qty / perCycle) : 0,
    inputNames: [],
    children: [],
  };
}

// ————————————————— 汇总收集 —————————————————

function collect(
  node: BreakdownNode,
  ext: Map<string, { qty: number; obtain: string }>,
  prod: Map<string, { name: string; cycles: number; requiresPower: boolean }>,
  power: Set<string>,
  infinite: Set<string>,
) {
  if (node.via === 'power') return;
  if (node.name === POWER_NAME) return;

  // 拆卸组：每个产出实例分别计入 productionLoad，children 继续展开
  if (node.via === VIA.CO_PRODUCTION) {
    if (node.coOutputs) {
      for (const o of node.coOutputs) {
        const key = o.instanceId;
        const cur = prod.get(key) ?? { name: o.name, cycles: 0, requiresPower: false };
        cur.cycles = Math.max(cur.cycles, node.cycles);
        prod.set(key, cur);
      }
    }
    for (const c of node.children) collect(c, ext, prod, power, infinite);
    return;
  }

  if (node.via === VIA.EXTERNAL || node.via === VIA.REFRESH) {
    const cur = ext.get(node.name) ?? { qty: 0, obtain: node.obtain ?? '外部' };
    cur.qty += node.qty;
    ext.set(node.name, cur);
    return;
  }
  if (node.via === VIA.INFINITE) {
    infinite.add(node.name);
    return;
  }
  if (node.via === VIA.AUTO) {
    power.add(node.name);
    return;
  }
  if (node.via === VIA.PRODUCE) {
    const cur = prod.get(node.instanceId) ?? { name: node.name, cycles: 0, requiresPower: node.requiresPower };
    cur.cycles = Math.max(cur.cycles, node.cycles);
    prod.set(node.instanceId, cur);
    if (node.requiresPower) power.add(node.name);
  }
  for (const c of node.children) collect(c, ext, prod, power, infinite);
}

/**
 * 汇总最终基础原料：从每个根节点向下递归。
 * 遇到 category=CATEGORY.RAW 或外部供给节点就累加数量；
 * 遇到 processed/compound 就继续往下拆。
 * 工人(无限)和电力(隔离)不计入最终原料。
 */
function collectRaw(node: BreakdownNode, raw: Map<string, number>): void {
  // 电力节点：完全隔离，自身及 children 都不计入最终基础物资
  if (node.name === POWER_NAME) return;
  if (node.via === 'power' || node.name === WORKER_NAME) return;

  // 拆卸组：不把节点自身计为原料，继续下钻 children 展开
  if (node.via === VIA.CO_PRODUCTION) {
    for (const c of node.children) collectRaw(c, raw);
    return;
  }

  // 叶子：外部供给 / 无限（除了工人） / 原料分类的节点 → 计入
  if (node.via === VIA.EXTERNAL || node.via === VIA.REFRESH || node.via === VIA.INFINITE) {
    raw.set(node.name, (raw.get(node.name) ?? 0) + node.qty);
    return;
  }

  // 生产节点：真实输入里没有"工人/电力以外"的物资 → 就是链路叶子，按原料计入
  // （不强制 category===RAW：needsPower 实例的虚拟电力会把分类带偏成 compound，
  //   但它本身没有任何真实物资输入，若不在此计入，数量会凭空消失）
  if (node.via === VIA.PRODUCE) {
    const others = node.inputNames.filter((n) => n !== WORKER_NAME && n !== POWER_NAME);
    if (!others.length) {
      raw.set(node.name, (raw.get(node.name) ?? 0) + node.qty);
      return;
    }
  }

  // 加工品/复合品继续向下拆
  for (const c of node.children) collectRaw(c, raw);
}

/** 统计全链路工人总需求（所有生产节点直接消耗的工人数） */
function collectWorkers(node: BreakdownNode, count: { total: number }): void {
  if (node.name === WORKER_NAME) {
    count.total += node.qty;
    return;
  }
  for (const c of node.children) collectWorkers(c, count);
}

// ————————————————— 拆卸组展开 —————————————————

/**
 * 展开一个拆卸组（共享配方，一次生产同时产出多实例）。
 * 组周期 = max(ceil(demand_i / perOut_i) for each output i)
 * 消耗 = perIn × 组周期（一次消耗，非各输出累加）
 */
function expandCoProductionGroup(
  group: CoProductionGroup,
  goals: { instanceId: string; qty: number }[],
  idx: Index,
  choice: RecipeChoice,
  warnings: StructuredWarning[],
  resolved: StructuredWarning[],
  depth: number,
  data: GameData,
  strategy: BreakdownStrategy = 'normal',
): BreakdownNode {
  // 1. 汇总组内各 output 的总需求量
  const demandMap = new Map<string, number>();
  for (const g of goals) {
    demandMap.set(g.instanceId, (demandMap.get(g.instanceId) ?? 0) + g.qty);
  }

  // 2. 计算组周期数
  const perIn = group.perIn ?? 1;
  let groupCycles = 0;
  const outputs: CoProductionOutputDetail[] = [];
  for (const out of group.outputs) {
    const demand = demandMap.get(out.instanceId) ?? 0;
    const perOut = out.perOut ?? 1;
    const needed = Math.ceil(demand / perOut);
    groupCycles = Math.max(groupCycles, needed);
    outputs.push({
      instanceId: out.instanceId,
      name: idx.byId.get(out.instanceId)?.name ?? out.instanceId,
      perOut,
      produced: 0,
      demanded: demand,
    });
  }
  // 🎯 minCoProduction 策略：组周期取最小需求，而非最大
  if (strategy === 'minCoProduction') {
    let minCycles = Infinity;
    for (const out of group.outputs) {
      const demand = demandMap.get(out.instanceId) ?? 0;
      if (demand > 0) {
        const perOut = out.perOut ?? 1;
        const needed = Math.ceil(demand / perOut);
        minCycles = Math.min(minCycles, needed);
      }
    }
    groupCycles = minCycles === Infinity ? 0 : minCycles;
  }
  // 回填实际产出（次数完全由需求推导，manualOutput 不再锁定产出量）
  for (const o of outputs) {
    o.produced = groupCycles * o.perOut;
  }

  // 3. 取第一个 output 的实例作为配方来源（所有 output 应共享相同 inputs）
  const firstOut = group.outputs[0];
  const firstInst = firstOut ? idx.byId.get(firstOut.instanceId) : undefined;
  if (!firstInst || !firstInst.inputs.length) {
    warnings.push({ message: `拆卸组「${group.label ?? group.id}」缺少有效的产出实例配方` });
    return leaf(group.label ?? group.id, 0, VIA.UNKNOWN, data);
  }

  // 4. 验证所有 output 的 inputs 一致
  for (const out of group.outputs) {
    const inst = idx.byId.get(out.instanceId);
    if (inst && JSON.stringify(inst.inputs) !== JSON.stringify(firstInst.inputs)) {
      warnings.push({
        message: `拆卸组「${group.label ?? group.id}」中 ${out.instanceId} 的配方（${inst.inputs.join(',')}）与其他实例不一致，将按 ${firstInst.inputs.join(',')} 计算`,
      });
    }
  }

  // 5. 展开共享消耗
  const totalInputQty = perIn * groupCycles;
  const children: BreakdownNode[] = [];
  const merged = new Map<string, number>();
  for (const input of firstInst.inputs) {
    if (input === WORKER_NAME) continue;
    if (input === POWER_NAME) continue;
    merged.set(input, (merged.get(input) ?? 0) + totalInputQty);
  }
  const newTrail = [group.label ?? group.id];
  for (const [iname, iqty] of merged) {
    children.push(expandByName(iname, iqty, idx, choice, newTrail, warnings, resolved, depth + 1, data));
  }

  return {
    instanceId: group.id,
    name: group.label ?? group.id,
    qty: totalInputQty,
    via: VIA.CO_PRODUCTION,
    category: CATEGORY.RAW,
    requiresPower: false,
    perCycle: groupCycles,
    cycles: groupCycles,
    inputNames: firstInst.inputs,
    children,
    coOutputs: outputs,
  };
}

// ————————————————— 主入口 —————————————————

export function breakdownGoals(
  goals: { instanceId: string; qty: number }[],
  data: GameData,
  choice: RecipeChoice = 'fewestInputs',
  localInstances?: ResourceInstance[],
  overrides?: Record<string, string>,
  stationSuppliedNames = new Set<string>(),
  powerSources: string[] = [],
  coProductionGroups?: CoProductionGroup[],
  strategy: BreakdownStrategy = 'normal',
): BreakdownResult {
  // 🎯 策略映射
  let effectiveChoice = choice;
  let effectiveCoGroups = coProductionGroups;
  switch (strategy) {
    case 'mostInputs':
      effectiveChoice = 'mostInputs' as RecipeChoice;
      effectiveCoGroups = undefined;
      break;
    case 'fewestInputs':
      effectiveChoice = 'fewestInputs' as RecipeChoice;
      effectiveCoGroups = undefined;
      break;
    case 'smallestPerCycle':
      effectiveChoice = 'smallestPerCycle' as RecipeChoice;
      effectiveCoGroups = undefined;
      break;
    case 'skipCoProduction':
      effectiveCoGroups = undefined;
      break;
    case 'minCoProduction':
    case 'normal':
    default:
      // 保持默认
      break;
  }

  // 🎯 扫描 goals：用户在目标录入里直接指定的具体实例 → 这些 name 已被显式选过，不再在 resolved 警告区重复出现
  const rootNames = new Set<string>();
  for (const g of goals) {
    const inst = data.instances.find((i) => i.id === g.instanceId);
    if (inst) rootNames.add(inst.name);
  }

  const idx = buildIndex(data, localInstances, overrides, rootNames, stationSuppliedNames, powerSources);
  const warnings = [] as StructuredWarning[];
  const resolved = [] as StructuredWarning[];

  // ① 构建实例ID → 拆卸组的映射
  const cpMap = new Map<string, CoProductionGroup>();
  if (effectiveCoGroups?.length) {
    for (const cp of effectiveCoGroups) {
      for (const out of cp.outputs) {
        cpMap.set(out.instanceId, cp);
      }
    }
  }

  // ② 将 goals 分为：拆卸组产出（直接需求）和其他目标
  const nonCpGoals: { instanceId: string; qty: number }[] = [];
  // goals 中直接指向拆卸组产出的需求，按名称汇总（视为已确认，不参与下游抵扣）
  const directByName = new Map<string, number>();
  for (const g of goals) {
    const cp = cpMap.get(g.instanceId);
    if (cp) {
      const nm = idx.byId.get(g.instanceId)?.name ?? g.instanceId;
      directByName.set(nm, (directByName.get(nm) ?? 0) + g.qty);
    } else {
      nonCpGoals.push(g);
    }
  }

  const roots: BreakdownNode[] = [];
  const satisfiedByName = new Map<string, number>();

  // ③ 需求探测（干跑）：先展开一次非拆卸目标，统计各名称的全链毛需求。
  //    此时 satisfiedByName 未设置，得到的是纯缺口；只要拆卸产出名出现在需求链上就算需求。
  const probeDemand = new Map<string, number>();
  if (effectiveCoGroups?.length) {
    idx.demandProbe = probeDemand;
    for (const g of nonCpGoals) {
      const inst = idx.byId.get(g.instanceId);
      if (inst) expandInstance(inst, g.qty, idx, effectiveChoice, [], [], [], 0, data);
    }
    idx.demandProbe = undefined;
    // goals 中直接指向拆卸产出的量同样计入总需求
    for (const [nm, qty] of directByName) probeDemand.set(nm, (probeDemand.get(nm) ?? 0) + qty);
  }

  // ④ 按全链缺口推导每个拆卸组的拆分次数：
  //    一次拆卸同时产出多种物资，次数 = max(各产出名缺口 / perOut)；
  //    产出优先满足 goals 的直接需求，其余写入 satisfiedByName 供下游按名抵扣。
  const remainingProbe = new Map(probeDemand);
  if (effectiveCoGroups?.length) {
    for (const cp of effectiveCoGroups) {
      const virtualGoals = cp.outputs.map((o) => {
        const nm = idx.byId.get(o.instanceId)?.name ?? o.instanceId;
        return { instanceId: o.instanceId, qty: remainingProbe.get(nm) ?? 0 };
      });
      // 产出名在整条需求链上都没有缺口 → 该组无需展开
      if (!virtualGoals.some((v) => v.qty > 0)) continue;

      const root = expandCoProductionGroup(cp, virtualGoals, idx, effectiveChoice, warnings, resolved, 0, data, strategy);
      roots.push(root);

      for (const o of root.coOutputs ?? []) {
        const direct = directByName.get(o.name) ?? 0;
        // 扣除 goals 直接消耗后，剩余部分才是可用于抵扣下游的量
        const forDownstream = Math.max(0, o.produced - direct);
        const avail = remainingProbe.get(o.name) ?? 0;
        const used = Math.min(forDownstream, avail);
        if (used > 0) {
          remainingProbe.set(o.name, avail - used);
          satisfiedByName.set(o.name, (satisfiedByName.get(o.name) ?? 0) + used);
        }
      }
    }
  }
  if (satisfiedByName.size > 0) {
    idx.satisfiedByName = satisfiedByName;
  }

  // ⑤ 展开非拆卸目标（此时已知道拆卸产出，会自动扣除已满足量）
  for (const g of nonCpGoals) {
    let inst = idx.byId.get(g.instanceId);
    if (!inst) {
      warnings.push({ message: `目标引用的物资实例 ${g.instanceId} 不存在` });
      roots.push(leaf(g.instanceId, g.qty, VIA.UNKNOWN, data, '', g.instanceId));
      continue;
    }
    // 非拆卸目标使用用户指定的实例，不应用 localByName 覆盖（用户已明确选择）
    roots.push(expandInstance(inst, g.qty, idx, effectiveChoice, [], warnings, resolved, 0, data));
  }

  // ⑥ minCoProduction 策略：组周期按最小需求计算，缺口部分用独立实例补充
  if (strategy === 'minCoProduction') {
    for (const r of roots) {
      if (r.via === VIA.CO_PRODUCTION && r.coOutputs) {
        for (const o of r.coOutputs) {
          const remaining = o.demanded - o.produced;
          if (remaining > 0) {
            // 从拆卸实例中找到独立生产实例
            const inst = idx.byId.get(o.instanceId);
            if (inst) {
              roots.push(expandInstance(inst, remaining, idx, effectiveChoice, [], warnings, resolved, 0, data));
            }
          }
        }
      }
    }
  }

  const ext = new Map<string, { qty: number; obtain: string }>();
  const prod = new Map<string, { name: string; cycles: number; requiresPower: boolean }>();
  const power = new Set<string>();
  const infinite = new Set<string>();
  for (const r of roots) collect(r, ext, prod, power, infinite);

  // ⭐ 最终原料汇总
  const rawMap = new Map<string, number>();
  for (const r of roots) collectRaw(r, rawMap);

  // 👷 工人总需求
  const workerCount = { total: 0 };
  for (const r of roots) collectWorkers(r, workerCount);

  return {
    roots,
    externalNeeds: [...ext.entries()].map(([name, v]) => ({ name, qty: v.qty, obtain: v.obtain })),
    productionLoad: [...prod.entries()].map(([instanceId, v]) => ({ instanceId, ...v })),
    powerNeeds: [...power],
    infiniteNeeds: [...infinite],
    rawNeeds: [...rawMap.entries()].map(([name, qty]) => ({ name, qty })),
    workerNeeds: workerCount.total,
    warnings,
    resolved,
  };
}

/** 从目标实例出发，列出其直接生产输入名称 */
export function directInputs(instanceId: string, data: GameData): string[] {
  return data.instances.find((i) => i.id === instanceId)?.inputs ?? [];
}
