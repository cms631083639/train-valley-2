<script setup lang="ts">
/** 关卡速查 / 物资拆解（本体 50 关优先，可切换查看全部） */
import { OBTAIN, REFRESH_START, STATION_KIND, FILTER_ALL, VIA } from '@/constants';
import { computed, onMounted, ref, reactive, watch, watchEffect, nextTick } from 'vue';
import type { BreakdownNode, RecipeChoice, BreakdownStrategy } from '@/engine/breakdown';
import { breakdownGoals, classifyName } from '@/engine/breakdown';
import type { CoProductionGroup, CoProductionOutput, ExternalStation, LevelGoal, PassengerStation, ResourceInstance, ResourceCategory, ResourceStation, StationExternalKind, WorkerStation } from '@/types';
import { WORKER_NAME } from '@/types';
import { useGameStore } from '@/stores/game';
import { CATEGORY_LABEL, fmtMinSec, fmtSeconds, starConditionText } from '@/utils/format';
import { recipeText } from '@/utils/recipe';
import AppIcon from '@/components/AppIcon.vue';
import ResLabel from '@/components/ResLabel.vue';
import TreeNode from '@/components/TreeNode.vue';
import GoalEditor from '@/components/GoalEditor.vue';

const store = useGameStore();
const goalEditorRef = ref<InstanceType<typeof GoalEditor> | null>(null);

const pickedId = ref('');
const choice = ref<RecipeChoice>('fewestInputs');

/** 拆解策略（用于多方案对比） */
const activeStrategy = ref<BreakdownStrategy>('normal');

/** 刷新站点间隔默认值：1 分 50 秒 */
const DEFAULT_INTERVAL_SEC = 0;
const keyword = ref('');

/** 手动保存状态 */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
const saveStatus = ref<SaveStatus>('idle');
async function handleSave() {
  if (saveStatus.value === 'saving') return;
  saveStatus.value = 'saving';
  try {
    const ok = await store.forceSave();
    saveStatus.value = ok ? 'saved' : 'error';
  } catch {
    saveStatus.value = 'error';
  }
  setTimeout(() => { saveStatus.value = 'idle'; }, 3000);
}

/** 导出当前关卡数据到剪贴板 */
const exportStatus = ref<'idle' | 'copied' | 'error'>('idle');
function exportLevelData() {
  const lv = level.value;
  if (!lv) return;
  const payload: Record<string, unknown> = {
    id: lv.id,
    name: lv.name,
    goals: lv.goals,
    multiChannelGroups: lv.multiChannelGroups,
    coProductionGroups: lv.coProductionGroups,
    instanceOverrides: lv.instanceOverrides,
    workerStationArr: lv.workerStationArr,
    externalStationArr: lv.externalStationArr,
    resourceStationArr: lv.resourceStationArr,
    initialTrains: lv.initialTrains,
    powerSources: lv.powerSources,
  };
  const json = JSON.stringify(payload, null, 2);
  navigator.clipboard.writeText(json).then(
    () => { exportStatus.value = 'copied'; setTimeout(() => { exportStatus.value = 'idle'; }, 2000); },
    () => { exportStatus.value = 'error'; setTimeout(() => { exportStatus.value = 'idle'; }, 2000); },
  );
}

/** contentType 筛选：'all' 或具体 contentType 值 */
const contentTypeFilter = ref<string>('主线');

/** 关卡标记多选（空数组=不筛选） */
const FLAG_KEYS = ['hasInterception', 'hasSpecialProduction', 'hasIndependentEvent', 'hasTerrainChange', 'hasMergedProduction', 'hasMultipleInstances', 'hasResourceStation', 'hasExternalStation'] as const;
const FLAG_LABELS: Record<(typeof FLAG_KEYS)[number], string> = {
  hasInterception: '拦截站',
  hasSpecialProduction: '铸币站',
  hasIndependentEvent: '独立事件',
  hasTerrainChange: '地形改变',
  hasMergedProduction: '拆卸工厂',
  hasMultipleInstances: '多实例',
  hasResourceStation: '资源站点',
  hasExternalStation: '外部站点',
};
const flagFilters = ref<string[]>([]);

/** contentType 全部选项（从数据动态提取，保持顺序：先主线再 DLC） */
const contentTypeOptions = computed(() => {
  const all = store.data.levels.map((l) => l.contentType).filter(Boolean);
  const uniq = [...new Set(all)];
  const priority = ['主线'];
  const rest = uniq.filter((c) => !priority.includes(c)).sort();
  return [...priority, ...rest];
});

/** 恢复上次选择的关卡 + 滚动位置 */
const levelListRef = ref<HTMLElement | null>(null);

// —— 先定义所有 computed（后面的 watch/watchEffect 都依赖它们）——
const levelList = computed(() => {
  let list = store.data.levels;
  if (contentTypeFilter.value !== 'all') {
    list = list.filter((l) => l.contentType === contentTypeFilter.value);
  }
  if (flagFilters.value.length) {
    list = list.filter((l) => flagFilters.value.every((k) => (l as any)[k]));
  }
  return list;
});

const selectedId = computed(() =>
  levelList.value.some((l) => l.id === pickedId.value) ? pickedId.value : levelList.value[0]?.id ?? '',
);
const level = computed(() => store.data.levels.find((l) => l.id === selectedId.value));

onMounted(() => {
  try {
    const saved = localStorage.getItem('tv2:pickedLevelId');
    if (saved) pickedId.value = saved;
    const savedCT = localStorage.getItem('tv2:contentTypeFilter');
    if (savedCT) contentTypeFilter.value = savedCT;
    const savedFlags = localStorage.getItem('tv2:flagFilters');
    if (savedFlags) {
      try { flagFilters.value = JSON.parse(savedFlags); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  // 关卡自带站点自定义下拉：点击外部收起
  document.addEventListener('mousedown', closeStationPopups);
});

// 选中关卡变化 → 滚到可视区（onMounted 后 DOM 已渲染完，用 nextTick + rAF 定位）
watchEffect(() => {
  const id = selectedId.value;
  if (!id) return;
  nextTick(() => {
    requestAnimationFrame(() => {
      const btn = levelListRef.value?.querySelector<HTMLElement>(`button[data-level-id="${id}"]`);
      if (btn) {
        const rect = btn.getBoundingClientRect();
        const container = levelListRef.value!;
        const cTop = container.getBoundingClientRect().top;
        const cBottom = container.getBoundingClientRect().bottom;
        // 只有不在可视区才滚
        if (rect.top < cTop + 20 || rect.bottom > cBottom - 20) {
          btn.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }
    });
  });
});

// 🎯 数据迁移：旧版用 instanceOverrides.电力 存单实例，新版用 powerSources
// 切换关卡时自动迁一次，避免旧数据丢失
watch(level, (lv) => {
  if (!lv) return;
  // 🎯 切换关卡时重置拆解策略：避免上一关的策略残留
  //    （如"配方输入最少"会禁用拆卸组，导致拆卸关卡结果被放大）
  activeStrategy.value = 'normal';
  const oldPower = lv.instanceOverrides?.['电力'];
  if (oldPower && !lv.powerSources?.length) {
    const cleaned: Record<string, string> = { ...(lv.instanceOverrides ?? {}) };
    delete cleaned['电力'];
    patchLevel({
      powerSources: [oldPower],
      instanceOverrides: Object.keys(cleaned).length ? cleaned : undefined,
    });
  }
});

watch(selectedId, () => {
  try { localStorage.setItem('tv2:pickedLevelId', selectedId.value); } catch { /* ignore */ }
});

let _scrollTimer: ReturnType<typeof setTimeout> | null = null;
function saveLevelListScroll() {
  if (_scrollTimer) clearTimeout(_scrollTimer);
  _scrollTimer = setTimeout(() => {
    try { localStorage.setItem('tv2:levelListScroll', String(levelListRef.value?.scrollTop ?? 0)); } catch { /* ignore */ }
  }, 150);
}

watch(contentTypeFilter, (v) => {
  try { localStorage.setItem('tv2:contentTypeFilter', v); } catch { /* ignore */ }
});
watch(flagFilters, (v) => {
  try { localStorage.setItem('tv2:flagFilters', JSON.stringify(v)); } catch { /* ignore */ }
}, { deep: true });

const filtered = computed(() =>
  levelList.value.filter((l) => !keyword.value || l.name.includes(keyword.value) || l.chapter.includes(keyword.value)),
);

/**
 * 关卡稳定序号：按"原始列表顺序"编号（仅受内容类型范围影响，不受标记筛选 / 搜索影响）。
 * 这样筛选「主线 + 外部站点」时，显示的是关卡原本的编号（如 05、12、30），
 * 而不是对筛选后的结果从 01 重新编号。
 */
const levelOrderIndex = computed(() => {
  const base = contentTypeFilter.value !== FILTER_ALL
    ? store.data.levels.filter((l) => l.contentType === contentTypeFilter.value)
    : store.data.levels;
  const map = new Map<string, number>();
  base.forEach((l, i) => map.set(l.id, i + 1));
  return map;
});

/** 当前参与拆解的 goals（关卡原始数据，实时直接保存） */
const goals = computed<LevelGoal[]>(() => level.value?.goals ?? []);

/** GoalEditor update 回调：直接写回关卡，store watch 自动持久化 */
function onGoalsUpdate(g: LevelGoal[]) {
  if (!level.value) return;
  patchLevel({ goals: g });
  autoDetectMcGroups(g);
}

/** 自动检测多渠道生产组：当目标中出现同名多实例时，自动创建多渠道组 */
function autoDetectMcGroups(goals: LevelGoal[]) {
  if (!level.value) return;
  const lv = level.value;
  // 统计"目标 + 各类站点"中每个名称实际使用了多少个不同的实例 ID
  const nameToIds = new Map<string, Set<string>>();
  const collect = (id?: string) => {
    if (!id) return;
    const inst = store.instById.get(id);
    if (!inst) return;
    if (!nameToIds.has(inst.name)) nameToIds.set(inst.name, new Set());
    nameToIds.get(inst.name)!.add(id);
  };
  for (const goal of goals) collect(goal.resourceId);
  // 🎯 站点也是物资渠道来源：资源站点 / 外部站点（含刷新、购买）
  for (const s of lv.resourceStationArr ?? []) collect(s.resourceId);
  for (const s of lv.externalStationArr ?? []) collect(s.resourceId);
  const multiNames = new Set<string>();
  for (const [name, ids] of nameToIds) {
    if (ids.size > 1) multiNames.add(name);
  }
  let changed = false;
  let groups = [...(level.value.multiChannelGroups ?? [])];
  const existing = new Set(groups.map((mc) => mc.typeName));
  for (const name of multiNames) {
    if (!existing.has(name)) {
      const idx = groups.length;
      const usedIds = getUsedInstanceIds(name);
      groups.push({ typeName: name, instanceIds: usedIds });
      mcExpanded[idx] = true;
      // 如果没有任何实例被使用，则全部选中（旧行为，方便人工勾选）
      if (!usedIds.length) {
        groups[groups.length - 1].instanceIds = store.data.instances.filter((i) => i.name === name).map((i) => i.id);
      }
      changed = true;
    }
  }
  if (changed) {
    patchLevel({ multiChannelGroups: groups, hasMultipleInstances: true });
  }
}
/** GoalEditor → 工人站点 unlockCost 变化回调 */
function onWorkerStationsUpdate(arr: WorkerStation[]) {
  if (!level.value) return;
  patchLevel({ workerStationArr: arr });
}

/** 配方输入列表（去重统计同名输入的数量，供警告区视觉化渲染） */
function recipeInputCounts(inst: ResourceInstance) {
  const map = new Map<string, number>();
  for (const name of inst.inputs) {
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return Array.from(map.entries());
}

// 🎯 外部物资站点覆盖的 name 集合 → 这些 name 在引擎里跳过 resolved/warnings
const stationSuppliedNames = computed(() => {
  const set = new Set<string>();
  const lv = level.value;
  // 1) 资源站点（无限/库存）— 仅当标记为 true 时计入
  if (lv?.hasResourceStation === true && lv?.resourceStationArr?.length) {
    for (const s of lv.resourceStationArr) {
      const inst = store.instById.get(s.resourceId ?? '');
      if (inst) set.add(inst.name);
    }
  }
  // 1.5) 客流站点
  if (lv?.hasPassengerStation === true && lv?.passengerStationArr?.length) {
    for (const s of lv.passengerStationArr) {
      const inst = store.instById.get(s.resourceId ?? '');
      if (inst) set.add(inst.name);
    }
  }
  // 2) 外部物资站点（刷新/购买）— 唯一数据源 externalStationArr
  if (lv?.hasExternalStation !== false && lv?.externalStationArr?.length) {
    for (const s of lv.externalStationArr) {
      const inst = store.instById.get(s.resourceId ?? '');
      if (inst) set.add(inst.name);
    }
  }
  // 4) 拆卸工厂产出实例（关卡已配置 → 视为已确认，不再提示未指定）
  if (lv?.hasMergedProduction === true && lv?.coProductionGroups?.length) {
    for (const cp of lv.coProductionGroups) {
      for (const o of cp.outputs) {
        const inst = store.instById.get(o.instanceId);
        if (inst) set.add(inst.name);
      }
    }
  }
  // 5) 工人站点已配置实例
  for (const w of lv?.workerStationArr ?? []) {
    const inst = store.instById.get(w.resourceId ?? '');
    if (inst) set.add(inst.name);
  }
  return set;
});

/** 🔗 拆卸组产出实例的名称集合（供外部站「建议提供」触发判断） */
const cpOutputNames = computed(() => {
  const set = new Set<string>();
  const lv = level.value;
  if (lv?.hasMergedProduction === true && lv?.coProductionGroups?.length) {
    for (const cp of lv.coProductionGroups) {
      for (const o of cp.outputs) {
        const inst = store.instById.get(o.instanceId);
        if (inst) set.add(inst.name);
      }
    }
  }
  return set;
});

/**
 * 🛒 「建议提供」显示条件：关卡内存在同名不同实例的物资（含拆卸组产出）。
 * 只有同一物资名对应 ≥2 个不同实例时，才需要人工限定"外部站供多少份"，
 * 余量交给同名的其他实例（生产站点 / 拆卸站点）补足。
 */
const suggestNames = computed(() => {
  const set = new Set<string>(cpOutputNames.value);
  const lv = level.value;
  if (!lv) return set;
  const byName = new Map<string, Set<string>>();
  const add = (id?: string) => {
    if (!id) return;
    const inst = store.instById.get(id);
    if (!inst) return;
    const s = byName.get(inst.name) ?? new Set<string>();
    s.add(id);
    byName.set(inst.name, s);
  };
  for (const g of goals.value) add(g.resourceId);
  for (const w of lv.workerStationArr ?? []) add(w.resourceId);
  for (const s of lv.resourceStationArr ?? []) add(s.resourceId);
  for (const s of lv.passengerStationArr ?? []) add(s.resourceId);
  for (const s of lv.externalStationArr ?? []) add(s.resourceId);
  for (const cp of lv.coProductionGroups ?? []) for (const o of cp.outputs) add(o.instanceId);
  for (const [nm, id] of Object.entries(lv.instanceOverrides ?? {})) {
    const inst = store.instById.get(id);
    if (inst && inst.name === nm) add(id);
  }
  for (const [nm, ids] of byName) if (ids.size >= 2) set.add(nm);
  return set;
});

/** 🛒 外部站建议提供量 → externalCaps（仅 resourceId 存在且 suggestQty>0） */
const externalCaps = computed<{ name: string; instanceId: string; qty: number }[] | undefined>(() => {
  const lv = level.value;
  if (!lv?.externalStationArr?.length) return undefined;
  const caps: { name: string; instanceId: string; qty: number }[] = [];
  for (const s of lv.externalStationArr) {
    if (!s.resourceId || !s.suggestQty || s.suggestQty <= 0) continue;
    const inst = store.instById.get(s.resourceId ?? '');
    if (!inst) continue;
    caps.push({ name: inst.name, instanceId: s.resourceId, qty: s.suggestQty });
  }
  return caps.length ? caps : undefined;
});

const result = computed(() => {
  if (!goals.value.length) return null;
  const lv = level.value;
  // 🎯 引擎内部根据 powerSources.length 推断 powerMode（none/single/multi）
  return breakdownGoals(
    goals.value.map((g) => ({ instanceId: g.resourceId, qty: g.qty })),
    store.data,
    choice.value,
    localInstances.value,
    lv?.instanceOverrides,
    stationSuppliedNames.value,
    lv?.powerSources ?? [],
    lv?.hasMergedProduction === true ? lv?.coProductionGroups : undefined,
    activeStrategy.value,
    externalCaps.value,
    lv?.multiChannelGroups,
  );
});

/** 外部物资站点 → 按 name 索引的配置（用于外部获取清单和拆解树显示） */
interface StationInfo {
  qtyEach: number;        // 刷新=每次数量；购买=**最高数量**（拆解树用 maxQty 算每周期件数）；客流=每次数量
  intervalSec: number;    // 刷新=间隔秒；购买/客流=0
  kind: '刷新' | '购买' | '库存' | '客流';
  // 购买专属
  minQty?: number;        // 最低货运量（用于外部清单展示 X-Y）
  maxQty?: number;        // 最高货运量（qtyEach 就是它，显式存一份便于模板读）
  price?: number;         // 每次购买金钱
}
const stationInfoByName = computed<Map<string, StationInfo>>(() => {
  const lv = level.value;
  const map = new Map<string, StationInfo>();
  // 1) 外部物资站点（刷新/购买/客流/库存 — 唯一数据源 externalStationArr）
  if (lv?.hasExternalStation !== false && lv?.externalStationArr?.length) {
    for (const s of lv.externalStationArr) {
      const inst = store.instById.get(s.resourceId ?? '');
      if (!inst) continue;
      if (s.kind === STATION_KIND.REFRESH) {
        map.set(inst.name, {
          qtyEach: qtyEach(s),
          intervalSec: s.interval ?? DEFAULT_INTERVAL_SEC,
          kind: '刷新',
        });
      } else if (s.kind === STATION_KIND.BUY) {
        const minQ = qtyMin(s);
        const maxQ = qtyMax(s);
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
          qtyEach: qtyEach(s),
          intervalSec: 0,
          kind: '客流',
        });
      } else if (s.kind === STATION_KIND.STOCK) {
        map.set(inst.name, {
          qtyEach: qtyEach(s), // 初始库存
          intervalSec: 0,
          kind: '库存',
          minQty: qtyMin(s),
          maxQty: qtyMax(s),
        });
      }
    }
  }
  // 2) 客流站点（passengerStationArr）
  if (lv?.hasPassengerStation === true && lv?.passengerStationArr?.length) {
    for (const s of lv.passengerStationArr) {
      const inst = store.instById.get(s.resourceId ?? '');
      if (!inst) continue;
      const qty = s.qty ?? cargoByLevel(maxTrainLevel.value);
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
});

/** 获取某个物资的外部供给配置：先查外部物资站点，没有则用默认值 */
function resolveExternalSupply(name: string, obtain: string): StationInfo {
  const fromStation = stationInfoByName.value.get(name);
  if (fromStation) return fromStation;
  // 关卡没配站点，用默认值
  return {
    qtyEach: cargoByLevel(maxTrainLevel.value),
    intervalSec: obtain === OBTAIN.REFRESH ? DEFAULT_INTERVAL_SEC : 0,
    kind: obtain === OBTAIN.REFRESH ? '刷新' : (obtain === OBTAIN.PASSENGER ? '客流' : (obtain === OBTAIN.STOCK ? '库存' : '购买')),
  };
}

/** 计算某个拆解结果的基础原料总数量 */
function totalRawQty(r: { rawNeeds: { name: string; qty: number }[] }): number {
  return r.rawNeeds.reduce((sum, n) => sum + n.qty, 0);
}

/** 外部获取清单：引擎算的 externalNeeds + 外部物资站点里的刷新/购买（按 name 合并去重） */
const effectiveExternalNeeds = computed(() => {
  const merged = new Map<string, { name: string; qty: number; obtain: string }>();
  // 1. 引擎拆解的 externalNeeds（目标链路里通过刷新/购买来的）
  if (result.value) {
    for (const n of result.value.externalNeeds) {
      merged.set(n.name, { name: n.name, qty: n.qty, obtain: n.obtain });
    }
  }
  // 2. 外部物资站点里所有刷新/购买/客流类（关卡自带，不管目标链路有没有都合并）
  const lv = level.value;
  if (lv?.externalStationArr?.length) {
    for (const s of lv.externalStationArr) {
      if (s.kind !== STATION_KIND.REFRESH && s.kind !== STATION_KIND.BUY && s.kind !== STATION_KIND.PASSENGER) continue;
      const inst = store.instById.get(s.resourceId ?? '');
      if (!inst) continue;
      if (!merged.has(inst.name)) {
        merged.set(inst.name, { name: inst.name, qty: 0, obtain: s.kind });
      }
    }
  }
  // 3. 客流站点（乘客带来物资）
  if (lv?.hasPassengerStation === true && lv?.passengerStationArr?.length) {
    for (const s of lv.passengerStationArr) {
      const inst = store.instById.get(s.resourceId ?? '');
      if (!inst) continue;
      if (!merged.has(inst.name)) {
        merged.set(inst.name, { name: inst.name, qty: 0, obtain: '客流' });
      }
    }
  }
  return [...merged.values()];
});

/** 工人站点标签列表：给 GoalEditor 用。优先 workerStationArr.label，没有就从 workerStations(number) 或 goals 里的 stationLabels 反推 */
const workerStationLabels = computed<string[]>(() => {
  const lv = level.value;
  if (!lv) return [];
  if (lv.workerStationArr?.length) return lv.workerStationArr.map((w) => w.label);
  // 从 goals 的 stationLabels 反推最大字母
  let maxIdx = 0;
  for (const g of goals.value) {
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
});

/** 关卡活跃实例集：目标 + 各类站点已配置的实例，用于局部递归分类 & 引擎按名选实例 */
const localInstances = computed(() => {
  const lv = level.value;
  if (!lv) return [];
  const ids = new Set<string>();
  // 按优先级从低到高写入，同名后者覆盖前者；instanceOverrides（警告面板手选）在引擎里优先级最高
  for (const s of lv.passengerStationArr ?? []) if (s.resourceId) ids.add(s.resourceId);
  for (const s of lv.externalStationArr ?? []) if (s.resourceId) ids.add(s.resourceId);
  for (const s of lv.resourceStationArr ?? []) if (s.resourceId) ids.add(s.resourceId);
  for (const w of lv.workerStationArr ?? []) if (w.resourceId) ids.add(w.resourceId);
  for (const cp of lv.coProductionGroups ?? []) for (const o of cp.outputs) if (o.instanceId) ids.add(o.instanceId);
  // 目标录入的实例优先级最高（用户对本关目标的明确选择）
  for (const g of goals.value) if (g.resourceId) ids.add(g.resourceId);
  const list: typeof store.data.instances = [];
  for (const id of ids) {
    const inst = store.instById.get(id);
    if (inst) list.push(inst);
  }
  return list;
});

/** 多方案对比结果 */
const strategyResults = computed(() => {
  const lv = level.value;
  if (!lv || !goals.value.length) return [];

  const baseGoals = goals.value.map((g) => ({ instanceId: g.resourceId, qty: g.qty }));
  const baseInstances = localInstances.value;
  const baseOverrides = lv.instanceOverrides;
  const baseSupplied = stationSuppliedNames.value;
  const basePower = lv.powerSources ?? [];
  const baseCoGroups = lv.hasMergedProduction === true ? lv.coProductionGroups : undefined;

  // 判断条件（使用标记而非数据存在性，隐藏时不计入策略）
  const hasCo = lv.hasMergedProduction === true && (lv.coProductionGroups?.length ?? 0) > 0;
  const goalNames = new Set<string>();
  for (const g of goals.value) {
    const inst = store.instById.get(g.resourceId);
    if (inst) goalNames.add(inst.name);
  }
  const hasMulti = lv.hasMultipleInstances !== false && (lv.multiChannelGroups?.length ?? 0) > 0;
  const hasTimeBased = [...goalNames].some((name) => {
    const instances = store.data.instances.filter((i) => i.name === name);
    return instances.some((i) => i.obtain === '刷新' || i.obtain === '库存');
  });

  // 构建策略列表
  type StrategyItem = { key: string; strategy: BreakdownStrategy; label: string };
  const strategies: StrategyItem[] = [];

  // 🎯 手动填写拆卸总个数 / 🛑 最多拆卸次数上限 → 拆卸通道已定，无需多方案对比
  const hasManualOutput = (lv.coProductionGroups ?? []).some((cp) => (cp.manualOutput !== undefined && cp.manualOutput > 0) || (cp.maxCycles !== undefined && cp.maxCycles > 0));
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
    const r = breakdownGoals(baseGoals, store.data, 'fewestInputs', baseInstances, baseOverrides, baseSupplied, basePower, baseCoGroups, s.strategy, externalCaps.value, level.value?.multiChannelGroups);
    return { key: s.key, strategy: s.strategy, label: s.label, result: r };
  });
});

/** 是否展示多方案对比面板（按需求关闭；恢复时改回 strategyResults.value.length > 0） */
const showStrategyComparison = computed(() => {
  return false;
});

/** 多方案对比提示文字：根据策略列表推断当前原因 */
const strategyHint = computed(() => {
  const keys = strategyResults.value.map((s) => s.key);
  if (keys.length === 0) return '';
  if (keys.includes('minWaste') && keys.includes('fewestInputs')) {
    return '该关卡存在拆卸工厂和同类物资多个配方';
  }
  if (keys.includes('fewestInputs') || keys.includes('mostInputs')) {
    return '该关卡存在同类物资多个配方';
  }
  if (keys.includes('minWaste')) {
    return '该关卡存在拆卸工厂';
  }
  return '';
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
  const hasManualOutput = (lv.coProductionGroups ?? []).some((cp) => (cp.manualOutput !== undefined && cp.manualOutput > 0) || (cp.maxCycles !== undefined && cp.maxCycles > 0));
  const items: { name: string; instances: { id: string; inputs: string }[] }[] = [];
  for (const mg of lv.multiChannelGroups ?? []) {
    const instances = mg.instanceIds
      .map((id) => store.instById.get(id))
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

// 当多方案策略列表变化时，如果当前 activeStrategy 不在列表中则重置为第一个
watch(strategyResults, (results) => {
  // 多方案对比 UI 已关闭时，不允许自动切换策略：
  // 一律用 normal（最佳配平），否则清空「建议拆 N 次」会让策略跳到 minCoProduction
  if (!showStrategyComparison.value) {
    if (activeStrategy.value !== 'normal') activeStrategy.value = 'normal';
    return;
  }
  if (results.length === 0) {
    // 无多方案列表（拆卸手动/上限已定，或单一方案关卡）→ 强制回落 normal，
    // 避免残留上一关的策略禁用拆卸组
    if (activeStrategy.value !== 'normal') activeStrategy.value = 'normal';
    return;
  }
  const valid = results.some((r) => r.strategy === activeStrategy.value);
  if (!valid) {
    activeStrategy.value = results[0].strategy;
  }
});

/** 完美通关条件（参与星级，每个有值的列 = 1 星）
 *  来源三部分：constraints 所有 key + earn（有值）+ spend（有值）
 */
const starConditions = computed(() => {
  const lv = level.value;
  if (!lv) return [];
  const list: { key: string; text: string }[] = [];
  for (const [k, v] of Object.entries(lv.constraints ?? {})) {
    list.push({ key: k, text: starConditionText(k, v) });
  }
  if (lv.earn && lv.earn.trim()) list.push({ key: '挣钱', text: starConditionText('挣钱', lv.earn) });
  if (lv.spend && lv.spend.trim()) list.push({ key: '花钱', text: starConditionText('花钱', lv.spend) });
  return list;
});

/** 星级汇总：3（限时固定） + 每个有值列 1 星 */
const starCount = computed(() => 3 + starConditions.value.length);

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
    const inst = store.instById.get(id);
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

// ————————— 内联编辑：改 store.data 后 watch 自动持久化 —————————

/** 显示：把存的完整数字（如 "30000"）转成"万"单位（如 3），空值返回空串 */
function moneyWan(raw?: string): string {
  if (!raw) return '';
  const n = Number(raw);
  if (!isFinite(n)) return '';
  // 兼容：seed 里存的是完整数字，≥1000 视为完整数字除以 10000
  // 如果用户自己存过小数（<1000），直接显示
  const wan = n >= 1000 ? n / 10000 : n;
  // 去掉末尾多余的 0
  return Number(wan.toFixed(2)).toString();
}

/** 保存：把用户输入的"万"单位（如 "4"）转成完整数字（如 "40000"） */
function fromWan(input: string): string {
  if (!input.trim()) return '';
  const n = Number(input);
  if (!isFinite(n) || n <= 0) return '';
  return Math.round(n * 10000).toString();
}

/** 外部站点购买花费：显示时把存的完整金钱（如 120000）换算成"万"（如 12） */
function priceWan(price?: number): number | string {
  if (!price) return 0;
  return Number((price / 10000).toFixed(2));
}

/** 外部站点购买花费：把用户输入的"万"（如 12）换算回完整金钱（如 120000） */
function fromPriceWan(input: string): number {
  const n = Number(input);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 10000);
}

/**
 * 花费输入框的编辑期草稿（按站点 label 存原始文本）。
 * 不能直接把 value 绑到 s.price：受控归一化会在用户键入 "1." 时把小数点吞掉。
 * 编辑期间保留原始文本，失焦/回车时再提交。
 */
const priceDraft = ref<Record<string, string>>({});
function commitPrice(i: number, label: string, raw: string) {
  delete priceDraft.value[label];
  updateStation(i, { price: fromPriceWan(raw) });
}

function patchLevel(patch: Record<string, unknown>) {
  if (!level.value) return;
  Object.assign(level.value, patch);
  store.scheduleSave();
}

/** 当前展开的下拉 key（'w'+idx 或空字符串）；空 = 全关 */
const openOverrideIdx = ref('');

/** 给警告行选定一个实例 → 电力走 powerSources，其他走 instanceOverrides */
function applyOverride(name: string, instanceId: string) {
  if (!level.value) return;
  if (name === '电力') {
    // 电力 → 勾进 powerSources（并放到第一位成为引擎拆解用的主电力）
    const cur = new Set(level.value.powerSources ?? []);
    cur.delete(instanceId);
    const arr = [instanceId, ...cur];
    patchLevel({ powerSources: arr });
  } else {
    const cur = { ...(level.value.instanceOverrides ?? {}) };
    cur[name] = instanceId;
    patchLevel({ instanceOverrides: cur });
  }
  openOverrideIdx.value = '';
}

/** 把 alternatives id 数组转成完整实例列表，供下拉显示 */
function alternativesInstances(ids: string[] | undefined) {
  if (!ids?.length) return [];
  return ids.map((id) => store.instById.get(id)).filter((i): i is NonNullable<typeof i> => !!i);
}

/** 列车数据最高等级（动态读 store，不硬编码） */
const MAX_TRAIN_LEVEL = computed(() => {
  const trains = store.data.trains;
  return trains.length ? Math.max(...trains.map((t) => t.level)) : 6;
});

/** 关卡当前可升到的最高火车等级（优先读用户配置，否则取初始最高等级；上限 = 列车最高等级） */
const maxTrainLevel = computed(() => {
  const trains = level.value?.initialTrains ?? [];
  const initMax = trains.length ? Math.max(...trains.map((t) => t.level)) : 1;
  const cfg = level.value?.maxTrainLevel;
  const maxLv = MAX_TRAIN_LEVEL.value;
  if (cfg && cfg >= initMax && cfg <= maxLv) return cfg;
  // 默认升 1 级，使升级次数默认为 1
  return Math.min(maxLv, initMax + 1);
});

/** 关卡初始列车最低等级（用于购买类站点 minQty） */
const minTrainLevel = computed(() => {
  const trains = level.value?.initialTrains ?? [];
  return trains.length ? Math.min(...trains.map((t) => t.level)) : 1;
});

/** 外部物资站点：数量字段脏值阈值 */
const DIRTY_QTY = 100;

/** 判断 qty 字段值是否有效（正整数且不超阈值） */
function isValidQty(v: unknown): v is number {
  return typeof v === 'number' && v > 0 && v <= DIRTY_QTY && Number.isFinite(v);
}

/** 根据火车等级查真实货运量（查 store.data.trains 的 capacity，找不到 fallback 到等级） */
function cargoByLevel(lv: number): number {
  const t = store.data.trains.find((x) => x.level === lv);
  return t ? t.capacity : Math.max(1, Math.min(MAX_TRAIN_LEVEL.value, lv));
}

/** 最高升级下拉选项：从初始最高等级到最高等级 */
const upgradeLevelOptions = computed(() => {
  const trains = level.value?.initialTrains ?? [];
  const initLv = trains.length ? Math.max(...trains.map((t) => t.level)) : 1;
  return store.data.trains.filter((t) => t.level >= initLv);
});

/** 升级次数（步进器展示用）= 最高升级 - 初始最高等级 */
const upgradeCount = computed(() => {
  const trains = level.value?.initialTrains ?? [];
  const initMax = trains.length ? Math.max(...trains.map((t) => t.level)) : 1;
  return Math.max(0, maxTrainLevel.value - initMax);
});

/** 升级次数步进器允许的最大值（= 列车最高等级 - 初始最高等级） */
const upgradeCountMax = computed(() => {
  const trains = level.value?.initialTrains ?? [];
  const initMax = trains.length ? Math.max(...trains.map((t) => t.level)) : 1;
  return Math.max(0, MAX_TRAIN_LEVEL.value - initMax);
});

/** 根据升级次数反算并写入 maxTrainLevel；count=0 代表"不升级"，最高等级 = 初始最高等级 */
function applyUpgradeCount(count: number) {
  const clamped = Math.max(0, Math.min(upgradeCountMax.value, Math.floor(count)));
  const trains = level.value?.initialTrains ?? [];
  const initMax = trains.length ? Math.max(...trains.map((t) => t.level)) : 1;
  patchLevel({ maxTrainLevel: Math.min(MAX_TRAIN_LEVEL.value, initMax + clamped) });
}

/** 电力类型可选实例（name=电力 的所有实例） */
const powerOptions = computed(() => store.data.instances.filter((i) => i.name === '电力'));
/** 关卡当前勾选的电力来源 id 数组（0~N 个） */
const currentPowerSources = computed<string[]>(() => level.value?.powerSources ?? []);
/** 电力实例的人性化 label（电力4n → "煤炭"，电力Lb → "仅工人"，连工人都不需要 → "无限供给"） */
function powerLabel(inst: ResourceInstance): string {
  const others = inst.inputs.filter((n) => n !== WORKER_NAME);
  if (others.length) return others.join(' + ');
  // 不含工人 → 无需工人即可供电，视为无限供给
  if (!inst.inputs.includes(WORKER_NAME)) return '无限供给';
  return '仅工人';
}
/** 切换某个电力 id 的勾选状态 */
function togglePowerSource(id: string) {
  const cur = new Set(level.value?.powerSources ?? []);
  if (cur.has(id)) cur.delete(id);
  else cur.add(id);
  patchLevel({ powerSources: [...cur] });
}

// ————————— 关卡标记（待开发模块）—————————
interface LevelFlagOpt { key: 'hasInterception' | 'hasSpecialProduction' | 'hasIndependentEvent' | 'hasTerrainChange' | 'hasMergedProduction' | 'hasMultipleInstances' | 'hasResourceStation' | 'hasPassengerStation' | 'hasExternalStation'; label: string; icon: string; hint: string; }
/** 特殊站点（特殊模块开关） */
const SPECIAL_FLAG_OPTS: LevelFlagOpt[] = [
  { key: 'hasExternalStation', label: '外部站点', icon: '📦', hint: '定时周期运送 / 空投购买材料' },
  { key: 'hasResourceStation', label: '资源站点', icon: '💎', hint: '初始配置资源站点' },
  { key: 'hasPassengerStation', label: '客流站点', icon: '🚃', hint: '乘客带来物资' },
  { key: 'hasMergedProduction', label: '拆卸工厂', icon: '🔗', hint: '多站点合流 / 合并生产链' },
  { key: 'hasMultipleInstances', label: '多渠道生产', icon: '🧬', hint: '同物资存在多配方 / 多获取路径' },
  { key: 'hasSpecialProduction', label: '铸币站', icon: '🏭', hint: '非标准工人站点' },
];
/** 常规关卡标记 */
const LEVEL_FLAG_OPTS: LevelFlagOpt[] = [
  { key: 'hasInterception', label: '拦截站', icon: '🏴‍☠️', hint: '强盗 / 事件站点' },
  { key: 'hasIndependentEvent', label: '独立事件', icon: '🎲', hint: '剧情 / 随机事件' },
  { key: 'hasTerrainChange', label: '地形改变', icon: '⛰️', hint: '修路 / 改造地形' },
];
function flagOn(key: LevelFlagOpt['key']): boolean { return !!level.value?.[key]; }
function toggleFlag(key: LevelFlagOpt['key']) {
  const next = !level.value?.[key];
  const patch: Record<string, unknown> = { [key]: next };
  patchLevel(patch);
  // 显示时自动添加初始条目（仅当尚无数据时）
  if (next) {
    nextTick(() => {
      if (key === 'hasMergedProduction' && !level.value?.coProductionGroups?.length) addCpGroup();
      if (key === 'hasResourceStation' && !level.value?.resourceStationArr?.length) addResourceStation();
      if (key === 'hasPassengerStation' && !level.value?.passengerStationArr?.length) addPassengerStation();
      if (key === 'hasExternalStation' && !level.value?.externalStationArr?.length) addStation();
      if (key === 'hasMultipleInstances' && !level.value?.multiChannelGroups?.length) addMcGroup();
    });
  }
}
/** 特殊站点统一点击事件：通过 data-flag-key 属性委托 */
function onSpecialFlagClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('[data-flag-key]');
  if (!btn) return;
  const key = btn.getAttribute('data-flag-key') as LevelFlagOpt['key'];
  toggleFlag(key);
}

// ————————— 工人站点数组（新旧字段适配）—————————
/** 运行时归一化：优先用 workerStationArr，没有就用旧 workerStations(number) 快速生成 */
const effectiveWorkerStations = computed<WorkerStation[]>(() => {
  const lv = level.value;
  if (!lv) return [];
  if (lv.workerStationArr?.length) return lv.workerStationArr;
  let maxIdx = 0;
  for (const g of goals.value) {
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
});

/** 工人站数量变化（步进器 ±1）—— 只改 workerStationArr，不再写旧 workerStations(number) */
function changeWorkerCount(delta: number) {
  const lv = level.value; if (!lv) return;
  const cur = effectiveWorkerStations.value;
  const n = Math.max(1, cur.length + delta);
  if (n === cur.length) return;
  const arr: WorkerStation[] = [];
  for (let i = 0; i < n; i++) {
    if (cur[i]) arr.push(cur[i]); // 保留原有配置（含 unlockCost）
    else arr.push({ label: String.fromCharCode(65 + i) }); // 新增
  }
  patchLevel({ workerStationArr: arr });
}
function changeWorkerCountTo(n: number) {
  const lv = level.value; if (!lv) return;
  n = Math.max(1, n);
  const cur = effectiveWorkerStations.value;
  if (n === cur.length) return;
  const arr: WorkerStation[] = [];
  for (let i = 0; i < n; i++) {
    if (cur[i]) arr.push(cur[i]);
    else arr.push({ label: String.fromCharCode(65 + i) });
  }
  patchLevel({ workerStationArr: arr });
}

// ————————— 资源站点 —————————
function addResourceStation() {
	  const lv = level.value; if (!lv) return;
	  const cur = lv.resourceStationArr ?? [];
	  const n = cur.length + 1;
	  const label = 'r' + n;
	  // 默认不选择实例，让用户手动选择
	  const rs: ResourceStation = { label, resourceId: undefined };
	  delete rsKeywords.value[cur.length];
	  patchLevel({ resourceStationArr: [...cur, rs] });
	}
	function removeResourceStation(idx: number) {
	  const lv = level.value; if (!lv?.resourceStationArr) return;
	  const arr = lv.resourceStationArr.filter((_, i) => i !== idx);
	  delete rsKeywords.value[idx];
	  for (let j = idx; j < arr.length; j++) {
	    if (rsKeywords.value[j + 1] !== undefined) {
	      rsKeywords.value[j] = rsKeywords.value[j + 1]!;
	    } else {
	      delete rsKeywords.value[j];
	    }
	  }
	  delete rsKeywords.value[arr.length];
	  if (!arr.length) {
	    patchLevel({ resourceStationArr: arr, hasResourceStation: false });
	  } else {
	    patchLevel({ resourceStationArr: arr });
	  }
	}
function setResourceStationResource(idx: number, resourceId: string) {
  const lv = level.value; if (!lv?.resourceStationArr) return;
  const arr = [...lv.resourceStationArr];
  const prevInst = arr[idx].resourceId ? store.data.instances.find((i) => i.id === arr[idx].resourceId) : undefined;
  const nextInst = resourceId ? store.data.instances.find((i) => i.id === resourceId) : undefined;
  const nextHasStock = nextInst?.obtain === '库存';
  const prevHasStock = prevInst?.obtain === '库存';
  const patch: Partial<ResourceStation> = { resourceId: resourceId || undefined };
  // 类型切换时清/置库存相关字段
  if (!prevHasStock && nextHasStock) {
    patch.totalStock = undefined;
    patch.autoRefresh = false;
    patch.refreshInterval = undefined;
  } else if (prevHasStock && !nextHasStock) {
    patch.totalStock = undefined;
    patch.autoRefresh = undefined;
    patch.refreshInterval = undefined;
  }
  arr[idx] = { ...arr[idx], ...patch };
  patchLevel({ resourceStationArr: arr });
}

/** 取资源站点对应的实例（obtain=无限 → 无限类；obtain=库存 → 库存类，控制 UI 显示） */
function rsInst(idx: number) {
  const rs = level.value?.resourceStationArr?.[idx];
  return rs?.resourceId ? store.data.instances.find((i) => i.id === rs.resourceId) : undefined;
}
function setResourceStockTotal(idx: number, v: number) {
  const lv = level.value; if (!lv?.resourceStationArr) return;
  const arr = [...lv.resourceStationArr];
  arr[idx] = { ...arr[idx], totalStock: isFinite(v) && v >= 0 ? v : undefined };
  patchLevel({ resourceStationArr: arr });
}
function toggleResourceAutoRefresh(idx: number) {
  const lv = level.value; if (!lv?.resourceStationArr) return;
  const arr = [...lv.resourceStationArr];
  arr[idx] = { ...arr[idx], autoRefresh: !arr[idx].autoRefresh };
  patchLevel({ resourceStationArr: arr });
}
function setResourceRefreshInterval(idx: number, v: number) {
  const lv = level.value; if (!lv?.resourceStationArr) return;
  const arr = [...lv.resourceStationArr];
  arr[idx] = { ...arr[idx], refreshInterval: isFinite(v) && v > 0 ? v : undefined };
  patchLevel({ resourceStationArr: arr });
}
function toggleResourceUnlock(idx: number) {
  const lv = level.value; if (!lv?.resourceStationArr) return;
  const arr = [...lv.resourceStationArr];
  const rs = arr[idx];
  if (rs.unlockCost !== undefined) {
    arr[idx] = { ...rs };
    delete arr[idx].unlockCost;
  } else {
    arr[idx] = { ...rs, unlockCost: 0 };
  }
  patchLevel({ resourceStationArr: arr });
}
function setResourceUnlockCost(idx: number, cost: number) {
  const lv = level.value; if (!lv?.resourceStationArr) return;
  const arr = [...lv.resourceStationArr];
  arr[idx] = { ...arr[idx], unlockCost: Math.max(0, cost || 0) };
  patchLevel({ resourceStationArr: arr });
}

// ————————— 客流站点 —————————
/** 获取所有客流实例（obtain=客流） */
const passengerInstances = computed(() =>
  store.data.instances.filter((i) => i.obtain === OBTAIN.PASSENGER),
);
function addPassengerStation() {
  const lv = level.value; if (!lv) return;
  const cur = lv.passengerStationArr ?? [];
  const ps: PassengerStation = { label: '', resourceId: undefined };
  patchLevel({ passengerStationArr: [...cur, ps] });
}
function removePassengerStation(idx: number) {
  const lv = level.value; if (!lv?.passengerStationArr) return;
  const arr = lv.passengerStationArr.filter((_, i) => i !== idx);
  if (!arr.length) {
    patchLevel({ passengerStationArr: arr, hasPassengerStation: false });
  } else {
    patchLevel({ passengerStationArr: arr });
  }
}
function setPassengerResource(idx: number, resourceId: string) {
  const lv = level.value; if (!lv?.passengerStationArr) return;
  const arr = [...lv.passengerStationArr];
  arr[idx] = { ...arr[idx], resourceId: resourceId || undefined };
  // 选实例时自动设置默认数量（列车运力）
  if (resourceId && !arr[idx].qty) {
    arr[idx].qty = cargoByLevel(maxTrainLevel.value);
  }
  patchLevel({ passengerStationArr: arr });
}
function togglePassengerUnlock(idx: number) {
  const lv = level.value; if (!lv?.passengerStationArr) return;
  const arr = [...lv.passengerStationArr];
  const ps = arr[idx];
  if (ps.unlockCost !== undefined) {
    const next = { ...ps };
    delete next.unlockCost;
    arr[idx] = next;
  } else {
    arr[idx] = { ...ps, unlockCost: 0 };
  }
  patchLevel({ passengerStationArr: arr });
}
function setPassengerUnlockCost(idx: number, cost: number) {
  const lv = level.value; if (!lv?.passengerStationArr) return;
  const arr = [...lv.passengerStationArr];
  arr[idx] = { ...arr[idx], unlockCost: Math.max(0, cost || 0) };
  patchLevel({ passengerStationArr: arr });
}
function setPassengerQty(idx: number, qty: number) {
  const lv = level.value; if (!lv?.passengerStationArr) return;
  const arr = [...lv.passengerStationArr];
  arr[idx] = { ...arr[idx], qty: Math.max(1, qty || 1) };
  patchLevel({ passengerStationArr: arr });
}
function setPassengerLabel(idx: number, label: string) {
  const lv = level.value; if (!lv?.passengerStationArr) return;
  const arr = [...lv.passengerStationArr];
  arr[idx] = { ...arr[idx], label };
  patchLevel({ passengerStationArr: arr });
}

/** 模板直接调用：最低货运量 */
function qtyMin(s?: ExternalStation | null): number {
  if (s && s.minQtyAuto) return cargoByLevel(minTrainLevel.value);
  if (s && isValidQty(s.minQty)) return s.minQty;
  return cargoByLevel(minTrainLevel.value);
}
/** 模板直接调用：最高货运量 */
function qtyMax(s?: ExternalStation | null): number {
  if (s && s.maxQtyAuto) return cargoByLevel(maxTrainLevel.value);
  if (s && isValidQty(s.maxQty)) return s.maxQty;
  return cargoByLevel(maxTrainLevel.value);
}
/** 模板直接调用：刷新每次产出 */
function qtyEach(s?: ExternalStation | null): number {
  if (s && s.qtyAuto) return cargoByLevel(maxTrainLevel.value);
  if (s && isValidQty(s.qty)) return s.qty;
  return cargoByLevel(maxTrainLevel.value);
}

/**
 * 最快通关时间预估（秒）。
 * 逻辑：遍历 rawNeeds，对每个需求找同名刷新站点 → 算需要趟数 → 首车延迟 + (趟数-1)×间隔。
 * 取所有基础物资里 **最慢** 的那个（瓶颈资源），就是理论最快通关时间。
 * 找不到刷新站点覆盖的物资不算（可能是购买或生产链覆盖）。
 */
const estimatedBestTime = computed<{
  seconds: number;
  perResource: Array<{ name: string; qty: number; per: number; trips: number; delay: number; interval: number; total: number }>;
} | null>(() => {
  const lv = level.value;
  if (!lv) return null;
  const needs = result.value?.rawNeeds;
  if (!needs?.length) return null;

  const stations = (lv.externalStationArr ?? []).filter((s) => s.kind === STATION_KIND.REFRESH && s.resourceId);
  if (!stations.length) return null;

  const details: Array<{ name: string; qty: number; per: number; trips: number; delay: number; interval: number; total: number }> = [];

  for (const need of needs) {
    // 找同名刷新站点（通过实例 name 匹配）
    const station = stations.find((s) => {
      const inst = store.instById.get(s.resourceId ?? '');
      return inst?.name === need.name && inst.obtain === OBTAIN.REFRESH;
    });
    if (!station) continue;

    const per = qtyEach(station);
    const trips = Math.ceil(need.qty / Math.max(1, per));
    const delay = station.refreshStart === REFRESH_START.UNLOCK ? 0 : (station.startDelay ?? 0);
    const interval = station.interval ?? DEFAULT_INTERVAL_SEC;
    const total = delay + (trips - 1) * interval;

    details.push({ name: need.name, qty: need.qty, per, trips, delay, interval, total });
  }

  if (!details.length) return null;
  details.sort((a, b) => b.total - a.total);
  return { seconds: details[0].total, perResource: details };
});

/**
 * 设计说明：外部物资站点的默认值由三个入口设置
 *   1) addStation           → kind=刷新, qty=defMax, minQty=defMin, maxQty=defMax
 *   2) pickStationResource  → 根据 inst.obtain 设置 kind + 默认值
 *   3) ensureKindDefaults   → 切类型时联动 resourceId + 补齐新 kind 的默认值
 *   4) 模板 qtyMin/qtyMax/qtyEach → store 无有效值时 fallback 到 cargoByLevel(初始列车)
 * 之前有一个 deep watch 试图自动清洗所有站点的脏值，但它在 ensureKindDefaults 之后触发
 * 会用 normalizeStationDefaults 重新写 externalStationArr 数组，在某些时机把刚写入的 kind 覆盖回旧值。
 * 已禁用该 watch，改由上述 4 个入口分别保证数据正确。
 */

/** 所有不重复的物资名称（用于站点产出物资联想）— 只包含有外部获取（购买/刷新）实例的名称 */
const allResourceNames = computed(() => {
	  const set = new Set<string>();
	  for (const i of store.data.instances) {
	    if (i.external && (i.obtain === OBTAIN.BUY || i.obtain === OBTAIN.REFRESH)) {
	      set.add(i.name);
	    }
	  }
	  return [...set].sort();
	});

/** 根据物资名称找可选 external 实例（站点产出只可能是外部供给：刷新/购买，排除库存） */
function instancesOfName(name: string): ResourceInstance[] {
  return store.data.instances.filter((i) => i.name === name && i.external && i.obtain !== '库存');
}

/**
 * 关卡站点类型按钮的可用 kind 列表（刷新 / 购买 / 客流）
 * - 只有刷新实例 → 只显示刷新
 * - 只有购买实例 → 只显示购买
 * - 只有客流实例 → 只显示客流
 * - 多种都有 → 多个按钮都显示
 * - 未选实例或都没有 → 兜底都显示
 */
function availableKindsForStation(s: ExternalStation): ('刷新' | '购买' | '客流')[] {
	  const inst = store.instById.get(s.resourceId ?? '');
	  if (!inst) return ['刷新', '购买', '客流'];
	  const externals = instancesOfName(inst.name);
	  const kinds = new Set<'刷新' | '购买' | '客流'>();
	  for (const e of externals) {
	    if (e.obtain === OBTAIN.REFRESH) kinds.add(STATION_KIND.REFRESH);
	    else if (e.obtain === OBTAIN.BUY) kinds.add(STATION_KIND.BUY);
	    else if (e.obtain === OBTAIN.PASSENGER) kinds.add(STATION_KIND.PASSENGER);
	  }
	  if (kinds.size === 0) { kinds.add(STATION_KIND.REFRESH); kinds.add(STATION_KIND.BUY); kinds.add(STATION_KIND.PASSENGER); }
	  return [...kinds];
	}

/** 判断关卡站点当前是否只有一种 type 可选（用于把按钮做成单选视觉） */
function isSingleKindStation(s: ExternalStation): boolean {
  return availableKindsForStation(s).length === 1;
}

/** 根据实例的 obtain 映射到对应的站点外部类型，无匹配时返回 undefined */
function kindFromObtain(obtain?: string | null): StationExternalKind | undefined {
	  if (obtain === OBTAIN.REFRESH) return STATION_KIND.REFRESH;
	  if (obtain === OBTAIN.BUY) return STATION_KIND.BUY;
	  if (obtain === OBTAIN.PASSENGER) return STATION_KIND.PASSENGER;
	  return undefined;
	}

/** 切换 kind 时：联动改 resourceId + 补齐对应字段默认值（只填缺失，不覆盖玩家已填的 interval 等） */
function ensureKindDefaults(s: ExternalStation, kind: StationExternalKind): Partial<ExternalStation> {
  const patch: Partial<ExternalStation> = { kind };
  const missing = (v: unknown) => v === undefined || v === null || v === 0;
  // 联动 resourceId：找当前物资下 obtain 匹配的 external 实例
  const curInst = s.resourceId ? store.instById.get(s.resourceId ?? '') : undefined;
  const name = curInst?.name;
  if (name) {
    const targetObtain = kind; // '刷新' / '购买' / '客流' 和 obtain 字段同名
    const match = store.data.instances.find(
      (i) => i.name === name && i.external && i.obtain === targetObtain,
    );
    if (match && match.id !== s.resourceId) {
      patch.resourceId = match.id;
      // 同时补齐 qty / price 等默认值（只填缺失，自动填的联动 auto=true）
      if (kind === STATION_KIND.REFRESH) {
        if (missing(s.qty)) { patch.qty = cargoByLevel(maxTrainLevel.value); patch.qtyAuto = true; }
        if (missing(s.interval)) patch.interval = DEFAULT_INTERVAL_SEC;
      } else if (kind === STATION_KIND.BUY) {
        if (s.price === undefined || s.price === null) patch.price = 0;
        if (missing(s.minQty)) { patch.minQty = cargoByLevel(minTrainLevel.value); patch.minQtyAuto = true; }
        if (missing(s.maxQty)) { patch.maxQty = cargoByLevel(maxTrainLevel.value); patch.maxQtyAuto = true; }
      } else {
        // 客流：默认 qty
        if (missing(s.qty)) { patch.qty = cargoByLevel(maxTrainLevel.value); }
      }
    }
  }
  // 补齐缺失字段
  if (kind === STATION_KIND.REFRESH) {
    if (missing(s.interval)) patch.interval = DEFAULT_INTERVAL_SEC;
    if (!s.refreshStart) patch.refreshStart = 'timed';
    if (s.startDelay === undefined || s.startDelay === null) patch.startDelay = 0;
    if (missing(s.qty) && !patch.qty) { patch.qty = cargoByLevel(maxTrainLevel.value); patch.qtyAuto = true; }
  } else if (kind === STATION_KIND.BUY) {
    if (s.price === undefined && patch.price === undefined) patch.price = 0;
    if (missing(s.minQty) && !patch.minQty) { patch.minQty = cargoByLevel(minTrainLevel.value); patch.minQtyAuto = true; }
    if (missing(s.maxQty) && !patch.maxQty) { patch.maxQty = cargoByLevel(maxTrainLevel.value); patch.maxQtyAuto = true; }
  } else {
    // 客流：默认 qty
    if (missing(s.qty) && !patch.qty) { patch.qty = cargoByLevel(maxTrainLevel.value); }
  }
  return patch;
}

/** 选了物资名称后自动选第一个 external 实例，并自动匹配对应类型 */
function pickStationResource(i: number, name: string) {
	  const candidates = instancesOfName(name);
	  const s = level.value?.externalStationArr?.[i];
	  if (!candidates.length) {
	    // 无匹配实例 → 清空站点选择
	    if (s) updateStation(i, { resourceId: '', kind: undefined });
	    return;
	  }
	  const chosen = candidates[0];
	  if (s) {
	    const kind = kindFromObtain(chosen.obtain);
	    const patch: Partial<ExternalStation> = { resourceId: chosen.id };
	    if (kind) {
	      Object.assign(patch, ensureKindDefaults(s, kind));
	      patch.kind = kind;
	    }
	    updateStation(i, patch);
	  }
	}

/** 切换实例时自动匹配对应类型 */
function onStationInstChange(i: number, instId: string) {
  const inst = store.instById.get(instId);
  if (!inst) {
    updateStation(i, { resourceId: '', kind: undefined });
    return;
  }
  const s = level.value?.externalStationArr?.[i];
  if (s) {
    const kind = kindFromObtain(inst.obtain);
    const patch: Partial<ExternalStation> = { resourceId: instId };
    if (kind) {
      Object.assign(patch, ensureKindDefaults(s, kind));
      patch.kind = kind;
    }
    updateStation(i, patch);
  }
}

/** 计算下一个外部站编号 mN+1（跳过历史空洞，避免重号） */
function nextExternalLabel(list: ExternalStation[]): string {
  let max = 0;
  for (const s of list) {
    const m = /^m(\d+)$/.exec(s.label ?? '');
    if (m) max = Math.max(max, +m[1]);
  }
  return 'm' + (max + 1);
}

function addStation() {
  if (!level.value) return;
  const list: ExternalStation[] = [...(level.value.externalStationArr ?? [])];
  list.push({
    label: nextExternalLabel(list),
    resourceId: '',
    qty: cargoByLevel(maxTrainLevel.value),
    qtyAuto: true,
    kind: undefined,
    interval: 0,
    refreshStart: 'timed',
    startDelay: 0,
    minQty: cargoByLevel(minTrainLevel.value),
    minQtyAuto: true,
    maxQty: cargoByLevel(maxTrainLevel.value),
    maxQtyAuto: true,
    price: 0,
  });
  patchLevel({ externalStationArr: list, hasExternalStation: true });
}
function updateStation(i: number, patch: Partial<ExternalStation>) {
  const list = [...(level.value?.externalStationArr ?? [])];
  const merged = { ...list[i], ...patch };
  // 用户手动改数量时 → 清除对应的 auto 标记，锁定
  if (patch.qty !== undefined) merged.qtyAuto = false;
  if (patch.minQty !== undefined) merged.minQtyAuto = false;
  if (patch.maxQty !== undefined) merged.maxQtyAuto = false;
  // 约束：最低 ≤ 最高（用户点 + 可能越过边界）
  if (merged.kind === STATION_KIND.BUY || merged.kind === STATION_KIND.STOCK) {
    if (isValidQty(merged.minQty) && isValidQty(merged.maxQty) && merged.minQty > merged.maxQty) {
      if (patch.minQty !== undefined) merged.maxQty = merged.minQty; // 拉 min 上来 → max 跟着升
      else if (patch.maxQty !== undefined) merged.minQty = merged.maxQty; // 拉 max 下去 → min 跟着降
    }
  }
  list[i] = merged;
  patchLevel({ externalStationArr: list });
}
function removeStation(i: number) {
  const list = (level.value?.externalStationArr ?? []).filter((_, idx) => idx !== i);
  if (!list.length) {
    patchLevel({ externalStationArr: [], hasExternalStation: false });
  } else {
    patchLevel({ externalStationArr: list });
  }
}

// ——— 拆卸组（拆卸工厂站点）CRUD ———

/** 新增拆卸组 */
function addCpGroup() {
  if (!level.value) return;
  const list = level.value.coProductionGroups ?? [];
  const nextId = 'cp' + (list.length + 1);
  list.push({
    id: nextId,
    outputs: [{ instanceId: '', perOut: 1 }],
  });
  patchLevel({ coProductionGroups: [...list] });
}
function removeCpGroup(cpIdx: number) {
  const list = (level.value?.coProductionGroups ?? []).filter((_, idx) => idx !== cpIdx);
  // 删除到空时写 []（而非 undefined）：undefined 在序列化时被丢弃，会让合并逻辑
  // 回落到 seed 里的旧数据，导致"删掉的组刷新后又冒出来"。
  patchLevel({ coProductionGroups: list, hasMergedProduction: list.length > 0 });
}
function updateCpGroup(cpIdx: number, patch: Partial<CoProductionGroup>) {
  const list = [...(level.value?.coProductionGroups ?? [])];
  list[cpIdx] = { ...list[cpIdx], ...patch };
  patchLevel({ coProductionGroups: list });
}
/** 解析「建议拆 N 次」：空 / 非法 / ≤0 → undefined（不限，走最佳配平）；否则取正整数 */
function setCpMaxCycles(cpIdx: number, e: Event) {
  const n = parseInt((e.target as HTMLInputElement).value.trim(), 10);
  updateCpGroup(cpIdx, { maxCycles: Number.isFinite(n) && n > 0 ? n : undefined });
}
function addCpOutput(cpIdx: number) {
  const list = [...(level.value?.coProductionGroups ?? [])];
  const cp = { ...list[cpIdx] };
  cp.outputs = [...cp.outputs, { instanceId: '', perOut: 1 }];
  list[cpIdx] = cp;
  patchLevel({ coProductionGroups: list });
}
function removeCpOutput(cpIdx: number, oi: number) {
  const list = [...(level.value?.coProductionGroups ?? [])];
  const cp = { ...list[cpIdx] };
  cp.outputs = cp.outputs.filter((_, idx) => idx !== oi);
  if (cp.outputs.length === 0) {
    // 组内无产出时自动删除整组
    list.splice(cpIdx, 1);
  } else {
    list[cpIdx] = cp;
  }
  patchLevel({ coProductionGroups: list.length ? list : undefined });
}
function updateCpOutput(cpIdx: number, oi: number, patch: Partial<CoProductionOutput>) {
  const list = [...(level.value?.coProductionGroups ?? [])];
  const cp = { ...list[cpIdx] };
  cp.outputs = cp.outputs.map((o, idx) => idx === oi ? { ...o, ...patch } : o);
  list[cpIdx] = cp;
  patchLevel({ coProductionGroups: list });
}

/** 拆卸组可选的实例列表：所有有配方（inputs.length > 0）且未加入其他组的实例 */
function cpInstanceOptions(_cp: CoProductionGroup, cpIdx: number): ResourceInstance[] {
  if (!level.value) return [];
  // 其他拆卸组已占用的实例 ID
  const otherUsed = new Set<string>();
  (level.value.coProductionGroups ?? []).forEach((g, gi) => {
    if (gi !== cpIdx) {
      g.outputs.forEach((o) => otherUsed.add(o.instanceId));
    }
  });
  return store.data.instances.filter((inst) => {
    if (!inst.inputs.length) return false; // 无配方
    if (otherUsed.has(inst.id)) return false; // 已被其他组使用
    return true;
  });
}

/** 拆卸组配方输入项（含分类），用于渲染高亮 */
function cpInputItems(cp: CoProductionGroup): { name: string; category: ResourceCategory }[] {
  if (!cp.outputs.length) return [];
  let common: string[] | null = null;
  for (const out of cp.outputs) {
    if (!out.instanceId) continue;
    const inst = store.data.instances.find((i) => i.id === out.instanceId);
    if (!inst || !inst.inputs.length) continue;
    if (common === null) {
      common = [...inst.inputs];
    } else {
      common = common.filter((n) => inst.inputs.includes(n));
    }
  }
  if (!common?.length) return [];
  // 构建关卡局部实例映射，统一分类
  const localByName = new Map<string, ResourceInstance>();
  for (const li of localInstances.value) {
    localByName.set(li.name, li);
  }
  return common.map((name) => ({
    name,
    category: classifyName(name, store.data, localByName),
  }));
}

/** 各分类对应的文字颜色类 */
const CATEGORY_TEXT_CLS: Record<string, string> = {
  raw: 'text-good',
  processed: 'text-steel-brand',
  compound: 'text-amber-brand',
};

/** 检查拆卸组内产出实例的配方是否一致（有 selected 实例且 inputs 不完全相同） */
function cpRecipeMismatch(cp: CoProductionGroup): boolean {
  const selected = cp.outputs.filter((o) => o.instanceId);
  if (selected.length < 2) return false;
  const insts = selected.map((o) => store.data.instances.find((i) => i.id === o.instanceId)).filter(Boolean);
  if (insts.length < 2) return false;
  const first = insts[0]!.inputs;
  return insts.slice(1).some((inst) => {
    if (inst!.inputs.length !== first.length) return true;
    return !inst!.inputs.every((n) => first.includes(n));
  });
}

// ——— 多渠道生产组 CRUD ———
const activeMcTypeSuggest = ref<number>(-1);
const mcTypeCursor = ref(0);
const mcExpanded = reactive<Record<number, boolean>>({});

function addMcGroup() {
  if (!level.value) return;
  const list = level.value.multiChannelGroups ?? [];
  const idx = list.length;
  list.push({ typeName: '', instanceIds: [] });
  mcExpanded[idx] = true;
  patchLevel({ multiChannelGroups: [...list] });
}
function removeMcGroup(idx: number) {
  const list = (level.value?.multiChannelGroups ?? []).filter((_, i) => i !== idx);
  delete mcExpanded[idx];
  // 同上：删除到空写 []，保证删除意图能覆盖 seed，刷新后不再复活空组
  patchLevel({ multiChannelGroups: list, hasMultipleInstances: list.length > 0 });
}
function mcTypeSuggestions(idx: number): string[] {
  const kw = (level.value?.multiChannelGroups?.[idx]?.typeName ?? '').trim();
  const names = store.resourceNames.filter((n) => store.data.instances.filter((i) => i.name === n).length > 1);
  if (!kw) return names.slice(0, 10);
  return names.filter((n) => n.includes(kw)).slice(0, 10);
}
/** 获取关卡中已使用的指定类型实例 ID 列表 */
function getUsedInstanceIds(typeName: string): string[] {
  if (!level.value) return [];
  const used = new Set<string>();
  const check = (id: string) => {
    const inst = store.instById.get(id);
    if (inst?.name === typeName) used.add(id);
  };
  for (const g of level.value.goals ?? []) if (g.resourceId) check(g.resourceId);
  for (const s of level.value.resourceStationArr ?? []) if (s.resourceId) check(s.resourceId);
  for (const s of level.value.externalStationArr ?? []) if (s.resourceId) check(s.resourceId);
  for (const g of level.value.coProductionGroups ?? [])
    for (const o of g.outputs) check(o.instanceId);
  return [...used];
}

function openMcTypeSuggest(idx: number) { activeMcTypeSuggest.value = idx; mcTypeCursor.value = 0; }
function onMcTypeInput(idx: number, value: string) {
  const list = [...(level.value?.multiChannelGroups ?? [])];
  const match = store.data.instances.some((i) => i.name === value);
  list[idx] = { ...list[idx], typeName: value, instanceIds: match ? getUsedInstanceIds(value) : [] };
  if (match) mcExpanded[idx] = true;
  patchLevel({ multiChannelGroups: list });
}
function closeMcTypeSuggest(idx: number) {
  setTimeout(() => { if (activeMcTypeSuggest.value === idx) activeMcTypeSuggest.value = -1; }, 150);
}
function onMcTypeKeydown(idx: number, e: KeyboardEvent) {
  const list = mcTypeSuggestions(idx);
  if (!list.length) return;
  if (e.key === 'Escape') { activeMcTypeSuggest.value = -1; return; }
  if (e.key === 'Enter') { e.preventDefault(); pickMcType(idx, list[Math.min(mcTypeCursor.value, list.length - 1)]); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); mcTypeCursor.value = (mcTypeCursor.value + 1) % list.length; }
  else if (e.key === 'ArrowUp') { e.preventDefault(); mcTypeCursor.value = mcTypeCursor.value <= 0 ? list.length - 1 : mcTypeCursor.value - 1; }
}
function pickMcType(idx: number, name: string) {
  const list = [...(level.value?.multiChannelGroups ?? [])];
  list[idx] = { ...list[idx], typeName: name, instanceIds: getUsedInstanceIds(name) };
  mcExpanded[idx] = true;
  patchLevel({ multiChannelGroups: list });
  activeMcTypeSuggest.value = -1;
}
function mcInstanceOptions(typeName: string): ResourceInstance[] {
  return store.data.instances.filter((i) => i.name === typeName);
}
function toggleMcInstance(idx: number, instanceId: string) {
  const list = [...(level.value?.multiChannelGroups ?? [])];
  const mc = { ...list[idx] };
  const ids = [...mc.instanceIds];
  mc.instanceIds = ids.includes(instanceId) ? ids.filter((id) => id !== instanceId) : [...ids, instanceId];
  list[idx] = mc;
  patchLevel({ multiChannelGroups: list });
}

// ——— 外部站点自定义联想 & 下拉 ———

/** 每行的物资搜索关键字 */
const stationKeywords = ref<Record<number, string>>({});
/** 当前展开联想的站点行（-1 = 收起） */
const activeStationSuggest = ref(-1);
/** 联想光标（每行独立） */
const stationSuggestCursor = ref<Record<number, number>>({});
/** 当前展开实例下拉的站点行（-1 = 收起） */
const activeStationInst = ref(-1);
/** 实例下拉光标（每行独立） */
const stationInstCursor = ref<Record<number, number>>({});

// ─── 资源站点物资名搜索 ───
const rsKeywords = ref<Record<number, string>>({});
const activeRsSuggest = ref(-1);
const rsSuggestCursor = ref<Record<number, number>>({});
const activeRsInst = ref(-1);
const rsInstCursor = ref<Record<number, number>>({});

/** 资源站点所有可选物资名称（obtain=无限/库存 的 initialSetup 实例） */
const allRsNames = computed(() => {
  const set = new Set<string>();
  for (const i of store.data.instances) {
    if (i.inputs.length === 0 && i.name !== '工人' && i.name !== '电力' && (i.obtain === '无限' || i.obtain === '库存')) {
      set.add(i.name);
    }
  }
  return [...set].sort();
});

/** 根据物资名称找资源站点可用实例 */
function rsInstancesOfName(name: string): ResourceInstance[] {
  return store.data.instances.filter(
    (i) => i.name === name && i.inputs.length === 0 && i.name !== '工人' && i.name !== '电力' && (i.obtain === '无限' || i.obtain === '库存'),
  );
}

/** 资源站点联想候选 */
function suggestRsResources(idx: number): string[] {
  const kw = (rsKeywords.value[idx] ?? '').trim();
  if (!kw) return allRsNames.value;
  return allRsNames.value.filter((n) => n.includes(kw)).slice(0, 12);
}

/** 选了物资名称后自动选第一个实例 */
function pickRsResource(idx: number, name: string) {
  const candidates = rsInstancesOfName(name);
  if (!candidates.length) return;
  setResourceStationResource(idx, candidates[0].id);
}

/** 点击联想项 */
function pickRsSuggest(idx: number, name: string) {
  rsKeywords.value[idx] = name;
  pickRsResource(idx, name);
  activeRsSuggest.value = -1;
  rsSuggestCursor.value[idx] = 0;
  nextTick(() => {
    const btn = document.querySelector<HTMLButtonElement>(`.rs-inst-trigger[data-row="${idx}"]`);
    btn?.focus();
    activeRsInst.value = -1;
    activeRsInst.value = idx;
  });
}

/** 资源站搜索框键盘事件 */
function onRsSuggestKeydown(idx: number, e: KeyboardEvent) {
  const list = suggestRsResources(idx);
  if (!list.length) return;
  const cur = rsSuggestCursor.value[idx] ?? 0;
  if (e.key === 'Enter') {
    e.preventDefault();
    const idx2 = Math.min(cur, list.length - 1);
    pickRsSuggest(idx, list[idx2]);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    rsSuggestCursor.value[idx] = ((cur + 1) % list.length + list.length) % list.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    rsSuggestCursor.value[idx] = cur <= 0 ? list.length - 1 : cur - 1;
  } else if (e.key === 'Escape') {
    activeRsSuggest.value = -1;
  }
}

/** 打开资源站实例下拉 */
function openRsInst(idx: number) {
  if (activeRsInst.value === idx) {
    activeRsInst.value = -1;
    return;
  }
  activeRsInst.value = idx;
  const rs = level.value?.resourceStationArr?.[idx];
  if (rs?.resourceId) {
    const name = store.instById.get(rs.resourceId)?.name;
    if (name) {
      const list = rsInstancesOfName(name);
      rsInstCursor.value[idx] = list.findIndex((x) => x.id === rs.resourceId);
      if (rsInstCursor.value[idx] < 0) rsInstCursor.value[idx] = 0;
    }
  }
}

/** 点击资源站实例选项 */
function pickRsInst(idx: number, instId: string) {
  setResourceStationResource(idx, instId);
  activeRsInst.value = -1;
}

/** 资源站实例下拉键盘事件 */
function onRsInstKeydown(idx: number, e: KeyboardEvent) {
  if (activeRsInst.value !== idx) return;
  const rs = level.value?.resourceStationArr?.[idx];
  if (!rs?.resourceId) return;
  const name = store.instById.get(rs.resourceId)?.name;
  if (!name) return;
  const list = rsInstancesOfName(name);
  if (!list.length) return;
  const cur = rsInstCursor.value[idx] ?? 0;
  if (e.key === 'Enter') {
    e.preventDefault();
    pickRsInst(idx, list[Math.min(cur, list.length - 1)].id);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    rsInstCursor.value[idx] = Math.min(cur + 1, list.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    rsInstCursor.value[idx] = Math.max(0, cur - 1);
  } else if (e.key === 'Escape') {
    activeRsInst.value = -1;
  }
}

// ─── 拆卸工厂物资名搜索 ───
const cpKeywords = ref<Record<string, string>>({});
const activeCpSuggest = ref<string | null>(null);
const cpSuggestCursor = ref<Record<string, number>>({});
const activeCpInst = ref<string | null>(null);
const cpInstCursor = ref<Record<string, number>>({});

function cpSuggestions(cpIdx: number, _oi: number): string[] {
  const key = `${cpIdx}-${_oi}`;
  const kw = (cpKeywords.value[key] ?? '').trim();
  const cp = level.value?.coProductionGroups?.[cpIdx];
  if (!cp) return [];
  const options = cpInstanceOptions(cp, cpIdx);
  const names = [...new Set(options.map((inst) => inst.name))];
  if (!kw) return names;
  return names.filter((n) => n.includes(kw));
}

function pickCpSuggest(cpIdx: number, oi: number, name: string) {
  const cp = level.value?.coProductionGroups?.[cpIdx];
  if (!cp) return;
  const options = cpInstanceOptions(cp, cpIdx);
  const candidates = options.filter((inst) => inst.name === name);
  if (!candidates.length) return;
  const chosen = candidates[0];
  updateCpOutput(cpIdx, oi, { instanceId: chosen.id });
  const key = `${cpIdx}-${oi}`;
  cpKeywords.value[key] = name;
  activeCpSuggest.value = null;
  cpSuggestCursor.value[key] = 0;
}

function onCpSuggestKeydown(cpIdx: number, oi: number, e: KeyboardEvent) {
  const key = `${cpIdx}-${oi}`;
  const list = cpSuggestions(cpIdx, oi);
  if (!list.length) return;
  const cur = cpSuggestCursor.value[key] ?? 0;
  if (e.key === 'Enter') {
    e.preventDefault();
    const idx = Math.min(cur, list.length - 1);
    pickCpSuggest(cpIdx, oi, list[idx]);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cpSuggestCursor.value[key] = ((cur + 1) % list.length + list.length) % list.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cpSuggestCursor.value[key] = cur <= 0 ? list.length - 1 : cur - 1;
  } else if (e.key === 'Escape') {
    activeCpSuggest.value = null;
  }
}

function openCpInst(cpIdx: number, oi: number) {
  const key = `${cpIdx}-${oi}`;
  if (activeCpInst.value === key) {
    activeCpInst.value = null;
    return;
  }
  activeCpInst.value = key;
  const out = level.value?.coProductionGroups?.[cpIdx]?.outputs?.[oi];
  if (out?.instanceId) {
    const inst = store.instById.get(out.instanceId);
    if (inst) {
      const cp = level.value?.coProductionGroups?.[cpIdx];
      if (!cp) return;
      const options = cpInstanceOptions(cp, cpIdx);
      const list = options.filter((x) => x.name === inst.name);
      cpInstCursor.value[key] = list.findIndex((x) => x.id === out.instanceId);
      if (cpInstCursor.value[key] < 0) cpInstCursor.value[key] = 0;
    }
  }
}

function pickCpInst(cpIdx: number, oi: number, instId: string) {
  updateCpOutput(cpIdx, oi, { instanceId: instId });
  activeCpInst.value = null;
}

/** 某行的联想候选 */
function suggestStationResources(i: number): string[] {
  const kw = (stationKeywords.value[i] ?? '').trim();
  if (!kw) return allResourceNames.value; // 空输入显示全部，滚动条浏览
  return allResourceNames.value.filter((n) => n.includes(kw)).slice(0, 12);
}

/** 点击联想项 */
function pickStationSuggest(i: number, name: string) {
  stationKeywords.value[i] = name; // 强制同步输入框内容，避免旧关键词残留
  pickStationResource(i, name);
  activeStationSuggest.value = -1;
  stationSuggestCursor.value[i] = 0;
  // 自动 focus 到实例下拉按钮（让用户直接方向键选实例）
  nextTick(() => {
    const btn = document.querySelector<HTMLButtonElement>(`.station-inst-trigger[data-row="${i}"]`);
    btn?.focus();
    // 自动展开实例下拉
    activeStationInst.value = -1; // 先清，防止 toggle 逻辑误关
    activeStationInst.value = i; // 直接赋值打开
  });
}

/** 物资搜索框键盘事件：Enter → 选首项 + 跳实例；↑↓ → 导航联想 */
function onStationSuggestKeydown(i: number, e: KeyboardEvent) {
	  const list = suggestStationResources(i);
	  const cur = stationSuggestCursor.value[i] ?? 0;

	  if (e.key === 'Enter') {
	    e.preventDefault();
	    if (list.length) {
	      const idx = Math.min(cur, list.length - 1);
	      pickStationSuggest(i, list[idx]);
	    } else {
	      // 无匹配联想时，直接用关键词尝试查找，失败则清空
	      const kw = (stationKeywords.value[i] ?? '').trim();
	      if (kw) pickStationResource(i, kw);
	    }
	    activeStationSuggest.value = -1;
	    return;
	  }
	  if (e.key === 'ArrowDown') {
	    e.preventDefault();
	    if (list.length) {
	      stationSuggestCursor.value[i] = ((cur + 1) % list.length + list.length) % list.length;
	    }
	  } else if (e.key === 'ArrowUp') {
	    e.preventDefault();
	    if (list.length) {
	      stationSuggestCursor.value[i] = cur <= 0 ? list.length - 1 : cur - 1;
	    }
	  } else if (e.key === 'Escape') {
	    activeStationSuggest.value = -1;
	  }
	}

/** 打开实例下拉 */
function openStationInst(i: number) {
  if (activeStationInst.value === i) {
    activeStationInst.value = -1;
    return;
  }
  activeStationInst.value = i;
  const s = level.value?.externalStationArr?.[i];
  if (s?.resourceId) {
    const name = store.instById.get(s.resourceId ?? '')?.name;
    if (name) {
      const list = instancesOfName(name);
      stationInstCursor.value[i] = list.findIndex((x) => x.id === s.resourceId);
      if (stationInstCursor.value[i] < 0) stationInstCursor.value[i] = 0;
    }
  }
}

/** 点击实例选项 */
function pickStationInst(i: number, instId: string) {
  onStationInstChange(i, instId);
  activeStationInst.value = -1;
}

/** 实例下拉键盘事件 */
function onStationInstKeydown(i: number, e: KeyboardEvent) {
  if (activeStationInst.value !== i) return;
  const s = level.value?.externalStationArr?.[i];
  if (!s?.resourceId) return;
  const name = store.instById.get(s.resourceId ?? '')?.name;
  if (!name) return;
  const list = instancesOfName(name);
  if (!list.length) return;
  const cur = stationInstCursor.value[i] ?? 0;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    stationInstCursor.value[i] = (cur + 1) % list.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    stationInstCursor.value[i] = cur <= 0 ? list.length - 1 : cur - 1;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const idx = Math.min(cur, list.length - 1);
    pickStationInst(i, list[idx].id);
  } else if (e.key === 'Escape') {
    activeStationInst.value = -1;
  }
}

/** 点击外部收起联想/下拉 */
function closeStationPopups() {
  activeStationSuggest.value = -1;
  activeStationInst.value = -1;
}

</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
    <!-- 左：关卡列表（独立滚动） -->
    <div class="panel flex h-full min-h-0 flex-col">
      <div class="flex items-center gap-2 shrink-0">
        <h2 class="panel-title mb-0">关卡列表</h2>
        <span class="flex-1" />
      </div>
      <!-- 筛选行 1：内容类型 -->
      <div class="mt-2 flex flex-wrap items-center gap-0.5">
        <button
          class="shrink-0 rounded border px-2 py-0.5 text-[11px] transition-colors"
          :class="contentTypeFilter === FILTER_ALL
            ? 'border-amber-brand bg-amber-brand/10 text-amber-brand'
            : 'border-ink-600 text-fog-400 hover:border-ink-500 hover:text-fog-100'"
          @click="contentTypeFilter = 'all'"
        >全部</button>
        <button
          v-for="ct in contentTypeOptions" :key="ct"
          class="shrink-0 rounded border px-2 py-0.5 text-[11px] transition-colors"
          :class="contentTypeFilter === ct
            ? 'border-amber-brand bg-amber-brand/10 text-amber-brand'
            : 'border-ink-600 text-fog-400 hover:border-ink-500 hover:text-fog-100'"
          @click="contentTypeFilter = ct"
        >{{ ct }}</button>
      </div>
      <!-- 筛选行 2：关卡标记（多选） -->
      <div class="mt-1 flex flex-wrap items-center gap-0.5">
        <button
          v-for="key in FLAG_KEYS" :key="key"
          class="shrink-0 rounded border px-2 py-0.5 text-[11px] transition-colors"
          :class="flagFilters.includes(key)
            ? 'border-steel-brand bg-steel-brand/15 text-steel-brand'
            : 'border-ink-600 text-fog-400 hover:border-ink-500 hover:text-fog-100'"
          @click="flagFilters = flagFilters.includes(key) ? flagFilters.filter((k) => k !== key) : [...flagFilters, key]"
        >{{ FLAG_LABELS[key] }}</button>
      </div>
      <div class="relative mt-2 shrink-0">
        <AppIcon name="search" :size="14" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fog-400" />
        <input v-model="keyword" type="text" placeholder="搜索关卡名 / 章节" class="w-full pl-7" />
      </div>
      <div ref="levelListRef" @scroll="saveLevelListScroll" class="mt-3 grid flex-1 min-h-0 grid-cols-1 gap-1.5 overflow-y-auto pr-1">
        <button
          v-for="l in filtered" :key="l.id"
          :data-level-id="l.id"
          class="group rounded-md border px-3 py-2 text-left transition-colors"
          :class="l.id === selectedId
            ? 'border-amber-brand bg-amber-brand/10'
            : 'border-ink-600 bg-ink-700/30 hover:border-ink-500 hover:bg-ink-700/70'"
          @click="pickedId = l.id"
        >
          <div class="flex items-baseline gap-2">
            <span v-if="contentTypeFilter !== FILTER_ALL" class="text-[11px] text-fog-500">{{ String(levelOrderIndex.get(l.id) ?? 0).padStart(2, '0') }}</span>
            <span class="text-sm font-semibold text-fog-100 group-hover:text-amber-brand">{{ l.name }}</span>
          </div>
          <div class="mt-0.5 text-[11px] text-fog-400">
            {{ CATEGORY_LABEL[l.category] }} · {{ l.chapter }}
            <template v-if="l.seconds"> · {{ fmtSeconds(l.seconds) }}</template>
            <template v-if="l.goals.length"> · <span class="text-amber-brand">{{ l.goals.length }} 目标</span></template>
          </div>
        </button>
        <p v-if="!filtered.length" class="py-4 text-center text-xs text-fog-500">无匹配关卡</p>
      </div>
    </div>

    <!-- 右：详情 + 拆解（独立滚动） -->
    <div v-if="!level" class="panel h-full min-h-0 overflow-y-auto">请选择左侧关卡</div>
    <div v-else class="flex min-h-0 flex-col overflow-y-auto space-y-4">
      <!-- 关卡详情头 -->
      <div class="panel">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-lg font-bold text-fog-100">{{ level.name }}</h2>
          <span class="tag">{{ CATEGORY_LABEL[level.category] }} · {{ level.contentType }}</span>
          <span class="tag">{{ level.chapter }}</span>
          <span v-if="level.seconds" class="tag"><AppIcon name="clock" :size="12" /> {{ fmtSeconds(level.seconds) }}（最佳 {{ level.bestTime }}）</span>
          <span v-if="level.earn" class="tag"><AppIcon name="coin" :size="12" /> 收入 {{ level.earn }}</span>
          <span v-if="level.startMoney" class="tag"><AppIcon name="coin" :size="12" /> 起始资金 {{ level.startMoney }}</span>
          <span class="flex-1" />
          <button
            class="shrink-0 rounded border px-2 py-0.5 text-[11px] transition-colors"
            :class="{
              'border-good bg-good/15 text-good': exportStatus === 'copied',
              'border-bad bg-bad/15 text-bad': exportStatus === 'error',
              'border-ink-600 text-fog-400 hover:border-ink-500 hover:text-fog-100': exportStatus === 'idle',
            }"
            @click="exportLevelData"
          >{{
            exportStatus === 'copied' ? '✅ 已复制' :
            exportStatus === 'error' ? '❌ 复制失败' :
            '导出'
          }}</button>
          <button
            class="shrink-0 rounded border px-2 py-0.5 text-[11px] transition-colors"
            :class="{
              'border-good bg-good/15 text-good': saveStatus === 'saved',
              'border-bad bg-bad/15 text-bad': saveStatus === 'error',
              'border-ink-600 text-fog-400 hover:border-ink-500 hover:text-fog-100': saveStatus === 'idle' || saveStatus === 'saving',
            }"
            @click="handleSave"
          >{{
            saveStatus === 'saving' ? '保存中…' :
            saveStatus === 'saved' ? '✅ 已保存' :
            saveStatus === 'error' ? '❌ 保存失败' :
            '保存'
          }}</button>
        </div>

        <!-- ————————— 完美通关星级 ————————— -->
        <div class="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-brand/30 bg-amber-brand/5 px-4 py-2.5">
          <div class="flex items-center gap-0.5 text-amber-brand">
            <AppIcon v-for="n in starCount" :key="n" name="star" :size="16" />
          </div>
          <span class="text-xs text-fog-300">完美通关 {{ starCount }} 星</span>
          <span class="flex-1" />
          <div class="flex flex-wrap gap-1.5 text-[11px]">
            <span class="rounded-full border border-amber-brand/40 bg-amber-brand/10 px-2 py-0.5 text-amber-brand">
              ⭐⭐⭐ 限时 {{ level.seconds ? fmtSeconds(level.seconds) : '—' }}（最佳 {{ level.bestTime }}）
            </span>
            <span v-for="s in starConditions" :key="s.key"
              class="rounded-full border border-amber-brand/40 bg-amber-brand/10 px-2 py-0.5 text-amber-brand">
              ⭐ {{ s.text }}
            </span>
            <span v-if="starConditions.length === 0"
              class="rounded-full border border-ink-600 px-2 py-0.5 text-fog-500">
              暂无附加条件
            </span>
          </div>
        </div>

        <!-- ————————— 初始配置 ————————— -->
        <h3 class="mb-2 mt-5 text-sm font-semibold text-amber-brand">
          <AppIcon name="factory" :size="13" class="mr-1" /> 初始配置
        </h3>

        <div class="rounded-md border border-ink-600 bg-ink-700/30 px-3 py-2.5">
          <div class="flex flex-wrap items-center gap-x-8 gap-y-3">
            <!-- —— 行 1：工人站点 + 初始列车 —— -->

            <!-- 👷 工人站点 → 顶部数量步进器 + 下方每站点独立解锁配置 -->
            <div class="flex items-center gap-2 text-xs text-fog-400">
              <span class="w-[80px] shrink-0">👷 工人站点</span>
              <div class="flex h-8 w-[88px] overflow-hidden rounded border border-ink-500 bg-ink-800 text-[12px]">
                <button
                  class="shrink-0 w-6 text-fog-400 hover:text-amber-brand disabled:opacity-30"
                  :disabled="(level.workerStationArr?.length ?? level.workerStations ?? 1) <= 1"
                  @click="changeWorkerCount(-1)"
                >−</button>
                <input
                  type="text" inputmode="numeric"
                  class="w-full border-x border-ink-600 bg-transparent text-center outline-none text-fog-100 focus:bg-ink-700/40"
                  :value="level.workerStationArr?.length ?? level.workerStations ?? 1"
                  @input="changeWorkerCountTo(+($event.target as HTMLInputElement).value || 1)"
                  @focus="($event.target as HTMLInputElement).select()"
                />
                <button
                  class="shrink-0 w-6 text-fog-400 hover:text-amber-brand"
                  @click="changeWorkerCount(1)"
                >+</button>
              </div>
              <span class="text-fog-300">个</span>
            </div>

            <!-- 🚂 初始列车 → 等级 select + 步进器 -->
            <div class="flex items-center gap-2 text-xs text-fog-400">
              <span class="w-[80px] shrink-0">🚂 初始列车</span>
              <select
                :value="level.initialTrains?.[0]?.level ?? 1"
                class="w-[90px] shrink-0"
                @change="patchLevel({ initialTrains: [{ level: +($event.target as HTMLSelectElement).value, count: level.initialTrains?.[0]?.count ?? 1 }] })"
              >
                <option v-for="lv in store.data.trains" :key="lv.level" :value="lv.level">Lv{{ lv.level }} (载{{ lv.capacity }})</option>
              </select>
              <div class="flex h-8 w-[88px] overflow-hidden rounded border border-ink-500 bg-ink-800 text-[12px]">
                <button
                  class="shrink-0 w-6 text-fog-400 hover:text-amber-brand disabled:opacity-30"
                  :disabled="(level.initialTrains?.[0]?.count ?? 1) <= 1"
                  @click="patchLevel({ initialTrains: [{ level: level.initialTrains?.[0]?.level ?? 1, count: Math.max(1, (level.initialTrains?.[0]?.count ?? 1) - 1) }] })"
                >−</button>
                <input
                  type="text" inputmode="numeric"
                  class="w-full border-x border-ink-600 bg-transparent text-center outline-none text-fog-100 focus:bg-ink-700/40"
                  :value="level.initialTrains?.[0]?.count ?? 1"
                  @input="patchLevel({ initialTrains: [{ level: level.initialTrains?.[0]?.level ?? 1, count: Math.max(1, +($event.target as HTMLInputElement).value || 1) }] })"
                  @focus="($event.target as HTMLInputElement).select()"
                />
                <button
                  class="shrink-0 w-6 text-fog-400 hover:text-amber-brand"
                  @click="patchLevel({ initialTrains: [{ level: level.initialTrains?.[0]?.level ?? 1, count: (level.initialTrains?.[0]?.count ?? 1) + 1 }] })"
                >+</button>
              </div>
              <span class="text-fog-300">辆</span>
            </div>

            <!-- —— 行 2：初始资金 + 最高升级（w-full 强制换行） —— -->
            <div class="flex w-full items-center gap-x-8 gap-y-3">
              <!-- 💰 初始资金 → input 宽度对齐步进器 88px -->
              <div class="flex items-center gap-2 text-xs text-fog-400">
                <span class="w-[80px] shrink-0">💰 初始资金</span>
                <input
                  type="text" inputmode="decimal"
                  class="w-[88px] text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  :value="moneyWan(level.startMoney)"
                  placeholder="如 3"
                  @input="patchLevel({ startMoney: fromWan(($event.target as HTMLInputElement).value) })"
                />
                <span class="text-fog-500">万</span>
              </div>

              <!-- 🚀 最高升级 → select + 升级次数步进器（双向联动） -->
              <div class="flex items-center gap-2 text-xs text-fog-400">
                <span class="w-[80px] shrink-0">🚀 最高升级</span>
                <select
                  :value="maxTrainLevel"
                  class="w-[90px] shrink-0"
                  @change="patchLevel({ maxTrainLevel: +($event.target as HTMLSelectElement).value })"
                >
                  <option v-for="lv in upgradeLevelOptions" :key="lv.level" :value="lv.level">Lv{{ lv.level }} (载{{ lv.capacity }})</option>
                </select>
                <div class="flex h-8 w-[88px] overflow-hidden rounded border border-ink-500 bg-ink-800 text-[12px]">
                  <button
                    class="shrink-0 w-6 text-fog-400 hover:text-amber-brand disabled:opacity-30"
                    :disabled="upgradeCount <= 0"
                    @click="applyUpgradeCount(upgradeCount - 1)"
                  >−</button>
                  <input
                    type="text" inputmode="numeric"
                    class="w-full border-x border-ink-600 bg-transparent text-center outline-none text-fog-100 focus:bg-ink-700/40"
                    :value="upgradeCount"
                    @input="applyUpgradeCount(+($event.target as HTMLInputElement).value || 0)"
                    @focus="($event.target as HTMLInputElement).select()"
                  />
                  <button
                    class="shrink-0 w-6 text-fog-400 hover:text-amber-brand disabled:opacity-30"
                    :disabled="upgradeCount >= upgradeCountMax"
                    @click="applyUpgradeCount(upgradeCount + 1)"
                  >+</button>
                </div>
                <span class="text-[11px] text-fog-600 whitespace-nowrap">次</span>
              </div>
            </div>

            <!-- —— 行 3：⚡️ 电力来源（w-full 独占一行） —— -->
            <div class="flex w-full items-start gap-2 text-xs text-fog-400">
              <span class="mt-0.5 w-[80px] shrink-0">⚡️ 电力来源</span>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="p in powerOptions"
                  :key="p.id"
                  type="button"
                  class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition"
                  :class="currentPowerSources.includes(p.id)
                    ? 'border-steel-brand/70 bg-steel-brand/20 text-steel-brand'
                    : 'border-ink-500 bg-transparent text-fog-500 hover:border-steel-brand/50 hover:text-fog-300'"
                  @click="togglePowerSource(p.id)"
                >
                  <span v-if="currentPowerSources.includes(p.id)" class="text-[9px] leading-none">✓</span>
                  {{ powerLabel(p) }}
                </button>
              </div>
            </div>

            <!-- —— 行 4：🏭 特殊站点 —— -->
            <div class="flex w-full items-start gap-2 text-xs text-fog-400">
              <span class="mt-0.5 w-[80px] shrink-0">🏭 特殊站点</span>
              <div class="flex flex-wrap gap-1" @click="onSpecialFlagClick">
                <button
                  v-for="f in SPECIAL_FLAG_OPTS"
                  :key="f.key"
                  type="button"
                  :data-flag-key="f.key"
                  :title="f.hint"
                  class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition"
                  :class="flagOn(f.key)
                    ? 'border-amber-brand/70 bg-amber-brand/15 text-amber-brand'
                    : 'border-ink-500 bg-transparent text-fog-500 hover:border-steel-brand/50 hover:text-fog-300'"
                >
                  <span class="mr-0.5">{{ f.icon }}</span>{{ f.label }}
                </button>
              </div>
            </div>

            <!-- —— 行 5：🏷️ 关卡标记（w-full，待开发模块） —— -->
            <div class="flex w-full items-start gap-2 text-xs text-fog-400">
              <span class="mt-0.5 w-[80px] shrink-0">🏷️ 关卡标记</span>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="f in LEVEL_FLAG_OPTS"
                  :key="f.key"
                  type="button"
                  :title="f.hint + '（待开发）'"
                  class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition"
                  :class="flagOn(f.key)
                    ? 'border-amber-brand/70 bg-amber-brand/20 text-amber-brand'
                    : 'border-ink-500 bg-transparent text-fog-500 hover:border-amber-brand/50 hover:text-fog-300'"
                  @click="toggleFlag(f.key)"
                >
                  <span class="mr-0.5">{{ f.icon }}</span>{{ f.label }}
                </button>
                <span class="ml-1 text-[10px] text-fog-600 self-center">（待开发模块）</span>
               </div>
             </div>

            <!-- —— 备注 —— -->
            <div class="flex w-full items-start gap-2 text-xs text-fog-400">
              <span class="mt-0.5 w-[80px] shrink-0">📝 备注</span>
              <textarea
                :value="level.notes ?? ''"
                placeholder="简述过关思路..."
                class="min-h-[60px] w-full resize-y rounded border border-ink-600 bg-ink-700 px-2 py-1 text-[12px] text-fog-100 placeholder:text-fog-600 focus:outline-none focus:ring-1 focus:ring-steel-brand/50"
                @input="patchLevel({ notes: ($event.target as HTMLTextAreaElement).value })"
              ></textarea>
            </div>
           </div>
         </div>

         <!-- —— 资源站点（无限/库存初始配置，可配置解锁） —— -->
         <div v-if="level.hasResourceStation === true || (level.resourceStationArr?.length ?? 0) > 0" class="mt-3 rounded-md border border-ink-600">
           <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
             <div class="text-xs font-medium text-fog-300">💎 初始资源站点（自动生产材料或直接提供库存）</div>
             <button class="btn !px-2 !py-0.5 text-xs" @click="addResourceStation">+ 添加资源站点</button>
           </div>
           <div v-if="!(level.resourceStationArr?.length)" class="py-3 text-center text-xs text-fog-500">暂无资源站点 — 点「+ 添加资源站点」开始配置</div>
           <div v-else class="px-2 py-2 space-y-2">
             <div v-for="(rs, idx) in level.resourceStationArr" :key="rs.label"
                  class="rounded-md border-2 border-dashed border-good/50 bg-good/5 p-2 flex flex-wrap items-center gap-2">
               <span class="inline-flex items-center gap-1 rounded bg-good/20 px-2 py-0.5 text-[11px] font-semibold text-good">💎 资源站 {{ idx + 1 }}</span>
               <!-- 物资搜索 -->
               <div class="relative">
                 <input
                   type="text"
                   class="w-[80px]"
                   :value="rsKeywords[idx] ?? (rs.resourceId ? store.instById.get(rs.resourceId)?.name ?? '' : '')"
                   placeholder="物资名…"
                   @focus="activeRsSuggest = idx; if (rs.resourceId) rsKeywords[idx] = store.instById.get(rs.resourceId)?.name ?? ''"
                   @input="rsKeywords[idx] = ($event.target as HTMLInputElement).value; activeRsSuggest = idx; rsSuggestCursor[idx] = 0"
                   @keydown="onRsSuggestKeydown(idx, $event)"
                 />
                 <ul
                   v-if="activeRsSuggest === idx && suggestRsResources(idx).length"
                   class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
                 >
                   <li
                     v-for="(nm, li) in suggestRsResources(idx)"
                     :key="nm"
                     class="cursor-pointer px-2 py-1 text-[11px]"
                     :class="rsSuggestCursor[idx] === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80'"
                     @mousedown.prevent="pickRsSuggest(idx, nm)"
                   >{{ nm }}</li>
                 </ul>
               </div>
               <!-- 实例下拉 -->
               <template v-if="rs.resourceId">
                 <div class="relative">
                   <button
                     type="button"
                     class="rs-inst-trigger flex w-[80px] items-center justify-between rounded border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-left text-[11px] text-fog-200 hover:border-steel-brand"
                     :class="activeRsInst === idx ? 'border-steel-brand' : ''"
                     :data-row="idx"
                     @click.stop="openRsInst(idx)"
                     @keydown="onRsInstKeydown(idx, $event)"
                   >
                     <span class="truncate">{{ store.instById.get(rs.resourceId)?.id ?? '—' }}</span>
                     <span class="ml-1 text-fog-500">▾</span>
                   </button>
                   <ul
                     v-if="activeRsInst === idx"
                     class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[160px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
                   >
                     <li
                       v-for="(inst, li) in rsInstancesOfName(store.instById.get(rs.resourceId)!.name)"
                       :key="inst.id"
                       class="cursor-pointer px-2 py-1 text-[11px]"
                       :class="[
                         rsInstCursor[idx] === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80',
                         inst.id === rs.resourceId ? 'font-medium text-fog-100' : ''
                       ]"
                       @mouseenter="rsInstCursor[idx] = li"
                       @mousedown.prevent="pickRsInst(idx, inst.id)"
                     >{{ inst.id }}<span class="text-fog-500 ml-1 text-[10px]">({{ inst.obtain }})</span></li>
                   </ul>
                 </div>
               </template>
               <span v-else class="text-xs text-fog-500">—</span>
               <button
                 type="button"
                 class="inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition"
                 :class="rs.unlockCost
                   ? 'border-ink-500 bg-ink-700/60 text-fog-400 hover:border-amber-brand hover:text-amber-brand'
                   : 'border-good/50 bg-good/15 text-good'"
                 @click="toggleResourceUnlock(idx)"
               >
                 <span class="text-[9px]">{{ rs.unlockCost ? '🔒' : '✅' }}</span>
                 {{ rs.unlockCost ? '未解锁' : '已解锁' }}
               </button>
               <template v-if="rs.unlockCost !== undefined">
                 <span class="text-[11px] text-fog-500">解锁金</span>
                 <input type="text" inputmode="numeric" class="w-[80px] text-center"
                        :value="rs.unlockCost"
                        @input="setResourceUnlockCost(idx, +($event.target as HTMLInputElement).value)"
                        @focus="($event.target as HTMLInputElement).select()" />
                 <span class="text-[11px] text-fog-500">$</span>
               </template>
               <template v-if="rsInst(idx)?.obtain === '库存'">
                 <span class="text-[11px] text-fog-500">库存</span>
                 <input type="text" inputmode="numeric" class="w-[70px] text-center"
                        :value="rs.totalStock ?? ''"
                        placeholder="∞"
                        @input="setResourceStockTotal(idx, +($event.target as HTMLInputElement).value)"
                        @focus="($event.target as HTMLInputElement).select()" />
                 <label class="inline-flex items-center gap-1 text-[11px] cursor-pointer select-none">
                   <input type="checkbox" :checked="!!rs.autoRefresh" @change="toggleResourceAutoRefresh(idx)" />
                   <span>自动刷新</span>
                 </label>
                 <template v-if="rs.autoRefresh">
                   <span class="text-[11px] text-fog-500">间隔</span>
                   <input type="text" inputmode="numeric" class="w-[64px] text-center"
                          :value="rs.refreshInterval ?? ''"
                          placeholder="秒"
                          @input="setResourceRefreshInterval(idx, +($event.target as HTMLInputElement).value)"
                          @focus="($event.target as HTMLInputElement).select()" />
                   <span class="text-[11px] text-fog-500">s</span>
                 </template>
               </template>
               <div class="flex-1" />
               <button class="text-[11px] text-bad/80 hover:text-bad" @click="removeResourceStation(idx)">删除此站</button>
             </div>
           </div>
         </div>

         <!-- —— 客流站点（乘客带来物资，每次1列车运载量，可解锁） —— -->
         <div v-if="level.hasPassengerStation === true || (level.passengerStationArr?.length ?? 0) > 0" class="mt-3 rounded-md border border-ink-600">
           <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
             <div class="text-xs font-medium text-fog-300">🚃 客流站点（乘客带来物资，每次 1 列车运载量）</div>
             <button class="btn !px-2 !py-0.5 text-xs" @click="addPassengerStation">+ 添加客流站</button>
           </div>
           <div v-if="!(level.passengerStationArr?.length)" class="py-3 text-center text-xs text-fog-500">暂无客流站点 — 点「+ 添加客流站」开始配置</div>
           <div v-else class="px-2 py-2 space-y-2">
             <div v-for="(ps, idx) in level.passengerStationArr" :key="ps.label"
                  class="rounded-md border-2 border-dashed border-steel-brand/50 bg-steel-brand/5 p-2 flex flex-wrap items-center gap-2">
               <span class="inline-flex items-center gap-1 rounded bg-steel-brand/20 px-2 py-0.5 text-[11px] font-semibold text-steel-brand">🚃 客流站 </span>
               <input type="text" class="w-[40px] text-center font-semibold text-[11px]"
                      :value="ps.label"
                      @input="setPassengerLabel(idx, ($event.target as HTMLInputElement).value)"
                      placeholder="A" />
               <select :value="ps.resourceId || ''" class="w-[150px]" @change="setPassengerResource(idx, ($event.target as HTMLSelectElement).value)">
                 <option value="">— 选择客流实例 —</option>
                 <option v-for="inst in passengerInstances" :key="inst.id" :value="inst.id">
                   {{ inst.id }} · {{ inst.name }}
                 </option>
               </select>
               <div class="flex items-center gap-1.5">
                 <span class="text-[11px] text-fog-500">每次</span>
                 <div class="inline-flex h-7 items-center overflow-hidden rounded-md border border-ink-500 bg-ink-700/60 text-[12px] tabular-nums focus-within:ring-1 focus-within:ring-steel-brand/50">
                   <button class="h-full w-6 text-fog-400 transition hover:bg-amber-brand/10 hover:text-amber-brand disabled:opacity-30"
                     :disabled="(ps.qty ?? cargoByLevel(maxTrainLevel)) <= 1"
                     @click="setPassengerQty(idx, Math.max(1, (ps.qty ?? cargoByLevel(maxTrainLevel)) - 1))">−</button>
                   <input type="text" inputmode="numeric"
                     class="w-10 bg-transparent text-center text-fog-100 outline-none"
                     :value="ps.qty ?? cargoByLevel(maxTrainLevel)"
                     @input="setPassengerQty(idx, Math.max(1, +($event.target as HTMLInputElement).value || 1))"
                     @focus="($event.target as HTMLInputElement).select()" />
                   <button class="h-full w-6 text-fog-400 transition hover:bg-amber-brand/10 hover:text-amber-brand"
                     @click="setPassengerQty(idx, (ps.qty ?? cargoByLevel(maxTrainLevel)) + 1)">+</button>
                 </div>
                 <span class="text-[10px] text-fog-500">件（列车运力 Lv{{ maxTrainLevel }} = {{ cargoByLevel(maxTrainLevel) }}）</span>
               </div>
               <button
                 type="button"
                 class="inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition"
                 :class="ps.unlockCost !== undefined
                   ? (ps.unlockCost > 0 ? 'border-ink-500 bg-ink-700/60 text-fog-400 hover:border-amber-brand hover:text-amber-brand' : 'border-amber-brand/50 bg-amber-brand/15 text-amber-brand')
                   : 'border-steel-brand/50 bg-steel-brand/15 text-steel-brand'"
                 @click="togglePassengerUnlock(idx)"
               >
                 <span class="text-[9px]">{{ ps.unlockCost !== undefined ? '🔒' : '✅' }}</span>
                 {{ ps.unlockCost !== undefined ? '未解锁' : '已解锁' }}
               </button>
               <template v-if="ps.unlockCost !== undefined">
                 <span class="text-[11px] text-fog-500">解锁金</span>
                 <input type="text" inputmode="numeric" class="w-[80px] text-center"
                        :value="ps.unlockCost"
                        @input="setPassengerUnlockCost(idx, +($event.target as HTMLInputElement).value)"
                        @focus="($event.target as HTMLInputElement).select()" />
                 <span class="text-[11px] text-fog-500">$</span>
               </template>
               <div class="flex-1" />
               <button class="text-[11px] text-bad/80 hover:text-bad" @click="removePassengerStation(idx)">删除此站</button>
             </div>
           </div>
         </div>

        <div v-if="level.hasExternalStation === true || (level.externalStationArr?.length ?? 0) > 0" class="mt-3 rounded-md border border-ink-600">
          <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
            <div class="text-xs font-medium text-fog-300">📦 外部物资站点（购买空投材料的运载量为玩家选择的列车，定时周期运送的为当前关卡火车最高等级的运载量）</div>
            <button class="btn !px-2 !py-0.5 text-xs" @click="addStation">+ 添加外部站点</button>
          </div>
          <div v-if="!level.externalStationArr?.length" class="py-3 text-center text-xs text-fog-500">暂无外部站点 — 点「+ 添加外部站点」开始配置</div>
          <div v-else class="px-2 py-2 space-y-2">
            <div
              v-for="(s, i) in level.externalStationArr"
              :key="s.label"
              class="rounded-md border-2 border-dashed border-bad/50 bg-bad/5 p-2 flex flex-wrap items-center gap-1"
            >
              <!-- 标识 -->
              <div class="shrink-0">
                <span class="inline-flex items-center gap-1 rounded bg-bad/20 px-2 py-0.5 text-[11px] font-semibold text-bad">📦 外部站 {{ i + 1 }}</span>
              </div>

              <!-- 物资搜索 + 自定义联想 -->
              <div class="px-2 py-1 shrink-0">
                <div class="relative">
                  <input
                    type="text"
                    class="w-[64px]"
                    :value="stationKeywords[i] ?? store.instById.get(s.resourceId ?? '')?.name ?? ''"
                    placeholder="物资名…"
                    @focus="activeStationSuggest = i; if (stationKeywords[i] === undefined && s.resourceId) stationKeywords[i] = store.instById.get(s.resourceId ?? '')?.name ?? ''"
                    @input="stationKeywords[i] = ($event.target as HTMLInputElement).value; activeStationSuggest = i; stationSuggestCursor[i] = 0"
                    @keydown="onStationSuggestKeydown(i, $event)"
                  />
                  <ul
                    v-if="activeStationSuggest === i && suggestStationResources(i).length"
                    class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
                  >
                    <li
                      v-for="(nm, li) in suggestStationResources(i)"
                      :key="nm"
                      class="cursor-pointer px-2 py-1 text-[11px]"
                      :class="stationSuggestCursor[i] === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80'"
                      @mousedown.prevent="pickStationSuggest(i, nm)"
                    >{{ nm }}</li>
                  </ul>
                </div>
              </div>

              <!-- 实例自定义下拉 -->
              <div class="px-2 py-1 shrink-0">
                <template v-if="store.instById.get(s.resourceId ?? '')">
                  <div class="relative">
                    <button
                      type="button"
                      class="station-inst-trigger flex w-[80px] items-center justify-between rounded border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-left text-[11px] text-fog-200 hover:border-steel-brand"
                      :class="activeStationInst === i ? 'border-steel-brand' : ''"
                      :data-row="i"
                      @click.stop="openStationInst(i)"
                      @keydown="onStationInstKeydown(i, $event)"
                    >
                      <span class="truncate">{{ store.instById.get(s.resourceId ?? '')!.id }}</span>
                      <span class="ml-1 text-fog-500">▾</span>
                    </button>
                    <ul
                      v-if="activeStationInst === i"
                      class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[160px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
                    >
                      <li
                        v-for="(inst, li) in instancesOfName(store.instById.get(s.resourceId ?? '')!.name)"
                        :key="inst.id"
                        class="cursor-pointer px-2 py-1 text-[11px]"
                        :class="[
                          stationInstCursor[i] === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80',
                          inst.id === s.resourceId ? 'font-medium text-fog-100' : ''
                        ]"
                        @mouseenter="stationInstCursor[i] = li"
                        @mousedown.prevent="pickStationInst(i, inst.id)"
                      >{{ inst.id }}<span v-if="inst.external" class="text-fog-500 ml-1 text-[10px]">({{ inst.obtain }})</span></li>
                    </ul>
                  </div>
                </template>
                <span v-else class="text-xs text-fog-500">—</span>
              </div>

              <!-- 类型：按钮组 → 根据物资 name 动态过滤可用 kind -->
              <div class="px-2 py-1 shrink-0">
                <div v-if="store.instById.get(s.resourceId ?? '')" class="grid grid-cols-2 gap-0.5 min-w-[80px]">
                  <div class="flex items-center">
                    <button
                      v-if="availableKindsForStation(s).includes('刷新')"
                      type="button"
                      :disabled="isSingleKindStation(s)"
                      class="inline-flex h-6 w-full items-center justify-center rounded border text-[11px] font-semibold transition disabled:cursor-default"
                      :class="s.kind === STATION_KIND.REFRESH
                        ? 'border-amber-brand/40 bg-amber-brand text-white'
                        : 'border-ink-500 bg-transparent text-fog-300 hover:border-amber-brand hover:text-amber-brand'"
                      @click="updateStation(i, ensureKindDefaults(s, '刷新'))"
                      title="定时刷新（NPC 火车不占用玩家列车）">刷新</button>
                  </div>
                  <div class="flex items-center">
                    <button
                      v-if="availableKindsForStation(s).includes('购买')"
                      type="button"
                      :disabled="isSingleKindStation(s)"
                      class="inline-flex h-6 w-full items-center justify-center rounded border text-[11px] font-semibold transition disabled:cursor-default"
                      :class="s.kind === STATION_KIND.BUY
                        ? 'border-steel-brand/40 bg-steel-brand text-white'
                        : 'border-ink-500 bg-transparent text-fog-300 hover:border-steel-brand hover:text-steel-brand'"
                      @click="updateStation(i, ensureKindDefaults(s, '购买'))"
                      title="空投购买（花钱，需玩家列车运送）">购买</button>
                  </div>
                </div>
                <span v-else class="text-xs text-fog-500">—</span>
              </div>

              <!-- 配置区：按 kind 分支（只有 刷新 / 购买 两种） -->
              <div class="px-2 py-1">
                <!-- 刷新类 -->
                <template v-if="s.kind === STATION_KIND.REFRESH">
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <!-- 开始方式按钮组 -->
                    <div class="flex items-center gap-0.5">
                      <button type="button"
                        class="inline-flex h-7 min-w-[40px] shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold transition"
                        :class="s.refreshStart === REFRESH_START.TIMED
                          ? 'border-transparent bg-amber-brand/15 text-amber-brand'
                          : 'border-ink-500 bg-ink-700/60 text-fog-400 hover:border-ink-400 hover:text-fog-100'"
                        @click="updateStation(i, { refreshStart: 'timed' })"
                        title="关卡开始后延迟指定秒数自动开始刷新">定时</button>
                      <button type="button"
                        class="inline-flex h-7 min-w-[40px] shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold transition"
                        :class="s.refreshStart === REFRESH_START.UNLOCK
                          ? 'border-transparent bg-amber-brand/15 text-amber-brand'
                          : 'border-ink-500 bg-ink-700/60 text-fog-400 hover:border-ink-400 hover:text-fog-100'"
                        @click="updateStation(i, { refreshStart: 'unlock' })"
                        title="花金钱解锁站点后才开始刷新">解锁</button>
                    </div>

                    <!-- timed 模式：开始延迟（分 + 秒） -->
                    <template v-if="s.refreshStart === REFRESH_START.TIMED">
                      <div class="flex items-center gap-1.5">
                        <div class="inline-flex h-7 items-center overflow-hidden rounded-md border border-ink-500 bg-ink-700/60 text-[12px] tabular-nums divide-x divide-ink-600 focus-within:ring-1 focus-within:ring-steel-brand/50">
                          <input type="text" inputmode="numeric" class="w-10 bg-transparent text-center text-fog-100 outline-none"
                            :value="Math.floor((s.startDelay ?? 0) / 60)"
                            @input="updateStation(i, { startDelay: (+($event.target as HTMLInputElement).value || 0) * 60 + ((s.startDelay ?? 0) % 60) })" />
                          <span class="flex items-center px-1.5 text-fog-500">分</span>
                          <input type="text" inputmode="numeric" class="w-10 bg-transparent text-center text-fog-100 outline-none"
                            :value="(s.startDelay ?? 0) % 60"
                            @input="updateStation(i, { startDelay: Math.floor((s.startDelay ?? 0) / 60) * 60 + (+($event.target as HTMLInputElement).value || 0) })" />
                          <span class="flex items-center px-1.5 text-fog-500">秒</span>
                        </div>
                        <span class="text-[11px] text-fog-500">开始</span>
                      </div>
                    </template>

                    <!-- unlock 模式：解锁金钱 -->
                    <template v-else>
                      <div class="inline-flex h-7 items-center gap-1.5 rounded-md border border-ink-500 bg-ink-700/60 px-2 text-[12px] tabular-nums focus-within:ring-1 focus-within:ring-steel-brand/50">
                        <span class="text-fog-500">解锁价</span>
                        <span class="text-fog-400">$</span>
                        <input type="text" inputmode="numeric" class="w-14 bg-transparent text-right text-fog-100 outline-none"
                          :value="s.unlockPrice ?? 0"
                          @input="updateStation(i, { unlockPrice: Math.max(0, +($event.target as HTMLInputElement).value || 0) })" />
                      </div>
                    </template>

                    <!-- 刷新间隔（分 + 秒） -->
                    <div class="flex items-center gap-1.5">
                      <div class="inline-flex h-7 items-center overflow-hidden rounded-md border border-ink-500 bg-ink-700/60 text-[12px] tabular-nums divide-x divide-ink-600 focus-within:ring-1 focus-within:ring-steel-brand/50">
                        <input type="text" inputmode="numeric" class="w-10 bg-transparent text-center text-fog-100 outline-none"
                          :value="Math.floor((s.interval ?? DEFAULT_INTERVAL_SEC) / 60)"
                          @input="updateStation(i, { interval: (+($event.target as HTMLInputElement).value || 0) * 60 + ((s.interval ?? DEFAULT_INTERVAL_SEC) % 60) })" />
                        <span class="flex items-center px-1.5 text-fog-500">分</span>
                        <input type="text" inputmode="numeric" class="w-10 bg-transparent text-center text-fog-100 outline-none"
                          :value="(s.interval ?? DEFAULT_INTERVAL_SEC) % 60"
                          @input="updateStation(i, { interval: Math.floor((s.interval ?? DEFAULT_INTERVAL_SEC) / 60) * 60 + (+($event.target as HTMLInputElement).value || 0) })" />
                        <span class="flex items-center px-1.5 text-fog-500">秒</span>
                      </div>
                      <span class="text-[11px] text-fog-500">刷新</span>
                    </div>
                  </div>
                </template>

                <!-- 购买类 -->
                <template v-else-if="s.kind === STATION_KIND.BUY">
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <!-- 每次购买金钱 -->
                    <div class="flex items-center gap-1.5">
                      <span class="text-[11px] text-fog-500">花费</span>
                      <div class="inline-flex h-7 items-center overflow-hidden rounded-md border border-ink-500 bg-ink-700/60 text-[12px] tabular-nums focus-within:ring-1 focus-within:ring-steel-brand/50">
                        <input type="text" inputmode="decimal" class="w-14 bg-transparent text-right text-fog-100 outline-none"
                          :value="priceDraft[s.label] ?? priceWan(s.price)"
                          @focus="priceDraft[s.label] = String(priceWan(s.price))"
                          @input="priceDraft[s.label] = ($event.target as HTMLInputElement).value"
                          @blur="commitPrice(i, s.label, ($event.target as HTMLInputElement).value)"
                          @keydown.enter="($event.target as HTMLInputElement).blur()" />
                      </div>
                      <span class="text-[11px] text-fog-500">万$/趟</span>
                    </div>
                  </div>
                </template>

                <!-- 客流类 -->
                <template v-else-if="s.kind === STATION_KIND.PASSENGER">
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <!-- 每次客流数量 -->
                    <div class="flex items-center gap-1.5">
                      <span class="text-[11px] text-fog-500">每次</span>
                      <div class="inline-flex h-7 items-center overflow-hidden rounded-md border border-ink-500 bg-ink-700/60 text-[12px] tabular-nums focus-within:ring-1 focus-within:ring-steel-brand/50">
                        <button class="h-full w-6 text-fog-400 transition hover:bg-amber-brand/10 hover:text-amber-brand disabled:opacity-30"
                          :disabled="qtyEach(s) <= 1"
                          @click="updateStation(i, { qty: Math.max(1, qtyEach(s) - 1) })">−</button>
                        <input type="text" inputmode="numeric"
                          class="w-10 bg-transparent text-center text-fog-100 outline-none"
                          :value="qtyEach(s)"
                          @input="updateStation(i, { qty: Math.max(1, +($event.target as HTMLInputElement).value || 1) })"
                          @focus="($event.target as HTMLInputElement).select()" />
                        <button class="h-full w-6 text-fog-400 transition hover:bg-amber-brand/10 hover:text-amber-brand"
                          @click="updateStation(i, { qty: qtyEach(s) + 1 })">+</button>
                      </div>
                    </div>

                    <span class="text-[10px] text-fog-600">乘客运送（不占列车）</span>
                  </div>
                </template>

                <!-- 未选类型时的占位 -->
                <template v-else>
                  <div class="flex items-center gap-1 text-[11px] text-fog-500">
                    先填物资名，再选配方
                  </div>
                </template>
              </div>

              <!-- 🛒 建议提供：当该行物资名存在同名不同实例（生产/拆卸/另一外部）时显示 -->
              <div v-if="suggestNames.has(store.instById.get(s.resourceId ?? '')?.name ?? '')" class="px-2 py-1 shrink-0">
                <div class="flex items-center gap-1">
                  <span class="text-[11px] text-fog-500">🛒 建议提供</span>
                  <input type="text" inputmode="numeric" class="w-[48px] text-center text-[11px]"
                    :value="s.suggestQty ?? ''"
                    placeholder="自动"
                    @input="updateStation(i, { suggestQty: parseInt(($event.target as HTMLInputElement).value, 10) || undefined })" />
                  <span class="text-[11px] text-fog-500">份</span>
                </div>
              </div>

              <!-- 删除 -->
              <div class="ml-auto px-2 py-1 shrink-0">
                <button class="text-[11px] text-bad/80 hover:text-bad whitespace-nowrap" @click="removeStation(i)">删除此站</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 🔗 拆卸工厂站点：在外部物资站点下方 -->
        <div v-if="level.hasMergedProduction === true || (level.coProductionGroups?.length ?? 0) > 0" class="mt-3 rounded-md border border-ink-600">
          <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
            <div class="text-xs font-medium text-fog-300">🔗 拆卸工厂站点（1组配方材料同时生产1组各类材料）</div>
            <button class="btn !px-2 !py-0.5 text-xs" @click="addCpGroup">+ 添加拆卸工厂</button>
          </div>
          <div v-if="!level.coProductionGroups?.length" class="py-3 text-center text-xs text-fog-500">
            暂无拆卸工厂 — 点「+ 添加拆卸工厂」开始配置
          </div>
          <div v-else class="px-2 py-2 space-y-2">
            <div
              v-for="(cp, cpIdx) in level.coProductionGroups"
              :key="cp.id"
              class="rounded-md border-2 border-dashed border-stack-sel/50 bg-stack-sel/5 p-2"
            >
              <!-- 组标题行 -->
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center gap-1 rounded bg-amber-brand/20 px-2 py-0.5 text-[11px] font-semibold text-amber-brand">🔗 拆卸站 {{ cpIdx + 1 }}</span>
                <span class="text-[10px] text-fog-500">配方:</span>
                <span class="flex flex-wrap items-center gap-0.5 text-[11px]">
                  <template v-for="(item, ii) in cpInputItems(cp)" :key="ii">
                    <span v-if="ii > 0" class="mx-0.5 text-fog-500">+</span>
                    <span v-if="item.name === '电力'" class="text-amber-brand">⚡️ 电力</span>
                    <span v-else :class="CATEGORY_TEXT_CLS[item.category] || 'text-fog-200'">{{ item.name }}</span>
                  </template>
                </span>
                <span class="text-[10px] text-fog-500">🛑 建议拆</span>
                <input type="text" inputmode="numeric" class="w-[48px] text-center text-[11px]"
                  :value="cp.maxCycles ?? ''"
                  placeholder="不限"
                  @input="setCpMaxCycles(cpIdx, $event)" />
                <span class="text-[10px] text-fog-500">次</span>
                <span class="flex-1" />
                <button class="text-[11px] text-bad/80 hover:text-bad" @click="removeCpGroup(cpIdx)">删除此站</button>
              </div>

              <!-- 库存上限 -->
              <div class="mb-2 flex flex-wrap items-center gap-3 border-b border-ink-600/50 pb-2">
                <div class="flex items-center gap-1">
                  <span class="text-[10px] text-fog-500">📦 库存上限</span>
                  <input type="text" inputmode="numeric" class="w-[48px] text-center text-[11px]"
                    :value="cp.stockLimit ?? ''"
                    placeholder="不限"
                    @input="updateCpGroup(cpIdx, { stockLimit: Math.max(1, +($event.target as HTMLInputElement).value || 0) || undefined })" />
                  <span class="text-[10px] text-fog-500">件/批</span>
                </div>
                <span v-if="cp.stockLimit" class="text-[10px] text-fog-400">
                  提示：每趟最多处理 {{ cp.stockLimit }} 份材料
                </span>
              </div>

              <!-- 警告：产出实例配方不一致 -->
              <div v-if="cpRecipeMismatch(cp)" class="mb-2 flex items-center gap-1 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn">
                <span>⚠️ 拆卸的配方是一致的，但选择的实例不同。请确保所有产出实例使用同一配方</span>
              </div>

              <!-- 产出实例列表 -->
              <div v-for="(out, oi) in cp.outputs" :key="oi" class="flex flex-wrap items-center gap-2 py-1">
                <span class="w-8 text-[10px] text-fog-500">产出</span>

                <!-- 物资名搜索 -->
                <div class="relative shrink-0">
                  <input
                    type="text"
                    class="w-[64px]"
                    :value="cpKeywords[`${cpIdx}-${oi}`] ?? (out.instanceId ? store.instById.get(out.instanceId)?.name ?? '' : '')"
                    placeholder="物资名…"
                    @focus="activeCpSuggest = `${cpIdx}-${oi}`; if (out.instanceId) cpKeywords[`${cpIdx}-${oi}`] = store.instById.get(out.instanceId)?.name ?? ''"
                    @input="cpKeywords[`${cpIdx}-${oi}`] = ($event.target as HTMLInputElement).value; activeCpSuggest = `${cpIdx}-${oi}`; cpSuggestCursor[`${cpIdx}-${oi}`] = 0"
                    @keydown="onCpSuggestKeydown(cpIdx, oi, $event)"
                  />
                  <ul
                    v-if="activeCpSuggest === `${cpIdx}-${oi}` && cpSuggestions(cpIdx, oi).length"
                    class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
                  >
                    <li
                      v-for="(nm, li) in cpSuggestions(cpIdx, oi)"
                      :key="nm"
                      class="cursor-pointer px-2 py-1 text-[11px]"
                      :class="cpSuggestCursor[`${cpIdx}-${oi}`] === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80'"
                      @mousedown.prevent="pickCpSuggest(cpIdx, oi, nm)"
                    >{{ nm }}</li>
                  </ul>
                </div>

                <!-- 实例切换下拉 -->
                <template v-if="out.instanceId">
                  <div class="relative shrink-0">
                    <button
                      type="button"
                      class="flex w-[80px] items-center justify-between rounded border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-left text-[11px] text-fog-200 hover:border-steel-brand"
                      :class="activeCpInst === `${cpIdx}-${oi}` ? 'border-steel-brand' : ''"
                      @click.stop="openCpInst(cpIdx, oi)"
                    >
                      <span class="truncate">{{ store.instById.get(out.instanceId)?.id ?? '—' }}</span>
                      <span class="ml-1 text-fog-500">▾</span>
                    </button>
                    <ul
                      v-if="activeCpInst === `${cpIdx}-${oi}`"
                      class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[160px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
                    >
                      <li
                        v-for="(inst, li) in cpInstanceOptions(cp, cpIdx).filter((x) => x.name === store.instById.get(out.instanceId)?.name)"
                        :key="inst.id"
                        class="cursor-pointer px-2 py-1 text-[11px] leading-tight"
                        :class="[
                          cpInstCursor[`${cpIdx}-${oi}`] === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80',
                          inst.id === out.instanceId ? 'font-medium text-fog-100' : ''
                        ]"
                        @mouseenter="cpInstCursor[`${cpIdx}-${oi}`] = li"
                        @mousedown.prevent="pickCpInst(cpIdx, oi, inst.id)"
                      >
                        <div class="flex items-center gap-1">
                          <span class="truncate">{{ inst.id }}</span>
                          <span class="shrink-0 rounded border border-ink-500/40 px-1 text-[10px] text-fog-400 whitespace-nowrap">{{ inst.inputs.join('+') }}</span>
                        </div>
                        <div class="mt-0.5 text-[10px] text-fog-500">配方: {{ inst.inputs.join(' + ') }}</div>
                      </li>
                    </ul>
                  </div>
                </template>
                <span v-else class="text-xs text-fog-500">—</span>

                <span class="text-[10px] text-fog-500">每次</span>
                <input type="text" inputmode="numeric" class="w-[48px] text-center text-[11px]" :value="out.perOut" @input="updateCpOutput(cpIdx, oi, { perOut: Math.max(1, +($event.target as HTMLInputElement).value || 1) })" />
                <span class="text-[10px] text-fog-500">件</span>
                <button class="text-[11px] text-bad/60 hover:text-bad" @click="removeCpOutput(cpIdx, oi)">×</button>
              </div>

              <button class="mt-1 text-[11px] text-steel-brand hover:text-steel-brand/80" @click="addCpOutput(cpIdx)">+ 添加产出实例</button>
            </div>
          </div>
        </div>

        <!-- 🧬 多渠道生产组：在拆卸工厂站点下方 -->
        <div v-if="level.hasMultipleInstances || (level.multiChannelGroups?.length ?? 0) > 0" class="mt-3 rounded-md border border-ink-600">
          <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
            <div class="text-xs font-medium text-fog-300">🧬 多渠道生产组（同类型物资多实例配置）</div>
            <button class="btn !px-2 !py-0.5 text-xs" @click="addMcGroup">+ 添加渠道组</button>
          </div>
          <div v-if="!level.multiChannelGroups?.length" class="py-3 text-center text-xs text-fog-500">
            暂无渠道组 — 点「+ 添加渠道组」开始配置
          </div>
          <div v-else class="px-2 py-2 space-y-2">
            <div v-for="(mc, mcIdx) in level.multiChannelGroups" :key="mcIdx"
              class="rounded-md border-2 border-dashed border-steel-brand/50 bg-steel-brand/5 p-2">
              <!-- 组标题行 -->
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center gap-1 rounded bg-steel-brand/20 px-2 py-0.5 text-[11px] font-semibold text-steel-brand">🧬 渠道组 {{ mcIdx + 1 }}</span>
                <span class="text-[10px] text-fog-500">类型:</span>
                <div class="relative">
                  <input type="text" :value="mc.typeName" placeholder="输入物资类型…" class="w-[120px] text-[11px]"
                    @input="onMcTypeInput(mcIdx, ($event.target as HTMLInputElement).value)"
                    @focus="openMcTypeSuggest(mcIdx)"
                    @blur="closeMcTypeSuggest(mcIdx)"
                    @keydown="onMcTypeKeydown(mcIdx, $event)"
                  />
                  <ul v-if="activeMcTypeSuggest === mcIdx && mcTypeSuggestions(mcIdx).length"
                    class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg">
                    <li v-for="(opt, li) in mcTypeSuggestions(mcIdx)" :key="opt"
                      :class="['cursor-pointer px-2 py-1 text-[11px]', mcTypeCursor === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80']"
                      @mousedown.prevent="pickMcType(mcIdx, opt)"
                    >{{ opt }}</li>
                  </ul>
                </div>
                <button class="text-[11px] text-fog-400 hover:text-fog-200 px-1"
                  @click="mcExpanded[mcIdx] = !mcExpanded[mcIdx]"
                  :title="mcExpanded[mcIdx] ? '收起全部实例' : '展开全部实例'">
                  {{ mcExpanded[mcIdx] ? '▲ 收起' : '▼ 展开' }}
                </button>
                <span class="flex-1" />
                <button class="text-[11px] text-bad/80 hover:text-bad" @click="removeMcGroup(mcIdx)">删除此站</button>
              </div>
              <!-- 实例选择列表（配方展示风格与目标录入一致） -->
              <div v-if="mc.typeName" class="space-y-1">
                <div v-for="inst in (mcExpanded[mcIdx] ? mcInstanceOptions(mc.typeName) : mcInstanceOptions(mc.typeName).filter(i => mc.instanceIds.includes(i.id)))" :key="inst.id"
                  class="flex items-center gap-2 py-0.5">
                  <label class="flex items-center justify-between gap-1 cursor-pointer select-none shrink-0 w-28">
                    <span class="text-[11px] text-fog-200 whitespace-nowrap">{{ inst.id }}</span>
                    <input type="checkbox" :checked="mc.instanceIds.includes(inst.id)"
                      @change="toggleMcInstance(mcIdx, inst.id)" class="accent-steel-brand" />
                  </label>
                  <div class="flex items-center gap-x-1 gap-y-0.5 rounded border border-ink-600 bg-ink-800/60 px-1.5 py-1 text-[11px] leading-tight flex-1 min-w-0">
                    <template v-if="inst.inputs.length">
                      <span v-for="([nm, cnt], ri) in recipeInputCounts(inst)" :key="ri"
                        class="rounded px-1 font-medium whitespace-nowrap"
                        :class="classifyName(nm, store.data) === 'raw' ? 'bg-good/15 text-good' :
                          classifyName(nm, store.data) === 'processed' ? 'bg-steel-brand/15 text-steel-brand' :
                          classifyName(nm, store.data) === 'compound' ? 'bg-amber-brand/15 text-amber-brand' : 'text-fog-100'">
                        {{ nm }}<span v-if="cnt > 1">×{{ cnt }}</span>
                      </span>
                      <span v-if="inst.needsPower" class="text-amber-brand" title="通电">⚡️</span>
                      <span class="text-fog-500 mx-0.5">→</span>
                      <span class="rounded px-1 font-medium"
                        :class="classifyName(inst.name, store.data) === 'raw' ? 'bg-good/15 text-good' :
                          classifyName(inst.name, store.data) === 'processed' ? 'bg-steel-brand/15 text-steel-brand' :
                          classifyName(inst.name, store.data) === 'compound' ? 'bg-amber-brand/15 text-amber-brand' : 'text-fog-100'">
                        {{ inst.name }}
                      </span>
                    </template>
                    <template v-else>
                      <span class="rounded bg-amber-brand/15 px-1.5 py-0.5 text-amber-brand" v-if="inst.needsPower">⚡️ 通电自动 {{ inst.name }}</span>
                      <span v-else class="flex items-center gap-1">
                        <span class="rounded bg-fog-600/30 px-1 text-fog-300">{{ inst.obtain }}</span>
                        <span class="text-fog-400">·</span>
                        <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ inst.name }}</span>
                      </span>
                    </template>
                  </div>
                </div>
                <div v-if="!mcInstanceOptions(mc.typeName).length" class="text-[11px] text-fog-500 py-1">
                  该类型无可选实例
                </div>
                <div v-else-if="!mcExpanded[mcIdx] && !mc.instanceIds.length" class="text-[11px] text-fog-500 py-1">
                  暂无已选实例 — 点击「▼ 展开」选择
                </div>
              </div>
              <div v-else class="text-[11px] text-fog-500 py-1">
                请先输入物资类型
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="panel-title mb-0"><AppIcon name="target" :size="15" class="mr-1 text-amber-brand" />最终需求 → 基础物资拆解</h2>
          <span class="flex-1" />
          <label class="flex items-center gap-1.5 text-xs text-fog-400">多实例取舍：
            <select v-model="choice">
              <option value="fewestInputs">配方输入最少</option>
              <option value="smallestPerCycle">单周期产出最小</option>
              <option value="first">表内顺序第一</option>
            </select>
          </label>
        </div>

        <!-- 🎯 最终基础原料：inline 第二行，跟 panel 第一行 mt-2 紧接，无额外空白 -->
        <div class="mt-2 flex min-h-[24px] flex-wrap items-center gap-1">
          <template v-if="result">
            <!-- 👷 工人数量徽章（如果有） -->
            <div v-if="result.workerNeeds > 0" class="inline-flex items-center gap-1 rounded border border-fog-600/60 bg-fog-700/30 px-1.5 py-0.5 text-[11px]">
              <AppIcon name="worker" :size="11" class="text-fog-300" />
              <span class="text-fog-300">👷 工人</span>
              <span class="font-bold text-fog-100 tabular-nums">{{ result.workerNeeds }}</span>
              <span class="text-fog-500">（无限）</span>
            </div>

            <template v-if="result.rawNeeds.length">
              <div class="flex flex-wrap gap-1">
                <div v-for="r in result.rawNeeds" :key="r.name" class="inline-flex shrink-0 items-center gap-0.5 rounded border border-good/30 bg-good/5 px-1.5 py-0.5 text-[11px]">
                  <ResLabel :name="r.name" />
                  <span class="font-bold text-amber-brand tabular-nums">{{ r.qty }}</span>
                </div>
              </div>
            </template>
            <span v-else class="text-[11px] text-fog-400">全部目标由工人直供，无额外原料</span>
          </template>
          <span v-else class="text-[11px] text-fog-500">请先添加目标 — 这里会自动拆解出最终基础原料</span>
        </div>

        <!-- 🔀 渠道分配预览（只读）：同时存在拆卸渠道与非拆卸渠道的物资 -->
        <div class="mt-3" v-if="channelAllocations.length">
          <div class="rounded-md border border-ink-600 bg-ink-700/40 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-steel-brand">🔀 渠道分配预览</h3>
              <span class="text-[11px] text-fog-400/70">（只读：拆卸组按「建议拆 N 次」封顶后，剩余需求流向非拆卸渠道）</span>
              <span class="inline-flex items-center gap-1 text-[10px] text-fog-400"><span class="inline-block h-2 w-3 rounded-sm bg-amber-brand"></span>拆卸渠道</span>
              <span class="inline-flex items-center gap-1 text-[10px] text-fog-400"><span class="inline-block h-2 w-3 rounded-sm bg-steel-brand"></span>非拆卸渠道</span>
            </div>
            <div class="mt-2 flex flex-col gap-2">
              <div v-for="alloc in channelAllocations" :key="alloc.name" class="flex items-center gap-2">
                <span class="w-[72px] shrink-0 text-[11px] text-fog-200"><ResLabel :name="alloc.name" /></span>
                <div class="flex h-6 flex-1 overflow-hidden rounded border border-ink-600">
                  <div
                    v-for="seg in alloc.segments" :key="seg.instanceId"
                    class="flex items-center justify-center gap-1 overflow-hidden whitespace-nowrap px-1.5 text-[10px] font-medium text-ink-900"
                    :class="seg.isCp ? 'bg-amber-brand' : 'bg-steel-brand'"
                    :style="{ flexGrow: seg.qty, flexBasis: 0, minWidth: '46px' }"
                    :title="`${seg.isCp ? '拆卸' : '非拆卸'}渠道 ${seg.instanceId}：${seg.qty}`">
                    <span class="truncate">{{ seg.instanceId }}</span>
                    <span class="shrink-0 font-bold tabular-nums">{{ seg.qty }}</span>
                  </div>
                </div>
                <span class="w-[56px] shrink-0 text-right text-[11px] text-fog-400">合计 {{ alloc.total }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 📊 多方案对比：最终需求下方，概览上方 -->
        <div class="mt-3" v-if="showStrategyComparison">
          <div class="rounded-md border border-ink-600 bg-ink-700/40 p-3">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-sm font-semibold text-amber-brand">📊 多方案对比</h3>
              <span v-if="strategyHint" class="text-[11px] text-fog-400/70">({{ strategyHint }})</span>
              <span class="flex-1" />
              <span class="text-[11px] text-fog-400">切换策略查看不同生产方案</span>
            </div>

            <!-- Tab bar -->
            <div class="mt-2 flex flex-wrap gap-1 border-b border-ink-600 pb-1.5">
              <button
                v-for="s in strategyResults" :key="s.key"
                class="rounded px-2.5 py-1 text-xs transition-colors cursor-pointer"
                :class="activeStrategy === s.strategy
                  ? 'bg-amber-brand/15 text-amber-brand border border-amber-brand/30'
                  : 'text-fog-400 hover:text-fog-200 border border-transparent hover:border-ink-500'"
                @click="activeStrategy = s.strategy"
              >{{ s.label }}</button>
            </div>

            <!-- 横向对比：所有策略的原料、工人、溢出 一行展示 -->
            <div class="mt-2 grid grid-cols-5 gap-1.5">
              <div v-for="s in strategyResults" :key="s.key"
                class="rounded border px-2 py-1.5 text-center transition-colors"
                :class="activeStrategy === s.strategy
                  ? 'border-amber-brand/40 bg-amber-brand/5'
                  : 'border-ink-600 bg-ink-700/30'"
              >
                <div class="text-[10px] text-fog-400 leading-tight">{{ s.label.replace(/^[①②③④⑤]\s*/, '') }}</div>
                <div class="mt-1 flex flex-col gap-0.5">
                  <div>
                    <span class="text-[10px] text-fog-500">原料·</span>
                    <span class="text-xs font-bold text-fog-100 tabular-nums">{{ s.result.rawNeeds.length }}</span>
                    <span class="text-[10px] text-fog-500">种</span>
                  </div>
                  <div>
                    <span class="text-[10px] text-fog-500">合计·</span>
                    <span class="text-xs font-bold text-amber-brand tabular-nums">{{ totalRawQty(s.result) }}</span>
                  </div>
                  <div>
                    <span class="text-[10px] text-fog-500">工人·</span>
                    <span class="text-xs font-bold text-fog-100 tabular-nums">{{ s.result.workerNeeds }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 各策略基础原料明细 -->
            <div class="mt-2 flex flex-wrap gap-1">
              <div v-for="s in strategyResults" :key="s.key"
                class="rounded border px-1.5 py-1 text-[11px] transition-colors"
                :class="activeStrategy === s.strategy
                  ? 'border-amber-brand/40 bg-amber-brand/5'
                  : 'border-ink-600 bg-ink-700/30'"
              >
                <div class="text-[10px] text-fog-400 mb-0.5">{{ s.label }}</div>
                <template v-if="s.result.rawNeeds.length">
                  <div v-for="r in s.result.rawNeeds" :key="s.key + '-' + r.name" class="inline-flex items-center gap-0.5 mr-1">
                    <ResLabel :name="r.name" />
                    <span class="font-bold text-amber-brand tabular-nums">{{ r.qty }}</span>
                  </div>
                </template>
                <span v-else class="text-fog-500">无原料</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ⚠️ 剩余多渠道提醒：拆卸工厂后，仍有同类型多实例需确认 -->
        <div class="mt-2" v-if="remainingMultiChannel && remainingMultiChannel.length > 0">
          <div class="rounded-md border border-warn/30 bg-warn/5 px-3 py-2">
            <div class="flex items-center gap-1.5 text-[12px]">
              <span class="text-warn">⚠️</span>
              <span class="font-medium text-fog-200">剩余需求中存在多渠道物资，请确认配方</span>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-3">
              <div v-for="g in remainingMultiChannel" :key="g.name" class="flex items-baseline gap-1.5 text-[11px]">
                <span class="font-bold text-fog-100 shrink-0">{{ g.name }}</span>
                <span class="text-fog-400">→</span>
                <span v-for="inst in g.instances" :key="inst.id" class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] border border-amber-brand/30 bg-amber-brand/5 text-amber-brand">
                  <span>{{ inst.id }}</span>
                  <span class="text-fog-400/60">({{ inst.inputs }})</span>
                </span>
              </div>
            </div>
            <div class="mt-1 text-[10px] text-fog-400/60">
              当前已自动选择「配方输入最少」方案
            </div>
          </div>
        </div>

        <!-- 📊 概览：始终显示，无数据时显示 0 -->
        <div class="mt-2">
          <h3 class="mb-1.5 text-sm font-semibold text-fog-300">📊 概览</h3>
          <div class="grid grid-cols-5 gap-2">
            <div class="rounded-md border border-ink-600 bg-ink-700/30 px-3 py-2 text-center">
              <div class="text-lg font-bold text-amber-brand">{{ result?.rawNeeds.length ?? 0 }}</div>
              <div class="text-[10px] text-fog-400 uppercase tracking-wider">原料种类</div>
            </div>
            <div class="rounded-md border border-ink-600 bg-ink-700/30 px-3 py-2 text-center">
              <div class="text-lg font-bold text-fog-100">{{ result?.workerNeeds ?? 0 }}</div>
              <div class="text-[10px] text-fog-400 uppercase tracking-wider">工人总数</div>
            </div>
            <div class="rounded-md border border-ink-600 bg-ink-700/30 px-3 py-2 text-center">
              <div class="text-lg font-bold text-steel-brand">{{ effectiveExternalNeeds.length }}</div>
              <div class="text-[10px] text-fog-400 uppercase tracking-wider">外部获取</div>
            </div>
            <div class="rounded-md border border-ink-600 bg-ink-700/30 px-3 py-2 text-center">
              <div class="text-lg font-bold text-fog-100">{{ result?.productionLoad.length ?? 0 }}</div>
              <div class="text-[10px] text-fog-400 uppercase tracking-wider">生产站点</div>
            </div>
            <div class="rounded-md border border-ink-600 bg-ink-700/30 px-3 py-2 text-center">
              <div class="text-lg font-bold text-amber-brand">{{ result?.powerNeeds.length ?? 0 }}</div>
              <div class="text-[10px] text-fog-400 uppercase tracking-wider">需通电</div>
            </div>
          </div>
        </div>

        <!-- 📝 目标录入：始终显示，实时直接保存 -->
        <div class="mt-3 rounded-md border border-ink-600 bg-ink-700/40 p-3">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-semibold text-amber-brand">📝 目标录入</h3>
            <span class="flex-1" />
            <button class="btn" @click="goalEditorRef?.add()">
              <AppIcon name="plus" :size="12" class="inline align-[-0.1em]" /> 添加目标
            </button>
            <button
              v-if="workerStationLabels.length >= 2"
              class="btn"
              :class="'border-amber-brand/50 text-amber-brand hover:bg-amber-brand/10'"
              @click="goalEditorRef?.addShared()"
              title="新增公共目标 — 所有站点共享，总量合并统计"
            >
              🤝 公共目标
            </button>
            <span v-if="store.lastSaved" class="text-xs text-fog-500">
              已自动保存 · {{ new Date(store.lastSaved).toLocaleTimeString() }}
            </span>
          </div>
          <GoalEditor
            ref="goalEditorRef"
            :goals="goals.map((g) => ({ ...g }))"
            :station-labels="workerStationLabels"
            :local-instances="localInstances"
            :local-overrides="level?.instanceOverrides"
            :worker-stations="effectiveWorkerStations"
            :multi-channel-groups="level?.multiChannelGroups"
            :co-production-groups="level?.coProductionGroups"
            @update="onGoalsUpdate($event)"
            @update:worker-stations="onWorkerStationsUpdate"
          />
        </div>

        <!-- ⚠️ warnings 琥珀色 + ✅ resolved 绿色 -->
        <template v-if="result">
          <!-- ① 多实例未指定：琥珀色警告，需用户行动 -->
          <div v-if="result.warnings.length" class="mt-3 rounded-md border border-warn/60 bg-warn/10 p-2.5 text-xs">
            <div v-for="(w, wi) in result.warnings" :key="'w'+wi" class="flex items-center gap-1.5 py-0.5 leading-tight">
              <AppIcon name="warning" :size="13" class="shrink-0 text-warn" />
              <span class="text-warn shrink-0">{{ w.message }}</span>
              <template v-if="w.instance">
                <span class="text-fog-500 shrink-0">·</span>
                <span class="flex items-center gap-x-1 gap-y-0.5 min-w-0 flex-wrap">
                  <template v-if="w.instance.inputs.length">
                    <span v-if="w.instance.needsPower" class="rounded bg-amber-brand/15 px-1 text-amber-brand">⚡️</span>
                    <template v-for="([nm, cnt], idx) in recipeInputCounts(w.instance)" :key="nm">
                      <span class="rounded bg-ink-600/80 px-1 text-fog-100">{{ nm }}<template v-if="cnt > 1">×{{ cnt }}</template></span>
                      <span v-if="idx < recipeInputCounts(w.instance).length - 1" class="text-fog-500">+</span>
                    </template>
                    <span class="text-fog-400">→</span>
                    <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ w.instance.name }}<template v-if="(w.instance.perOut ?? 1) > 1"> ×{{ w.instance.perOut }}</template></span>
                  </template>
                  <template v-else-if="w.instance.external">
                    <span v-if="w.instance.needsPower" class="rounded bg-amber-brand/15 px-1 text-amber-brand">⚡️</span>
                    <span class="rounded bg-fog-600/30 px-1 text-fog-300">{{ w.instance.obtain ?? '外部' }}</span>
                    <span class="text-fog-400">·</span>
                    <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ w.instance.name }}<template v-if="(w.instance.perOut ?? 1) > 1"> ×{{ w.instance.perOut }}</template></span>
                  </template>
                  <template v-else>
                    <span class="rounded bg-amber-brand/15 px-1.5 py-0.5 text-amber-brand">⚡️ 通电自动 {{ w.instance.name }}<template v-if="(w.instance.perOut ?? 1) > 1"> ×{{ w.instance.perOut }}</template></span>
                  </template>
                </span>
                <template v-if="w.alternatives?.length">
                  <div class="relative shrink-0">
                    <button
                      type="button"
                      class="flex items-center gap-0.5 rounded border border-ink-500 bg-ink-800 px-2 py-0.5 text-[11px] text-fog-300 transition hover:border-steel-brand hover:text-steel-brand"
                      @click.stop="openOverrideIdx = openOverrideIdx === 'w'+wi ? '' : 'w'+wi"
                    >选实例 ▾</button>
                    <ul
                      v-if="openOverrideIdx === 'w'+wi"
                      class="absolute left-0 top-full z-20 mt-0.5 min-w-[280px] max-h-[220px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
                      @mousedown.stop
                    >
                      <li
                        v-for="opt in alternativesInstances(w.alternatives)"
                        :key="opt.id"
                        class="cursor-pointer px-2 py-1 text-[11px] hover:bg-ink-600/80"
                        :class="opt.id === w.instance!.id ? 'bg-ink-600 text-amber-brand' : 'text-fog-200'"
                        @mousedown.prevent="applyOverride(opt.name, opt.id)"
                      >
                        <span class="font-medium">{{ opt.id }}</span>
                        <span class="text-fog-500"> · {{ opt.name }}</span>
                        <span v-if="opt.needsPower" class="ml-0.5 inline-flex shrink-0 items-center rounded bg-amber-brand/15 px-1 text-amber-brand" title="生产需通电">⚡️</span>
                        <span class="text-fog-400"> · {{ recipeText(opt) }}</span>
                      </li>
                    </ul>
                  </div>
                </template>
              </template>
            </div>
          </div>

          <!-- ② 已自动选 / 已确认：绿色 good token，每行也可以改 -->
          <div v-if="result.resolved.length" class="mt-2 rounded-md border border-good/50 bg-good/8 p-2.5 text-xs">
            <div v-for="(r, ri) in result.resolved" :key="'r'+ri" class="flex items-center gap-1.5 py-0.5 leading-tight">
              <AppIcon name="check" :size="13" class="shrink-0 text-good" />
              <span class="text-good shrink-0">{{ r.message }}</span>
              <template v-if="r.instance">
                <span class="text-fog-500 shrink-0">·</span>
                <span class="flex items-center gap-x-1 gap-y-0.5 min-w-0 flex-wrap">
                  <template v-if="r.instance.inputs.length">
                    <span v-if="r.instance.needsPower" class="rounded bg-amber-brand/15 px-1 text-amber-brand">⚡️</span>
                    <template v-for="([nm, cnt], idx) in recipeInputCounts(r.instance)" :key="nm">
                      <span class="rounded bg-ink-600/80 px-1 text-fog-100">{{ nm }}<template v-if="cnt > 1">×{{ cnt }}</template></span>
                      <span v-if="idx < recipeInputCounts(r.instance).length - 1" class="text-fog-500">+</span>
                    </template>
                    <span class="text-fog-400">→</span>
                    <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ r.instance.name }}<template v-if="(r.instance.perOut ?? 1) > 1"> ×{{ r.instance.perOut }}</template></span>
                  </template>
                  <template v-else-if="r.instance.external">
                    <span v-if="r.instance.needsPower" class="rounded bg-amber-brand/15 px-1 text-amber-brand">⚡️</span>
                    <span class="rounded bg-fog-600/30 px-1 text-fog-300">{{ r.instance.obtain ?? '外部' }}</span>
                    <span class="text-fog-400">·</span>
                    <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ r.instance.name }}<template v-if="(r.instance.perOut ?? 1) > 1"> ×{{ r.instance.perOut }}</template></span>
                  </template>
                  <template v-else>
                    <span class="rounded bg-amber-brand/15 px-1.5 py-0.5 text-amber-brand">⚡️ 通电自动 {{ r.instance.name }}<template v-if="(r.instance.perOut ?? 1) > 1"> ×{{ r.instance.perOut }}</template></span>
                  </template>
                </span>
                <!-- 绿色面板里也可以改实例（选完写 override，引擎重新拆解） -->
                <template v-if="r.alternatives?.length">
                  <div class="relative shrink-0">
                    <button
                      type="button"
                      class="flex items-center gap-0.5 rounded border border-ink-500 bg-ink-800 px-2 py-0.5 text-[11px] text-fog-300 transition hover:border-steel-brand hover:text-steel-brand"
                      @click.stop="openOverrideIdx = openOverrideIdx === 'r'+ri ? '' : 'r'+ri"
                    >更改 ▾</button>
                    <ul
                      v-if="openOverrideIdx === 'r'+ri"
                      class="absolute left-0 top-full z-20 mt-0.5 min-w-[280px] max-h-[220px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
                      @mousedown.stop
                    >
                      <li
                        v-for="opt in alternativesInstances(r.alternatives)"
                        :key="opt.id"
                        class="cursor-pointer px-2 py-1 text-[11px] hover:bg-ink-600/80"
                        :class="opt.id === r.instance!.id ? 'bg-ink-600 text-good' : 'text-fog-200'"
                        @mousedown.prevent="applyOverride(opt.name, opt.id)"
                      >
                        <span class="font-medium">{{ opt.id }}</span>
                        <span class="text-fog-500"> · {{ opt.name }}</span>
                        <span v-if="opt.needsPower" class="ml-0.5 inline-flex shrink-0 items-center rounded bg-amber-brand/15 px-1 text-amber-brand" title="生产需通电">⚡️</span>
                        <span class="text-fog-400"> · {{ recipeText(opt) }}</span>
                      </li>
                    </ul>
                  </div>
                </template>
              </template>
            </div>
          </div>

          <!-- ⏱ 最快通关时间预估（只有外部物资站点覆盖了基础物资时才显示） -->
          <div v-if="estimatedBestTime" class="mt-3 rounded-md border border-steel-brand/40 bg-steel-brand/8 px-3 py-2">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="text-xs text-steel-brand">⏱ 最快通关预估</span>
              <span class="text-lg font-bold text-steel-brand tabular-nums">{{ fmtSeconds(estimatedBestTime.seconds) }}</span>
              <span v-if="level.seconds" class="text-[11px] text-fog-500">
                限时 {{ fmtSeconds(level.seconds) }} · 最佳 {{ level.bestTime }}
                <span v-if="estimatedBestTime.seconds > (level.seconds ?? 0)" class="ml-1 text-bad">（超出限时）</span>
              </span>
            </div>
            <div class="mt-1 flex flex-col gap-0.5 text-[11px] text-fog-400">
              <div v-for="r in estimatedBestTime.perResource" :key="r.name" class="flex items-baseline gap-1">
                <span :class="r.total === estimatedBestTime!.seconds ? 'text-amber-brand font-medium' : ''">
                  {{ r.name }} ×{{ r.qty }} = {{ r.trips }}趟 · 首车{{ fmtSeconds(r.delay) }} + {{ r.interval }}秒×{{ r.trips - 1 || 0 }}
                  <span class="tabular-nums">= {{ fmtSeconds(r.total) }}</span>
                </span>
              </div>
            </div>
          </div>

          <h3 class="mb-2 mt-4 text-sm font-semibold text-amber-brand">外部获取清单（外部物资站点未覆盖的基础原料 · 刷新/购买均可无限获取）</h3>
          <div class="overflow-hidden rounded-md border border-ink-600">
            <table class="w-full text-[13px]">
              <thead>
                <tr class="bg-ink-700/40 text-left text-[11px] uppercase tracking-wider text-fog-400">
                  <th class="px-3 py-1.5 font-medium">物资</th>
                  <th class="px-3 py-1.5 font-medium">方式</th>
                  <th class="px-3 py-1.5 font-medium text-right">每次数量</th>
                  <th class="px-3 py-1.5 font-medium">间隔 / 金钱</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="n in effectiveExternalNeeds" :key="n.name" class="border-t border-ink-600/60 hover:bg-ink-700/20 transition-colors">
                  <td class="px-3 py-1.5"><ResLabel :name="n.name" /></td>
                  <td class="px-3 py-1.5 text-fog-400">{{ resolveExternalSupply(n.name, n.obtain).kind }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums text-steel-brand">
                    {{
                      (() => {
                        const si = resolveExternalSupply(n.name, n.obtain);
                        return si.kind === STATION_KIND.BUY && si.minQty !== undefined && si.maxQty !== undefined
                          ? `${si.minQty}-${si.maxQty}`
                          : si.qtyEach;
                      })()
                    }}
                  </td>
                  <td class="px-3 py-1.5 text-fog-400">
                    {{
                      (() => {
                        const si = resolveExternalSupply(n.name, n.obtain);
                        if (si.kind === STATION_KIND.BUY) return `每次 ${si.price ?? 0} 金钱`;
                        return fmtMinSec(si.intervalSec);
                      })()
                    }}
                  </td>
                </tr>
                <tr v-if="!effectiveExternalNeeds.length"><td colspan="4" class="px-3 py-3 text-center text-xs text-fog-500">全部可由生产链或外部物资站点覆盖，无需外部购买/刷新</td></tr>
              </tbody>
            </table>
          </div>

          <h3 class="mb-2 mt-5 text-sm font-semibold text-amber-brand">需通电的站点（发电自身消耗物资，但取决于通电时长，不计入总需求）</h3>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="p in result.powerNeeds" :key="p" class="inline-flex items-center gap-1 rounded border border-amber-brand/40 bg-amber-brand/10 px-2 py-0.5 text-xs text-amber-brand">
              <AppIcon name="power" :size="12" /> {{ p }}
            </span>
            <span v-if="!result.powerNeeds.length" class="text-xs text-fog-500">本链无需电力站点</span>
          </div>

          <h3 class="mb-2 mt-5 text-sm font-semibold text-amber-brand">完整拆解树（查看每一步的生产链）</h3>
          <ul class="text-[13px]">
            <TreeNode v-for="(n, i) in roots" :key="`${n.name}-${i}`" :node="n" :station-info="stationInfoByName" />
          </ul>
        </template>
      </div>
    </div>
  </div>
</template>
