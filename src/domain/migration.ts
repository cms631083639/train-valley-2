/**
 * 数据迁移 / 归一化 / 合并（纯逻辑层）。
 *
 * 从 stores/game.ts 抽出，行为与原实现逐行等价：只做「旧结构 → 新结构」的搬运与
 * 「seed × 存档」的合并，不触碰任何持久化 I/O，便于单测与复用。
 */

import { OBTAIN, STATION_KIND } from '@/constants';
import { USER_EDITABLE_FIELDS } from '@/domain/levelFields';
import type { ExternalStation, GameData, InitialStation, Level, ResourceInstance, WorkerStation } from '@/types';
import { WORKER_NAME } from '@/types';

/** 空数据集（校验兜底用） */
const EMPTY: GameData = { instances: [], levels: [], trains: [] };

// ————————— 站点结构迁移（旧字段 → 三新数组）—————————
/** 过滤掉值为 undefined 的键，避免用空值覆盖已有字段 */
export function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * 站点结构迁移与归一化（幂等）：
 * - workerStations (number) → workerStationArr 数量生成 A/B/C…
 * - initialStations (array) 的 external 行 → 合并进 externalStationArr（旧字段优先），非 external 行 → workerStationArr
 * - 迁移后删除 initialStations，保证 externalStationArr 是外部站点的唯一数据源
 * - goals.stationLabels / stationLabel → "工人N" 格式转成 A/B/C
 */
export function migrateLevelStations(levels: Level[]): void {
  for (const lv of levels) {
    // —— 站点数组迁移 ——
    // 规则：workerStationArr 已有就不改；没有则从 workerStations(number) 或 goals.stationLabels 反推
    if (!lv.workerStationArr) {
      let count = 1;
      if (typeof lv.workerStations === 'number') {
        count = lv.workerStations;
      } else if (Array.isArray(lv.goals)) {
        // 从 goals 的 stationLabels 反推最大站点数
        const maxIdx = lv.goals.reduce((mx, g) => {
          const labels = [...(g.stationLabels ?? []), ...(g.stationLabel ? [g.stationLabel] : [])];
          for (const lb of labels) {
            // 支持 A/B/C 或 a/b/c 格式
            const m = lb.match(/^([a-zA-Z])(\d*)$/);
            if (m) {
              if (m[2]) { mx = Math.max(mx, +m[2]); }
              else { mx = Math.max(mx, m[1].toUpperCase().charCodeAt(0) - 64); }
            } else {
              // 旧格式 "工人N"
              const n = lb.match(/^工人(\d+)$/);
              if (n) mx = Math.max(mx, +n[1]);
            }
          }
          return mx;
        }, 0);
        if (maxIdx > 0) count = maxIdx;
      }
      const arr: WorkerStation[] = [];
      for (let i = 0; i < count; i++) arr.push({ label: String.fromCharCode(65 + i) });
      lv.workerStationArr = arr;
    }

    // —— 外部站点归一化：旧 initialStations(刷新/购买/库存/客流) 并入 externalStationArr ——
    // 规则：initialStations 是用户实际编辑的权威来源，字段值优先覆盖；
    //       externalStationArr 中旧字段没有的行予以保留；合并后统一重编号 m1..mN；
    //       迁移完成后删除 initialStations，彻底消除「同一份数据两处存储」的双源问题。
    //       initialStations 里 kind 为空的按工人站点并入 workerStationArr。
    const legacyExternal: ExternalStation[] = [];
    const workerArr: WorkerStation[] = [...(lv.workerStationArr ?? [])];

    if (Array.isArray(lv.initialStations)) {
      for (const s of lv.initialStations as InitialStation[]) {
        const isExternal =
          s.kind === STATION_KIND.REFRESH ||
          s.kind === STATION_KIND.BUY ||
          s.kind === STATION_KIND.STOCK ||
          s.kind === STATION_KIND.PASSENGER;
        if (isExternal) {
          legacyExternal.push({
            label: s.label,
            resourceId: s.resourceId,
            qty: s.qty, qtyAuto: s.qtyAuto,
            kind: s.kind,
            refreshStart: s.refreshStart, startDelay: s.startDelay,
            unlockPrice: s.unlockPrice, interval: s.interval,
            price: s.price, minQty: s.minQty, minQtyAuto: s.minQtyAuto,
            maxQty: s.maxQty, maxQtyAuto: s.maxQtyAuto,
            suggestQty: s.suggestQty,
          });
        } else if (!workerArr.some((w) => w.label === s.label)) {
          workerArr.push({ label: s.label, resourceId: s.resourceId, qty: s.qty, qtyAuto: s.qtyAuto });
        }
      }
    }

    const existingExternal: ExternalStation[] = lv.externalStationArr ?? [];
    let mergedExternal: ExternalStation[];
    if (legacyExternal.length) {
      // 旧字段优先，按 resourceId 与已有行对齐；对齐时 undefined 不覆盖已有值
      const consumed = new Set<number>();
      const reconciled = legacyExternal.map((legacy) => {
        const idx = existingExternal.findIndex(
          (e, i) => !consumed.has(i) && !!e.resourceId && e.resourceId === legacy.resourceId,
        );
        if (idx < 0) return legacy;
        consumed.add(idx);
        return { ...existingExternal[idx], ...stripUndefined(legacy) };
      });
      const onlyNew = existingExternal.filter((_, i) => !consumed.has(i));
      mergedExternal = [...reconciled, ...onlyNew];
    } else {
      mergedExternal = existingExternal;
    }
    // 重新编号 m1..mN（生成新对象，避免污染模块级 seed 引用）；
    // 同时剔除空壳行：没有 resourceId 的外部站是"半途新增/历史遗留"，不算数据，
    // 否则会随 seed 反复复活（与拆卸组/多渠道组同一类问题）。
    mergedExternal = mergedExternal
      .filter((e) => !!e.resourceId)
      .map((e, i) => ({ ...e, label: 'm' + (i + 1) }));

    workerArr.sort((a, b) => a.label.localeCompare(b.label));
    if (workerArr.length) lv.workerStationArr = workerArr;
    // 关键：只要该字段原本存在（或迁移出了行），就把剔除后的结果写回（含空数组），
    // 否则全部为空壳时会被上面的 if(length) 跳过，导致未剔除的原数组继续留在数据里。
    if (Array.isArray(lv.externalStationArr) || mergedExternal.length) {
      lv.externalStationArr = mergedExternal;
    }

    // —— 站点/组：空壳行统一剔除（数据存在即为真）——
    // 所有"可增删的配置行"共用一条通用规则：行内没有核心字段（外部站/资源站/客流站无 resourceId，
    // 拆卸组无产出实例，多渠道组无类型名且无实例）就不算数据。否则用户删掉后，刷新时又会从
    // seed 快照里被合并回来，表现成"删掉的空行/空组又冒出来"。在此对每个关卡一次性归一化。
    if (lv.resourceStationArr) {
      lv.resourceStationArr = lv.resourceStationArr.filter((s) => !!s.resourceId);
    }
    if (lv.passengerStationArr) {
      lv.passengerStationArr = lv.passengerStationArr.filter((s) => !!s.resourceId);
    }
    if (lv.coProductionGroups) {
      lv.coProductionGroups = lv.coProductionGroups.filter(
        (cp) => cp.outputs?.some((o) => !!o.instanceId),
      );
    }
    if (lv.multiChannelGroups) {
      lv.multiChannelGroups = lv.multiChannelGroups.filter(
        (g) => !!g.typeName?.trim() || (g.instanceIds?.length ?? 0) > 0,
      );
    }

    // —— 特殊站点标记与数据对齐 ——
    // hasXxx 标记同时是"页面渲染开关"和"列表筛选依据"，必须由对应数据数组的有无推导，
    // 否则历史数据里标记缺失时，已填内容不会显示（进关卡默认不显示、必须手点一下）。
    if (lv.resourceStationArr?.length) lv.hasResourceStation = true;
    if (lv.passengerStationArr?.length) lv.hasPassengerStation = true;
    if (lv.externalStationArr?.length) lv.hasExternalStation = true;
    if (lv.coProductionGroups?.length) lv.hasMergedProduction = true;
    if (lv.multiChannelGroups?.length) lv.hasMultipleInstances = true;

    // 旧字段彻底移除，后续以 externalStationArr 为唯一数据源
    if ('initialStations' in lv) delete (lv as { initialStations?: InitialStation[] }).initialStations;

    // —— goal stationLabel 格式迁移："工人N" → A/B/C ——
    if (Array.isArray(lv.goals)) {
      let changed = false;
      lv.goals = lv.goals.map((g) => {
        const fix = (old?: string): string | undefined => {
          if (!old) return old;
          const m = old.match(/^工人(\d+)$/);
          if (m) { changed = true; return String.fromCharCode(64 + (+m[1])); }
          return old;
        };
        const newLabels = g.stationLabels?.map(fix).filter(Boolean) as string[] | undefined;
        const newSingle = fix(g.stationLabel);
        if (!changed) return g;
        return { ...g, stationLabels: newLabels, stationLabel: newSingle };
      });
    }
  }
}

// ————————— 导入校验 —————————
export function validate(raw: unknown): { data: GameData | null; issues: string[] } {
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { data: null, issues: ['根节点必须是对象'] };
  }
  const o = raw as Partial<GameData>;
  for (const key of ['instances', 'levels', 'trains'] as const) {
    if (!Array.isArray(o[key])) issues.push(`缺少数组字段「${key}」，将按空表处理`);
  }
  const data: GameData = { ...EMPTY, ...o } as GameData;

  const ids = new Set<string>();
  for (const it of data.instances) {
    if (!it.id) issues.push('物资实例缺少 id');
    else if (ids.has(it.id)) issues.push(`物资实例重复 id：${it.id}`);
    ids.add(it.id);
    if (!it.name) issues.push(`物资实例 ${it.id} 缺少名称`);
  }

  const names = new Set(data.instances.map((i) => i.name));
  for (const it of data.instances) {
    for (const input of it.inputs) {
      if (!names.has(input)) issues.push(`物资 ${it.id} 的配方输入「${input}」在物资主表中不存在`);
    }
  }

  for (const lv of data.levels) {
    for (const g of lv.goals ?? []) {
      if (!ids.has(g.resourceId)) issues.push(`关卡「${lv.name}」的目标引用了不存在的物资实例：${g.resourceId}`);
    }
  }

  return { data, issues };
}

/** 确保数据里包含 工人eY（就地修补，返回同一对象引用） */
export function ensureWorkerEY(data: GameData): GameData {
  if (!data.instances.some((i) => i.id === '工人eY')) {
    const xdIdx = data.instances.findIndex((i) => i.id === '工人XD');
    if (xdIdx >= 0) {
      data.instances.splice(xdIdx + 1, 0, {
        id: '工人eY',
        name: WORKER_NAME,
        inputs: [],
        perOut: 1,
        external: true,
        obtain: OBTAIN.REFRESH,
      });
    } else {
      data.instances.push({
        id: '工人eY',
        name: WORKER_NAME,
        inputs: [],
        perOut: 1,
        external: true,
        obtain: OBTAIN.REFRESH,
      });
    }
  }
  return data;
}

/**
 * 合并 seed 与存档。
 * @param saved 存档数据（localStorage / 文件系统读到的内容）
 * @param seedData 编译时 seed 快照
 * @param deletedSeedInstIds 用户已删除的 seed 实例 id 集合；本函数会**就地增补**从存档里
 *   恢复出来的删除标记（与原实现一致，保持 Vue 响应式 Set 的行为）
 * @param preferSavedInstances dev 模式下为 true —— 此时文件系统 tv2.json 是唯一权威，
 *   且 vite 会把该文件从 watcher 排除（见 vite.config），编译时 seed 快照可能是陈旧的，
 *   因此 instances 必须以 saved（load-data 读到的文件内容）为准，seed 只兜底缺失 id。
 */
export function mergeWithSeed(
  saved: GameData,
  seedData: GameData,
  deletedSeedInstIds: Set<string>,
  preferSavedInstances = false,
): GameData {
  // 从存档里恢复 deletedSeedInstIds（如果存档有这个字段）
  const savedDeleted = (saved as any).__deletedSeedInstIds as string[] | undefined;
  if (savedDeleted?.length) {
    for (const id of savedDeleted) deletedSeedInstIds.add(id);
  }

  let mergedInstances: ResourceInstance[];
  if (preferSavedInstances) {
    // dev：以文件系统为准（含 sync 对已有实例字段的更新），删除标记照常剔除
    const savedIds = new Set(saved.instances.map((i) => i.id));
    mergedInstances = [
      ...saved.instances.filter((i) => !deletedSeedInstIds.has(i.id)),
      // seed 里有而 saved 缺失的（理论上 dev 不该发生），兜底并入
      ...seedData.instances.filter((i) => !deletedSeedInstIds.has(i.id) && !savedIds.has(i.id)),
    ];
  } else {
    // 非 dev：seed 编译快照为最新元数据，用户新增的追加，用户删过的剔除
    const seedInstIds = new Set(seedData.instances.map((i) => i.id));
    const userAddedInsts = saved.instances.filter((i) => !seedInstIds.has(i.id));
    mergedInstances = [
      ...seedData.instances.filter((i) => !deletedSeedInstIds.has(i.id)),
      ...userAddedInsts,
    ];
  }

  const mergedTrains = seedData.trains;

  // 关卡：以 seed 为准，用户可编辑字段用存档值覆盖
  const savedMap = new Map(saved.levels.map((l) => [l.id, l]));

  const mergedLevels = seedData.levels.map((seedLv) => {
    const savedLv = savedMap.get(seedLv.id);
    if (!savedLv) return { ...seedLv };
    // ⚠️ 仅当存档字段有定义时才覆盖：否则存档里 undefined 的可选标记会抹掉 seed 的 true
    const overrides: Record<string, unknown> = {};
    for (const k of USER_EDITABLE_FIELDS) {
      const v = (savedLv as any)[k];
      if (v !== undefined) overrides[k] = v;
    }
    const merged = { ...seedLv, ...overrides } as typeof seedLv;
    // initialStations（旧字段）：存档一旦包含该关卡，即以其为准（含「已迁移删除」的情况），
    // 避免编译期陈旧快照把旧字段复活，导致双源再次发散
    if ('initialStations' in savedLv) (merged as any).initialStations = (savedLv as any).initialStations;
    else delete (merged as any).initialStations;
    return merged;
  });

  // 存档里有但 seed 里没有的关卡（老版本遗留）—— 保留
  for (const savedLv of saved.levels) {
    if (!seedData.levels.some((s) => s.id === savedLv.id)) {
      mergedLevels.push(savedLv);
    }
  }

  // —— 站点结构迁移：旧字段 → 新三数组 ——
  migrateLevelStations(mergedLevels);

  const merged: GameData = {
    instances: mergedInstances,
    trains: mergedTrains,
    levels: mergedLevels,
  };

  // 检查是否有元数据变化
  let metaChanged = 0;
  for (const seedLv of seedData.levels) {
    const savedLv = savedMap.get(seedLv.id);
    if (!savedLv) { metaChanged++; continue; }
    const seedKey = JSON.stringify({ c: seedLv.constraints, e: seedLv.earn, s: seedLv.spend, sec: seedLv.seconds });
    const saveKey = JSON.stringify({ c: savedLv.constraints, e: savedLv.earn, s: savedLv.spend, sec: savedLv.seconds });
    if (seedKey !== saveKey) metaChanged++;
  }
  if (metaChanged > 0) {
    console.log(`[store] 🔄 检测到 ${metaChanged} 个关卡元数据已更新（来自最新 seed）`);
  }

  return merged;
}
