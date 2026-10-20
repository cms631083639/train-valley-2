<script setup lang="ts">
/**
 * 挣钱测算面板：玩家手动输入「打算完成哪些物资实例、各多少次」，
 * 每行的「链价值」= 该实例把整条生产链递归展开后的总价值（递增计入上游每层的工人价值）；
 * 合计 = 多行并集去重后的链价值（共享上游只计一次），与关卡挣钱目标对比是否达标
 * （派生逻辑见 domain/earn.ts）。
 *
 * 纯旁路数据 —— 通过 patch 回写 level.earnPlan，只读现有数据、不参与拆解计算，
 * 绝不影响 breakdownGoals 的结果。
 */
import { computed, nextTick, ref, watch } from 'vue';
import type { EarnPlanRow, Level, ResourceInstance } from '@/types';
import { computeEarnPlan, earnTargetOf } from '@/domain/earn';
import { collectLocalInstances } from '@/domain/level';
import { useSuggestCombo } from '@/composables/useSuggestCombo';

const props = defineProps<{
  /** 关卡（读取挣钱目标与 earnPlan 数据源） */
  level: Level;
  /** 全量实例库（供候选与收益查询） */
  instances: ResourceInstance[];
  /** 物资名 → 单价（对应 GameData.prices），用于链价值与外部补算 */
  prices?: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Record<string, unknown>): void;
}>();

/** 实例 id → 实例 索引 */
const instById = computed(() => new Map(props.instances.map((i) => [i.id, i])));

/** 计划原始行（唯一数据源） */
const rows = computed<EarnPlanRow[]>(() => props.level.earnPlan ?? []);

/** 挣钱目标值 */
const target = computed(() => earnTargetOf(props.level));

/** 显示/隐藏：本组件仅在关卡有挣钱目标时才被渲染，故默认展开 */
const shown = ref(true);

/** 候选实例：优先本关已配置实例，其后补齐全量实例 */
const candidates = computed(() => {
  const local = collectLocalInstances(props.level, props.level.goals ?? [], instById.value);
  const seen = new Set(local.map((i) => i.id));
  return [...local, ...props.instances.filter((i) => !seen.has(i.id))];
});

/** 候选名称（本关优先，去重） */
const candidateNames = computed(() => {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const i of candidates.value) {
    if (!seen.has(i.name)) {
      seen.add(i.name);
      names.push(i.name);
    }
  }
  return names;
});

/** 关卡内已配置的实例（递归展开时优先采用） */
const localInsts = computed(() => collectLocalInstances(props.level, props.level.goals ?? [], instById.value));

/**
 * 每个物资名用于递归展开的生产实例，优先级（高 → 低）：
 *   关卡 instanceOverrides → 关卡已配置实例 → 赚钱测算列出的实例 → 全量首个。
 * 递归展开时用它解析「该由哪个生产实例补缺口」。
 */
const resolvedByName = computed(() => {
  const m = new Map<string, ResourceInstance>();
  // 4) 全量首个：先兜底铺一层
  for (const i of props.instances) if (!m.has(i.name)) m.set(i.name, i);
  // 3) 赚钱测算里列出的实例（同名取首个列出的）
  const planSeen = new Set<string>();
  for (const row of rows.value) {
    const i = row.resourceId ? instById.value.get(row.resourceId) : undefined;
    if (i && !planSeen.has(i.name)) {
      planSeen.add(i.name);
      m.set(i.name, i);
    }
  }
  // 2) 关卡已配置的实例（同名取首个）
  const localSeen = new Set<string>();
  for (const i of localInsts.value) {
    if (!localSeen.has(i.name)) {
      localSeen.add(i.name);
      m.set(i.name, i);
    }
  }
  // 1) 关卡显式覆盖
  for (const id of Object.values(props.level.instanceOverrides ?? {})) {
    const i = instById.value.get(id);
    if (i) m.set(i.name, i);
  }
  return m;
});

/** 递归展开用的生产实例表：仅含有配方（inputs.length > 0）的实例 —— 工人 / 电力等无配方不放 */
const producers = computed(() => {
  const m = new Map<string, ResourceInstance>();
  for (const [name, i] of resolvedByName.value) if (i.inputs.length > 0) m.set(name, i);
  return m;
});

/** 测算结果（逐行链价值 + 并集去重合计 + 链外叶子明细，与 rows 一一对应） */
const plan = computed(() => computeEarnPlan(rows.value, instById.value, props.prices, producers.value));

/** 某行下标的结果行（链价值 / 小计 / 缺价标注） */
function lineOf(idx: number) {
  return plan.value.rows[idx];
}

/** 实例下拉里的链价值（该实例单独执行一次的完整链价值） */
function chainValueOf(inst: ResourceInstance): number {
  return computeEarnPlan([{ resourceId: inst.id, qty: 1 }], instById.value, props.prices, producers.value)
    .rows[0].chainValue;
}

/** 行的实例（用于配方预览），对应目标录入模块的 previewInstance */
function previewInst(idx: number): ResourceInstance | undefined {
  const rid = rows.value[idx]?.resourceId;
  return rid ? instById.value.get(rid) : undefined;
}

/** 输入去重计数（同名合并 ×count）—— 与目标录入模块一致 */
function dedupeInputs(inputs: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const n of inputs) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m.entries()];
}

/** 实例配方的纯文本描述（实例下拉选项内用） */
function recipeText(inst: ResourceInstance): string {
  if (inst.inputs.length) {
    const ins = dedupeInputs(inst.inputs)
      .map(([n, c]) => (c > 1 ? `${n}×${c}` : n))
      .join(' + ');
    return `${ins} → ${inst.name}${(inst.perOut ?? 1) > 1 ? ` ×${inst.perOut}` : ''}`;
  }
  if (inst.external || inst.initialSetup) return `${inst.obtain ?? '外部'} · ${inst.name}`;
  if (inst.needsPower) return `⚡️ 通电自动 ${inst.name}`;
  return `${inst.obtain ?? '未知'} · ${inst.name}`;
}

/** 生成稳定行标识（行重排/删除时不变，仅用于 UI 行绑定） */
let uidSeq = 0;
function genUid(): string {
  return `e${Date.now().toString(36)}${(uidSeq++).toString(36)}`;
}

/** uid → 行下标 */
function indexOfUid(uid: string | undefined): number {
  if (!uid) return -1;
  return rows.value.findIndex((r) => r.uid === uid);
}

function patchRows(next: EarnPlanRow[]) {
  emit('patch', { earnPlan: next });
}

/**
 * 老数据（无 uid）补发 uid 并回写父级。
 * 与 GoalEditor 同策略：uid 只用于行内 UI 绑定，不参与业务计算。
 */
watch(
  () => rows.value.some((r) => !r.uid),
  (missing) => {
    if (!missing) return;
    nextTick(() => {
      if (rows.value.some((r) => !r.uid)) {
        patchRows(rows.value.map((r) => (r.uid ? { ...r } : { ...r, uid: genUid() })));
      }
    });
  },
  { immediate: true },
);

function add() {
  patchRows([...rows.value, { uid: genUid(), resourceId: '', qty: 1 }]);
}

function remove(idx: number) {
  const uid = rows.value[idx]?.uid;
  if (uid) delete combo.keywords[uid];
  patchRows(rows.value.filter((_, i) => i !== idx));
}

function updateRow(idx: number, patch: Partial<EarnPlanRow>) {
  patchRows(rows.value.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
}

function setQty(idx: number, qty: number) {
  updateRow(idx, { qty: Math.max(1, Math.floor(qty) || 1) });
}

function stepQty(idx: number, delta: number) {
  setQty(idx, (rows.value[idx]?.qty ?? 1) + delta);
}

/** 选中某行的实例 */
function setInstance(idx: number, resourceId: string) {
  updateRow(idx, { resourceId });
}

/** 物资名联想 + 实例下拉（通用状态机，以 uid 为 key） */
const combo = useSuggestCombo({
  suggestions: (_key, keyword) => {
    const kw = keyword.trim();
    const list = kw ? candidateNames.value.filter((n) => n.includes(kw)) : candidateNames.value;
    return list.slice(0, 12);
  },
  instances: (key) => {
    const row = rows.value[indexOfUid(String(key))];
    const name = row?.resourceId ? instById.value.get(row.resourceId)?.name : undefined;
    return name ? candidates.value.filter((i) => i.name === name) : [];
  },
  pickName: (key, name) => {
    const idx = indexOfUid(String(key));
    const chosen = candidates.value.find((i) => i.name === name);
    if (idx >= 0 && chosen) setInstance(idx, chosen.id);
  },
  pickInst: (key, instId) => {
    const idx = indexOfUid(String(key));
    if (idx >= 0) setInstance(idx, instId);
  },
  initialInstCursor: (key) => {
    const row = rows.value[indexOfUid(String(key))];
    if (row?.resourceId) {
      const name = instById.value.get(row.resourceId)?.name;
      const list = name ? candidates.value.filter((i) => i.name === name) : [];
      const i = list.findIndex((x) => x.id === row.resourceId);
      if (i >= 0) return i;
    }
    return 0;
  },
  instTriggerClass: 'earn-inst-trigger',
  instCursorWrap: false,
});

/** 聚焦物资名搜索框：已有实例时回填名称 */
function onRowFocus(row: EarnPlanRow) {
  const uid = row.uid ?? '';
  combo.openSuggest(uid);
  if (row.resourceId) combo.setKeyword(uid, instById.value.get(row.resourceId)?.name ?? '');
}
</script>

<template>
  <div class="mt-3 rounded-md border border-ink-600">
    <div class="flex items-center justify-between bg-ink-700/30 px-3 py-1.5" :class="shown ? 'border-b border-ink-600' : ''">
      <div class="text-xs font-medium text-fog-300">💰 挣钱测算（计划完成的物资实例 × 次数）</div>
      <div class="flex items-center gap-2">
        <button v-if="shown" class="btn !px-2 !py-0.5 text-xs" @click="add">+ 添加一行</button>
        <button
          class="rounded border border-ink-500 px-2 py-0.5 text-[11px] text-fog-300 hover:border-steel-brand hover:text-fog-100"
          @click="shown = !shown"
        >{{ shown ? '隐藏' : '显示' }}</button>
      </div>
    </div>
    <template v-if="shown">
    <div v-if="!rows.length" class="py-3 text-center text-xs text-fog-500">
      暂无计划 — 点「+ 添加一行」开始测算
    </div>
    <div v-else class="px-2 py-2 space-y-2">
      <div
        v-for="(row, idx) in rows"
        :key="row.uid ?? idx"
        class="flex flex-wrap items-center gap-2 rounded-md border-2 border-dashed border-good/40 bg-good/5 p-2"
      >
        <!-- 物资名搜索 -->
        <div class="relative shrink-0">
          <input
            type="text"
            class="w-[72px]"
            :value="combo.keywords[row.uid ?? ''] ?? (row.resourceId ? instById.get(row.resourceId)?.name ?? '' : '')"
            placeholder="物资名…"
            @focus="onRowFocus(row)"
            @input="combo.onSuggestInput(row.uid ?? '', $event)"
            @blur="combo.blurSuggest(row.uid ?? '')"
            @keydown="combo.onSuggestKeydown(row.uid ?? '', $event)"
          />
          <ul
            v-if="combo.suggestOpen === row.uid && combo.suggestions(row.uid ?? '').length"
            class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[140px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
          >
            <li
              v-for="(nm, li) in combo.suggestions(row.uid ?? '')"
              :key="nm"
              class="cursor-pointer px-2 py-1 text-[11px]"
              :class="combo.sugCur(row.uid ?? '') === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80'"
              @mousedown.prevent="combo.pickName(row.uid ?? '', nm)"
            >{{ nm }}</li>
          </ul>
        </div>

        <!-- 实例下拉 -->
        <template v-if="row.resourceId">
          <div class="relative shrink-0">
            <button
              type="button"
              class="earn-inst-trigger flex w-[80px] items-center justify-between rounded border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-left text-[11px] text-fog-200 hover:border-steel-brand"
              :class="combo.instOpen === row.uid ? 'border-steel-brand' : ''"
              :data-row="row.uid"
              @click.stop="combo.openInst(row.uid ?? '')"
              @keydown="combo.onInstKeydown(row.uid ?? '', $event)"
              @blur="combo.blurInst(row.uid ?? '')"
            >
              <span class="truncate">{{ instById.get(row.resourceId)?.id ?? '—' }}</span>
              <span class="ml-1 text-fog-500">▾</span>
            </button>
            <ul
              v-if="combo.instOpen === row.uid"
              class="absolute left-0 top-full z-30 mt-0.5 max-h-[200px] min-w-[280px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
            >
              <li
                v-for="(inst, li) in combo.instances(row.uid ?? '')"
                :key="inst.id"
                class="cursor-pointer px-2 py-1 text-[11px]"
                :class="[
                  combo.instCur(row.uid ?? '') === li ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80',
                  inst.id === row.resourceId ? 'font-medium text-fog-100' : '',
                ]"
                @mouseenter="combo.instCursor[row.uid ?? ''] = li"
                @mousedown.prevent="combo.pickInst(row.uid ?? '', inst.id)"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate">{{ inst.id }}</span>
                  <span class="shrink-0 text-[10px] text-fog-500">链价值 {{ chainValueOf(inst) }}</span>
                </div>
                <div class="truncate text-[10px] text-fog-400">{{ recipeText(inst) }}</div>
              </li>
            </ul>
          </div>
        </template>
        <span v-else class="text-xs text-fog-500">—</span>

        <!-- 次数步进器：去掉「次数」标签，宽度加大以容纳多位数字 -->
        <div class="flex h-7 w-[84px] shrink-0 overflow-hidden rounded border border-ink-500 bg-ink-800 text-[11px]">
          <button
            type="button"
            class="shrink-0 w-5 text-fog-300 hover:text-amber-brand disabled:opacity-30"
            :disabled="(row.qty ?? 1) <= 1"
            @click="stepQty(idx, -1)"
          >−</button>
          <input
            type="text"
            inputmode="numeric"
            class="min-w-0 flex-1 border-x border-ink-600 bg-transparent text-center text-fog-100 outline-none"
            :value="row.qty"
            @keydown.enter="setQty(idx, Number(($event.target as HTMLInputElement).value))"
            @blur="setQty(idx, Number(($event.target as HTMLInputElement).value))"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <button
            type="button"
            class="shrink-0 w-5 text-fog-300 hover:text-amber-brand"
            @click="stepQty(idx, 1)"
          >+</button>
        </div>

        <!-- 小计：链价值 × 次数 = 小计（未选实例时显示占位，避免出现「0 × 1 = 0」） -->
        <template v-if="previewInst(idx)">
          <span class="text-[11px] text-fog-300 tabular-nums">{{ lineOf(idx)?.chainValue ?? 0 }} × {{ row.qty ?? 1 }}</span>
          <span class="text-[11px] text-fog-500">=</span>
          <span class="text-[11px] font-bold text-amber-brand tabular-nums">{{ lineOf(idx)?.subtotal ?? 0 }}</span>
          <span
            v-if="lineOf(idx)?.missingPrice"
            class="rounded bg-warn/15 px-1 text-[10px] text-warn"
            title="该物资名缺单价，按 0 计"
          >缺单价</span>
        </template>
        <span v-else class="text-[11px] text-fog-500">选择实例后计算链价值</span>

        <!-- 配方预览：选中实例后显示，显示逻辑参考目标录入模块的实例 -->
        <div
          v-if="previewInst(idx)"
          class="flex min-w-[160px] flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 rounded border border-ink-600 bg-ink-800/60 px-1.5 py-1 text-[11px] leading-tight"
        >
          <template v-if="previewInst(idx)!.inputs.length">
            <span v-if="previewInst(idx)!.needsPower" class="rounded bg-amber-brand/15 px-1 text-amber-brand">⚡️</span>
            <template v-for="([nm, cnt], ii) in dedupeInputs(previewInst(idx)!.inputs)" :key="nm">
              <span class="rounded bg-ink-600/80 px-1 text-fog-100">{{ nm }}<template v-if="cnt > 1">×{{ cnt }}</template></span>
              <span v-if="ii < dedupeInputs(previewInst(idx)!.inputs).length - 1" class="text-fog-500">+</span>
            </template>
            <span class="text-fog-400">→</span>
            <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ previewInst(idx)!.name }}<template v-if="(previewInst(idx)!.perOut ?? 1) > 1"> ×{{ previewInst(idx)!.perOut }}</template></span>
            <span v-if="previewInst(idx)!.external" class="ml-1 rounded bg-fog-600/30 px-1 text-fog-300">外部</span>
          </template>
          <template v-else-if="previewInst(idx)!.external || previewInst(idx)!.initialSetup">
            <span v-if="previewInst(idx)!.needsPower" class="rounded bg-amber-brand/15 px-1 text-amber-brand">⚡️</span>
            <span class="rounded bg-fog-600/30 px-1 text-fog-300">{{ previewInst(idx)!.obtain ?? '外部' }}</span>
            <span class="text-fog-400">·</span>
            <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ previewInst(idx)!.name }}<template v-if="(previewInst(idx)!.perOut ?? 1) > 1"> ×{{ previewInst(idx)!.perOut }}</template></span>
          </template>
          <template v-else-if="previewInst(idx)!.needsPower">
            <span class="rounded bg-amber-brand/15 px-1.5 py-0.5 text-amber-brand">⚡️ 通电自动 {{ previewInst(idx)!.name }}<template v-if="(previewInst(idx)!.perOut ?? 1) > 1"> ×{{ previewInst(idx)!.perOut }}</template></span>
          </template>
          <template v-else>
            <span class="rounded bg-fog-600/30 px-1 text-fog-300">{{ previewInst(idx)!.obtain ?? '未知' }}</span>
            <span class="text-fog-400">·</span>
            <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ previewInst(idx)!.name }}</span>
          </template>
        </div>

        <button class="text-[11px] text-bad/80 hover:text-bad" @click="remove(idx)">删除此条</button>
      </div>
    </div>

    <!-- 底部：合计（去重）/ 目标 / 达标结论 / 重叠提示 / 链外叶子明细 -->
    <div v-if="rows.length" class="border-t border-ink-600 px-3 py-2 text-xs">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-fog-400">合计（去重） <span class="font-bold text-fog-100 tabular-nums">{{ plan.total }}</span></span>
        <span class="text-fog-500">｜</span>
        <span class="text-fog-400">目标 <span class="font-bold text-amber-brand tabular-nums">{{ target }}</span></span>
        <span class="text-fog-500">｜</span>
        <span
          class="inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium"
          :class="plan.total >= target
            ? 'border-good/30 bg-good/15 text-good'
            : 'border-warn/30 bg-warn/15 text-warn'"
        >
          {{ plan.total >= target ? `✅ 已达标（超出 ${plan.total - target}）` : `⚠️ 还差 ${target - plan.total}` }}
        </span>
      </div>
      <!-- 重叠提示：行小计之和与去重合计不等时说明差异 -->
      <div v-if="plan.sumRowSubtotals !== plan.total" class="mt-1 text-[11px] text-fog-500">
        行小计合计 {{ plan.sumRowSubtotals }}（含重叠，已去重为 {{ plan.total }}）
      </div>
      <!-- 链外叶子明细：需要外部获取的缺口物资（名称 × 数量，单价小字） -->
      <div v-if="plan.externals.length" class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-[11px] text-fog-500">链外叶子明细：</span>
        <span
          v-for="e in plan.externals"
          :key="e.name"
          class="inline-flex items-center gap-1 rounded border border-ink-500 bg-ink-800 px-1.5 py-0.5 text-[11px]"
        >
          <span class="text-fog-100">{{ e.name }} × {{ e.qty }}</span>
          <span class="text-[10px] text-fog-500">@{{ e.price }}</span>
          <span v-if="e.missingPrice" class="rounded bg-warn/15 px-1 text-[10px] text-warn" title="该物资名缺单价，按 0 计">缺价</span>
        </span>
      </div>
    </div>
    </template>
  </div>
</template>
