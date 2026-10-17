import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import type { BreakdownStrategy, RecipeChoice } from '@/engine/breakdown';
import type { GameData, Level, LevelGoal, ResourceInstance } from '@/types';
import { useLevelCalc } from '@/composables/useLevelCalc';

// ————————— 夹具 —————————

function inst(partial: Partial<ResourceInstance> & { id: string; name: string }): ResourceInstance {
  return { inputs: [], ...partial };
}

function level(partial: Partial<Level> = {}): Level {
  return {
    id: 'L1',
    name: '测试关',
    contentType: '主线',
    category: '游戏本体',
    chapter: '🔵 蒸汽时代',
    seconds: null,
    bestTime: '',
    earn: '',
    spend: '',
    constraints: {},
    goals: [],
    ...partial,
  };
}

/** 原木（无限原料） → 木板（原木 + 工人）；另备一个同名的第二生产实例用于多渠道/拆卸场景 */
const CHAIN: ResourceInstance[] = [
  inst({ id: 'rw', name: '原木', obtain: '无限' }),
  inst({ id: 'wd1', name: '木板', inputs: ['原木', '工人'], perOut: 1, perIn: 1 }),
  inst({ id: 'wd2', name: '木板', inputs: ['原木', '工人'], perOut: 1, perIn: 1 }),
];

/** 调用组合式函数：所有输入以 ref/computed 注入，便于在 node 环境下直接断言 */
function calc(opts: {
  level?: Level;
  goals?: LevelGoal[];
  instances?: ResourceInstance[];
  choice?: RecipeChoice;
  activeStrategy?: BreakdownStrategy;
}) {
  const data = ref<GameData>({ instances: opts.instances ?? [], levels: [], trains: [] });
  return useLevelCalc({
    level: ref<Level | undefined>(opts.level),
    // 与页面一致：goals 由 level.goals 派生，未显式传入时沿用关卡自身的目标
    goals: ref<LevelGoal[]>(opts.goals ?? opts.level?.goals ?? []),
    data,
    instById: computed(() => new Map(data.value.instances.map((i) => [i.id, i]))),
    choice: ref<RecipeChoice>(opts.choice ?? 'fewestInputs'),
    activeStrategy: ref<BreakdownStrategy>(opts.activeStrategy ?? 'normal'),
  });
}

const goal = (resourceId: string, qty = 1): LevelGoal => ({ resourceId, qty });

// ————————— 主结果 —————————

describe('useLevelCalc 主结果', () => {
  it('无目标时 result 为 null，策略与根节点为空', () => {
    const c = calc({ level: level(), instances: CHAIN });
    expect(c.result.value).toBeNull();
    expect(c.strategyResults.value).toEqual([]);
    expect(c.roots.value).toEqual([]);
  });

  it('沿配方下钻到原料叶子（引擎参数装配正确）', () => {
    const c = calc({ level: level({ goals: [goal('wd1', 6)] }), goals: [goal('wd1', 6)], instances: CHAIN });
    expect(c.result.value).not.toBeNull();
    expect(c.roots.value).toHaveLength(1);
    expect(c.result.value!.rawNeeds.find((n) => n.name === '原木')?.qty).toBe(6);
  });

  it('totalRawQty 汇总基础原料数量', () => {
    const c = calc({ level: level(), instances: CHAIN });
    expect(c.totalRawQty({ rawNeeds: [{ name: 'a', qty: 2 }, { name: 'b', qty: 3 }] })).toBe(5);
  });
});

// ————————— 内部 domain 接线 —————————

describe('useLevelCalc 内部派生接线', () => {
  it('localInstances 汇总目标与站点实例', () => {
    const c = calc({
      level: level({ resourceStationArr: [{ label: 'r1', resourceId: 'rw' }] }),
      goals: [goal('wd1')],
      instances: CHAIN,
    });
    expect(c.localInstances.value.map((i) => i.id).sort()).toEqual(['rw', 'wd1']);
  });

  it('suggestNames 仅在同名 ≥2 实例时命中', () => {
    const c = calc({
      level: level({ goals: [goal('wd1'), goal('wd2')] }),
      goals: [goal('wd1'), goal('wd2')],
      instances: CHAIN,
    });
    expect(c.suggestNames.value.has('木板')).toBe(true);
    expect(c.suggestNames.value.has('原木')).toBe(false);
  });
});

// ————————— 多方案策略列表 —————————

describe('useLevelCalc 策略列表', () => {
  /** @param extra 在基础关卡上加拆卸组 / 多渠道组等 */
  const lv = (extra: Partial<Level>) => level({ goals: [goal('wd1')], ...extra });

  it('无拆卸工厂且无多渠道 → 无多方案', () => {
    const c = calc({ level: lv({}), instances: CHAIN });
    expect(c.strategyResults.value.map((s) => s.key)).toEqual([]);
  });

  it('有拆卸工厂但无多渠道 → 无多方案（主结果即最优）', () => {
    const c = calc({
      level: lv({
        hasMergedProduction: true,
        coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'wd2', perOut: 1 }] }],
      }),
      instances: CHAIN,
    });
    expect(c.strategyResults.value.map((s) => s.key)).toEqual([]);
  });

  it('仅多渠道 → 配方输入最少 + 最复杂方案', () => {
    const c = calc({
      level: lv({
        hasMultipleInstances: true,
        multiChannelGroups: [{ typeName: '木板', instanceIds: ['wd1', 'wd2'] }],
      }),
      instances: CHAIN,
    });
    expect(c.strategyResults.value.map((s) => s.key)).toEqual(['fewestInputs', 'mostInputs']);
  });

  it('拆卸工厂 + 多渠道 → 最少浪费方案打头（最多 3 项）', () => {
    const c = calc({
      level: lv({
        hasMergedProduction: true,
        coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'wd2', perOut: 1 }] }],
        hasMultipleInstances: true,
        multiChannelGroups: [{ typeName: '木板', instanceIds: ['wd1', 'wd2'] }],
      }),
      instances: CHAIN,
    });
    expect(c.strategyResults.value.map((s) => s.key)).toEqual(['minWaste', 'fewestInputs', 'mostInputs']);
  });

  it('目标物资为时间型（刷新）→ 第三项换成单周期产出最小', () => {
    const c = calc({
      level: lv({
        hasMergedProduction: true,
        coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'wd2', perOut: 1 }] }],
        hasMultipleInstances: true,
        multiChannelGroups: [{ typeName: '木板', instanceIds: ['wd1', 'wd2'] }],
      }),
      instances: [
        inst({ id: 'rw', name: '原木', obtain: '无限' }),
        inst({ id: 'wd1', name: '木板', inputs: ['原木', '工人'], perOut: 1, perIn: 1 }),
        inst({ id: 'wd2', name: '木板', inputs: [], obtain: '刷新' }),
      ],
    });
    expect(c.strategyResults.value.map((s) => s.key)).toEqual(['minWaste', 'fewestInputs', 'smallestCycle']);
  });

  it('拆卸个数已手动指定（manualOutput / maxCycles）→ 无多方案', () => {
    const multi: Partial<Level> = {
      hasMultipleInstances: true,
      multiChannelGroups: [{ typeName: '木板', instanceIds: ['wd1', 'wd2'] }],
    };
    const manual = calc({
      level: lv({
        ...multi,
        hasMergedProduction: true,
        coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'wd2', perOut: 1 }], manualOutput: 3 }],
      }),
      instances: CHAIN,
    });
    expect(manual.strategyResults.value).toEqual([]);

    const capped = calc({
      level: lv({
        ...multi,
        hasMergedProduction: true,
        coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'wd2', perOut: 1 }], maxCycles: 2 }],
      }),
      instances: CHAIN,
    });
    expect(capped.strategyResults.value).toEqual([]);
  });
});

// ————————— 剩余多渠道 / 渠道分配 —————————

describe('useLevelCalc 剩余多渠道与渠道分配', () => {
  const lv = (extra: Partial<Level>) =>
    level({
      goals: [goal('wd1')],
      hasMergedProduction: true,
      coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'wd2', perOut: 1 }] }],
      hasMultipleInstances: true,
      multiChannelGroups: [{ typeName: '木板', instanceIds: ['wd1', 'wd2'] }],
      ...extra,
    });

  it('无拆卸组产出 → 不提示剩余多渠道', () => {
    const c = calc({ level: level({ goals: [goal('wd1')] }), instances: CHAIN });
    expect(c.remainingMultiChannel.value).toBeNull();
  });

  it('有拆卸组产出 → 列出剩余的多渠道物资', () => {
    const c = calc({ level: lv({}), instances: CHAIN });
    expect(c.remainingMultiChannel.value?.map((g) => g.name)).toEqual(['木板']);
    expect(c.remainingMultiChannel.value?.[0]!.instances.map((i) => i.id)).toEqual(['wd1', 'wd2']);
  });

  it('拆卸个数已定 → 剩余清单里剔除拆卸实例', () => {
    const c = calc({ level: lv({ coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'wd2', perOut: 1 }], manualOutput: 3 }] }), instances: CHAIN });
    // 剔除后只剩 1 个实例，不足 2 个 → 不再视为多渠道
    expect(c.remainingMultiChannel.value).toBeNull();
  });

  it('无拆卸渠道 → 渠道分配预览为空', () => {
    const c = calc({ level: level({ goals: [goal('wd1')] }), instances: CHAIN });
    expect(c.channelAllocations.value).toEqual([]);
  });
});
