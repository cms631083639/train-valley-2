import { describe, expect, it } from 'vitest';
import type { GameData, ResourceInstance } from '@/types';
import { breakdownGoals } from '@/engine/breakdown';

// ————————— 夹具 —————————

function inst(partial: Partial<ResourceInstance> & { id: string; name: string }): ResourceInstance {
  return { inputs: [], ...partial };
}

function data(instances: ResourceInstance[]): GameData {
  return { instances, levels: [], trains: [] };
}

/** 原木（原料） → 木板（原木 + 工人） */
const woodChain = data([
  inst({ id: 'rw', name: '原木', inputs: [], obtain: '无限' }),
  inst({ id: 'wd', name: '木板', inputs: ['原木', '工人'], perOut: 1, perIn: 1 }),
]);

// ————————— 用例 —————————

describe('breakdownGoals', () => {
  it('空目标：无根节点、无原料需求', () => {
    const result = breakdownGoals([], woodChain);
    expect(result.roots).toEqual([]);
    expect(result.rawNeeds).toEqual([]);
  });

  it('单条生产链：沿配方下钻到原料叶子', () => {
    const result = breakdownGoals([{ instanceId: 'wd', qty: 6 }], woodChain);
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]!.name).toBe('木板');
    const 原木 = result.rawNeeds.find((n) => n.name === '原木');
    expect(原木?.qty).toBe(6);
  });

  it('直接以原料为目标：原料需求等于目标数量', () => {
    const result = breakdownGoals([{ instanceId: 'rw', qty: 4 }], woodChain);
    const 原木 = result.rawNeeds.find((n) => n.name === '原木');
    expect(原木?.qty).toBe(4);
  });

  it('目标引用不存在的实例：产出警告且不影响其他目标', () => {
    const result = breakdownGoals([{ instanceId: 'nope', qty: 1 }], woodChain);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});