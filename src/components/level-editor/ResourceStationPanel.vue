<script setup lang="ts">
/**
 * 资源站点面板（无限/库存初始配置，可配置解锁）。
 * 面板自带「物资名联想 + 实例下拉」状态机与行 CRUD，通过 patch 事件回写 resourceStationArr。
 */
import { computed } from 'vue';
import type { ResourceInstance, ResourceStation } from '@/types';
import { useGameStore } from '@/stores/game';
import { useSuggestCombo } from '@/composables/useSuggestCombo';

const props = defineProps<{
  /** 资源站点数组（唯一数据源） */
  stations: ResourceStation[];
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Record<string, unknown>): void;
}>();

const store = useGameStore();

function add() {
  const cur = props.stations ?? [];
  const n = cur.length + 1;
  const label = 'r' + n;
  // 默认不选择实例，让用户手动选择
  const rs: ResourceStation = { label, resourceId: undefined };
  delete rsCombo.keywords[cur.length];
  emit('patch', { resourceStationArr: [...cur, rs] });
}

function remove(idx: number) {
  const arr = (props.stations ?? []).filter((_, i) => i !== idx);
  delete rsCombo.keywords[idx];
  for (let j = idx; j < arr.length; j++) {
    if (rsCombo.keywords[j + 1] !== undefined) {
      rsCombo.keywords[j] = rsCombo.keywords[j + 1]!;
    } else {
      delete rsCombo.keywords[j];
    }
  }
  delete rsCombo.keywords[arr.length];
  if (!arr.length) {
    emit('patch', { resourceStationArr: arr, hasResourceStation: false });
  } else {
    emit('patch', { resourceStationArr: arr });
  }
}

function setResource(idx: number, resourceId: string) {
  const arr = [...(props.stations ?? [])];
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
  emit('patch', { resourceStationArr: arr });
}

/** 取资源站点对应的实例（obtain=无限 → 无限类；obtain=库存 → 库存类，控制 UI 显示） */
function rsInst(idx: number) {
  const rs = props.stations?.[idx];
  return rs?.resourceId ? store.data.instances.find((i) => i.id === rs.resourceId) : undefined;
}

function setStockTotal(idx: number, v: number) {
  const arr = [...(props.stations ?? [])];
  arr[idx] = { ...arr[idx], totalStock: isFinite(v) && v >= 0 ? v : undefined };
  emit('patch', { resourceStationArr: arr });
}

function toggleAutoRefresh(idx: number) {
  const arr = [...(props.stations ?? [])];
  arr[idx] = { ...arr[idx], autoRefresh: !arr[idx].autoRefresh };
  emit('patch', { resourceStationArr: arr });
}

function setRefreshInterval(idx: number, v: number) {
  const arr = [...(props.stations ?? [])];
  arr[idx] = { ...arr[idx], refreshInterval: isFinite(v) && v > 0 ? v : undefined };
  emit('patch', { resourceStationArr: arr });
}

function toggleUnlock(idx: number) {
  const arr = [...(props.stations ?? [])];
  const rs = arr[idx];
  if (rs.unlockCost !== undefined) {
    arr[idx] = { ...rs };
    delete arr[idx].unlockCost;
  } else {
    arr[idx] = { ...rs, unlockCost: 0 };
  }
  emit('patch', { resourceStationArr: arr });
}

function setUnlockCost(idx: number, cost: number) {
  const arr = [...(props.stations ?? [])];
  arr[idx] = { ...arr[idx], unlockCost: Math.max(0, cost || 0) };
  emit('patch', { resourceStationArr: arr });
}

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

/** 选了物资名称后自动选第一个实例 */
function pickRsResource(idx: number, name: string) {
  const candidates = rsInstancesOfName(name);
  if (!candidates.length) return;
  setResource(idx, candidates[0].id);
}

/** 资源站联想 + 实例下拉（通用状态机） */
const rsCombo = useSuggestCombo({
  suggestions: (_key, keyword) => {
    const kw = keyword.trim();
    if (!kw) return allRsNames.value;
    return allRsNames.value.filter((n) => n.includes(kw)).slice(0, 12);
  },
  instances: (key) => {
    const rs = props.stations?.[Number(key)];
    const name = rs?.resourceId ? store.instById.get(rs.resourceId)?.name : undefined;
    return name ? rsInstancesOfName(name) : [];
  },
  pickName: (key, name) => pickRsResource(Number(key), name),
  pickInst: (key, instId) => setResource(Number(key), instId),
  initialInstCursor: (key) => {
    const rs = props.stations?.[Number(key)];
    if (rs?.resourceId) {
      const name = store.instById.get(rs.resourceId)?.name;
      if (name) {
        const i = rsInstancesOfName(name).findIndex((x) => x.id === rs.resourceId);
        if (i >= 0) return i;
      }
    }
    return 0;
  },
  instTriggerClass: 'rs-inst-trigger',
  instCursorWrap: false,
});

/** 聚焦资源站搜索框：已有实例时把名称回填到输入框 */
function onRsFocus(idx: number, rs: ResourceStation) {
  rsCombo.openSuggest(idx);
  if (rs.resourceId) rsCombo.setKeyword(idx, store.instById.get(rs.resourceId)?.name ?? '');
}

// 供父级在「关卡标记」打开时自动添加一条空行
defineExpose({ add });
</script>

<template>
  <div class="mt-3 rounded-md border border-ink-600">
    <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
      <div class="text-xs font-medium text-fog-300">💎 初始资源站点（自动生产材料或直接提供库存）</div>
      <button class="btn !px-2 !py-0.5 text-xs" @click="add">+ 添加资源站点</button>
    </div>
    <div v-if="!stations.length" class="py-3 text-center text-xs text-fog-500">暂无资源站点 — 点「+ 添加资源站点」开始配置</div>
    <div v-else class="px-2 py-2 space-y-2">
      <div v-for="(rs, idx) in stations" :key="rs.label"
           class="rounded-md border-2 border-dashed border-good/50 bg-good/5 p-2 flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center gap-1 rounded bg-good/20 px-2 py-0.5 text-[11px] font-semibold text-good">💎 资源站 {{ idx + 1 }}</span>
        <!-- 物资搜索 -->
        <div class="relative">
          <input
            type="text"
            class="w-[80px]"
            :value="rsCombo.keywords[idx] ?? (rs.resourceId ? store.instById.get(rs.resourceId)?.name ?? '' : '')"
            placeholder="物资名…"
            @focus="onRsFocus(idx, rs)"
            @input="rsCombo.onSuggestInput(idx, $event)"
            @keydown="rsCombo.onSuggestKeydown(idx, $event)"
          />
          <ul
            v-if="rsCombo.suggestOpen === idx && rsCombo.suggestions(idx).length"
            class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
          >
            <li
              v-for="(nm, li) in rsCombo.suggestions(idx)"
              :key="nm"
              class="cursor-pointer px-2 py-1 text-[11px]"
              :class="rsCombo.sugCur(idx) === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80'"
              @mousedown.prevent="rsCombo.pickName(idx, nm)"
            >{{ nm }}</li>
          </ul>
        </div>
        <!-- 实例下拉 -->
        <template v-if="rs.resourceId">
          <div class="relative">
            <button
              type="button"
              class="rs-inst-trigger flex w-[80px] items-center justify-between rounded border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-left text-[11px] text-fog-200 hover:border-steel-brand"
              :class="rsCombo.instOpen === idx ? 'border-steel-brand' : ''"
              :data-row="idx"
              @click.stop="rsCombo.openInst(idx)"
              @keydown="rsCombo.onInstKeydown(idx, $event)"
            >
              <span class="truncate">{{ store.instById.get(rs.resourceId)?.id ?? '—' }}</span>
              <span class="ml-1 text-fog-500">▾</span>
            </button>
            <ul
              v-if="rsCombo.instOpen === idx"
              class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[160px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
            >
              <li
                v-for="(inst, li) in rsCombo.instances(idx)"
                :key="inst.id"
                class="cursor-pointer px-2 py-1 text-[11px]"
                :class="[
                  rsCombo.instCur(idx) === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80',
                  inst.id === rs.resourceId ? 'font-medium text-fog-100' : ''
                ]"
                @mouseenter="rsCombo.instCursor[idx] = li"
                @mousedown.prevent="rsCombo.pickInst(idx, inst.id)"
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
          @click="toggleUnlock(idx)"
        >
          <span class="text-[9px]">{{ rs.unlockCost ? '🔒' : '✅' }}</span>
          {{ rs.unlockCost ? '未解锁' : '已解锁' }}
        </button>
        <template v-if="rs.unlockCost !== undefined">
          <span class="text-[11px] text-fog-500">解锁金</span>
          <input type="text" inputmode="numeric" class="w-[80px] text-center"
                 :value="rs.unlockCost"
                 @input="setUnlockCost(idx, +($event.target as HTMLInputElement).value)"
                 @focus="($event.target as HTMLInputElement).select()" />
          <span class="text-[11px] text-fog-500">$</span>
        </template>
        <template v-if="rsInst(idx)?.obtain === '库存'">
          <span class="text-[11px] text-fog-500">库存</span>
          <input type="text" inputmode="numeric" class="w-[70px] text-center"
                 :value="rs.totalStock ?? ''"
                 placeholder="∞"
                 @input="setStockTotal(idx, +($event.target as HTMLInputElement).value)"
                 @focus="($event.target as HTMLInputElement).select()" />
          <label class="inline-flex items-center gap-1 text-[11px] cursor-pointer select-none">
            <input type="checkbox" :checked="!!rs.autoRefresh" @change="toggleAutoRefresh(idx)" />
            <span>自动刷新</span>
          </label>
          <template v-if="rs.autoRefresh">
            <span class="text-[11px] text-fog-500">间隔</span>
            <input type="text" inputmode="numeric" class="w-[64px] text-center"
                   :value="rs.refreshInterval ?? ''"
                   placeholder="秒"
                   @input="setRefreshInterval(idx, +($event.target as HTMLInputElement).value)"
                   @focus="($event.target as HTMLInputElement).select()" />
            <span class="text-[11px] text-fog-500">s</span>
          </template>
        </template>
        <div class="flex-1" />
        <button class="text-[11px] text-bad/80 hover:text-bad" @click="remove(idx)">删除此站</button>
      </div>
    </div>
  </div>
</template>