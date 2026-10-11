<script setup lang="ts">
/**
 * 外部物资站点面板（刷新 / 购买 / 客流）。
 * 面板自带「物资名联想 + 实例下拉」状态机与行 CRUD，通过 patch 事件回写 externalStationArr。
 * 数量换算 / 货运量查询等共享纯函数由父级以函数 prop 传入，避免逻辑分叉。
 */
import { computed, ref } from 'vue';
import type { ExternalStation, ResourceInstance, StationExternalKind } from '@/types';
import { OBTAIN, REFRESH_START, STATION_KIND } from '@/constants';
import { useGameStore } from '@/stores/game';
import { useSuggestCombo } from '@/composables/useSuggestCombo';

const props = defineProps<{
  /** 外部站点数组（唯一数据源） */
  stations: ExternalStation[];
  /** 关卡可升到的最高火车等级 */
  maxTrainLevel: number;
  /** 初始列车最低等级 */
  minTrainLevel: number;
  /** 🛒 建议提供触发名称集合（同名多实例） */
  suggestNames: Set<string>;
  /** 刷新间隔默认秒数 */
  defaultIntervalSec: number;
  /** 单站每次数量（父级共享实现） */
  qtyEach: (s?: ExternalStation | null) => number;
  /** 按等级查货运量（父级共享实现） */
  cargoByLevel: (lv: number) => number;
  /** 数量有效性判断（父级共享实现） */
  isValidQty: (v: unknown) => v is number;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Record<string, unknown>): void;
}>();

const store = useGameStore();

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
 * - 只有刷新实例 → 只显示刷新；只有购买实例 → 只显示购买；只有客流实例 → 只显示客流
 * - 多种都有 → 多个按钮都显示；未选实例或都没有 → 兜底都显示
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
        if (missing(s.qty)) { patch.qty = props.cargoByLevel(props.maxTrainLevel); patch.qtyAuto = true; }
        if (missing(s.interval)) patch.interval = props.defaultIntervalSec;
      } else if (kind === STATION_KIND.BUY) {
        if (s.price === undefined || s.price === null) patch.price = 0;
        if (missing(s.minQty)) { patch.minQty = props.cargoByLevel(props.minTrainLevel); patch.minQtyAuto = true; }
        if (missing(s.maxQty)) { patch.maxQty = props.cargoByLevel(props.maxTrainLevel); patch.maxQtyAuto = true; }
      } else {
        // 客流：默认 qty
        if (missing(s.qty)) { patch.qty = props.cargoByLevel(props.maxTrainLevel); }
      }
    }
  }
  // 补齐缺失字段
  if (kind === STATION_KIND.REFRESH) {
    if (missing(s.interval)) patch.interval = props.defaultIntervalSec;
    if (!s.refreshStart) patch.refreshStart = 'timed';
    if (s.startDelay === undefined || s.startDelay === null) patch.startDelay = 0;
    if (missing(s.qty) && !patch.qty) { patch.qty = props.cargoByLevel(props.maxTrainLevel); patch.qtyAuto = true; }
  } else if (kind === STATION_KIND.BUY) {
    if (s.price === undefined && patch.price === undefined) patch.price = 0;
    if (missing(s.minQty) && !patch.minQty) { patch.minQty = props.cargoByLevel(props.minTrainLevel); patch.minQtyAuto = true; }
    if (missing(s.maxQty) && !patch.maxQty) { patch.maxQty = props.cargoByLevel(props.maxTrainLevel); patch.maxQtyAuto = true; }
  } else {
    // 客流：默认 qty
    if (missing(s.qty) && !patch.qty) { patch.qty = props.cargoByLevel(props.maxTrainLevel); }
  }
  return patch;
}

/** 选了物资名称后自动选第一个 external 实例，并自动匹配对应类型 */
function pickStationResource(i: number, name: string) {
  const candidates = instancesOfName(name);
  const s = props.stations?.[i];
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
  const s = props.stations?.[i];
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

function add() {
  const list: ExternalStation[] = [...(props.stations ?? [])];
  list.push({
    label: nextExternalLabel(list),
    resourceId: '',
    qty: props.cargoByLevel(props.maxTrainLevel),
    qtyAuto: true,
    kind: undefined,
    interval: 0,
    refreshStart: 'timed',
    startDelay: 0,
    minQty: props.cargoByLevel(props.minTrainLevel),
    minQtyAuto: true,
    maxQty: props.cargoByLevel(props.maxTrainLevel),
    maxQtyAuto: true,
    price: 0,
  });
  emit('patch', { externalStationArr: list, hasExternalStation: true });
}

function updateStation(i: number, patch: Partial<ExternalStation>) {
  const list = [...(props.stations ?? [])];
  const merged = { ...list[i], ...patch };
  // 用户手动改数量时 → 清除对应的 auto 标记，锁定
  if (patch.qty !== undefined) merged.qtyAuto = false;
  if (patch.minQty !== undefined) merged.minQtyAuto = false;
  if (patch.maxQty !== undefined) merged.maxQtyAuto = false;
  // 约束：最低 ≤ 最高（用户点 + 可能越过边界）
  if (merged.kind === STATION_KIND.BUY || merged.kind === STATION_KIND.STOCK) {
    if (props.isValidQty(merged.minQty) && props.isValidQty(merged.maxQty) && merged.minQty > merged.maxQty) {
      if (patch.minQty !== undefined) merged.maxQty = merged.minQty; // 拉 min 上来 → max 跟着升
      else if (patch.maxQty !== undefined) merged.minQty = merged.maxQty; // 拉 max 下去 → min 跟着降
    }
  }
  list[i] = merged;
  emit('patch', { externalStationArr: list });
}

function remove(idx: number) {
  const list = (props.stations ?? []).filter((_, i) => i !== idx);
  if (!list.length) {
    emit('patch', { externalStationArr: [], hasExternalStation: false });
  } else {
    emit('patch', { externalStationArr: list });
  }
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

/** 外部站联想 + 实例下拉（通用状态机） */
const stationCombo = useSuggestCombo({
  suggestions: (_key, keyword) => {
    const kw = keyword.trim();
    if (!kw) return allResourceNames.value; // 空输入显示全部，滚动条浏览
    return allResourceNames.value.filter((n) => n.includes(kw)).slice(0, 12);
  },
  instances: (key) => {
    const s = props.stations?.[Number(key)];
    const name = s?.resourceId ? store.instById.get(s.resourceId)?.name : undefined;
    return name ? instancesOfName(name) : [];
  },
  pickName: (key, name) => pickStationResource(Number(key), name),
  pickInst: (key, instId) => onStationInstChange(Number(key), instId),
  enterFallback: (key, keyword) => {
    // 无匹配联想时，直接用关键词尝试查找
    const kw = keyword.trim();
    if (kw) pickStationResource(Number(key), kw);
  },
  initialInstCursor: (key) => {
    const s = props.stations?.[Number(key)];
    if (s?.resourceId) {
      const name = store.instById.get(s.resourceId)?.name;
      if (name) {
        const i = instancesOfName(name).findIndex((x) => x.id === s.resourceId);
        if (i >= 0) return i;
      }
    }
    return 0;
  },
  instTriggerClass: 'station-inst-trigger',
});

/** 聚焦外部站搜索框：未填过关键字时用已有实例名回填 */
function onStationFocus(i: number, s: ExternalStation) {
  stationCombo.openSuggest(i);
  if (stationCombo.keywords[i] === undefined && s.resourceId) {
    stationCombo.setKeyword(i, store.instById.get(s.resourceId ?? '')?.name ?? '');
  }
}

/** 点击外部收起联想/下拉（父级全局 mousedown 调用） */
function closePopups() {
  stationCombo.closeSuggest();
  stationCombo.closeInst();
}

// 供父级在「关卡标记」打开时自动添加一条空行
defineExpose({ add, closePopups });
</script>

<template>
  <div class="mt-3 rounded-md border border-ink-600">
    <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
      <div class="text-xs font-medium text-fog-300">📦 外部物资站点（购买空投材料的运载量为玩家选择的列车，定时周期运送的为当前关卡火车最高等级的运载量）</div>
      <button class="btn !px-2 !py-0.5 text-xs" @click="add">+ 添加外部站点</button>
    </div>
    <div v-if="!stations.length" class="py-3 text-center text-xs text-fog-500">暂无外部站点 — 点「+ 添加外部站点」开始配置</div>
    <div v-else class="px-2 py-2 space-y-2">
      <div
        v-for="(s, i) in stations"
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
              :value="stationCombo.keywords[i] ?? store.instById.get(s.resourceId ?? '')?.name ?? ''"
              placeholder="物资名…"
              @focus="onStationFocus(i, s)"
              @input="stationCombo.onSuggestInput(i, $event)"
              @keydown="stationCombo.onSuggestKeydown(i, $event)"
            />
            <ul
              v-if="stationCombo.suggestOpen === i && stationCombo.suggestions(i).length"
              class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
            >
              <li
                v-for="(nm, li) in stationCombo.suggestions(i)"
                :key="nm"
                class="cursor-pointer px-2 py-1 text-[11px]"
                :class="stationCombo.sugCur(i) === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80'"
                @mousedown.prevent="stationCombo.pickName(i, nm)"
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
                :class="stationCombo.instOpen === i ? 'border-steel-brand' : ''"
                :data-row="i"
                @click.stop="stationCombo.openInst(i)"
                @keydown="stationCombo.onInstKeydown(i, $event)"
              >
                <span class="truncate">{{ store.instById.get(s.resourceId ?? '')!.id }}</span>
                <span class="ml-1 text-fog-500">▾</span>
              </button>
              <ul
                v-if="stationCombo.instOpen === i"
                class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[160px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
              >
                <li
                  v-for="(inst, li) in stationCombo.instances(i)"
                  :key="inst.id"
                  class="cursor-pointer px-2 py-1 text-[11px]"
                  :class="[
                    stationCombo.instCur(i) === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80',
                    inst.id === s.resourceId ? 'font-medium text-fog-100' : ''
                  ]"
                  @mouseenter="stationCombo.instCursor[i] = li"
                  @mousedown.prevent="stationCombo.pickInst(i, inst.id)"
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
                    :value="Math.floor((s.interval ?? defaultIntervalSec) / 60)"
                    @input="updateStation(i, { interval: (+($event.target as HTMLInputElement).value || 0) * 60 + ((s.interval ?? defaultIntervalSec) % 60) })" />
                  <span class="flex items-center px-1.5 text-fog-500">分</span>
                  <input type="text" inputmode="numeric" class="w-10 bg-transparent text-center text-fog-100 outline-none"
                    :value="(s.interval ?? defaultIntervalSec) % 60"
                    @input="updateStation(i, { interval: Math.floor((s.interval ?? defaultIntervalSec) / 60) * 60 + (+($event.target as HTMLInputElement).value || 0) })" />
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
          <button class="text-[11px] text-bad/80 hover:text-bad whitespace-nowrap" @click="remove(i)">删除此站</button>
        </div>
      </div>
    </div>
  </div>
</template>