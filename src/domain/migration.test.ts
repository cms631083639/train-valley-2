import { describe, expect, it } from 'vitest';
import type { GameData, Level, ResourceInstance, TrainLevel } from '@/types';
import {
  ensureWorkerEY,
  mergeWithSeed,
  migrateLevelStations,
  stripUndefined,
  validate,
} from '@/domain/migration';

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

const trains: TrainLevel[] = [{ level: 1, capacity: 4, price: 0, upgrade: 100, upgradable: true }];

function data(partial: Partial<GameData> = {}): GameData {
  return { instances: [], levels: [], trains, ...partial };
}

// ————————— stripUndefined —————————

describe('stripUndefined', () => {
  it('只剔除 undefined，保留 0 / 空串 / false', () => {
    const out = stripUndefined({ a: undefined, b: 0, c: '', d: false, e: 'x' });
    expect(out).toEqual({ b: 0, c: '', d: false, e: 'x' });
  });
});

// ————————— migrateLevelStations —————————

describe('migrateLevelStations', () => {
  it('workerStations 数字 → A/B/C 站点数组', () => {
    const lv = level({ workerStations: 3 });
    migrateLevelStations([lv]);
    expect(lv.workerStationArr?.map((w) => w.label)).toEqual(['A', 'B', 'C']);
  });

  it('未配置时默认生成 1 个工人站点', () => {
    const lv = level();
    migrateLevelStations([lv]);
    expect(lv.workerStationArr).toHaveLength(1);
  });

  it('已有 workerStationArr 时不重建', () => {
    const lv = level({ workerStationArr: [{ label: 'B' }] });
    migrateLevelStations([lv]);
    expect(lv.workerStationArr?.map((w) => w.label)).toEqual(['B']);
  });

  it('从 goals 站点标识反推站点数量（字母与旧「工人N」两种写法）', () => {
    const lv1 = level({ goals: [{ resourceId: 'x', qty: 1, stationLabels: ['C'] }] });
    migrateLevelStations([lv1]);
    expect(lv1.workerStationArr?.map((w) => w.label)).toEqual(['A', 'B', 'C']);

    const lv2 = level({ goals: [{ resourceId: 'x', qty: 1, stationLabel: '工人2' }] });
    migrateLevelStations([lv2]);
    expect(lv2.workerStationArr?.map((w) => w.label)).toEqual(['A', 'B']);
  });

  it('goal 站点标识「工人N」统一迁移为字母', () => {
    const lv = level({
      workerStationArr: [],
      goals: [{ resourceId: 'a1', qty: 2, stationLabels: ['工人1'], stationLabel: '工人1' }],
    });
    migrateLevelStations([lv]);
    expect(lv.goals[0]!.stationLabels).toEqual(['A']);
    expect(lv.goals[0]!.stationLabel).toBe('A');
  });

  it('旧 initialStations 的外部行并入 externalStationArr 并重编号，非外部行并入工人站点', () => {
    const lv = level({
      workerStationArr: [],
      initialStations: [
        { label: 'x1', resourceId: 'a1', kind: '刷新', interval: 110 },
        { label: 'b', resourceId: 'a2' },
      ],
    });
    migrateLevelStations([lv]);
    expect(lv.externalStationArr).toHaveLength(1);
    expect(lv.externalStationArr?.[0]).toMatchObject({
      label: 'm1', resourceId: 'a1', kind: '刷新', interval: 110,
    });
    expect(lv.workerStationArr?.some((w) => w.label === 'b')).toBe(true);
    expect('initialStations' in lv).toBe(false);
  });

  it('旧字段按 resourceId 与已有外部站对齐，undefined 不覆盖已有值', () => {
    const lv = level({
      workerStationArr: [],
      externalStationArr: [{ label: 'old', resourceId: 'a1', kind: '购买', price: 500 }],
      initialStations: [{ label: 'x1', resourceId: 'a1', kind: '购买' }],
    });
    migrateLevelStations([lv]);
    expect(lv.externalStationArr).toHaveLength(1);
    expect(lv.externalStationArr?.[0]).toMatchObject({ label: 'm1', resourceId: 'a1', price: 500 });
  });

  it('剔除空壳行并由数组长度推导 hasXxx 标记', () => {
    const lv = level({
      externalStationArr: [{ label: 'm1' }],
      resourceStationArr: [{ label: 'r1' }, { label: 'r2', resourceId: 'a1' }],
      passengerStationArr: [{ label: 'A' }],
      coProductionGroups: [
        { id: 'cp1', outputs: [] },
        { id: 'cp2', outputs: [{ instanceId: 'a1', perOut: 1 }] },
      ],
      multiChannelGroups: [
        { typeName: '  ', instanceIds: [] },
        { typeName: '钢板', instanceIds: [] },
      ],
      hasExternalStation: false,
    });
    migrateLevelStations([lv]);
    expect(lv.externalStationArr).toEqual([]);
    expect(lv.resourceStationArr).toHaveLength(1);
    expect(lv.passengerStationArr).toEqual([]);
    expect(lv.coProductionGroups).toHaveLength(1);
    expect(lv.multiChannelGroups).toHaveLength(1);
    expect(lv.hasResourceStation).toBe(true);
    expect(lv.hasMergedProduction).toBe(true);
    expect(lv.hasMultipleInstances).toBe(true);
    // 空数组不置 true；原值 false 保持不变
    expect(lv.hasPassengerStation).toBeUndefined();
    expect(lv.hasExternalStation).toBe(false);
  });
});

// ————————— validate —————————

describe('validate', () => {
  it('非对象直接判失败', () => {
    expect(validate(null)).toEqual({ data: null, issues: ['根节点必须是对象'] });
    expect(validate('x').data).toBeNull();
  });

  it('缺数组字段时按空表处理并记录问题', () => {
    const r = validate({});
    expect(r.data).toEqual({ instances: [], levels: [], trains: [] });
    expect(r.issues).toHaveLength(3);
  });

  it('检出重复 id / 缺名称 / 配方输入缺失 / 目标实例缺失', () => {
    const r = validate({
      instances: [inst({ id: 'a', name: '钢', inputs: ['不存在'] }), inst({ id: 'a', name: '' })],
      levels: [level({ goals: [{ resourceId: 'nope', qty: 1 }] })],
      trains: [],
    });
    const text = r.issues.join('|');
    expect(r.data).not.toBeNull();
    expect(text).toContain('重复 id：a');
    expect(text).toContain('缺少名称');
    expect(text).toContain('配方输入「不存在」');
    expect(text).toContain('不存在的物资实例：nope');
  });
});

// ————————— ensureWorkerEY —————————

describe('ensureWorkerEY', () => {
  it('缺少 工人eY 时插入到 工人XD 之后', () => {
    const d = data({ instances: [inst({ id: '工人XD', name: '工人' })] });
    ensureWorkerEY(d);
    expect(d.instances.map((i) => i.id)).toEqual(['工人XD', '工人eY']);
  });

  it('没有 工人XD 时追加到末尾', () => {
    const d = data({ instances: [inst({ id: 'other', name: '钢' })] });
    ensureWorkerEY(d);
    expect(d.instances.map((i) => i.id)).toEqual(['other', '工人eY']);
  });

  it('已存在时不重复插入', () => {
    const d = data({ instances: [inst({ id: '工人eY', name: '工人' })] });
    expect(ensureWorkerEY(d).instances).toHaveLength(1);
  });
});

// ————————— mergeWithSeed —————————

describe('mergeWithSeed', () => {
  const seedData = data({
    instances: [inst({ id: 's1', name: '钢' }), inst({ id: 's2', name: '煤' })],
    levels: [level({ id: 'L1', name: '种子关' })],
  });

  it('非 dev：实例以 seed 为准，追加用户新增，剔除删除标记', () => {
    const saved = data({
      instances: [inst({ id: 's1', name: '钢', notes: '存档改动' }), inst({ id: 'u1', name: '新物资' })],
    });
    const merged = mergeWithSeed(saved, seedData, new Set(['s2']));
    expect(merged.instances.map((i) => i.id)).toEqual(['s1', 'u1']);
    expect(merged.instances[0]!.notes).toBeUndefined();
    expect(merged.trains).toBe(seedData.trains);
  });

  it('dev：实例以存档为准，seed 兜底并入缺失 id', () => {
    const saved = data({
      instances: [inst({ id: 's1', name: '钢', notes: '存档改动' }), inst({ id: 'u1', name: '新物资' })],
    });
    const merged = mergeWithSeed(saved, seedData, new Set(), true);
    expect(merged.instances.map((i) => i.id)).toEqual(['s1', 'u1', 's2']);
    expect(merged.instances[0]!.notes).toBe('存档改动');
  });

  it('从存档 __deletedSeedInstIds 恢复删除标记（就地增补 Set）并剔除实例', () => {
    const deleted = new Set<string>();
    const saved = { ...data({ instances: [inst({ id: 's1', name: '钢' })] }), __deletedSeedInstIds: ['s2'] } as GameData;
    const merged = mergeWithSeed(saved, seedData, deleted);
    expect([...deleted]).toEqual(['s2']);
    expect(merged.instances.map((i) => i.id)).toEqual(['s1']);
  });

  it('关卡以 seed 为准，仅非 undefined 的存档字段覆盖', () => {
    const seedData2 = data({
      levels: [level({ id: 'L1', hasExternalStation: true, externalStationArr: [{ label: 'm9', resourceId: 'a1' }] })],
    });
    const saved = data({ levels: [{ id: 'L1', goals: [{ resourceId: 'a1', qty: 3 }] } as Level] });
    const merged = mergeWithSeed(saved, seedData2, new Set());
    const m = merged.levels[0]!;
    expect(m.goals).toHaveLength(1);
    // 存档未提供该字段 → 不得抹掉 seed 的 true
    expect(m.hasExternalStation).toBe(true);
    expect(m.externalStationArr?.[0]!.resourceId).toBe('a1');
    expect('initialStations' in m).toBe(false);
  });

  it('存档带旧 initialStations 时以其为准并完成迁移', () => {
    const seedData2 = data({ levels: [level({ id: 'L1', workerStationArr: [] })] });
    const saved = data({
      levels: [{
        id: 'L1',
        workerStationArr: [],
        initialStations: [{ label: 'x1', resourceId: 'a1', kind: '购买' }],
      } as unknown as Level],
    });
    const merged = mergeWithSeed(saved, seedData2, new Set());
    const m = merged.levels[0]!;
    expect('initialStations' in m).toBe(false);
    expect(m.externalStationArr?.[0]).toMatchObject({ label: 'm1', resourceId: 'a1', kind: '购买' });
  });

  it('保留存档中 seed 已不存在的关卡', () => {
    const saved = data({ levels: [level({ id: 'OLD', name: '老关卡' })] });
    const merged = mergeWithSeed(saved, data({ levels: [level({ id: 'L1' })] }), new Set());
    expect(merged.levels.map((l) => l.id)).toEqual(['L1', 'OLD']);
  });
});
