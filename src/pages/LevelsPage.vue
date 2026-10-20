<script setup lang="ts">
/** 关卡速查 / 物资拆解（本体 50 关优先，可切换查看全部） */
import { OBTAIN, STATION_KIND, FILTER_ALL, STRATEGY_CARD } from '@/constants';
import { computed, onMounted, ref, reactive, watch, watchEffect, nextTick } from 'vue';
import { RECIPE_CHOICE, BREAKDOWN_STRATEGY } from '@/engine/breakdown';
import type { RecipeChoice, BreakdownStrategy } from '@/engine/breakdown';
import type { ExternalStation, LevelGoal, ResourceInstance, WorkerStation } from '@/types';
import { POWER_NAME, WORKER_NAME } from '@/types';
import { useGameStore } from '@/stores/game';
import { useLevelCalc } from '@/composables/useLevelCalc';
import { CONTENT_CATEGORY_LABEL, fmtMinSec, fmtSeconds, starConditionText } from '@/utils/format';
import { recipeText } from '@/utils/recipe';
import {
  buildStationInfoByName,
  collectEffectiveExternalNeeds,
  collectUsedInstanceIds,
  deriveEffectiveWorkerStations,
  deriveWorkerStationLabels,
  detectMultiChannelGroups,
  estimateBestTime,
  isValidQty,
  stationQtyEach,
} from '@/domain/level';
import type { StationContext, StationInfo } from '@/domain/level';
import { earnTargetOf } from '@/domain/earn';
import {
  cargoOfLevel,
  initMinTrainLevel,
  maxTrainLevelFromCount,
  maxTrainLevelOf,
  resolveMaxTrainLevel,
  upgradeCountMaxOf,
  upgradeCountOf,
  upgradeLevelOptionsOf,
} from '@/domain/train';
import AppIcon from '@/components/AppIcon.vue';
import ResLabel from '@/components/ResLabel.vue';
import TreeNode from '@/components/TreeNode.vue';
import GoalEditor from '@/components/GoalEditor.vue';
import PassengerStationPanel from '@/components/level-editor/PassengerStationPanel.vue';
import ResourceStationPanel from '@/components/level-editor/ResourceStationPanel.vue';
import MultiChannelPanel from '@/components/level-editor/MultiChannelPanel.vue';
import CoProductionPanel from '@/components/level-editor/CoProductionPanel.vue';
import ExternalStationPanel from '@/components/level-editor/ExternalStationPanel.vue';
import EarnPanel from '@/components/level-editor/EarnPanel.vue';

const store = useGameStore();
const goalEditorRef = ref<InstanceType<typeof GoalEditor> | null>(null);
const passengerPanelRef = ref<InstanceType<typeof PassengerStationPanel> | null>(null);
const resourcePanelRef = ref<InstanceType<typeof ResourceStationPanel> | null>(null);
const multiChannelPanelRef = ref<InstanceType<typeof MultiChannelPanel> | null>(null);
const coProductionPanelRef = ref<InstanceType<typeof CoProductionPanel> | null>(null);
const externalPanelRef = ref<InstanceType<typeof ExternalStationPanel> | null>(null);

const pickedId = ref('');
const choice = ref<RecipeChoice>(RECIPE_CHOICE.FEWEST_INPUTS);

/** 拆解策略（用于多方案对比） */
const activeStrategy = ref<BreakdownStrategy>(BREAKDOWN_STRATEGY.NORMAL);

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
  document.addEventListener('mousedown', () => externalPanelRef.value?.closePopups());
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
  activeStrategy.value = BREAKDOWN_STRATEGY.NORMAL;
  const oldPower = lv.instanceOverrides?.[POWER_NAME];
  if (oldPower && !lv.powerSources?.length) {
    const cleaned: Record<string, string> = { ...(lv.instanceOverrides ?? {}) };
    delete cleaned[POWER_NAME];
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
 * 关卡列表键盘导航：↑ / ↓ 在当前可见列表内切换上一关 / 下一关。
 * 监听器挂在列表容器上（@keydown），因此只在焦点位于关卡列表内时才生效，
 * 不会冒泡到别处，也不影响目标录入区里实例下拉自己的 ↑↓ 选择。
 * - 当前选中项不在可见列表（被搜索 / 筛选过滤掉）时：↓ 从列表首项进入、↑ 从末项进入
 * - 已在列表两端时不做任何事，也不吃掉按键
 */
function onLevelListKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const list = filtered.value;
  if (!list.length) return;
  const down = e.key === 'ArrowDown';
  const cur = list.findIndex((l) => l.id === selectedId.value);
  const next = cur === -1 ? (down ? 0 : list.length - 1) : cur + (down ? 1 : -1);
  if (next < 0 || next >= list.length) return;
  e.preventDefault();
  pickedId.value = list[next].id;
}

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

/** 自动检测多渠道生产组：当目标中出现同名多实例时，自动创建多渠道组（派生逻辑见 domain/level.ts） */
function autoDetectMcGroups(g: LevelGoal[]) {
  if (!level.value) return;
  const { groups, addedIndexes } = detectMultiChannelGroups(level.value, g, store.instById, store.data.instances);
  if (!addedIndexes.length) return;
  for (const idx of addedIndexes) mcExpanded[idx] = true;
  patchLevel({ multiChannelGroups: groups, hasMultipleInstances: true });
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

// ————————— 需求量计算编排（实现见 composables/useLevelCalc.ts）—————————
// 引擎参数装配 / 多方案对比 / 渠道分配预览整块抽离，页面只保留输入与消费
const {
  suggestNames,
  localInstances,
  result,
  strategyResults,
  remainingMultiChannel,
  roots,
  channelAllocations,
  totalRawQty,
} = useLevelCalc({
  level,
  goals,
  data: computed(() => store.data),
  instById: computed(() => store.instById),
  choice,
  activeStrategy,
});

/** 站点货运量计算上下文（供 domain 派生函数使用） */
const stationQtyCtx = computed<StationContext>(() => ({
  cargoByLevel,
  minTrainLevel: minTrainLevel.value,
  maxTrainLevel: maxTrainLevel.value,
  defaultIntervalSec: DEFAULT_INTERVAL_SEC,
}));

/** 外部物资站点 → 按 name 索引的配置（用于外部获取清单和拆解树显示，派生逻辑见 domain/level.ts） */
const stationInfoByName = computed(() => buildStationInfoByName(level.value, store.instById, stationQtyCtx.value));

/** 获取某个物资的外部供给配置：先查外部物资站点，没有则用默认值 */
function resolveExternalSupply(name: string, obtain: string): StationInfo {
  const fromStation = stationInfoByName.value.get(name);
  if (fromStation) return fromStation;
  // 关卡没配站点，用默认值
  return {
    qtyEach: cargoByLevel(maxTrainLevel.value),
    intervalSec: obtain === OBTAIN.REFRESH ? DEFAULT_INTERVAL_SEC : 0,
    kind: obtain === OBTAIN.REFRESH ? STATION_KIND.REFRESH : (obtain === OBTAIN.PASSENGER ? STATION_KIND.PASSENGER : (obtain === OBTAIN.STOCK ? STATION_KIND.STOCK : STATION_KIND.BUY)),
  };
}

/** 外部获取清单：引擎算的 externalNeeds + 外部物资站点里的刷新/购买（派生逻辑见 domain/level.ts） */
const effectiveExternalNeeds = computed(() =>
  collectEffectiveExternalNeeds(result.value?.externalNeeds, level.value, store.instById),
);

/** 工人站点标签列表：给 GoalEditor 用（派生逻辑见 domain/level.ts） */
const workerStationLabels = computed(() => deriveWorkerStationLabels(level.value, goals.value));

/** 挣钱目标值（>0 时显示挣钱测算区块；派生逻辑见 domain/earn.ts） */
const earnTarget = computed(() => earnTargetOf(level.value));

/** 是否展示多方案对比面板（按需求关闭；恢复时改回 strategyResults.value.length > 0） */
const showStrategyComparison = computed(() => {
  return false;
});

/** 多方案对比提示文字：根据策略列表推断当前原因 */
const strategyHint = computed(() => {
  const keys = strategyResults.value.map((s) => s.key);
  if (keys.length === 0) return '';
  if (keys.includes(STRATEGY_CARD.MIN_WASTE) && keys.includes(STRATEGY_CARD.FEWEST_INPUTS)) {
    return '该关卡存在拆卸工厂和同类物资多个配方';
  }
  if (keys.includes(STRATEGY_CARD.FEWEST_INPUTS) || keys.includes(STRATEGY_CARD.MOST_INPUTS)) {
    return '该关卡存在同类物资多个配方';
  }
  if (keys.includes(STRATEGY_CARD.MIN_WASTE)) {
    return '该关卡存在拆卸工厂';
  }
  return '';
});

// 当多方案策略列表变化时，如果当前 activeStrategy 不在列表中则重置为第一个
watch(strategyResults, (results) => {
  // 多方案对比 UI 已关闭时，不允许自动切换策略：
  // 一律用 normal（最佳配平），否则清空「建议拆 N 次」会让策略跳到 minCoProduction
  if (!showStrategyComparison.value) {
    if (activeStrategy.value !== BREAKDOWN_STRATEGY.NORMAL) activeStrategy.value = BREAKDOWN_STRATEGY.NORMAL;
    return;
  }
  if (results.length === 0) {
    // 无多方案列表（拆卸手动/上限已定，或单一方案关卡）→ 强制回落 normal，
    // 避免残留上一关的策略禁用拆卸组
    if (activeStrategy.value !== BREAKDOWN_STRATEGY.NORMAL) activeStrategy.value = BREAKDOWN_STRATEGY.NORMAL;
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
  if (name === POWER_NAME) {
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

/** 列车数据最高等级（动态读 store，不硬编码；派生逻辑见 domain/train.ts） */
const MAX_TRAIN_LEVEL = computed(() => maxTrainLevelOf(store.data.trains));

/** 关卡当前可升到的最高火车等级（优先读用户配置，否则取初始最高等级；上限 = 列车最高等级） */
const maxTrainLevel = computed(() => resolveMaxTrainLevel(level.value, MAX_TRAIN_LEVEL.value));

/** 关卡初始列车最低等级（用于购买类站点 minQty） */
const minTrainLevel = computed(() => initMinTrainLevel(level.value));

/** 根据火车等级查真实货运量（查 store.data.trains 的 capacity，找不到 fallback 到等级） */
function cargoByLevel(lv: number): number {
  return cargoOfLevel(lv, store.data.trains, MAX_TRAIN_LEVEL.value);
}

/** 最高升级下拉选项：从初始最高等级到最高等级 */
const upgradeLevelOptions = computed(() => upgradeLevelOptionsOf(level.value, store.data.trains));

/** 升级次数（步进器展示用）= 最高升级 - 初始最高等级 */
const upgradeCount = computed(() => upgradeCountOf(level.value, maxTrainLevel.value));

/** 升级次数步进器允许的最大值（= 列车最高等级 - 初始最高等级） */
const upgradeCountMax = computed(() => upgradeCountMaxOf(level.value, MAX_TRAIN_LEVEL.value));

/** 根据升级次数反算并写入 maxTrainLevel；count=0 代表"不升级"，最高等级 = 初始最高等级 */
function applyUpgradeCount(count: number) {
  patchLevel({ maxTrainLevel: maxTrainLevelFromCount(count, level.value, MAX_TRAIN_LEVEL.value) });
}

/** 电力类型可选实例（name=电力 的所有实例） */
const powerOptions = computed(() => store.data.instances.filter((i) => i.name === POWER_NAME));
/** 关卡当前勾选的电力来源 id 数组（0~N 个） */
const currentPowerSources = computed<string[]>(() => level.value?.powerSources ?? []);
/** 电力实例的人性化 label（电力4n → "煤炭"，电力Lb → "工人"，连工人都不需要 → "无限供给"） */
function powerLabel(inst: ResourceInstance): string {
  const others = inst.inputs.filter((n) => n !== WORKER_NAME);
  if (others.length) return others.join(' + ');
  // 不含工人 → 无需工人即可供电，视为无限供给
  if (!inst.inputs.includes(WORKER_NAME)) return '无限供给';
  return '工人';
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
      if (key === 'hasMergedProduction' && !level.value?.coProductionGroups?.length) coProductionPanelRef.value?.add();
      if (key === 'hasResourceStation' && !level.value?.resourceStationArr?.length) resourcePanelRef.value?.add();
      if (key === 'hasPassengerStation' && !level.value?.passengerStationArr?.length) passengerPanelRef.value?.add();
      if (key === 'hasExternalStation' && !level.value?.externalStationArr?.length) externalPanelRef.value?.add();
      if (key === 'hasMultipleInstances' && !level.value?.multiChannelGroups?.length) multiChannelPanelRef.value?.add();
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
/** 运行时归一化工人站点（派生逻辑见 domain/level.ts） */
const effectiveWorkerStations = computed(() => deriveEffectiveWorkerStations(level.value, goals.value));

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

// ————————— 资源站点（UI 已抽离到 components/level-editor/ResourceStationPanel.vue）—————————

// ————————— 客流站点（UI 已抽离到 components/level-editor/PassengerStationPanel.vue）—————————

/** 模板直接调用：刷新每次产出（派生逻辑见 domain/level.ts） */
function qtyEach(s?: ExternalStation | null): number {
  return stationQtyEach(s, stationQtyCtx.value);
}

/**
 * 最快通关时间预估（秒）：遍历 rawNeeds，找同名刷新站点算趟数，取瓶颈资源耗时。
 * 派生逻辑见 domain/level.ts。
 */
const estimatedBestTime = computed(() =>
  estimateBestTime(result.value?.rawNeeds, level.value, store.instById, stationQtyCtx.value),
);

// ————————— 外部物资站点（UI 已抽离到 components/level-editor/ExternalStationPanel.vue）—————————

// ——— 拆卸工厂 / 拆卸组 CRUD（UI 已抽离到 components/level-editor/CoProductionPanel.vue）———

// ——— 多渠道生产组 CRUD ———
const mcExpanded = reactive<Record<number, boolean>>({});

/** 获取关卡中已使用的指定类型实例 ID 列表（派生逻辑见 domain/level.ts） */
function getUsedInstanceIds(typeName: string): string[] {
  return collectUsedInstanceIds(level.value, typeName, store.instById);
}

// ——— 多渠道生产组 CRUD（UI 已抽离到 components/level-editor/MultiChannelPanel.vue）———

// ─── 外部站点自定义联想 & 下拉（已随面板抽离到 ExternalStationPanel.vue）───

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
      <div ref="levelListRef" tabindex="-1" @scroll="saveLevelListScroll" @keydown="onLevelListKeydown" class="mt-3 grid flex-1 min-h-0 grid-cols-1 gap-1.5 overflow-y-auto pr-1">
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
            {{ CONTENT_CATEGORY_LABEL[l.category] }} · {{ l.chapter }}
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
          <span class="tag">{{ CONTENT_CATEGORY_LABEL[level.category] }} · {{ level.contentType }}</span>
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
         <ResourceStationPanel
           v-if="level.hasResourceStation === true || (level.resourceStationArr?.length ?? 0) > 0"
           ref="resourcePanelRef"
           :stations="level.resourceStationArr ?? []"
           @patch="patchLevel"
         />

         <!-- —— 客流站点（乘客带来物资，每次1列车运载量，可解锁） —— -->
         <PassengerStationPanel
           v-if="level.hasPassengerStation === true || (level.passengerStationArr?.length ?? 0) > 0"
           ref="passengerPanelRef"
           :stations="level.passengerStationArr ?? []"
           :max-train-level="maxTrainLevel"
           :max-cargo="cargoByLevel(maxTrainLevel)"
           @patch="patchLevel"
         />

        <ExternalStationPanel
          v-if="level.hasExternalStation === true || (level.externalStationArr?.length ?? 0) > 0"
          ref="externalPanelRef"
          :stations="level.externalStationArr ?? []"
          :max-train-level="maxTrainLevel"
          :min-train-level="minTrainLevel"
          :suggest-names="suggestNames"
          :default-interval-sec="DEFAULT_INTERVAL_SEC"
          :qty-each="qtyEach"
          :cargo-by-level="cargoByLevel"
          :is-valid-qty="isValidQty"
          @patch="patchLevel"
        />

        <!-- 🔗 拆卸工厂站点：在外部物资站点下方 -->
        <CoProductionPanel
          v-if="level.hasMergedProduction === true || (level.coProductionGroups?.length ?? 0) > 0"
          ref="coProductionPanelRef"
          :groups="level.coProductionGroups ?? []"
          :local-instances="localInstances"
          @patch="patchLevel"
        />

        <!-- 🧬 多渠道生产组：在拆卸工厂站点下方 -->
        <MultiChannelPanel
          v-if="level.hasMultipleInstances || (level.multiChannelGroups?.length ?? 0) > 0"
          ref="multiChannelPanelRef"
          :groups="level.multiChannelGroups ?? []"
          :expanded="mcExpanded"
          :get-used-instance-ids="getUsedInstanceIds"
          @patch="patchLevel"
        />
      </div>

      <!-- 💰 挣钱测算：置于最终需求上方；仅当关卡有挣钱目标时提供显示/隐藏入口，数据完全旁路（不参与拆解计算） -->
      <EarnPanel
        v-if="earnTarget > 0"
        :level="level"
        :instances="store.data.instances"
        :prices="store.data.prices"
        @patch="patchLevel"
      />

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
