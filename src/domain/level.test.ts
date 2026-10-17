import { describe, expect, it } from 'vitest';
import type { ExternalStation, Level, LevelGoal, ResourceInstance } from '@/types';
import {
  buildStationInfoByName,
  collectCpOutputNames,
  collectEffectiveExternalNeeds,
  collectExternalCaps,
  collectLocalInstances,
  collectStationSuppliedNames,
  collectSuggestNames,
  collectUsedInstanceIds,
  deriveEffectiveWorkerStations,
  deriveWorkerStationLabels,
  detectMultiChannelGroups,
  estimateBestTime,
  isValidQty,
  stationQtyEach,
  stationQtyMax,
  stationQtyMin,
} from '@/domain/level';

// ————————— 测试夹具 —————————

function inst(partial: Partial<ResourceInstance> & { id: string; name: string }): ResourceInstance {
  return { inputs: [], ...partial };
}

function idx(list: ResourceInstance[]): Map<string, ResourceInstance> {
  return new Map(list.map((i) => [i.id, i]));
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

function goal(resourceId: string, qty = 1): LevelGoal {
  return { resourceId, qty };
}

/** cargoByLevel：等级 = 货运量，便于断言 */
const ctx = {
  cargoByLevel: (lv: number) => lv,
  minTrainLevel: 1,
  maxTrainLevel: 3,
  defaultIntervalSec: 0,
};

// ————————— isValidQty —————————

describe('isValidQty', () => {
  it('接受正整数且不超阈值', () => {
    expect(isValidQty(1)).toBe(true);
    expect(isValidQty(100)).toBe(true);
  });
  it('拒绝 0、负数、超阈值、非有限数与非数字', () => {
    expect(isValidQty(0)).toBe(false);
    expect(isValidQty(-1)).toBe(false);
    expect(isValidQty(101)).toBe(false);
    expect(isValidQty(Infinity)).toBe(false);
    expect(isValidQty('5')).toBe(false);
    expect(isValidQty(undefined)).toBe(false);
  });
});

// ————————— 站点货运量 —————————

describe('站点货运量计算', () => {
  const st: ExternalStation = { label: 'm1' };

  it('auto 开关为真时跟随列车等级', () => {
    expect(stationQtyMin({ ...st, minQtyAuto: true }, ctx)).toBe(ctx.minTrainLevel);
    expect(stationQtyMax({ ...st, maxQtyAuto: true }, ctx)).toBe(ctx.maxTrainLevel);
    expect(stationQtyEach({ ...st, qtyAuto: true }, ctx)).toBe(ctx.maxTrainLevel);
  });

  it('填写了有效数值时用填写值', () => {
    expect(stationQtyMin({ ...st, minQty: 2 }, ctx)).toBe(2);
    expect(stationQtyMax({ ...st, maxQty: 4 }, ctx)).toBe(4);
    expect(stationQtyEach({ ...st, qty: 5 }, ctx)).toBe(5);
  });

  it('未设置时回落到列车等级', () => {
    expect(stationQtyMin(st, ctx)).toBe(ctx.minTrainLevel);
    expect(stationQtyMax(st, ctx)).toBe(ctx.maxTrainLevel);
    expect(stationQtyEach(st, ctx)).toBe(ctx.maxTrainLevel);
    expect(stationQtyEach(undefined, ctx)).toBe(ctx.maxTrainLevel);
  });
});

// ————————— 集合类派生 —————————

describe('collectStationSuppliedNames', () => {
  const instances = [
    inst({ id: 'rs1', name: '煤' }),
    inst({ id: 'ps1', name: '乘客货' }),
    inst({ id: 'ex1', name: '钢' }),
    inst({ id: 'cp1', name: '木板' }),
    inst({ id: 'wk1', name: '椅子' }),
  ];
  const map = idx(instances);

  it('汇总资源站/客流站/外部站/拆卸组产出/工人站点的物资名', () => {
    const lv = level({
      hasResourceStation: true,
      resourceStationArr: [{ label: 'r1', resourceId: 'rs1' }],
      hasPassengerStation: true,
      passengerStationArr: [{ label: 'A', resourceId: 'ps1' }],
      hasExternalStation: true,
      externalStationArr: [{ label: 'm1', resourceId: 'ex1' }],
      hasMergedProduction: true,
      coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'cp1', perOut: 1 }] }],
      workerStationArr: [{ label: 'A', resourceId: 'wk1' }],
    });
    expect(collectStationSuppliedNames(lv, map)).toEqual(new Set(['煤', '乘客货', '钢', '木板', '椅子']));
  });

  it('标记为 false 时不计入对应站点', () => {
    const lv = level({
      hasResourceStation: false,
      resourceStationArr: [{ label: 'r1', resourceId: 'rs1' }],
      hasExternalStation: false,
      externalStationArr: [{ label: 'm1', resourceId: 'ex1' }],
    });
    expect(collectStationSuppliedNames(lv, map)).toEqual(new Set());
  });

  it('undefined 关卡返回空集合', () => {
    expect(collectStationSuppliedNames(undefined, map)).toEqual(new Set());
  });
});

describe('collectCpOutputNames', () => {
  const map = idx([inst({ id: 'cp1', name: '木板' }), inst({ id: 'cp2', name: '钢' })]);
  it('仅在拆卸工厂标记为真时收集产出名', () => {
    const lv = level({
      hasMergedProduction: true,
      coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'cp1', perOut: 1 }, { instanceId: 'cp2', perOut: 1 }] }],
    });
    expect(collectCpOutputNames(lv, map)).toEqual(new Set(['木板', '钢']));
  });
  it('标记为假时返回空集合', () => {
    const lv = level({ hasMergedProduction: false, coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'cp1', perOut: 1 }] }] });
    expect(collectCpOutputNames(lv, map)).toEqual(new Set());
  });
});

describe('collectSuggestNames', () => {
  const map = idx([
    inst({ id: 'a1', name: '钢坯' }),
    inst({ id: 'a2', name: '钢坯' }),
    inst({ id: 'b1', name: '铜' }),
  ]);

  it('同名 ≥2 实例才进入建议集合', () => {
    const lv = level({
      goals: [goal('a1'), goal('a2'), goal('b1')],
    });
    const result = collectSuggestNames(lv, lv.goals, map, new Set());
    expect(result.has('钢坯')).toBe(true);
    expect(result.has('铜')).toBe(false);
  });

  it('包含拆卸组产出名（经 cpOutputNames 传入）', () => {
    const lv = level({ goals: [goal('b1')] });
    const result = collectSuggestNames(lv, lv.goals, map, new Set(['铜']));
    expect(result.has('铜')).toBe(true);
  });

  it('undefined 关卡时仍返回 cpOutputNames 内容', () => {
    expect(collectSuggestNames(undefined, [], map, new Set(['铜']))).toEqual(new Set(['铜']));
  });
});

describe('collectExternalCaps', () => {
  const map = idx([inst({ id: 'ex1', name: '钢' })]);
  it('仅收集 suggestQty>0 的条目', () => {
    const lv = level({
      externalStationArr: [
        { label: 'm1', resourceId: 'ex1', suggestQty: 24 },
        { label: 'm2', resourceId: 'ex1', suggestQty: 0 },
        { label: 'm3' },
      ],
    });
    expect(collectExternalCaps(lv, map)).toEqual([{ name: '钢', instanceId: 'ex1', qty: 24 }]);
  });
  it('没有有效条目时返回 undefined', () => {
    expect(collectExternalCaps(level({ externalStationArr: [{ label: 'm1', resourceId: 'ex1' }] }), map)).toBeUndefined();
    expect(collectExternalCaps(level(), map)).toBeUndefined();
  });
});

describe('collectLocalInstances', () => {
  it('汇总各类站点实例并按去重（目标优先级最高）', () => {
    const map = idx([
      inst({ id: 'ps1', name: '客' }),
      inst({ id: 'ex1', name: '外' }),
      inst({ id: 'rs1', name: '资' }),
      inst({ id: 'wk1', name: '工' }),
      inst({ id: 'cp1', name: '拆' }),
      inst({ id: 'g1', name: '目' }),
    ]);
    const lv = level({
      passengerStationArr: [{ label: 'A', resourceId: 'ps1' }],
      externalStationArr: [{ label: 'm1', resourceId: 'ex1' }],
      resourceStationArr: [{ label: 'r1', resourceId: 'rs1' }],
      workerStationArr: [{ label: 'A', resourceId: 'wk1' }],
      coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'cp1', perOut: 1 }] }],
    });
    const list = collectLocalInstances(lv, [goal('g1')], map);
    expect(list.map((i) => i.id).sort()).toEqual(['cp1', 'ex1', 'g1', 'ps1', 'rs1', 'wk1']);
  });
  it('undefined 关卡返回空数组', () => {
    expect(collectLocalInstances(undefined, [], idx([]))).toEqual([]);
  });
});

describe('collectUsedInstanceIds', () => {
  const map = idx([inst({ id: 'a1', name: '钢' }), inst({ id: 'a2', name: '钢' }), inst({ id: 'b1', name: '铜' })]);
  it('只收集名称匹配的实例（目标/资源站/外部站/拆卸组）', () => {
    const lv = level({
      goals: [goal('a1')],
      resourceStationArr: [{ label: 'r1', resourceId: 'a2' }],
      externalStationArr: [{ label: 'm1', resourceId: 'b1' }],
      coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'a1', perOut: 1 }] }],
    });
    expect(collectUsedInstanceIds(lv, '钢', map).sort()).toEqual(['a1', 'a2']);
  });
  it('可显式传入 goals 覆盖 lv.goals（供自动检测复用同一批目标）', () => {
    const lv = level({ goals: [goal('b1')] });
    expect(collectUsedInstanceIds(lv, '钢', map, [goal('a2')])).toEqual(['a2']);
    // 不传时仍读 lv.goals
    expect(collectUsedInstanceIds(lv, '铜', map)).toEqual(['b1']);
  });
});

// ————————— 站点索引 / 外部清单 —————————

describe('buildStationInfoByName', () => {
  const map = idx([
    inst({ id: 'rf', name: '煤', obtain: '刷新' }),
    inst({ id: 'by', name: '钢', obtain: '购买' }),
    inst({ id: 'pk', name: '木', obtain: '客流' }),
  ]);

  it('刷新类：每周期数量跟随等级，记录间隔', () => {
    const lv = level({
      hasExternalStation: true,
      externalStationArr: [{ label: 'm1', resourceId: 'rf', kind: '刷新', qtyAuto: true, interval: 110 }],
    });
    const info = buildStationInfoByName(lv, map, ctx).get('煤');
    expect(info).toMatchObject({ kind: '刷新', qtyEach: ctx.maxTrainLevel, intervalSec: 110 });
  });

  it('购买类：qtyEach 取最高货运量，保留 min/max/price', () => {
    const lv = level({
      hasExternalStation: true,
      externalStationArr: [{ label: 'm1', resourceId: 'by', kind: '购买', minQtyAuto: true, maxQtyAuto: true, price: 500 }],
    });
    const info = buildStationInfoByName(lv, map, ctx).get('钢');
    expect(info).toMatchObject({
      kind: '购买',
      qtyEach: ctx.maxTrainLevel,
      minQty: ctx.minTrainLevel,
      maxQty: ctx.maxTrainLevel,
      price: 500,
    });
  });

  it('客流站点：未设数量时用最高等级货运量，且不与外部站同名覆盖', () => {
    const lv = level({
      hasExternalStation: true,
      externalStationArr: [{ label: 'm1', resourceId: 'rf', kind: '刷新', qtyAuto: true, interval: 110 }],
      hasPassengerStation: true,
      passengerStationArr: [{ label: 'A', resourceId: 'pk' }],
    });
    const info = buildStationInfoByName(lv, map, ctx);
    expect(info.get('木')).toMatchObject({ kind: '客流', qtyEach: ctx.maxTrainLevel, intervalSec: 0 });
    // 同名既在外部站又在客流站时，保留外部站优先
    const lv2 = level({
      hasExternalStation: true,
      externalStationArr: [{ label: 'm1', resourceId: 'pk', kind: '刷新', qtyAuto: true, interval: 110 }],
      hasPassengerStation: true,
      passengerStationArr: [{ label: 'A', resourceId: 'pk' }],
    });
    expect(buildStationInfoByName(lv2, map, ctx).get('木')).toMatchObject({ kind: '刷新' });
  });
});

describe('collectEffectiveExternalNeeds', () => {
  const map = idx([inst({ id: 'ex1', name: '钢' }), inst({ id: 'pk1', name: '木' })]);
  it('合并引擎 externalNeeds 与关卡站点，按 name 去重且保留非零数量', () => {
    const lv = level({
      externalStationArr: [{ label: 'm1', resourceId: 'ex1', kind: '购买' }],
      hasPassengerStation: true,
      passengerStationArr: [{ label: 'A', resourceId: 'pk1' }],
    });
    const list = collectEffectiveExternalNeeds([{ name: '钢', qty: 12, obtain: '刷新' }], lv, map);
    const byName = Object.fromEntries(list.map((n) => [n.name, n]));
    expect(byName['钢']).toMatchObject({ qty: 12, obtain: '刷新' });
    expect(byName['木']).toMatchObject({ qty: 0, obtain: '客流' });
  });
});

// ————————— 工人站点推导 —————————

describe('deriveWorkerStationLabels', () => {
  it('优先使用 workerStationArr 的标签', () => {
    expect(deriveWorkerStationLabels(level({ workerStationArr: [{ label: 'A' }, { label: 'B' }] }), [])).toEqual(['A', 'B']);
  });
  it('无数组时从 goals 的 stationLabel 反推字母序列', () => {
    const lv = level();
    const goals = [{ resourceId: 'x', qty: 1, stationLabel: 'C' }];
    expect(deriveWorkerStationLabels(lv, goals)).toEqual(['A', 'B', 'C']);
  });
});

describe('deriveEffectiveWorkerStations', () => {
  it('有 workerStationArr 时原样返回', () => {
    const arr = [{ label: 'A' }, { label: 'B' }];
    expect(deriveEffectiveWorkerStations(level({ workerStationArr: arr }), [])).toBe(arr);
  });
  it('退化为旧 workerStations(number) 生成标签', () => {
    expect(deriveEffectiveWorkerStations(level({ workerStations: 3 }), [])).toEqual([{ label: 'A' }, { label: 'B' }, { label: 'C' }]);
  });
});

// ————————— 最快通关时间 —————————

describe('estimateBestTime', () => {
  const map = idx([inst({ id: 'rf', name: '煤', obtain: '刷新' })]);

  it('按刷新站点算趟数与耗时，取最慢的瓶颈资源', () => {
    const lv = level({
      externalStationArr: [{ label: 'm1', resourceId: 'rf', kind: '刷新', qty: 4, refreshStart: 'timed', startDelay: 20, interval: 110 }],
    });
    const result = estimateBestTime([{ name: '煤', qty: 10 }], lv, map, ctx);
    // trips = ceil(10/4)=3 → 20 + 2*110 = 240
    expect(result?.seconds).toBe(240);
    expect(result?.perResource[0]).toMatchObject({ name: '煤', per: 4, trips: 3, total: 240 });
  });

  it('无刷新站点覆盖或无需求时返回 null', () => {
    expect(estimateBestTime(undefined, level(), map, ctx)).toBeNull();
    expect(estimateBestTime([{ name: '铜', qty: 5 }], level(), map, ctx)).toBeNull();
  });
});

// ————————— 多渠道组自动检测 —————————

describe('detectMultiChannelGroups', () => {
  // 同名"木板"三个实例；"原木"单实例
  const instances = [
    inst({ id: 'wd1', name: '木板' }),
    inst({ id: 'wd2', name: '木板' }),
    inst({ id: 'wd3', name: '木板' }),
    inst({ id: 'rw', name: '原木' }),
  ];
  const map = idx(instances);

  it('无同名多实例时返回原列表且不新增', () => {
    const g = [goal('rw')];
    const r = detectMultiChannelGroups(level({ goals: g }), g, map, instances);
    expect(r.addedIndexes).toEqual([]);
    expect(r.groups).toEqual([]);
  });

  it('目标出现同名多实例时自动建组并返回新增下标', () => {
    const g = [goal('wd1'), goal('wd2')];
    const r = detectMultiChannelGroups(level({ goals: g }), g, map, instances);
    expect(r.addedIndexes).toEqual([0]);
    expect(r.groups).toEqual([{ typeName: '木板', instanceIds: ['wd1', 'wd2'] }]);
  });

  it('资源站点提供的同名第二实例也会触发建组', () => {
    const g = [goal('wd1')];
    const lv = level({ goals: g, resourceStationArr: [{ label: 'r1', resourceId: 'wd2' }] });
    const r = detectMultiChannelGroups(lv, g, map, instances);
    expect(r.addedIndexes).toEqual([0]);
    expect(r.groups[0]).toEqual({ typeName: '木板', instanceIds: ['wd1', 'wd2'] });
  });

  it('拆卸组产出实例计入新建组的实例清单', () => {
    const g = [goal('wd1')];
    const lv = level({
      goals: g,
      resourceStationArr: [{ label: 'r1', resourceId: 'wd2' }],
      coProductionGroups: [{ id: 'cp1', outputs: [{ instanceId: 'wd3', perOut: 1 }] }],
    });
    const r = detectMultiChannelGroups(lv, g, map, instances);
    expect(r.groups[0].instanceIds).toEqual(['wd1', 'wd2', 'wd3']);
  });

  it('已存在的同名组不重复添加', () => {
    const g = [goal('wd1'), goal('wd2')];
    const lv = level({ goals: g, multiChannelGroups: [{ typeName: '木板', instanceIds: ['wd1'] }] });
    const r = detectMultiChannelGroups(lv, g, map, instances);
    expect(r.addedIndexes).toEqual([]);
    expect(r.groups).toEqual([{ typeName: '木板', instanceIds: ['wd1'] }]);
  });

  it('新建组追加到已有组之后，下标可对', () => {
    const g = [goal('wd1'), goal('wd2')];
    const lv = level({ goals: g, multiChannelGroups: [{ typeName: '原木', instanceIds: ['rw'] }] });
    const r = detectMultiChannelGroups(lv, g, map, instances);
    expect(r.addedIndexes).toEqual([1]);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[1]).toEqual({ typeName: '木板', instanceIds: ['wd1', 'wd2'] });
  });

  it('不改动入参（纯函数）', () => {
    const g = [goal('wd1'), goal('wd2')];
    const lv = level({ goals: g, multiChannelGroups: [{ typeName: '原木', instanceIds: ['rw'] }] });
    const before = JSON.stringify([lv, g, instances]);
    detectMultiChannelGroups(lv, g, map, instances);
    expect(JSON.stringify([lv, g, instances])).toBe(before);
  });
});