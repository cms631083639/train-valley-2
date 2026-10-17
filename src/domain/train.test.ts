import { describe, expect, it } from 'vitest';
import type { Level, TrainLevel } from '@/types';
import {
  cargoOfLevel,
  initMaxTrainLevel,
  initMinTrainLevel,
  maxTrainLevelFromCount,
  maxTrainLevelOf,
  resolveMaxTrainLevel,
  upgradeCountMaxOf,
  upgradeCountOf,
  upgradeLevelOptionsOf,
} from '@/domain/train';

// ————————— 测试夹具 —————————

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

/** 等级 1..6 的列车表，capacity = level * 3 */
const TRAINS: TrainLevel[] = [1, 2, 3, 4, 5, 6].map((lv) => ({
  level: lv,
  capacity: lv * 3,
  price: lv * 100,
  upgrade: lv < 6 ? lv * 50 : null,
  upgradable: lv < 6,
}));

// ————————— 等级取数 —————————

describe('maxTrainLevelOf', () => {
  it('取列车数据最高等级', () => {
    expect(maxTrainLevelOf(TRAINS)).toBe(6);
  });
  it('无列车数据时回落 6', () => {
    expect(maxTrainLevelOf([])).toBe(6);
  });
});

describe('initMaxTrainLevel / initMinTrainLevel', () => {
  it('空关卡回落 1', () => {
    expect(initMaxTrainLevel(undefined)).toBe(1);
    expect(initMinTrainLevel(undefined)).toBe(1);
    expect(initMaxTrainLevel(level())).toBe(1);
  });
  it('多列车取最高 / 最低等级', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }, { level: 5, count: 2 }] });
    expect(initMaxTrainLevel(lv)).toBe(5);
    expect(initMinTrainLevel(lv)).toBe(2);
  });
});

describe('resolveMaxTrainLevel', () => {
  it('未配置时默认升 1 级', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    expect(resolveMaxTrainLevel(lv, 6)).toBe(3);
  });
  it('配置合法（落在 [初始最高, 数据最高]）时采用配置值', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }], maxTrainLevel: 5 });
    expect(resolveMaxTrainLevel(lv, 6)).toBe(5);
  });
  it('配置低于初始最高等级时忽略，回落默认', () => {
    const lv = level({ initialTrains: [{ level: 4, count: 1 }], maxTrainLevel: 2 });
    expect(resolveMaxTrainLevel(lv, 6)).toBe(5);
  });
  it('配置超过数据最高等级时忽略，回落默认', () => {
    const lv = level({ initialTrains: [{ level: 5, count: 1 }], maxTrainLevel: 9 });
    expect(resolveMaxTrainLevel(lv, 6)).toBe(6); // min(6, 5+1)
  });
  it('初始最高等级已达上限时不再上浮', () => {
    const lv = level({ initialTrains: [{ level: 6, count: 1 }] });
    expect(resolveMaxTrainLevel(lv, 6)).toBe(6);
  });
});

describe('cargoOfLevel', () => {
  it('命中列车表时取 capacity', () => {
    expect(cargoOfLevel(4, TRAINS, 6)).toBe(12);
  });
  it('未命中时回落等级本身', () => {
    expect(cargoOfLevel(3, [], 6)).toBe(3);
  });
  it('未命中且等级超上限时夹到上限', () => {
    expect(cargoOfLevel(9, [], 6)).toBe(6);
  });
  it('未命中且等级非法（<=0）时夹到下限 1', () => {
    expect(cargoOfLevel(0, [], 6)).toBe(1);
  });
});

// ————————— 升级下拉 / 次数 —————————

describe('upgradeLevelOptionsOf', () => {
  it('从初始最高等级起列出候选', () => {
    const lv = level({ initialTrains: [{ level: 3, count: 1 }] });
    expect(upgradeLevelOptionsOf(lv, TRAINS).map((t) => t.level)).toEqual([3, 4, 5, 6]);
  });
  it('无初始列车时从 1 起列出全部', () => {
    expect(upgradeLevelOptionsOf(level(), TRAINS).map((t) => t.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('upgradeCountOf / upgradeCountMaxOf', () => {
  it('按当前最高等级与初始最高等级之差计算', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    expect(upgradeCountOf(lv, 5)).toBe(3);
  });
  it('当前最高等级低于初始时夹到 0', () => {
    const lv = level({ initialTrains: [{ level: 4, count: 1 }] });
    expect(upgradeCountOf(lv, 3)).toBe(0);
  });
  it('步进器上限 = 数据最高等级 - 初始最高等级', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    expect(upgradeCountMaxOf(lv, 6)).toBe(4);
  });
});

describe('maxTrainLevelFromCount', () => {
  it('count=0 表示不升级，最高等级 = 初始最高等级', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    expect(maxTrainLevelFromCount(0, lv, 6)).toBe(2);
  });
  it('正常次数叠加到初始最高等级', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    expect(maxTrainLevelFromCount(3, lv, 6)).toBe(5);
  });
  it('超过步进器上限时封顶', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    expect(maxTrainLevelFromCount(99, lv, 6)).toBe(6);
  });
  it('负数夹到 0', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    expect(maxTrainLevelFromCount(-5, lv, 6)).toBe(2);
  });
  it('小数向下取整', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    expect(maxTrainLevelFromCount(2.9, lv, 6)).toBe(4);
  });
  it('与 resolveMaxTrainLevel 回算一致（默认升 1 级 → count=1）', () => {
    const lv = level({ initialTrains: [{ level: 2, count: 1 }] });
    const resolved = resolveMaxTrainLevel(lv, 6);
    expect(upgradeCountOf(lv, resolved)).toBe(1);
    expect(maxTrainLevelFromCount(1, lv, 6)).toBe(resolved);
  });
});
