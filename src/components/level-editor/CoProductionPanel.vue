<script setup lang="ts">
/**
 * 拆卸工厂站点面板（1 组配方材料同时生产 1 组各类材料）。
 * 组 / 产出的 CRUD、配方一致性检查、物资名联想与实例下拉都在本组件内，
 * 通过 patch 回写 coProductionGroups。
 */
import type { CoProductionGroup, CoProductionOutput, ResourceInstance, ResourceCategory } from '@/types';
import { POWER_NAME } from '@/types';
import { useGameStore } from '@/stores/game';
import { useSuggestCombo } from '@/composables/useSuggestCombo';
import { classifyName } from '@/engine/breakdown';

const props = defineProps<{
  /** 拆卸组数组（唯一数据源） */
  groups: CoProductionGroup[];
  /** 关卡活跃实例集合（用于 cpInputItems 的分类高亮） */
  localInstances: ResourceInstance[];
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Record<string, unknown>): void;
}>();

const store = useGameStore();

/** 新增拆卸组 */
function add() {
  const list = props.groups ?? [];
  const nextId = 'cp' + (list.length + 1);
  const next = [...list, { id: nextId, outputs: [{ instanceId: '', perOut: 1 }] }];
  emit('patch', { coProductionGroups: next });
}

function removeCpGroup(cpIdx: number) {
  const list = (props.groups ?? []).filter((_, idx) => idx !== cpIdx);
  // 删除到空时写 []（而非 undefined）：undefined 在序列化时被丢弃，会让合并逻辑
  // 回落到 seed 里的旧数据，导致"删掉的组刷新后又冒出来"。
  emit('patch', { coProductionGroups: list, hasMergedProduction: list.length > 0 });
}

function updateCpGroup(cpIdx: number, patch: Partial<CoProductionGroup>) {
  const list = [...(props.groups ?? [])];
  list[cpIdx] = { ...list[cpIdx], ...patch };
  emit('patch', { coProductionGroups: list });
}

/** 解析「建议拆 N 次」：空 / 非法 / ≤0 → undefined（不限，走最佳配平）；否则取正整数 */
function setCpMaxCycles(cpIdx: number, e: Event) {
  const n = parseInt((e.target as HTMLInputElement).value.trim(), 10);
  updateCpGroup(cpIdx, { maxCycles: Number.isFinite(n) && n > 0 ? n : undefined });
}

function addCpOutput(cpIdx: number) {
  const list = [...(props.groups ?? [])];
  const cp = { ...list[cpIdx] };
  cp.outputs = [...cp.outputs, { instanceId: '', perOut: 1 }];
  list[cpIdx] = cp;
  emit('patch', { coProductionGroups: list });
}

function removeCpOutput(cpIdx: number, oi: number) {
  const list = [...(props.groups ?? [])];
  const cp = { ...list[cpIdx] };
  cp.outputs = cp.outputs.filter((_, idx) => idx !== oi);
  if (cp.outputs.length === 0) {
    // 组内无产出时自动删除整组
    list.splice(cpIdx, 1);
  } else {
    list[cpIdx] = cp;
  }
  emit('patch', { coProductionGroups: list.length ? list : undefined });
}

function updateCpOutput(cpIdx: number, oi: number, patch: Partial<CoProductionOutput>) {
  const list = [...(props.groups ?? [])];
  const cp = { ...list[cpIdx] };
  cp.outputs = cp.outputs.map((o, idx) => idx === oi ? { ...o, ...patch } : o);
  list[cpIdx] = cp;
  emit('patch', { coProductionGroups: list });
}

/** 拆卸组可选的实例列表：所有有配方（inputs.length > 0）且未加入其他组的实例 */
function cpInstanceOptions(_cp: CoProductionGroup, cpIdx: number): ResourceInstance[] {
  // 其他拆卸组已占用的实例 ID
  const otherUsed = new Set<string>();
  (props.groups ?? []).forEach((g, gi) => {
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
  for (const li of props.localInstances ?? []) {
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

/** 解析 `cpIdx-oi` 结构 key */
function parseCpKey(key: string | number): [number, number] {
  const [a, b] = String(key).split('-');
  return [Number(a), Number(b)];
}

/** 拆卸组某一产出行当前可选实例（按已选实例名称过滤） */
function cpInstancesOfKey(key: string | number): ResourceInstance[] {
  const [cpIdx, oi] = parseCpKey(key);
  const cp = props.groups?.[cpIdx];
  const out = cp?.outputs?.[oi];
  if (!cp || !out?.instanceId) return [];
  const name = store.instById.get(out.instanceId)?.name;
  if (!name) return [];
  return cpInstanceOptions(cp, cpIdx).filter((x) => x.name === name);
}

/** 拆卸组联想 + 实例下拉（通用状态机） */
const cpCombo = useSuggestCombo({
  suggestions: (key, keyword) => {
    const [cpIdx] = parseCpKey(key);
    const cp = props.groups?.[cpIdx];
    if (!cp) return [];
    const names = [...new Set(cpInstanceOptions(cp, cpIdx).map((inst) => inst.name))];
    const kw = keyword.trim();
    return kw ? names.filter((n) => n.includes(kw)) : names;
  },
  instances: (key) => cpInstancesOfKey(key),
  pickName: (key, name) => {
    const [cpIdx, oi] = parseCpKey(key);
    const cp = props.groups?.[cpIdx];
    if (!cp) return;
    const chosen = cpInstanceOptions(cp, cpIdx).find((inst) => inst.name === name);
    if (chosen) updateCpOutput(cpIdx, oi, { instanceId: chosen.id });
  },
  pickInst: (key, instId) => {
    const [cpIdx, oi] = parseCpKey(key);
    updateCpOutput(cpIdx, oi, { instanceId: instId });
  },
  initialInstCursor: (key) => {
    const [cpIdx, oi] = parseCpKey(key);
    const out = props.groups?.[cpIdx]?.outputs?.[oi];
    if (!out?.instanceId) return 0;
    const i = cpInstancesOfKey(key).findIndex((x) => x.id === out.instanceId);
    return i < 0 ? 0 : i;
  },
});

/** 聚焦拆卸产出搜索框：已有实例时回填名称 */
function onCpFocus(cpIdx: number, oi: number, out: CoProductionOutput) {
  const key = `${cpIdx}-${oi}`;
  cpCombo.openSuggest(key);
  if (out.instanceId) cpCombo.setKeyword(key, store.instById.get(out.instanceId)?.name ?? '');
}

// 供父级在「关卡标记」打开时自动添加一条空行
defineExpose({ add });
</script>

<template>
  <div class="mt-3 rounded-md border border-ink-600">
    <div class="flex items-center justify-between border-b border-ink-600 bg-ink-700/30 px-3 py-1.5">
      <div class="text-xs font-medium text-fog-300">🔗 拆卸工厂站点（1组配方材料同时生产1组各类材料）</div>
      <button class="btn !px-2 !py-0.5 text-xs" @click="add">+ 添加拆卸工厂</button>
    </div>
    <div v-if="!groups.length" class="py-3 text-center text-xs text-fog-500">
      暂无拆卸工厂 — 点「+ 添加拆卸工厂」开始配置
    </div>
    <div v-else class="px-2 py-2 space-y-2">
      <div
        v-for="(cp, cpIdx) in groups"
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
              <span v-if="item.name === POWER_NAME" class="text-amber-brand">⚡️ 电力</span>
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
              :value="cpCombo.keywords[`${cpIdx}-${oi}`] ?? (out.instanceId ? store.instById.get(out.instanceId)?.name ?? '' : '')"
              placeholder="物资名…"
              @focus="onCpFocus(cpIdx, oi, out)"
              @input="cpCombo.onSuggestInput(`${cpIdx}-${oi}`, $event)"
              @keydown="cpCombo.onSuggestKeydown(`${cpIdx}-${oi}`, $event)"
            />
            <ul
              v-if="cpCombo.suggestOpen === `${cpIdx}-${oi}` && cpCombo.suggestions(`${cpIdx}-${oi}`).length"
              class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
            >
              <li
                v-for="(nm, li) in cpCombo.suggestions(`${cpIdx}-${oi}`)"
                :key="nm"
                class="cursor-pointer px-2 py-1 text-[11px]"
                :class="cpCombo.sugCur(`${cpIdx}-${oi}`) === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80'"
                @mousedown.prevent="cpCombo.pickName(`${cpIdx}-${oi}`, nm)"
              >{{ nm }}</li>
            </ul>
          </div>

          <!-- 实例切换下拉 -->
          <template v-if="out.instanceId">
            <div class="relative shrink-0">
              <button
                type="button"
                class="flex w-[80px] items-center justify-between rounded border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-left text-[11px] text-fog-200 hover:border-steel-brand"
                :class="cpCombo.instOpen === `${cpIdx}-${oi}` ? 'border-steel-brand' : ''"
                @click.stop="cpCombo.openInst(`${cpIdx}-${oi}`)"
              >
                <span class="truncate">{{ store.instById.get(out.instanceId)?.id ?? '—' }}</span>
                <span class="ml-1 text-fog-500">▾</span>
              </button>
              <ul
                v-if="cpCombo.instOpen === `${cpIdx}-${oi}`"
                class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[160px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
              >
                <li
                  v-for="(inst, li) in cpCombo.instances(`${cpIdx}-${oi}`)"
                  :key="inst.id"
                  class="cursor-pointer px-2 py-1 text-[11px] leading-tight"
                  :class="[
                    cpCombo.instCur(`${cpIdx}-${oi}`) === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80',
                    inst.id === out.instanceId ? 'font-medium text-fog-100' : ''
                  ]"
                  @mouseenter="cpCombo.instCursor[`${cpIdx}-${oi}`] = li"
                  @mousedown.prevent="cpCombo.pickInst(`${cpIdx}-${oi}`, inst.id)"
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
</template>