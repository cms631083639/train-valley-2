<script setup lang="ts">
/**
 * 客流站点面板：乘客带来物资，每次 1 列车运载量，可解锁。
 * 面板自身负责行 CRUD，通过 patch 事件把新的 passengerStationArr 回写父级。
 */
import { computed } from 'vue';
import type { PassengerStation } from '@/types';
import { OBTAIN } from '@/constants';
import { useGameStore } from '@/stores/game';

const props = defineProps<{
  /** 客流站点数组（唯一数据源） */
  stations: PassengerStation[];
  /** 关卡当前最高火车等级（展示用） */
  maxTrainLevel: number;
  /** maxTrainLevel 对应的列车运载量（默认每次数量） */
  maxCargo: number;
}>();

const emit = defineEmits<{
  /** 回写关卡部分字段（父级用 patchLevel 应用） */
  (e: 'patch', patch: Record<string, unknown>): void;
}>();

const store = useGameStore();

/** 获取所有客流实例（obtain=客流） */
const passengerInstances = computed(() =>
  store.data.instances.filter((i) => i.obtain === OBTAIN.PASSENGER),
);

function add() {
  const cur = props.stations ?? [];
  const ps: PassengerStation = { label: '', resourceId: undefined };
  emit('patch', { passengerStationArr: [...cur, ps] });
}

function remove(idx: number) {
  const arr = (props.stations ?? []).filter((_, i) => i !== idx);
  if (!arr.length) {
    emit('patch', { passengerStationArr: arr, hasPassengerStation: false });
  } else {
    emit('patch', { passengerStationArr: arr });
  }
}

function setResource(idx: number, resourceId: string) {
  const arr = [...(props.stations ?? [])];
  arr[idx] = { ...arr[idx], resourceId: resourceId || undefined };
  // 选实例时自动设置默认数量（列车运力）
  if (resourceId && !arr[idx].qty) {
    arr[idx].qty = props.maxCargo;
  }
  emit('patch', { passengerStationArr: arr });
}

function toggleUnlock(idx: number) {
  const arr = [...(props.stations ?? [])];
  const ps = arr[idx];
  if (ps.unlockCost !== undefined) {
    const next = { ...ps };
    delete next.unlockCost;
    arr[idx] = next;
  } else {
    arr[idx] = { ...ps, unlockCost: 0 };
  }
  emit('patch', { passengerStationArr: arr });
}

function setUnlockCost(idx: number, cost: number) {
  const arr = [...(props.stations ?? [])];
  arr[idx] = { ...arr[idx], unlockCost: Math.max(0, cost || 0) };
  emit('patch', { passengerStationArr: arr });
}

function setQty(idx: number, qty: number) {
  const arr = [...(props.stations ?? [])];
  arr[idx] = { ...arr[idx], qty: Math.max(1, qty || 1) };
  emit('patch', { passengerStationArr: arr });
}

function setLabel(idx: number, label: string) {
  const arr = [...(props.stations ?? [])];
  arr[idx] = { ...arr[idx], label };
  emit('patch', { passengerStationArr: arr });
}

// 供父级在「关卡标记」打开时自动添加一条空行
defineExpose({ add });
</script>

<template>
  <div class="mt-3 rounded-md border border-ink-600">
    <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
      <div class="text-xs font-medium text-fog-300">🚃 客流站点（乘客带来物资，每次 1 列车运载量）</div>
      <button class="btn !px-2 !py-0.5 text-xs" @click="add">+ 添加客流站</button>
    </div>
    <div v-if="!stations.length" class="py-3 text-center text-xs text-fog-500">暂无客流站点 — 点「+ 添加客流站」开始配置</div>
    <div v-else class="px-2 py-2 space-y-2">
      <div v-for="(ps, idx) in stations" :key="ps.label"
           class="rounded-md border-2 border-dashed border-steel-brand/50 bg-steel-brand/5 p-2 flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center gap-1 rounded bg-steel-brand/20 px-2 py-0.5 text-[11px] font-semibold text-steel-brand">🚃 客流站 </span>
        <input type="text" class="w-[40px] text-center font-semibold text-[11px]"
               :value="ps.label"
               @input="setLabel(idx, ($event.target as HTMLInputElement).value)"
               placeholder="A" />
        <select :value="ps.resourceId || ''" class="w-[150px]" @change="setResource(idx, ($event.target as HTMLSelectElement).value)">
          <option value="">— 选择客流实例 —</option>
          <option v-for="inst in passengerInstances" :key="inst.id" :value="inst.id">
            {{ inst.id }} · {{ inst.name }}
          </option>
        </select>
        <div class="flex items-center gap-1.5">
          <span class="text-[11px] text-fog-500">每次</span>
          <div class="inline-flex h-7 items-center overflow-hidden rounded-md border border-ink-500 bg-ink-700/60 text-[12px] tabular-nums focus-within:ring-1 focus-within:ring-steel-brand/50">
            <button class="h-full w-6 text-fog-400 transition hover:bg-amber-brand/10 hover:text-amber-brand disabled:opacity-30"
              :disabled="(ps.qty ?? maxCargo) <= 1"
              @click="setQty(idx, Math.max(1, (ps.qty ?? maxCargo) - 1))">−</button>
            <input type="text" inputmode="numeric"
              class="w-10 bg-transparent text-center text-fog-100 outline-none"
              :value="ps.qty ?? maxCargo"
              @input="setQty(idx, Math.max(1, +($event.target as HTMLInputElement).value || 1))"
              @focus="($event.target as HTMLInputElement).select()" />
            <button class="h-full w-6 text-fog-400 transition hover:bg-amber-brand/10 hover:text-amber-brand"
              @click="setQty(idx, (ps.qty ?? maxCargo) + 1)">+</button>
          </div>
          <span class="text-[10px] text-fog-500">件（列车运力 Lv{{ maxTrainLevel }} = {{ maxCargo }}）</span>
        </div>
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium transition"
          :class="ps.unlockCost !== undefined
            ? (ps.unlockCost > 0 ? 'border-ink-500 bg-ink-700/60 text-fog-400 hover:border-amber-brand hover:text-amber-brand' : 'border-amber-brand/50 bg-amber-brand/15 text-amber-brand')
            : 'border-steel-brand/50 bg-steel-brand/15 text-steel-brand'"
          @click="toggleUnlock(idx)"
        >
          <span class="text-[9px]">{{ ps.unlockCost !== undefined ? '🔒' : '✅' }}</span>
          {{ ps.unlockCost !== undefined ? '未解锁' : '已解锁' }}
        </button>
        <template v-if="ps.unlockCost !== undefined">
          <span class="text-[11px] text-fog-500">解锁金</span>
          <input type="text" inputmode="numeric" class="w-[80px] text-center"
                 :value="ps.unlockCost"
                 @input="setUnlockCost(idx, +($event.target as HTMLInputElement).value)"
                 @focus="($event.target as HTMLInputElement).select()" />
          <span class="text-[11px] text-fog-500">$</span>
        </template>
        <div class="flex-1" />
        <button class="text-[11px] text-bad/80 hover:text-bad" @click="remove(idx)">删除此站</button>
      </div>
    </div>
  </div>
</template>