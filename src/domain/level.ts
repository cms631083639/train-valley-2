/**
 * 关卡领域派生逻辑（纯函数集合）。
 *
 * 从 LevelsPage.vue 抽离：站点/物资集合推导、外部站货运量计算、外部获取清单、
 * 最快通关时间预估等。所有函数均为纯函数，依赖的数据通过参数显式传入，
 * 便于复用、单测与后续把 store 拆分。
 */
import { OBTAIN, REFRESH_START, STATION_KIND } from '@/constants';
import type { ExternalStation, Level, LevelGoal, MultiChannelGroup, ResourceInstance, WorkerStation } from '@/types';

/** 实例 id → 实例 的索引（对应 store.instById） */
export type InstIndex = Map<string, ResourceInstance>;

/** 外部站「建议提供」额度（供引擎限制外部总供给） */
export interface ExternalCap {
  name: string;
  instanceId: string;
  qty: number;
}

/** 外部物资站点 → 按 name 索引的配置（用于外部获取清单和拆解树显示） */
export interface StationInfo {
  qtyEach: number;        // 刷新=每次数量；购买=最高数量（拆解树用 maxQty 算每周期件数）；客流=每次数量
  intervalSec: number;    // 刷新=间隔秒；购买/客流=0
  kind: '刷新' | '购买' | '库存' | '客流';
  // 购买专属
  minQty?: number;        // 最低货运量（用于外部清单展示 X-Y）
  maxQty?: number;        // 最高货运量（qtyEach 就是它，显式存一份便于模板读）
  price?: number;         // 每次购买金钱
}

/** 外部获取清单条目 */
export interface ExternalNeed {
  name: string;
  qty: number;
  obtain: string;
}

/** 外部物资站点：数量字段脏值阈值 */
const DIRTY_QTY = 100;

/** 站点数量计算所需的列车上下文 */
export interface StationQtyContext {
  /** 列车等级 → 真实货运量 */
  cargoByLevel: (lv: number) => number;
  minTrainLevel: number;
  maxTrainLevel: number;
}

/** 站点信息 / 时间预估所需的上下文 */
export interface StationContext extends StationQtyContext {
  defaultIntervalSec: number;
}

/** 判断 qty 字段值是否有效（正整数且不超阈值） */
export function isValidQty(v: unknown): v is number {
  return typeof v === 'number' && v > 0 && v <= DIRTY_QTY && Number.isFinite(v);
}

/** 外部站：最低货运量 */
export function stationQtyMin(s: ExternalStation | null | undefined, ctx: StationQtyContext): number {
  if (s && s.minQtyAuto) return ctx.cargoByLevel(ctx.minTrainLevel);
  if (s && isValidQty(s.minQty)) return s.minQty;
  return ctx.cargoByLevel(ctx.minTrainLevel);
}

/** 外部站：最高货运量 */
export function stationQtyMax(s: ExternalStation | null | undefined, ctx: StationQtyContext): number {
  if (s && s.maxQtyAuto) return ctx.cargoByLevel(ctx.maxTrainLevel);
  if (s && isValidQty(s.maxQty)) return s.maxQty;
  return ctx.cargoByLevel(ctx.maxTrainLevel);
}

/** 外部站：刷新每次产出 */
export function stationQtyEach(s: ExternalStation | null | undefined, ctx: StationQtyContext): number {
  if (s && s.qtyAuto) return ctx.cargoByLevel(ctx.maxTrainLevel);
  if (s && isValidQty(s.qty)) return s.qty;
  return ctx.cargoByLevel(ctx.maxTrainLevel);
}

/**
 * 🎯 外部物资站点覆盖的 name 集合 → 这些 name 在引擎里跳过 resolved/warnings。
 */
export function collectStationSuppliedNames(lv: Level | undefined, instById: InstIndex): Set<string> {
  const set = new Set<string>();
  // 1) 资源站点（无限/库存）— 仅当标记为 true 时计入
  if (lv?.hasResourceStation === true && lv?.resourceStationArr?.length) {
    for (const s of lv.resourceStationArr) {
      const inst = instById.get(s.resourceId ?? '');
      if (inst) set.add(inst.name);
    }
  }
  // 1.5) 客流站点
  if (lv?.hasPassengerStation === true && lv?.passengerStationArr?.length) {
    for (const s of lv.passengerStationArr) {
      const inst = instById.get(s.resourceId ?? '');
      if (inst) set.add(inst.name);
    }
  }
  // 2) 外部物资站点（刷新/购买）— 唯一数据源 externalStationArr
  if (lv?.hasExternalStation !== false && lv?.externalStationArr?.length) {
    for (const s of lv.externalStationArr) {
      const inst = instById.get(s.resourceId ?? '');
      if (inst) set.add(inst.name);
    }
  }
  // 4) 拆卸工厂产出实例（关卡已配置 → 视为已确认，不再提示未指定）
  if (lv?.hasMergedProduction === true && lv?.coProductionGroups?.length) {
    for (const cp of lv.coProductionGroups) {
      for (const o of cp.outputs) {
        const inst = instById.get(o.instanceId);
        if (inst) set.add(inst.name);
      }
    }
  }
  // 5) 工人站点已配置实例
  for (const w of lv?.workerStationArr ?? []) {
    const inst = instById.get(w.resourceId ?? '');
    if (inst) set.add(inst.name);
  }
  return set;
}

/** 🔗 拆卸组产出实例的名称集合（供外部站「建议提供」触发判断） */
export function collectCpOutputNames(lv: Level | undefined, instById: InstIndex): Set<string> {
  const set = new Set<string>();
  if (lv?.hasMergedProduction === true && lv?.coProductionGroups?.length) {
    for (const cp of lv.coProductionGroups) {
      for (const o of cp.outputs) {
        const inst = instById.get(o.instanceId);
        if (inst) set.add(inst.name);
      }
    }
  }
  return set;
}

/**
 * 🛒 「建议提供」显示条件：关卡内存在同名不同实例的物资（含拆卸组产出）。
 * 只有同一物资名对应 ≥2 个不同实例时，才需要人工限定"外部站供多少份"，
 * 余量交给同名的其他实例（生产站点 / 拆卸站点）补足。
 */
export function collectSuggestNames(
  lv: Level | undefined,
  goals: LevelGoal[],
  instById: InstIndex,
  cpOutputNames: Set<string>,
): Set<string> {
  const set = new Set<string>(cpOutputNames);
  if (!lv) return set;
  const byName = new Map<string, Set<string>>();
  const add = (id?: string) => {
    if (!id) return;
    const inst = instById.get(id);
    if (!inst) return;
    const s = byName.get(inst.name) ?? new Set<string>();
    s.add(id);
    byName.set(inst.name, s);
  };
  for (const g of goals) add(g.resourceId);
  for (const w of lv.workerStationArr ?? []) add(w.resourceId);
  for (const s of lv.resourceStationArr ?? []) add(s.resourceId);
  for (const s of lv.passengerStationArr ?? []) add(s.resourceId);
  for (const s of lv.externalStationArr ?? []) add(s.resourceId);
  for (const cp of lv.coProductionGroups ?? []) for (const o of cp.outputs) add(o.instanceId);
  for (const [nm, id] of Object.entries(lv.instanceOverrides ?? {})) {
    const inst = instById.get(id);
    if (inst && inst.name === nm) add(id);
  }
  for (const [nm, ids] of byName) if (ids.size >= 2) set.add(nm);
  return set;
}

/** 🛒 外部站建议提供量 → externalCaps（仅 resourceId 存在且 suggestQty>0） */
export function collectExternalCaps(lv: Level | undefined, instById: InstIndex): ExternalCap[] | undefined {
  if (!lv?.externalStationArr?.length) return undefined;
  const caps: ExternalCap[] = [];
  for (const s of lv.externalStationArr) {
    if (!s.resourceId || !s.suggestQty || s.suggestQty <= 0) continue;
    const inst = instById.get(s.resourceId ?? '');
    if (!inst) continue;
    caps.push({ name: inst.name, instanceId: s.resourceId, qty: s.suggestQty });
  }
  return caps.length ? caps : undefined;
}

/** 关卡活跃实例集：目标 + 各类站点已配置的实例，用于局部递归分类 & 引擎按名选实例 */
export function collectLocalInstances(
  lv: Level | undefined,
  goals: LevelGoal[],
  instById: InstIndex,
): ResourceInstance[] {
  if (!lv) return [];
  const ids = new Set<string>();
  // 按优先级从低到高写入，同名后者覆盖前者；instanceOverrides（警告面板手选）在引擎里优先级最高
  for (const s of lv.passengerStationArr ?? []) if (s.resourceId) ids.add(s.resourceId);
  for (const s of lv.externalStationArr ?? []) if (s.resourceId) ids.add(s.resourceId);
  for (const s of lv.resourceStationArr ?? []) if (s.resourceId) ids.add(s.resourceId);
  for (const w of lv.workerStationArr ?? []) if (w.resourceId) ids.add(w.resourceId);
  for (const cp of lv.coProductionGroups ?? []) for (const o of cp.outputs) if (o.instanceId) ids.add(o.instanceId);
  // 目标录入的实例优先级最高（用户对本关目标的明确选择）
  for (const g of goals) if (g.resourceId) ids.add(g.resourceId);
  const list: ResourceInstance[] = [];
  for (const id of ids) {
    const inst = instById.get(id);
    if (inst) list.push(inst);
  }
  return list;
}

/** 外部物资站点 → 按 name 索引的配置（用于外部获取清单和拆解树显示） */
export function buildStationInfoByName(
  lv: Level | undefined,
  instById: InstIndex,
  ctx: StationContext,
): Map<string, StationInfo> {
  const map = new Map<string, StationInfo>();
  // 1) 外部物资站点（刷新/购买/客流/库存 — 唯一数据源 externalStationArr）
  if (lv?.hasExternalStation !== false && lv?.externalStationArr?.length) {
    for (const s of lv.externalStationArr) {
      const inst = instById.get(s.resourceId ?? '');
      if (!inst) continue;
      if (s.kind === STATION_KIND.REFRESH) {
        map.set(inst.name, {
          qtyEach: stationQtyEach(s, ctx),
          intervalSec: s.interval ?? ctx.defaultIntervalSec,
          kind: '刷新',
        });
      } else if (s.kind === STATION_KIND.BUY) {
        const minQ = stationQtyMin(s, ctx);
        const maxQ = stationQtyMax(s, ctx);
        map.set(inst.name, {
          qtyEach: maxQ, // 拆解树用最高数量算 perCycle
          intervalSec: 0,
          kind: '购买',
          minQty: minQ,
          maxQty: maxQ,
          price: s.price ?? 0,
        });
      } else if (s.kind === STATION_KIND.PASSENGER) {
        map.set(inst.name, {
          qtyEach: stationQtyEach(s, ctx),
          intervalSec: 0,
          kind: '客流',
        });
      } else if (s.kind === STATION_KIND.STOCK) {
        map.set(inst.name, {
          qtyEach: stationQtyEach(s, ctx), // 初始库存
          intervalSec: 0,
          kind: '库存',
          minQty: stationQtyMin(s, ctx),
          maxQty: stationQtyMax(s, ctx),
        });
      }
    }
  }
  // 2) 客流站点（passengerStationArr）
  if (lv?.hasPassengerStation === true && lv?.passengerStationArr?.length) {
    for (const s of lv.passengerStationArr) {
      const inst = instById.get(s.resourceId ?? '');
      if (!inst) continue;
      const qty = s.qty ?? ctx.cargoByLevel(ctx.maxTrainLevel);
      // 同 name 可能已在上面 set 过，保留第一个（外部站点优先）
      if (!map.has(inst.name)) {
        map.set(inst.name, {
          qtyEach: qty,
          intervalSec: 0,
          kind: '客流',
        });
      }
    }
  }
  return map;
}

/** 外部获取清单：引擎算的 externalNeeds + 外部物资站点里的刷新/购买（按 name 合并去重） */
export function collectEffectiveExternalNeeds(
  externalNeeds: { name: string; qty: number; obtain: string }[] | undefined,
  lv: Level | undefined,
  instById: InstIndex,
): ExternalNeed[] {
  const merged = new Map<string, ExternalNeed>();
  // 1. 引擎拆解的 externalNeeds（目标链路里通过刷新/购买来的）
  for (const n of externalNeeds ?? []) {
    merged.set(n.name, { name: n.name, qty: n.qty, obtain: n.obtain });
  }
  // 2. 外部物资站点里所有刷新/购买/客流类（关卡自带，不管目标链路有没有都合并）
  if (lv?.externalStationArr?.length) {
    for (const s of lv.externalStationArr) {
      if (s.kind !== STATION_KIND.REFRESH && s.kind !== STATION_KIND.BUY && s.kind !== STATION_KIND.PASSENGER) continue;
      const inst = instById.get(s.resourceId ?? '');
      if (!inst) continue;
      if (!merged.has(inst.name)) {
        merged.set(inst.name, { name: inst.name, qty: 0, obtain: s.kind });
      }
    }
  }
  // 3. 客流站点（乘客带来物资）
  if (lv?.hasPassengerStation === true && lv?.passengerStationArr?.length) {
    for (const s of lv.passengerStationArr) {
      const inst = instById.get(s.resourceId ?? '');
      if (!inst) continue;
      if (!merged.has(inst.name)) {
        merged.set(inst.name, { name: inst.name, qty: 0, obtain: '客流' });
      }
    }
  }
  return [...merged.values()];
}

/** 工人站点标签列表：给 GoalEditor 用。优先 workerStationArr.label，没有就从 goals 的 stationLabels 反推 */
export function deriveWorkerStationLabels(lv: Level | undefined, goals: LevelGoal[]): string[] {
  if (!lv) return [];
  if (lv.workerStationArr?.length) return lv.workerStationArr.map((w) => w.label);
  // 从 goals 的 stationLabels 反推最大字母
  let maxIdx = 0;
  for (const g of goals) {
    const labels = [...(g.stationLabels ?? []), ...(g.stationLabel ? [g.stationLabel] : [])];
    for (const lb of labels) {
      const m = lb.match(/^([a-zA-Z])(\d*)$/);
      if (m) maxIdx = Math.max(maxIdx, m[1].toUpperCase().charCodeAt(0) - 64);
    }
  }
  const n = Math.max(1, typeof lv.workerStations === 'number' ? lv.workerStations : maxIdx);
  const arr: string[] = [];
  for (let i = 0; i < n; i++) arr.push(String.fromCharCode(65 + i));
  return arr;
}

/** 运行时归一化工人站点：优先 workerStationArr，没有就用旧 workerStations(number) 快速生成 */
export function deriveEffectiveWorkerStations(lv: Level | undefined, goals: LevelGoal[]): WorkerStation[] {
  if (!lv) return [];
  if (lv.workerStationArr?.length) return lv.workerStationArr;
  let maxIdx = 0;
  for (const g of goals) {
    const labels = [...(g.stationLabels ?? []), ...(g.stationLabel ? [g.stationLabel] : [])];
    for (const lb of labels) {
      const m = lb.match(/^([a-zA-Z])(\d*)$/);
      if (m) maxIdx = Math.max(maxIdx, m[1].toUpperCase().charCodeAt(0) - 64);
    }
  }
  const n = Math.max(1, typeof lv.workerStations === 'number' ? lv.workerStations : maxIdx);
  const arr: WorkerStation[] = [];
  for (let i = 0; i < n; i++) arr.push({ label: String.fromCharCode(65 + i) });
  return arr;
}

/** 获取关卡中已使用的指定类型实例 ID 列表（多渠道面板也复用） */
export function collectUsedInstanceIds(
  lv: Level | undefined,
  typeName: string,
  instById: InstIndex,
  goals?: LevelGoal[],
): string[] {
  if (!lv) return [];
  const used = new Set<string>();
  const check = (id: string) => {
    const inst = instById.get(id);
    if (inst?.name === typeName) used.add(id);
  };
  for (const g of goals ?? lv.goals ?? []) if (g.resourceId) check(g.resourceId);
  for (const s of lv.resourceStationArr ?? []) if (s.resourceId) check(s.resourceId);
  for (const s of lv.externalStationArr ?? []) if (s.resourceId) check(s.resourceId);
  for (const g of lv.coProductionGroups ?? [])
    for (const o of g.outputs) check(o.instanceId);
  return [...used];
}

/** 自动检测多渠道组的结果 */
export interface McGroupDetection {
  /** 检测后的多渠道组列表（无新增时与原列表内容一致） */
  groups: MultiChannelGroup[];
  /** 本次新增组的索引（供 UI 展开态使用） */
  addedIndexes: number[];
}

/**
 * 自动检测多渠道生产组：目标 / 资源站点 / 外部站点中出现同名多实例时，自动补建组。
 * - 已存在于 multiChannelGroups 的名称不重复添加；
 * - 新建组的 instanceIds 取 collectUsedInstanceIds（含拆卸组产出），为空时回退为该名称下全部实例。
 * 纯函数：返回新列表与新增下标，UI 展开态与写回由调用方处理。
 */
export function detectMultiChannelGroups(
  lv: Level,
  goals: LevelGoal[],
  instById: InstIndex,
  allInstances: ResourceInstance[],
): McGroupDetection {
  // 统计"目标 + 各类站点"中每个名称实际使用了多少个不同的实例 ID
  const nameToIds = new Map<string, Set<string>>();
  const collect = (id?: string) => {
    if (!id) return;
    const inst = instById.get(id);
    if (!inst) return;
    if (!nameToIds.has(inst.name)) nameToIds.set(inst.name, new Set());
    nameToIds.get(inst.name)!.add(id);
  };
  for (const goal of goals) collect(goal.resourceId);
  for (const s of lv.resourceStationArr ?? []) collect(s.resourceId);
  for (const s of lv.externalStationArr ?? []) collect(s.resourceId);

  const multiNames: string[] = [];
  for (const [name, ids] of nameToIds) if (ids.size > 1) multiNames.push(name);

  const groups = [...(lv.multiChannelGroups ?? [])];
  const existing = new Set(groups.map((mc) => mc.typeName));
  const addedIndexes: number[] = [];
  for (const name of multiNames) {
    if (existing.has(name)) continue;
    const idx = groups.length;
    const usedIds = collectUsedInstanceIds(lv, name, instById, goals);
    groups.push({ typeName: name, instanceIds: usedIds });
    addedIndexes.push(idx);
    // 如果没有任何实例被使用，则全部选中（旧行为，方便人工勾选）
    if (!usedIds.length) {
      groups[idx].instanceIds = allInstances.filter((i) => i.name === name).map((i) => i.id);
    }
  }
  return { groups, addedIndexes };
}

/** 最快通关时间预估结果 */
export interface BestTimeEstimate {
  seconds: number;
  perResource: Array<{ name: string; qty: number; per: number; trips: number; delay: number; interval: number; total: number }>;
}

/**
 * 最快通关时间预估（秒）。
 * 逻辑：遍历 rawNeeds，对每个需求找同名刷新站点 → 算需要趟数 → 首车延迟 + (趟数-1)×间隔。
 * 取所有基础物资里 **最慢** 的那个（瓶颈资源），就是理论最快通关时间。
 * 找不到刷新站点覆盖的物资不算（可能是购买或生产链覆盖）。
 */
export function estimateBestTime(
  rawNeeds: { name: string; qty: number }[] | undefined,
  lv: Level | undefined,
  instById: InstIndex,
  ctx: StationContext,
): BestTimeEstimate | null {
  if (!lv) return null;
  if (!rawNeeds?.length) return null;

  const stations = (lv.externalStationArr ?? []).filter((s) => s.kind === STATION_KIND.REFRESH && s.resourceId);
  if (!stations.length) return null;

  const details: Array<{ name: string; qty: number; per: number; trips: number; delay: number; interval: number; total: number }> = [];

  for (const need of rawNeeds) {
    // 找同名刷新站点（通过实例 name 匹配）
    const station = stations.find((s) => {
      const inst = instById.get(s.resourceId ?? '');
      return inst?.name === need.name && inst.obtain === OBTAIN.REFRESH;
    });
    if (!station) continue;

    const per = stationQtyEach(station, ctx);
    const trips = Math.ceil(need.qty / Math.max(1, per));
    const delay = station.refreshStart === REFRESH_START.UNLOCK ? 0 : (station.startDelay ?? 0);
    const interval = station.interval ?? ctx.defaultIntervalSec;
    const total = delay + (trips - 1) * interval;

    details.push({ name: need.name, qty: need.qty, per, trips, delay, interval, total });
  }

  if (!details.length) return null;
  details.sort((a, b) => b.total - a.total);
  return { seconds: details[0].total, perResource: details };
}