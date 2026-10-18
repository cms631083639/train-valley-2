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
export const RECIPE_CHOICE = {
  FEWEST_INPUTS: 'fewestInputs',
  SMALLEST_PER_CYCLE: 'smallestPerCycle',
  FIRST: 'first',
  MOST_INPUTS: 'mostInputs',
} as const;
export type RecipeChoice = (typeof RECIPE_CHOICE)[keyof typeof RECIPE_CHOICE];

/** 拆解策略：控制拆卸组的使用方式 */
export const BREAKDOWN_STRATEGY = {
  NORMAL: 'normal',
  SKIP_COPRODUCTION: 'skipCoProduction',
  MIN_COPRODUCTION: 'minCoProduction',
  MOST_INPUTS: 'mostInputs',
  FEWEST_INPUTS: 'fewestInputs',
  SMALLEST_PER_CYCLE: 'smallestPerCycle',
} as const;
export type BreakdownStrategy = (typeof BREAKDOWN_STRATEGY)[keyof typeof BREAKDOWN_STRATEGY];

/** 节点解析方式 */
export type NodeVia = typeof VIA[keyof typeof VIA];

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
  /**
   * 需求探测期间视为"由拆卸组供给"的主产出名称集合。
   * 探测时这些名称只记录毛需求、不再向下展开，避免循环配方把需求放大。
   */
  probeAnchorNames?: Set<string>;
  /** 拆卸组主产出实例 id 集合（用于局部实例优选：残余需求优先走非拆卸组通道） */
  cpOutputIds?: Set<string>;
  /**
   * 🛒 外部站「建议提供」按名称的剩余额度。
   * 生成外部供给叶子时扣减，扣完即不再供给（形成缺口）。
   * 仅在最终构建阶段生效（探测干跑阶段为空，避免把 cp 迭代算炸）。
   */
  externalCapByName?: Map<string, number>;
  /**
   * 🛒 该额度应优先使用的「外部站实例 id」（用户在外部站里配的那个实例）。
   * 避免引擎从主表里随便挑一个关卡外的同名外部实例（如把"微型芯片9l"错配成"微型芯片5P"）。
   */
  externalCapInstanceByName?: Map<string, string>;
  /**
   * 🧬 多渠道组：该名称在关卡内的"生产渠道"实例（组内、有配方、非外部）。
   * 外部额度耗尽后，缺口由这些实例补足（而不是回落到目标里随便指定的同名实例）。
   */
  mcProducerByName?: Map<string, ResourceInstance[]>;
  /** 🧬 多渠道组：该名称在关卡内的"外部渠道"实例（组内、无配方）。额度优先用这个实例供给。 */
  mcExternalByName?: Map<string, ResourceInstance>;
  /**
   * 关卡内实际配置过的实例 id 集合（localInstances + overrides + 电力 + 拆卸组产出 + 多渠道组）。
   * 用于把警告/提示里的"其他可选实例"限制在关卡范围内，避免列出关卡外无关实例。
   */
  localInstanceIds: Set<string>;
  /**
   * 关卡内被显式配置为「外部来源」的实例 id 集合（实例带 external=true 或 obtain 标记）。
   * 这类实例即使带配方，也按外部供给叶子展开 —— 关卡已声明该物资从外部获取，
   * 其配方不应再被下钻（否则会把无关物资/循环配方带进生产链）。
   * 例：新加坡的 电器ar（obtain=购买 却带配方）→ 按外部供给处理，不再带出铜锭/加工橡胶/玻璃。
   */
  sourceOverrideIds: Set<string>;
}

function buildIndex(
  data: GameData,
  localInstances?: ResourceInstance[],
  overrides?: Record<string, string>,
  rootNames = new Set<string>(),
  stationSuppliedNames = new Set<string>(),
  powerSources: string[] = [],
  cpOutputIds = new Set<string>(),
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

  // 关卡内实际配置的实例 id（用于限定警告候选，避免列出关卡外实例）
  const localInstanceIds = new Set<string>();
  for (const inst of localInstances ?? []) localInstanceIds.add(inst.id);
  for (const id of Object.values(overrides ?? {})) localInstanceIds.add(id);
  for (const id of ps) localInstanceIds.add(id);
  for (const id of cpOutputIds) localInstanceIds.add(id);

  const byId = new Map(data.instances.map((i) => [i.id, i]));

  // 关卡内被显式配置为「外部来源」的实例：即使带配方，也按外部供给展开（忽略其配方）
  const sourceOverrideIds = new Set<string>();
  const markSource = (inst?: ResourceInstance) => {
    if (inst && isExternalMarked(inst)) sourceOverrideIds.add(inst.id);
  };
  for (const inst of localInstances ?? []) markSource(inst);
  for (const id of Object.values(overrides ?? {})) markSource(byId.get(id));

  let localByName: Map<string, ResourceInstance> | undefined;
  // 优先级（从低到高）：localInstances（goals 里的实例）< overrides（警告区用户显式选的）< powerSources[0]（关卡主电力）
  const hasOverrides = (overrides && Object.keys(overrides).length) || (localInstances && localInstances.length) || powerMode === 'single';
  if (hasOverrides) {
    localByName = new Map();
    // 🎯 同名多实例时的优选：若已选中的是"拆卸组产出"，而新来的是非拆卸组实例，
    //    则改用非拆卸组实例 —— 拆卸组的产出已由拆卸组满足，残余需求应走其它通道。
    //    （主产出没有非拆卸组备选，因此不会被换掉。）
    const putLocal = (inst: ResourceInstance) => {
      const prev = localByName!.get(inst.name);
      if (prev && cpOutputIds.has(prev.id) && !cpOutputIds.has(inst.id)) {
        localByName!.set(inst.name, inst);
      } else if (prev && !cpOutputIds.has(prev.id) && cpOutputIds.has(inst.id)) {
        // 保留已有的非拆卸组实例
      } else {
        localByName!.set(inst.name, inst);
      }
    };
    if (localInstances) {
      for (const inst of localInstances) putLocal(inst);
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
  return { byName, byId, localByName, rootNames, stationSuppliedNames, powerMode, powerSources: ps, cpOutputIds, localInstanceIds, sourceOverrideIds };
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

/** 实例是否被标记为外部来源（obtain/external 标记）——外部来源优先于配方 */
function isExternalMarked(inst: ResourceInstance): boolean {
  const via = viaOfSupply(inst);
  return via === VIA.EXTERNAL || via === VIA.REFRESH || via === VIA.INFINITE;
}

/**
 * 实例在当前关卡是否按「来源（叶子）」处理：
 * - 无配方（inputs 为空）→ 天然来源；
 * - 有配方，但被关卡显式配置为外部来源（idx.sourceOverrideIds）→ 仍按来源处理。
 * 统一供 pickSupply / pickProducers / expandInstance 使用，保证三处判定一致。
 */
function isSourceInstance(inst: ResourceInstance, idx: Index): boolean {
  return !inst.inputs.length || idx.sourceOverrideIds.has(inst.id);
}

function pickProducers(list: ResourceInstance[], idx: Index): ResourceInstance[] {
  return list.filter((i) => i.inputs.length > 0 && !isSourceInstance(i, idx));
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

function pickSupply(list: ResourceInstance[], idx: Index): ResourceInstance | undefined {
  const supplies = list.filter((i) => isSourceInstance(i, idx));
  return supplies.find((i) => viaOfSupply(i) !== VIA.UNKNOWN) ?? supplies[0];
}

function chooseProducer(candidates: ResourceInstance[], choice: RecipeChoice): ResourceInstance {
  if (candidates.length === 1) return candidates[0];
  const sorted = [...candidates];
  switch (choice) {
    case RECIPE_CHOICE.SMALLEST_PER_CYCLE:
      sorted.sort((a, b) => (a.perOut ?? 1) - (b.perOut ?? 1) || a.inputs.length - b.inputs.length);
      break;
    case RECIPE_CHOICE.FIRST:
      break;
    case RECIPE_CHOICE.MOST_INPUTS:
      sorted.sort((a, b) => b.inputs.length - a.inputs.length || (b.perOut ?? 1) - (a.perOut ?? 1));
      break;
    case RECIPE_CHOICE.FEWEST_INPUTS:
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

  // 外部供给节点（无配方，或被关卡显式配置为外部来源的带配方实例）
  if (isSourceInstance(inst, idx)) {
    const via = viaOfSupply(inst);
    if (via === VIA.UNKNOWN) {
      warnings.push({ message: `「${inst.name}」(${inst.id}) 既无配方也无外部供给标记，需人工确认来源` });
      return leaf(inst.name, qty, VIA.UNKNOWN, data, '', inst.id, false, (inst.perOut ?? 1));
    }
    // 🛒 外部站「建议提供」：该名称外部渠道总供给 clamp 到剩余额度（仅最终构建阶段生效）
    let outQty = qty;
    if (!idx.demandProbe && idx.externalCapByName && (via === VIA.EXTERNAL || via === VIA.REFRESH || inst.external)) {
      const remaining = idx.externalCapByName.get(inst.name);
      if (remaining !== undefined) {
        outQty = Math.max(0, Math.min(qty, remaining));
        idx.externalCapByName.set(inst.name, remaining - outQty);
      }
    }
    return leaf(inst.name, outQty, via, data, inst.obtain ?? '', inst.id, inst.needsPower, (inst.perOut ?? 1));
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
    // 🎯 拆卸组主产出：探测阶段只记毛需求、不再下钻，避免循环配方把需求放大
    if (idx.probeAnchorNames?.has(name)) {
      return leaf(name, qty, VIA.CO_PRODUCTION, data, '', name);
    }
  }

  // 🎯 拆卸组已满足的产量扣除（消耗式：同一份产出只抵扣一次下游需求）
  if (idx.satisfiedByName) {
    const satisfied = idx.satisfiedByName.get(name) ?? 0;
    if (satisfied >= qty) {
      // 已全部满足，无需额外生产
      idx.satisfiedByName.set(name, satisfied - qty);
      return leaf(name, 0, VIA.CO_PRODUCTION, data, '', name);
    }
    if (satisfied > 0) {
      // 已部分满足，只生产剩余部分
      qty = qty - satisfied;
      idx.satisfiedByName.set(name, 0);
    }
  }

  const list = idx.byName.get(name) ?? [];
  if (!list.length) {
    warnings.push({ message: `「${name}」在物资主表中不存在，无法拆解` });
    return leaf(name, qty, VIA.UNKNOWN, data);
  }

  const producers = pickProducers(list, idx);
  const supply = pickSupply(list, idx);
  // 所有可选实例（supply + 所有 producers）。
  // 🎯 只展示本关卡实际配置过的同名实例；关卡内一个都没有时才回落到全局候选，
  //    避免警告区列出与关卡无关的实例（如本关用不到的铜锭/加工橡胶/玻璃）。
  const localSameName = list.filter((p) => idx.localInstanceIds.has(p.id));
  const allIds = (localSameName.length ? localSameName : list).map((p) => p.id);

  // 🎯 关卡局部覆盖：如果 localByName 里有这个 name，优先用用户选的那个实例
  // 但如果 name 已在 goals 里作为根目标被用户直接指定，或已被关卡物资站点覆盖 → 跳过 resolved（已确认）
  const isConfirmed = idx.rootNames.has(name) || idx.stationSuppliedNames.has(name);
  const local = idx.localByName?.get(name);

  // 🛒 外部「建议提供」额度：该名称外部供给被限额时，
  //    先取额度内的外部份，余量交给同名的生产实例补足。
  //    多渠道组优先：外部源用组内的外部渠道实例，缺口用组内的生产渠道实例。
  //    仅在最终构建阶段生效（探测干跑阶段 externalCapByName 为空）。
  if (!idx.demandProbe && idx.externalCapByName && qty > 0) {
    const remaining = idx.externalCapByName.get(name);
    if (remaining !== undefined) {
      // 外部源：优先用外部站里配置的那个实例，其次多渠道组的外部实例，最后通用 supply
      const capId = idx.externalCapInstanceByName?.get(name);
      const capInst = capId ? idx.byId.get(capId) : undefined;
      let extSource = capInst && !capInst.inputs.length ? capInst : undefined;
      if (!extSource) extSource = idx.mcExternalByName?.get(name);
      if (!extSource || extSource.inputs.length) extSource = supply && !supply.inputs.length ? supply : undefined;

      // 缺口生产实例：多渠道组的生产渠道优先，其次同名生产实例（排除拆卸组产出）
      const gapPool = idx.mcProducerByName?.get(name) ?? producers;
      const gapProducers = gapPool.filter((p) => !idx.cpOutputIds?.has(p.id) && p.id !== extSource?.id);

      let node: BreakdownNode | undefined;
      let rest = qty;
      if (extSource && remaining > 0) {
        // expandInstance 内部会把外部叶子 clamp 到剩余额度并扣减
        node = expandInstance(extSource, qty, idx, choice, trail, warnings, resolved, depth, data);
        rest = qty - node.qty;
      }
      if (rest > 0 && gapProducers.length) {
        // 余量交给同名生产实例；trail 不追加 name，避免按名循环保护误伤同名展开
        const producer = local && gapProducers.includes(local) ? local : chooseProducer(gapProducers, choice);
        const pNode = expandInstance(producer, rest, idx, choice, trail, warnings, resolved, depth, data);
        if (node) node.children = [...node.children, pNode];
        else node = pNode;
      }
      if (node) {
        if (!isConfirmed && !resolved.some((r) => r.message.startsWith(`「${name}」已确认`)))
          resolved.push({ message: `「${name}」外部额度 ${remaining}，余量由同类型生产实例补足`, instance: extSource, alternatives: allIds });
        return node;
      }
      // 既无外部源也无生产实例 → 落回常规流程
    }
  }
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
    requiresPower: requiresPower || via === VIA.POWER,
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
  if (node.via === VIA.POWER) return;
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
    // 🛒 外部额度截断时，余量挂在该外部节点下（生产实例补足），一并汇总
    for (const c of node.children) collect(c, ext, prod, power, infinite);
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
function collectRaw(node: BreakdownNode, raw: Map<string, number>, rawCountNames?: Set<string>): void {
  // 电力节点：完全隔离，自身及 children 都不计入最终基础物资
  if (node.name === POWER_NAME) return;
  if (node.via === VIA.POWER || node.name === WORKER_NAME) return;

  // 拆卸组：不把节点自身计为原料，继续下钻 children 展开
  if (node.via === VIA.CO_PRODUCTION) {
    for (const c of node.children) collectRaw(c, raw, rawCountNames);
    return;
  }

  // 叶子：外部供给 / 无限（除了工人） / 原料分类的节点 → 计入
  if (node.via === VIA.EXTERNAL || node.via === VIA.REFRESH || node.via === VIA.INFINITE) {
    raw.set(node.name, (raw.get(node.name) ?? 0) + node.qty);
    // 🛒 外部额度截断时，余量挂在该外部节点下（生产实例补足），一并下钻
    for (const c of node.children) collectRaw(c, raw, rawCountNames);
    return;
  }

  // 生产节点：真实输入里没有"工人/电力以外"的物资 → 就是链路叶子，按原料计入
  // （不强制 category===RAW：needsPower 实例的虚拟电力会把分类带偏成 compound，
  //   但它本身没有任何真实物资输入，若不在此计入，数量会凭空消失）
  if (node.via === VIA.PRODUCE) {
    const others = node.inputNames.filter((n) => n !== WORKER_NAME && n !== POWER_NAME);
    // 无真实物资输入 → 链路叶子，计为原料
    if (!others.length) {
      raw.set(node.name, (raw.get(node.name) ?? 0) + node.qty);
      return;
    }
    // 🧱 双属性名称（既属原料又属复合品）：按原料计入自身数量，
    //    使"外部供给 + 自产"都算作该物资的实际需求（微型芯片 24 外部 + 12 自产 = 36）；
    //    同时继续下钻，自产那部分消耗的原料也要正常计入，避免总量凭空减少。
    if (rawCountNames?.has(node.name)) {
      raw.set(node.name, (raw.get(node.name) ?? 0) + node.qty);
    }
  }

  // 加工品/复合品继续向下拆
  for (const c of node.children) collectRaw(c, raw, rawCountNames);
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
  strategy: BreakdownStrategy = BREAKDOWN_STRATEGY.NORMAL,
  forcedCycles?: number,
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
  if (strategy === BREAKDOWN_STRATEGY.MIN_COPRODUCTION) {
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
  // 🎯 迭代配平：外部已算出收敛的组次数（共生产 + 循环回吐配平结果）→ 直接采用
  if (forcedCycles !== undefined) groupCycles = forcedCycles;
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

/** breakdownGoals 的输入：把原先 11 个位置参数收敛为单一对象，避免调用点顺序错位 */
export interface BreakdownOptions {
  /** 目标列表（实例 id + 数量） */
  goals: { instanceId: string; qty: number }[];
  /** 全局物资/关卡数据 */
  data: GameData;
  /** 配方选择策略（默认 fewestInputs） */
  choice?: RecipeChoice;
  /** 关卡内活跃实例（局部按名优选，优先于全局主表） */
  localInstances?: ResourceInstance[];
  /** 警告面板手选的 name → instanceId 覆盖（优先级最高） */
  overrides?: Record<string, string>;
  /** 关卡站点已覆盖的 name 集合（这些 name 跳过 resolved/warnings） */
  stationSuppliedNames?: Set<string>;
  /** 关卡电力实例 id 数组（长度推断 none/single/multi） */
  powerSources?: string[];
  /** 拆卸工厂组（仅在关卡标记为 true 时传入） */
  coProductionGroups?: CoProductionGroup[];
  /** 拆解策略（默认 normal） */
  strategy?: BreakdownStrategy;
  /** 外部站「建议提供」额度 */
  externalCaps?: { name: string; instanceId: string; qty: number }[];
  /** 多渠道生产组 */
  multiChannelGroups?: { typeName: string; instanceIds: string[] }[];
}

export function breakdownGoals(options: BreakdownOptions): BreakdownResult {
  const {
    goals,
    data,
    choice = RECIPE_CHOICE.FEWEST_INPUTS,
    localInstances,
    overrides,
    stationSuppliedNames = new Set<string>(),
    powerSources = [],
    coProductionGroups,
    strategy = BREAKDOWN_STRATEGY.NORMAL,
    externalCaps,
    multiChannelGroups,
  } = options;
  // 🎯 策略映射
  let effectiveChoice = choice;
  let effectiveCoGroups = coProductionGroups;
  switch (strategy) {
    case BREAKDOWN_STRATEGY.MOST_INPUTS:
      effectiveChoice = RECIPE_CHOICE.MOST_INPUTS;
      effectiveCoGroups = undefined;
      break;
    case BREAKDOWN_STRATEGY.FEWEST_INPUTS:
      effectiveChoice = RECIPE_CHOICE.FEWEST_INPUTS;
      effectiveCoGroups = undefined;
      break;
    case BREAKDOWN_STRATEGY.SMALLEST_PER_CYCLE:
      effectiveChoice = RECIPE_CHOICE.SMALLEST_PER_CYCLE;
      effectiveCoGroups = undefined;
      break;
    case BREAKDOWN_STRATEGY.SKIP_COPRODUCTION:
      effectiveCoGroups = undefined;
      break;
    case BREAKDOWN_STRATEGY.MIN_COPRODUCTION:
    case BREAKDOWN_STRATEGY.NORMAL:
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

  // 🎯 拆卸组产出的实例 id 集合（供 buildIndex 做局部实例优选：残余需求优先走非拆卸组通道）
  const cpOutputIds = new Set<string>();
  if (effectiveCoGroups?.length) {
    for (const cp of effectiveCoGroups) for (const o of cp.outputs) cpOutputIds.add(o.instanceId);
  }

  const idx = buildIndex(data, localInstances, overrides, rootNames, stationSuppliedNames, powerSources, cpOutputIds);
  const warnings = [] as StructuredWarning[];
  const resolved = [] as StructuredWarning[];

  // 🧬 多渠道组：把该组实例按"外部渠道 / 生产渠道"归类。
  //    外部额度耗尽后，缺口由生产渠道补足（而不是回落到目标里随便指定的同名实例）。
  if (multiChannelGroups?.length) {
    const mp = new Map<string, ResourceInstance[]>();
    const me = new Map<string, ResourceInstance>();
    for (const g of multiChannelGroups) {
      for (const id of g.instanceIds ?? []) {
        const inst = idx.byId.get(id);
        if (!inst) continue;
        if (inst.inputs.length > 0) {
          const arr = mp.get(inst.name) ?? [];
          if (!arr.includes(inst)) arr.push(inst);
          mp.set(inst.name, arr);
        } else if (!me.has(inst.name)) {
          me.set(inst.name, inst);
        }
      }
    }
    if (mp.size) idx.mcProducerByName = mp;
    if (me.size) idx.mcExternalByName = me;
    // 多渠道组实例也算关卡内实例（供警告候选限定使用）；其中被标记为外部来源的同样按来源处理
    for (const g of multiChannelGroups) {
      for (const id of g.instanceIds ?? []) {
        idx.localInstanceIds.add(id);
        const inst = idx.byId.get(id);
        if (inst && isExternalMarked(inst)) idx.sourceOverrideIds.add(id);
      }
    }
  }

  // 🧱 原料/复合品双属性名称：关卡内既有"原料"渠道（外部供给 或 仅需工人），
  //    又有"非原料"渠道（加工品/复合品配方）。这类名称在最终基础物资里一律按原料统计：
  //    需求 N 就直接计 N（外部供给 + 自产都算作该物资本身），不再下钻其复合配方。
  //    例：微型芯片既有外部购买实例(9l)，又有复合配方实例(xO) → 基础物资按 36 计。
  const rawChannelNames = new Set<string>();
  const nonRawChannelNames = new Set<string>();
  const scanChannel = (inst?: ResourceInstance) => {
    if (!inst) return;
    const realInputs = inst.inputs.filter((n) => n !== WORKER_NAME && n !== POWER_NAME);
    if (!inst.inputs.length || !realInputs.length) rawChannelNames.add(inst.name);
    else nonRawChannelNames.add(inst.name);
  };
  for (const inst of localInstances ?? []) scanChannel(inst);
  if (overrides) for (const id of Object.values(overrides)) scanChannel(idx.byId.get(id));
  for (const g of multiChannelGroups ?? []) for (const id of g.instanceIds ?? []) scanChannel(idx.byId.get(id));
  for (const cp of effectiveCoGroups ?? []) for (const o of cp.outputs) scanChannel(idx.byId.get(o.instanceId));
  const rawCountNames = new Set<string>();
  for (const nm of rawChannelNames) if (nonRawChannelNames.has(nm)) rawCountNames.add(nm);

  // 🛒 外部站点建议提供量：仅当名称同时是拆卸组产出名称时才生效
  const cpOutputNames = new Set<string>();
  if (effectiveCoGroups?.length) {
    for (const cp of effectiveCoGroups) for (const o of cp.outputs) {
      const inst = idx.byId.get(o.instanceId);
      if (inst) cpOutputNames.add(inst.name);
    }
  }

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

  // ③ 共生产（拆卸组）+ 循环回吐 迭代配平
  //    主产出(anchor)：其名称在关卡内没有"非拆卸组"备选 → 由该组承担、驱动组次数
  //    副产(byproduct)：其名称存在非拆卸组实例 → 不驱动组次数，产出仅用于抵扣下游
  //    反复迭代：探测整链毛需求（主产出只记毛需求、不下钻，避免循环配方放大）→ 更新组次数，直到收敛
  if (effectiveCoGroups?.length) {
    // 3.1 判定各组的 anchor 产出
    const localNames = new Set<string>();
    for (const inst of localInstances ?? []) if (!cpOutputIds.has(inst.id)) localNames.add(inst.name);
    for (const [nm, id] of Object.entries(overrides ?? {})) if (!cpOutputIds.has(id)) localNames.add(nm);
    const anchorsByGroup = new Map<string, { instanceId: string; perOut: number }[]>();
    const probeAnchorNames = new Set<string>();
    for (const cp of effectiveCoGroups) {
      const anchors: { instanceId: string; perOut: number }[] = [];
      for (const o of cp.outputs) {
        const nm = idx.byId.get(o.instanceId)?.name ?? o.instanceId;
        if (!localNames.has(nm)) {
          anchors.push({ instanceId: o.instanceId, perOut: o.perOut ?? 1 });
          probeAnchorNames.add(nm);
        }
      }
      anchorsByGroup.set(cp.id, anchors);
    }

    // 3.2 按组次数计算"可用于下游抵扣"的产出（按名汇总，扣除直接目标占用）
    const computeSatisfied = (cyclesMap: Map<string, number>) => {
      const agg = new Map<string, number>();
      for (const cp of effectiveCoGroups) {
        const cyc = cyclesMap.get(cp.id) ?? 0;
        if (!cyc) continue;
        for (const o of cp.outputs) {
          const nm = idx.byId.get(o.instanceId)?.name ?? o.instanceId;
          agg.set(nm, (agg.get(nm) ?? 0) + cyc * (o.perOut ?? 1));
        }
      }
      const res = new Map<string, number>();
      for (const [nm, produced] of agg) {
        const avail = produced - (directByName.get(nm) ?? 0);
        if (avail > 0) res.set(nm, avail);
      }
      return res;
    };

    // 3.3 迭代求解组次数
    const cpCycles = new Map<string, number>();
    for (const cp of effectiveCoGroups) cpCycles.set(cp.id, 0);
    /** 实际上限「截断」了需求的拆卸组（need > maxCycles）；上限≥需求即未生效，不触发 3.5 调整 */
    const cappedIds = new Set<string>();
    let finalProbe = new Map<string, number>();
    let finalNonCpDemand = new Map<string, number>();
    const MAX_ITER = 30;
    for (let iter = 0; iter < MAX_ITER; iter++) {
      // 探测：展开非拆卸目标 + 各拆卸组自身配方消耗（含循环回吐）
      const probeDemand = new Map<string, number>();
      idx.demandProbe = probeDemand;
      idx.probeAnchorNames = probeAnchorNames;
      idx.satisfiedByName = new Map(computeSatisfied(cpCycles));
      for (const g of nonCpGoals) {
        const inst = idx.byId.get(g.instanceId);
        if (inst) expandInstance(inst, g.qty, idx, effectiveChoice, [], [], [], 0, data);
      }
      // 🛒 cap 情形2 用的"非拆卸来源总需求"：仅取非拆卸目标，避免拆卸组自身循环消耗造成放大
      const nonCpDemand = new Map(probeDemand);
      for (const cp of effectiveCoGroups) {
        const cyc = cpCycles.get(cp.id) ?? 0;
        if (!cyc) continue;
        const firstInst = cp.outputs[0] ? idx.byId.get(cp.outputs[0].instanceId) : undefined;
        if (!firstInst) continue;
        const perIn = cp.perIn ?? 1;
        const mergedIn = new Map<string, number>();
        for (const input of firstInst.inputs) {
          if (input === WORKER_NAME || input === POWER_NAME) continue;
          mergedIn.set(input, (mergedIn.get(input) ?? 0) + perIn * cyc);
        }
        for (const [iname, iqty] of mergedIn)
          expandByName(iname, iqty, idx, effectiveChoice, [cp.label ?? cp.id], [], [], 0, data);
      }
      idx.demandProbe = undefined;
      idx.probeAnchorNames = undefined;
      idx.satisfiedByName = undefined;
      // 直接指向拆卸组产出的目标量同样驱动组次数
      for (const [nm, qty] of directByName) probeDemand.set(nm, (probeDemand.get(nm) ?? 0) + qty);
      finalProbe = probeDemand;
      finalNonCpDemand = nonCpDemand;

      // 更新各组次数：anchor 产出需求量 / perOut（minCoProduction 取最小）
      let changed = false;
      for (const cp of effectiveCoGroups) {
        const anchors = anchorsByGroup.get(cp.id) ?? [];
        const relevant = anchors.length
          ? anchors
          : cp.outputs.map((o) => ({ instanceId: o.instanceId, perOut: o.perOut ?? 1 }));
        let need = 0;
        for (const a of relevant) {
          const nm = idx.byId.get(a.instanceId)?.name ?? a.instanceId;
          const demand = probeDemand.get(nm) ?? 0;
          const n = Math.ceil(demand / (a.perOut || 1));
          if (strategy === BREAKDOWN_STRATEGY.MIN_COPRODUCTION) need = need === 0 ? n : Math.min(need, n);
          else need = Math.max(need, n);
        }
        // 🛑 maxCycles 上限：用户指定最多拆 N 次，超出则封顶（缺口由非拆卸实例补齐）
        if (cp.maxCycles && cp.maxCycles > 0) {
          if (need > cp.maxCycles) cappedIds.add(cp.id);
          else cappedIds.delete(cp.id);
          need = Math.min(need, cp.maxCycles);
        }
        if ((cpCycles.get(cp.id) ?? 0) !== need) {
          cpCycles.set(cp.id, need);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // 3.4 收敛：用最终 satisfied（消耗式）构建拆卸组根节点
    idx.satisfiedByName = computeSatisfied(cpCycles);
    if (idx.satisfiedByName.size === 0) idx.satisfiedByName = undefined;
    for (const cp of effectiveCoGroups) {
      const cyc = cpCycles.get(cp.id) ?? 0;
      if (!cyc) continue;
      const anchors = anchorsByGroup.get(cp.id) ?? [];
      const virtualGoals = cp.outputs.map((o) => {
        const nm = idx.byId.get(o.instanceId)?.name ?? o.instanceId;
        const isAnchor = anchors.some((a) => a.instanceId === o.instanceId);
        return {
          instanceId: o.instanceId,
          qty: isAnchor ? (finalProbe.get(nm) ?? 0) : (directByName.get(nm) ?? 0),
        };
      });
      roots.push(expandCoProductionGroup(cp, virtualGoals, idx, effectiveChoice, warnings, resolved, 0, data, strategy, cyc));
    }

    // 3.5 🛑 maxCycles 封顶：拆卸组只产出 N 次，剩余需求全部改由非拆卸实例承担
    //     对每个产出名称：缺口（产出 < 直接目标）→ 非拆卸实例补齐；溢出（产出 > 直接目标）→ 从非拆卸目标等量削减
    for (const cp of effectiveCoGroups) {
      // 仅当上限真正截断了需求时才调整（need > maxCycles）；
      // 上限 ≥ 需求时并未实际限制，结果应与"不设上限"完全一致
      if (!cappedIds.has(cp.id)) continue;
      const cyc = cpCycles.get(cp.id) ?? 0;
      for (const o of cp.outputs) {
        const nm = idx.byId.get(o.instanceId)?.name ?? o.instanceId;
        const produced = cyc * (o.perOut ?? 1);
        const direct = directByName.get(nm) ?? 0;
        if (produced > direct) {
          // 溢出：从同名非拆卸目标里等量削减（同步消耗 satisfiedByName，避免下游重复抵扣）
          let surplus = produced - direct;
          for (const g of nonCpGoals) {
            if (surplus <= 0) break;
            const gi = idx.byId.get(g.instanceId);
            if (!gi || gi.name !== nm) continue;
            const take = Math.min(g.qty, surplus);
            g.qty -= take;
            surplus -= take;
          }
          if (idx.satisfiedByName) {
            const cur = idx.satisfiedByName.get(nm) ?? 0;
            const used = (produced - direct) - surplus;
            if (used > 0) {
              if (cur - used > 0) idx.satisfiedByName.set(nm, cur - used);
              else idx.satisfiedByName.delete(nm);
            }
          }
        } else if (produced < direct) {
          // 缺口：直接指向拆卸组产出的目标未被满足 → 用「关卡内的非拆卸实例」补齐
          const unmet = direct - produced;
          // 只在关卡已配置了同名非拆卸实例时才补齐；不从全局主表里随便拉一个关卡外实例
          // （否则会把该实例配方里的其它物资链一并引入，如"电线lH"带出"铜锭"）
          const fallback = idx.localByName?.get(nm);
          if (!fallback || cpOutputIds.has(fallback.id)) continue; // 关卡内无同名非拆卸实例 → 保持缺口
          // 合并到已有同实例目标，避免同一实例出现多个根节点
          const exist = nonCpGoals.find((g) => g.instanceId === fallback.id);
          if (exist) exist.qty += unmet;
          else nonCpGoals.push({ instanceId: fallback.id, qty: unmet });
        }
      }
    }

    // 3.6 🛒 外部站「建议提供」：计算该名称"外部渠道目标净供给"（不叠加）
    //     情形1：填了 E → 外部=E；情形2：E 空但拆卸组设了 maxCycles → 外部=max(0, Q−C)；
    //     情形3：E 空且无 maxCycles → 不设额度（完全维持现有行为）。
    //     仅对名称 ∈ cpOutputNames 生效；cp 侧不变，cp 产出 C 不计入该外部 cap。
    if (cpOutputNames.size && (externalCaps?.length || cappedIds.size > 0)) {
      // 各名称的 cp 产出 C = Σ（组次数 × perOut）
      const cpProducedByName = new Map<string, number>();
      for (const cp of effectiveCoGroups) {
        const cyc = cpCycles.get(cp.id) ?? 0;
        if (!cyc) continue;
        for (const o of cp.outputs) {
          const nm = idx.byId.get(o.instanceId)?.name ?? o.instanceId;
          cpProducedByName.set(nm, (cpProducedByName.get(nm) ?? 0) + cyc * (o.perOut ?? 1));
        }
      }
      const target = new Map<string, number>();
      for (const nm of cpOutputNames) {
        let e: number | undefined;
        for (const c of externalCaps ?? []) if (c.name === nm) e = (e ?? 0) + c.qty;
        if (e !== undefined) {
          target.set(nm, e); // 情形1
          continue;
        }
        // 情形2：该名称存在「实际被上限截断」的拆卸组
        const hasCappedCp = effectiveCoGroups.some((cp) =>
          cappedIds.has(cp.id) &&
          cp.outputs.some((o) => (idx.byId.get(o.instanceId)?.name ?? o.instanceId) === nm));
        if (hasCappedCp) {
          // Q = 该名称总需求（非拆卸来源毛需求 + 直接目标量）
          const q = (finalNonCpDemand.get(nm) ?? 0) + (directByName.get(nm) ?? 0);
          target.set(nm, Math.max(0, q - (cpProducedByName.get(nm) ?? 0)));
        }
        // 情形3：不设额度
      }
      if (target.size) idx.externalCapByName = target;
    }
  }

  // 🛒 显式「建议提供」额度：限制该名称的外部总供给（对任意名称生效，不受拆卸组限制）。
  //    拆卸组名称的显式 E 已在 3.6 处理；这里补上非拆卸组名称。
  if (externalCaps?.length) {
    const t = idx.externalCapByName ?? new Map<string, number>();
    const im = idx.externalCapInstanceByName ?? new Map<string, string>();
    for (const c of externalCaps) {
      if (!im.has(c.name)) im.set(c.name, c.instanceId);
      if (t.has(c.name)) continue; // 3.6 已按显式 E 处理
      t.set(c.name, c.qty);
    }
    if (t.size) idx.externalCapByName = t;
    if (im.size) idx.externalCapInstanceByName = im;
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
    // 🧬 有外部额度的多渠道名称：目标需求也走"外部额度 + 同类型生产渠道补足"的通道，
    //    让额度作用于该名称的总需求（含目标本身），而不是只作用于派生需求。
    //    （否则目标会绕过额度、按自己指定的实例生产，导致填了建议提供后总需求纹丝不动）
    if (idx.externalCapByName?.has(inst.name) && idx.mcProducerByName?.has(inst.name)) {
      roots.push(expandByName(inst.name, g.qty, idx, effectiveChoice, [], warnings, resolved, 0, data));
      continue;
    }
    roots.push(expandInstance(inst, g.qty, idx, effectiveChoice, [], warnings, resolved, 0, data));
  }

  // ⑥ minCoProduction 策略：组周期按最小需求计算，缺口部分用独立实例补充
  if (strategy === BREAKDOWN_STRATEGY.MIN_COPRODUCTION) {
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
  for (const r of roots) collectRaw(r, rawMap, rawCountNames);

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
