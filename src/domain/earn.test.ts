import { describe, expect, it } from 'vitest';
import type { Level, ResourceInstance } from '@/types';
import { computeEarnPlan, earnTargetOf } from '@/domain/earn';

// ————————— 测试夹具 —————————

function inst(partial: Partial<ResourceInstance> & { id: string; name: string }): ResourceInstance {
  return { inputs: [], ...partial };
}

function idx(list: ResourceInstance[]): Map<string, ResourceInstance> {
  return new Map(list.map((i) => [i.id, i]));
}

/** 物资名 → 该名首个「有配方」的生产实例（模拟调用方构造的 producers） */
function prodIdx(list: ResourceInstance[]): Map<string, ResourceInstance> {
  const m = new Map<string, ResourceInstance>();
  for (const i of list) if (i.inputs.length > 0 && !m.has(i.name)) m.set(i.name, i);
  return m;
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

// ————————— 公共测试数据（对应任务验收用例）—————————

const prices = { 工人: 1000, 原木: 2000, 钢板: 4000, 电线: 6000, 机床: 9000 };
const instances = idx([
  inst({ id: '钢板Xi', name: '钢板', inputs: ['工人'], perOut: 1 }),
  inst({ id: '电线3n', name: '电线', inputs: ['工人'], perOut: 1 }),
  inst({ id: '机床lh', name: '机床', inputs: ['工人', '钢板', '电线'], perOut: 1 }),
]);
const producers = prodIdx([...instances.values()]);

// ————————— 验收用例 —————————

describe('computeEarnPlan（生产链总价值）', () => {
  it('电线3n 单实例 = 7000（产出 6000 + 外部工人 1000）', () => {
    const r = computeEarnPlan([{ resourceId: '电线3n', qty: 1 }], instances, prices, producers);
    expect(r.rows[0].chainValue).toBe(7000);
    expect(r.externals).toEqual([{ name: '工人', qty: 1, price: 1000, subtotal: 1000, missingPrice: false }]);
    expect(r.total).toBe(7000);
  });

  it('机床lh 单实例 = 22000（机床9000 + 钢板4000 + 电线6000 + 工人×3=3000），且 ≠ 20000', () => {
    const r = computeEarnPlan([{ resourceId: '机床lh', qty: 1 }], instances, prices, producers);
    expect(r.rows[0].chainValue).toBe(22000);
    expect(r.rows[0].chainValue).not.toBe(20000);
    expect(r.externals).toEqual([{ name: '工人', qty: 3, price: 1000, subtotal: 3000, missingPrice: false }]);
    expect(r.total).toBe(22000);
  });

  it('机床lh×1 + 电线3n×1 → 合计 22000（电线由已列出行自产，缺口 0；其工人不重复）', () => {
    const r = computeEarnPlan(
      [
        { resourceId: '机床lh', qty: 1 },
        { resourceId: '电线3n', qty: 1 },
      ],
      instances,
      prices,
      producers,
    );
    expect(r.total).toBe(22000);
    expect(r.externals).toEqual([{ name: '工人', qty: 3, price: 1000, subtotal: 3000, missingPrice: false }]);
    // 逐行链价值：机床 22000、电线 7000；行小计合计 29000 > 去重合计 22000
    expect(r.rows[0].chainValue).toBe(22000);
    expect(r.rows[1].chainValue).toBe(7000);
    expect(r.sumRowSubtotals).toBe(29000);
    expect(r.sumRowSubtotals).toBeGreaterThan(r.total);
  });

  it('重叠去重：机床lh×1 + 钢板Xi×1 → 合计仍 22000，sumRowSubtotals=27000 > total', () => {
    const r = computeEarnPlan(
      [
        { resourceId: '机床lh', qty: 1 },
        { resourceId: '钢板Xi', qty: 1 },
      ],
      instances,
      prices,
      producers,
    );
    expect(r.total).toBe(22000);
    expect(r.sumRowSubtotals).toBe(27000);
    expect(r.sumRowSubtotals).toBeGreaterThan(r.total);
    expect(r.rows[1].chainValue).toBe(5000); // 钢板4000 + 工人1000
  });

  it('perOut>1 的 ceil 展开：1 份「家具」缺口 → 展开 1 个周期产出 2 份', () => {
    const list = [
      inst({ id: '家具a', name: '家具', inputs: ['工人'], perOut: 2 }),
      inst({ id: '高级品x', name: '高级品', inputs: ['家具'], perOut: 1 }),
    ];
    const r = computeEarnPlan([{ resourceId: '高级品x', qty: 1 }], idx(list), { 工人: 1000, 家具: 5000, 高级品: 10000 }, prodIdx(list));
    // 高级品 10000 + 家具 ×2（ceil(1/2)=1 周期）10000 + 工人 1000
    expect(r.rows[0].chainValue).toBe(21000);
    expect(r.total).toBe(21000);
    expect(r.externals).toEqual([{ name: '工人', qty: 1, price: 1000, subtotal: 1000, missingPrice: false }]);
  });
});

// ————————— 边界 —————————

describe('computeEarnPlan（边界）', () => {
  it('缺 prices 的产出名按 0 计并在行上标注', () => {
    const r = computeEarnPlan([{ resourceId: 'u', qty: 4 }], idx([inst({ id: 'u', name: '未知物资' })]), {}, prodIdx([]));
    expect(r.rows[0]).toEqual({
      uid: undefined,
      resourceId: 'u',
      chainValue: 0,
      qty: 4,
      subtotal: 0,
      missingPrice: true,
    });
    expect(r.total).toBe(0);
  });

  it('缺 prices 的叶子按 0 计并在叶子明细标注', () => {
    const list = [inst({ id: 'p', name: '成品', inputs: ['神秘'], perOut: 1 })];
    const r = computeEarnPlan([{ resourceId: 'p', qty: 1 }], idx(list), { 成品: 100 }, prodIdx(list));
    expect(r.total).toBe(100);
    expect(r.externals).toEqual([{ name: '神秘', qty: 1, price: 0, subtotal: 0, missingPrice: true }]);
  });

  it('空行（无 resourceId）/ 实例 id 找不到 → 按 0 计且保留行以一一对应', () => {
    const r = computeEarnPlan(
      [
        { resourceId: '', qty: 9 },
        { resourceId: 'ghost', qty: 5 },
      ],
      instances,
      prices,
      producers,
    );
    expect(r.rows).toEqual([
      { uid: undefined, resourceId: '', chainValue: 0, qty: 9, subtotal: 0, missingPrice: false },
      { uid: undefined, resourceId: 'ghost', chainValue: 0, qty: 5, subtotal: 0, missingPrice: false },
    ]);
    expect(r.externals).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.sumRowSubtotals).toBe(0);
  });

  it('空 / 未定义 rows → 结果全空、合计 0', () => {
    expect(computeEarnPlan(undefined, idx([]), undefined, undefined)).toEqual({
      rows: [],
      externals: [],
      total: 0,
      sumRowSubtotals: 0,
    });
    expect(computeEarnPlan([], idx([]), { 工人: 1000 }, undefined)).toEqual({
      rows: [],
      externals: [],
      total: 0,
      sumRowSubtotals: 0,
    });
  });

  it('排除电力：既不计消耗也不计收益', () => {
    const list = [
      inst({ id: 'e', name: '电力', inputs: [] }),
      inst({ id: 'y', name: '成品', inputs: ['电力', '工人'], perOut: 1 }),
    ];
    const r = computeEarnPlan(
      [
        { resourceId: 'e', qty: 5 },
        { resourceId: 'y', qty: 1 },
      ],
      idx(list),
      { 电力: 9999, 成品: 3000, 工人: 1000 },
      prodIdx(list),
    );
    expect(r.rows[0].chainValue).toBe(0); // 电力行被排除
    expect(r.rows[1].chainValue).toBe(4000); // 成品3000 + 工人1000
    expect(r.total).toBe(4000);
    expect(r.externals).toEqual([{ name: '工人', qty: 1, price: 1000, subtotal: 1000, missingPrice: false }]);
  });
});

// ————————— earnTargetOf —————————

describe('earnTargetOf', () => {
  it('解析数字字符串目标值', () => {
    expect(earnTargetOf(level({ earn: '40000' }))).toBe(40000);
    expect(earnTargetOf(level({ earn: '280000' }))).toBe(280000);
  });

  it('空 / 非法 → 0；关卡未定义 → 0', () => {
    expect(earnTargetOf(level({ earn: '' }))).toBe(0);
    expect(earnTargetOf(level({ earn: 'abc' }))).toBe(0);
    expect(earnTargetOf(undefined)).toBe(0);
  });
});

// ————————— 达标 / 未达标判定（合计 vs 目标）—————————

describe('挣钱达标判定', () => {
  it('合计 >= 目标 → 已达标', () => {
    const r = computeEarnPlan([{ resourceId: '机床lh', qty: 1 }], instances, prices, producers);
    const target = earnTargetOf(level({ earn: '22000' }));
    expect(r.total).toBe(22000);
    expect(r.total >= target).toBe(true);
  });

  it('合计 < 目标 → 未达标', () => {
    const r = computeEarnPlan([{ resourceId: '机床lh', qty: 1 }], instances, prices, producers);
    const target = earnTargetOf(level({ earn: '40000' }));
    expect(r.total).toBe(22000);
    expect(r.total >= target).toBe(false);
    expect(target - r.total).toBe(18000);
  });
});
