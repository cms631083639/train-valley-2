/**
 * 关卡需求量计算编排（从 pages/LevelsPage.vue 抽出的纯派生计算集群）。
 *
 * 职责：把关卡状态 + 物资数据装配成引擎参数、调用 breakdownGoals、汇总多方案结果与
 * 渠道分配预览。所有输入以 ref/computed 显式注入，本模块**不 import store**，
 * 保持「store → 组合式函数 → 组件」的单向数据流。
 *
 * 行为与抽离前逐行等价（仅把 store 访问替换为注入的 inputs）。
 */

import { computed, type Ref } from 'vue';
import { VIA } from '@/constants';
import { breakdownGoals } from '@/engine/breakdown';
import type { BreakdownNode, BreakdownStrategy, RecipeChoice } from '@/engine/breakdown';
import {
  collectCpOutputNames,
  collectExternalCaps,
  collectLocalInstances,
  collectStationSuppliedNames,
  collectSuggestNames,
} from '@/domain/level';
import type { GameData, Level, LevelGoal, ResourceInstance } from '@/types';

export interface LevelCalcInputs {
  /** 当前关卡 */
  level: Ref<Level | undefined>;
  /** 关卡目标（level.goals 的便捷引用） */
  goals: Ref<LevelGoal[]>;
  /** 全局物资/关卡数据 */
  data: Ref<GameData>;
  /** 实例索引（id → 实例） */
  instById: Ref<Map<string, ResourceInstance>>;
  /** 配方选择策略（可被多方案对比覆盖） */
  choice: Ref<RecipeChoice>;
  /** 当前拆解策略（引擎调用用） */
  activeStrategy: Ref<BreakdownStrategy>;
}

export function useLevelCalc(inputs: LevelCalcInputs) {
  const { level, goals, data, instById, choice, activeStrategy } = inputs;

  // 🎯 外部物资站点覆盖的 name 集合 → 这些 name 在引擎里跳过 resolved/warnings（派生逻辑见 domain/level.ts）
  const stationSuppliedNames = computed(() => collectStationSuppliedNames(level.value, instById.value));

  /** 🔗 拆卸组产出实例的名称集合（供外部站「建议提供」触发判断，派生逻辑见 domain/level.ts） */
  const cpOutputNames = computed(() => collectCpOutputNames(level.value, instById.value));

  /**
   * 🛒 「建议提供」显示条件：关卡内存在同名不同实例的物资（含拆卸组产出）。
   * 只有同一物资名对应 ≥2 个不同实例时，才需要人工限定"外部站供多少份"。
   * 派生逻辑见 domain/level.ts。
   */
  const suggestNames = computed(() =>
    collectSuggestNames(level.value, goals.value, instById.value, cpOutputNames.value),
  );

  /** 🛒 外部站建议提供量 → externalCaps（派生逻辑见 domain/level.ts） */
  const externalCaps = computed(() => collectExternalCaps(level.value, instById.value));

  /** 关卡活跃实例集：目标 + 各类站点已配置的实例（派生逻辑见 domain/level.ts） */
  const localInstances = computed(() => collectLocalInstances(level.value, goals.value, instById.value));

  /**
   * 引擎参数装配：主结果与多方案结果共用同一份基础参数，仅 choice / strategy 不同。
   * （抽离前两处各自拼装 10 个字段，改一处漏一处就会产生静默差异）
   */
  const buildOptions = (choiceOverride: RecipeChoice, strategy: BreakdownStrategy) => ({
    goals: goals.value.map((g) => ({ instanceId: g.resourceId, qty: g.qty })),
    data: data.value,
    choice: choiceOverride,
    localInstances: localInstances.value,
    overrides: level.value?.instanceOverrides,
    stationSuppliedNames: stationSuppliedNames.value,
    // 🎯 引擎内部根据 powerSources.length 推断 powerMode（none/single/multi）
    powerSources: level.value?.powerSources ?? [],
    coProductionGroups: level.value?.hasMergedProduction === true ? level.value.coProductionGroups : undefined,
    strategy,
    externalCaps: externalCaps.value,
    multiChannelGroups: level.value?.multiChannelGroups,
  });

  /** 主计算结果（当前 choice + activeStrategy） */
  const result = computed(() => {
    if (!goals.value.length) return null;
    return breakdownGoals(buildOptions(choice.value, activeStrategy.value));
  });

  /** 多方案对比结果 */
  const strategyResults = computed(() => {
    const lv = level.value;
    if (!lv || !goals.value.length) return [];

    // 判断条件（使用标记而非数据存在性，隐藏时不计入策略）
    const hasCo = lv.hasMergedProduction === true && (lv.coProductionGroups?.length ?? 0) > 0;
    const goalNames = new Set<string>();
    for (const g of goals.value) {
      const inst = instById.value.get(g.resourceId);
      if (inst) goalNames.add(inst.name);
    }
    const hasMulti = lv.hasMultipleInstances !== false && (lv.multiChannelGroups?.length ?? 0) > 0;
    const hasTimeBased = [...goalNames].some((name) => {
      const instances = data.value.instances.filter((i) => i.name === name);
      return instances.some((i) => i.obtain === '刷新' || i.obtain === '库存');
    });

    // 构建策略列表
    type StrategyItem = { key: string; strategy: BreakdownStrategy; label: string };
    const strategies: StrategyItem[] = [];

    // 🎯 手动填写拆卸总个数 / 🛑 最多拆卸次数上限 → 拆卸通道已定，无需多方案对比
    const hasManualOutput = (lv.coProductionGroups ?? []).some(
      (cp) => (cp.manualOutput !== undefined && cp.manualOutput > 0) || (cp.maxCycles !== undefined && cp.maxCycles > 0),
    );
    if (hasManualOutput) {
      // 手动总个数已确定，直接返回唯一解
    } else if (hasCo && hasMulti) {
      // 有拆卸工厂 + 多渠道：展示最少浪费方案 + 多渠道对比
      strategies.push(
        { key: 'minWaste', strategy: 'minCoProduction', label: '① 最少浪费方案' },
        { key: 'fewestInputs', strategy: 'fewestInputs', label: '② 配方输入最少' },
      );
      if (hasTimeBased) {
        strategies.push({ key: 'smallestCycle', strategy: 'smallestPerCycle', label: '③ 单周期产出最小' });
      } else {
        strategies.push({ key: 'mostInputs', strategy: 'mostInputs', label: '③ 最复杂方案' });
      }
    } else if (hasCo && !hasMulti) {
      // 有拆卸工厂但无多渠道 → 无需多方案对比，主结果即为最优方案
      return [];
    } else if (!hasCo && hasMulti) {
      // 只有多实例：多渠道对比
      strategies.push(
        { key: 'fewestInputs', strategy: 'fewestInputs', label: '① 配方输入最少' },
      );
      if (hasTimeBased) {
        strategies.push({ key: 'smallestCycle', strategy: 'smallestPerCycle', label: '② 单周期产出最小' });
      }
      strategies.push({ key: 'mostInputs', strategy: 'mostInputs', label: hasTimeBased ? '③ 最复杂方案' : '② 最复杂方案' });
    } else {
      return [];
    }

    return strategies.map((s) => {
      const r = breakdownGoals(buildOptions('fewestInputs', s.strategy));
      return { key: s.key, strategy: s.strategy, label: s.label, result: r };
    });
  });

  /** 拆卸工厂后的剩余多渠道物资 */
  const remainingMultiChannel = computed<{ name: string; instances: { id: string; inputs: string }[] }[] | null>(() => {
    const lv = level.value;
    if (!lv) return null;
    if (!result.value) return null;
    // 没有拆卸工厂或者没有多渠道，直接返回
    if (!lv.coProductionGroups?.length && !lv.multiChannelGroups?.length) return null;
    // 收集拆卸工厂输出的实例 ID
    const cpOutputIds = new Set<string>();
    for (const cp of lv.coProductionGroups ?? []) {
      for (const out of cp.outputs) {
        cpOutputIds.add(out.instanceId);
      }
    }
    // 没有拆卸工厂，不显示剩余多渠道提醒（由策略面板处理）
    if (cpOutputIds.size === 0) return null;
    // 检查是否有拆卸组设置了手动总个数 / 最多拆卸次数上限 → 拆卸实例已确定，不再参与剩余多渠道
    const hasManualOutput = (lv.coProductionGroups ?? []).some(
      (cp) => (cp.manualOutput !== undefined && cp.manualOutput > 0) || (cp.maxCycles !== undefined && cp.maxCycles > 0),
    );
    const items: { name: string; instances: { id: string; inputs: string }[] }[] = [];
    for (const mg of lv.multiChannelGroups ?? []) {
      const instances = mg.instanceIds
        .map((id) => instById.value.get(id))
        .filter((inst): inst is ResourceInstance => !!inst);
      // 过滤掉已确定的拆卸实例
      const remaining = hasManualOutput
        ? instances.filter((inst) => !cpOutputIds.has(inst.id))
        : instances;
      // 至少有2个剩余实例才是多渠道
      if (remaining.length < 2) continue;
      items.push({
        name: mg.typeName,
        instances: remaining.map((inst) => ({
          id: inst.id,
          inputs: inst.inputs.filter((i) => i !== '电力').join(', ') || '仅工人',
        })),
      });
    }
    return items.length > 0 ? items : null;
  });

  const roots = computed<BreakdownNode[]>(() => result.value?.roots ?? []);

  /** 🔀 渠道分配预览（只读）：仅统计"同时存在拆卸渠道与非拆卸渠道"的物资 */
  const channelAllocations = computed(() => {
    const lv = level.value;
    if (!lv) return [];
    // 拆卸组产出的实例 id 集合 → 用于区分"拆卸渠道 / 非拆卸渠道"
    const cpIds = new Set<string>();
    for (const cp of lv.coProductionGroups ?? []) for (const o of cp.outputs) cpIds.add(o.instanceId);
    if (!cpIds.size) return [];
    // 按实例汇总实际产出量（含拆卸组产出，qty≤0 的节点不计）
    const byInst = new Map<string, number>();
    const add = (id: string, q: number) => { if (id && q > 0) byInst.set(id, (byInst.get(id) ?? 0) + q); };
    const walk = (n: BreakdownNode) => {
      if (n.via === VIA.PRODUCE && n.instanceId) add(n.instanceId, n.qty);
      if (n.coOutputs) for (const o of n.coOutputs) add(o.instanceId, o.produced);
      for (const c of n.children) walk(c);
    };
    for (const r of roots.value) walk(r);
    // 按物资名称聚合渠道
    const byName = new Map<string, { instanceId: string; qty: number; isCp: boolean }[]>();
    for (const [id, q] of byInst) {
      const inst = instById.value.get(id);
      if (!inst) continue;
      const arr = byName.get(inst.name) ?? [];
      arr.push({ instanceId: id, qty: q, isCp: cpIds.has(id) });
      byName.set(inst.name, arr);
    }
    const out: { name: string; total: number; segments: { instanceId: string; qty: number; isCp: boolean }[] }[] = [];
    for (const [name, segs] of byName) {
      const hasCp = segs.some((s) => s.isCp);
      const hasNonCp = segs.some((s) => !s.isCp);
      if (!hasCp || !hasNonCp) continue; // 仅显示同时有拆卸渠道与非拆卸渠道的物资
      segs.sort((a, b) => Number(b.isCp) - Number(a.isCp) || b.qty - a.qty);
      out.push({ name, total: segs.reduce((s, x) => s + x.qty, 0), segments: segs });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  });

  /** 计算某个拆解结果的基础原料总数量 */
  function totalRawQty(r: { rawNeeds: { name: string; qty: number }[] }): number {
    return r.rawNeeds.reduce((sum, n) => sum + n.qty, 0);
  }

  return {
    stationSuppliedNames,
    cpOutputNames,
    suggestNames,
    externalCaps,
    localInstances,
    result,
    strategyResults,
    remainingMultiChannel,
    roots,
    channelAllocations,
    totalRawQty,
  };
}
