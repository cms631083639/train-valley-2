<script setup lang="ts">
/**
 * 多渠道生产组面板（同类型物资多实例配置）。
 * 组 CRUD 与类型联想在本组件内完成，通过 patch 回写 multiChannelGroups；
 * 展开状态由父级持有（autoDetectMcGroups 也会写入），以对象形式共享。
 */
import type { MultiChannelGroup, ResourceInstance } from '@/types';
import { RESOURCE_CATEGORY_STYLE } from '@/utils/format';
import { useGameStore } from '@/stores/game';
import { useSuggestCombo } from '@/composables/useSuggestCombo';
import { dedupeInputs } from '@/utils/recipe';
import { classifyName } from '@/engine/breakdown';

const props = defineProps<{
  /** 渠道组数组（唯一数据源） */
  groups: MultiChannelGroup[];
  /** 各组的展开状态（父级持有，含自动检测时的写入） */
  expanded: Record<number, boolean>;
  /** 收集关卡中已使用的指定类型实例 id（父级提供，避免重复实现） */
  getUsedInstanceIds: (typeName: string) => string[];
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Record<string, unknown>): void;
}>();

const store = useGameStore();

function add() {
  const list = props.groups ?? [];
  const idx = list.length;
  const next = [...list, { typeName: '', instanceIds: [] }];
  props.expanded[idx] = true;
  emit('patch', { multiChannelGroups: next });
}

function remove(idx: number) {
  const list = (props.groups ?? []).filter((_, i) => i !== idx);
  delete props.expanded[idx];
  // 删除到空写 []，保证删除意图能覆盖 seed，刷新后不再复活空组
  emit('patch', { multiChannelGroups: list, hasMultipleInstances: list.length > 0 });
}

/** 多渠道组类型联想（通用状态机，无实例下拉） */
const mcCombo = useSuggestCombo({
  suggestions: (key) => {
    const idx = Number(key);
    const kw = (props.groups?.[idx]?.typeName ?? '').trim();
    const names = store.resourceNames.filter((n) => store.data.instances.filter((i) => i.name === n).length > 1);
    if (!kw) return names.slice(0, 10);
    return names.filter((n) => n.includes(kw)).slice(0, 10);
  },
  pickName: (key, name) => pickMcType(Number(key), name),
  onInput: (key, value) => onMcTypeInput(Number(key), value),
});

function onMcTypeInput(idx: number, value: string) {
  const list = [...(props.groups ?? [])];
  const match = store.data.instances.some((i) => i.name === value);
  list[idx] = { ...list[idx], typeName: value, instanceIds: match ? props.getUsedInstanceIds(value) : [] };
  if (match) props.expanded[idx] = true;
  emit('patch', { multiChannelGroups: list });
}

function pickMcType(idx: number, name: string) {
  const list = [...(props.groups ?? [])];
  list[idx] = { ...list[idx], typeName: name, instanceIds: props.getUsedInstanceIds(name) };
  props.expanded[idx] = true;
  emit('patch', { multiChannelGroups: list });
}

function mcInstanceOptions(typeName: string): ResourceInstance[] {
  return store.data.instances.filter((i) => i.name === typeName);
}

function toggleMcInstance(idx: number, instanceId: string) {
  const list = [...(props.groups ?? [])];
  const mc = { ...list[idx] };
  const ids = [...mc.instanceIds];
  mc.instanceIds = ids.includes(instanceId) ? ids.filter((id) => id !== instanceId) : [...ids, instanceId];
  list[idx] = mc;
  emit('patch', { multiChannelGroups: list });
}

function toggleExpand(idx: number) {
  props.expanded[idx] = !props.expanded[idx];
}

// 供父级在「关卡标记」打开时自动添加一条空行
defineExpose({ add });
</script>

<template>
  <div class="mt-3 rounded-md border border-ink-600">
    <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
      <div class="text-xs font-medium text-fog-300">🧬 多渠道生产组（同类型物资多实例配置）</div>
      <button class="btn !px-2 !py-0.5 text-xs" @click="add">+ 添加渠道组</button>
    </div>
    <div v-if="!groups.length" class="py-3 text-center text-xs text-fog-500">
      暂无渠道组 — 点「+ 添加渠道组」开始配置
    </div>
    <div v-else class="px-2 py-2 space-y-2">
      <div v-for="(mc, mcIdx) in groups" :key="mcIdx"
        class="rounded-md border-2 border-dashed border-steel-brand/50 bg-steel-brand/5 p-2">
        <!-- 组标题行 -->
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1 rounded bg-steel-brand/20 px-2 py-0.5 text-[11px] font-semibold text-steel-brand">🧬 渠道组 {{ mcIdx + 1 }}</span>
          <span class="text-[10px] text-fog-500">类型:</span>
          <div class="relative">
            <input type="text" :value="mc.typeName" placeholder="输入物资类型…" class="w-[120px] text-[11px]"
              @input="mcCombo.onSuggestInput(mcIdx, $event)"
              @focus="mcCombo.openSuggest(mcIdx)"
              @blur="mcCombo.blurSuggest(mcIdx)"
              @keydown="mcCombo.onSuggestKeydown(mcIdx, $event)"
            />
            <ul v-if="mcCombo.suggestOpen === mcIdx && mcCombo.suggestions(mcIdx).length"
              class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg">
              <li v-for="(opt, li) in mcCombo.suggestions(mcIdx)" :key="opt"
                :class="['cursor-pointer px-2 py-1 text-[11px]', mcCombo.sugCur(mcIdx) === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80']"
                @mousedown.prevent="mcCombo.pickName(mcIdx, opt)"
              >{{ opt }}</li>
            </ul>
          </div>
          <button class="text-[11px] text-fog-400 hover:text-fog-200 px-1"
            @click="toggleExpand(mcIdx)"
            :title="expanded[mcIdx] ? '收起全部实例' : '展开全部实例'">
            {{ expanded[mcIdx] ? '▲ 收起' : '▼ 展开' }}
          </button>
          <span class="flex-1" />
          <button class="text-[11px] text-bad/80 hover:text-bad" @click="remove(mcIdx)">删除此站</button>
        </div>
        <!-- 实例选择列表（配方展示风格与目标录入一致） -->
        <div v-if="mc.typeName" class="space-y-1">
          <div v-for="inst in (expanded[mcIdx] ? mcInstanceOptions(mc.typeName) : mcInstanceOptions(mc.typeName).filter(i => mc.instanceIds.includes(i.id)))" :key="inst.id"
            class="flex items-center gap-2 py-0.5">
            <label class="flex items-center justify-between gap-1 cursor-pointer select-none shrink-0 w-28">
              <span class="text-[11px] text-fog-200 whitespace-nowrap">{{ inst.id }}</span>
              <input type="checkbox" :checked="mc.instanceIds.includes(inst.id)"
                @change="toggleMcInstance(mcIdx, inst.id)" class="accent-steel-brand" />
            </label>
            <div class="flex items-center gap-x-1 gap-y-0.5 rounded border border-ink-600 bg-ink-800/60 px-1.5 py-1 text-[11px] leading-tight flex-1 min-w-0">
              <template v-if="inst.inputs.length">
                <span v-for="([nm, cnt], ri) in dedupeInputs(inst.inputs)" :key="ri"
                  class="rounded px-1 font-medium whitespace-nowrap"
                  :class="RESOURCE_CATEGORY_STYLE[classifyName(nm, store.data)].chip">
                  {{ nm }}<span v-if="cnt > 1">×{{ cnt }}</span>
                </span>
                <span v-if="inst.needsPower" class="text-amber-brand" title="通电">⚡️</span>
                <span class="text-fog-500 mx-0.5">→</span>
                <span class="rounded px-1 font-medium"
                  :class="RESOURCE_CATEGORY_STYLE[classifyName(inst.name, store.data)].chip">
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
          <div v-else-if="!expanded[mcIdx] && !mc.instanceIds.length" class="text-[11px] text-fog-500 py-1">
            暂无已选实例 — 点击「▼ 展开」选择
          </div>
        </div>
        <div v-else class="text-[11px] text-fog-500 py-1">
          请先输入物资类型
        </div>
      </div>
    </div>
  </div>
</template>