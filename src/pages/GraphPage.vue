<script setup lang="ts">
/**
 * 生产链依赖图（按物资名称）
 *
 * 节点 = 物资名称；边 = 某实例把输入名称加工成输出名称。
 * 分层 = 从"无输入物资"起的最长链深度。
 * 电力是特殊外部供给源：黄色虚线节点，只连"需要通电的站点"，不参与消耗链。
 */
import { computed, ref } from 'vue';
import { POWER_NAME } from '@/types';
import { useGameStore } from '@/stores/game';
import { resolveIcon } from '@/icons/registry';
import AppIcon from '@/components/AppIcon.vue';

const store = useGameStore();
const focus = ref('');

type GNode = { name: string; col: number; producers: number };
type GEdge = { from: string; to: string; label: string; power?: boolean };

/** 名称依赖图：input → name */
const graph = computed(() => {
  const names = new Set(store.resourceNames);
  const deps = new Map<string, string[]>();   // name -> inputs（消耗关系）
  const powerUsers = new Set<string>();       // needsPower 的产出名称
  for (const it of store.data.instances) {
    if (!it.inputs.length) continue;
    const ins = it.inputs.filter((i) => names.has(i) && i !== POWER_NAME);
    deps.set(it.name, [...(deps.get(it.name) ?? []), ...ins]);
    if (it.needsPower) powerUsers.add(it.name);
  }
  return { names, deps, powerUsers };
});

/** 分层：无输入 = 第 0 层，其余 = max(输入层)+1（迭代松弛，成环时截断） */
const layer = computed(() => {
  const L = new Map<string, number>();
  for (const n of graph.value.names) L.set(n, 0);
  for (let pass = 0; pass < 24; pass++) {
    let changed = false;
    for (const [name, ins] of graph.value.deps) {
      const want = Math.max(0, ...ins.map((i) => (L.get(i) ?? 0) + 1));
      if (want > (L.get(name) ?? 0)) { L.set(name, want); changed = true; }
    }
    if (!changed) break;
  }
  return L;
});

/** 聚焦：反推上游 + 正推下游 */
const visible = computed<Set<string> | null>(() => {
  if (!focus.value || !graph.value.names.has(focus.value)) return null;
  const set = new Set<string>([focus.value]);
  const up = [focus.value];
  while (up.length) {
    for (const i of graph.value.deps.get(up.pop()!) ?? []) {
      if (!set.has(i)) { set.add(i); up.push(i); }
    }
  }
  const down = [focus.value];
  while (down.length) {
    const n = down.pop()!;
    for (const [name, ins] of graph.value.deps) {
      if (ins.includes(n) && !set.has(name)) { set.add(name); down.push(name); }
    }
  }
  return set;
});

const nodes = computed<GNode[]>(() => {
  const list: GNode[] = [];
  for (const name of graph.value.names) {
    if (visible.value && !visible.value.has(name)) continue;
    const producers = store.data.instances.filter((i) => i.name === name && i.inputs.length).length;
    list.push({ name, col: layer.value.get(name) ?? 0, producers });
  }
  return list;
});

const edges = computed<GEdge[]>(() => {
  const es: GEdge[] = [];
  for (const [name, ins] of graph.value.deps) {
    if (visible.value && !visible.value.has(name)) continue;
    for (const i of ins) {
      if (visible.value && !visible.value.has(i)) continue;
      es.push({ from: i, to: name, label: '' });
    }
  }
  // 电力条件边：虚线，指向需通电站点
  if (!visible.value || visible.value.has(POWER_NAME)) {
    for (const name of graph.value.powerUsers) {
      if (visible.value && !visible.value.has(name)) continue;
      es.push({ from: POWER_NAME, to: name, label: '⚡', power: true });
    }
  }
  return es;
});

const COL_GAP = 150;
const ROW_GAP = 46;

const pos = computed(() => {
  const byCol = new Map<number, GNode[]>();
  for (const n of nodes.value) {
    const arr = byCol.get(n.col) ?? [];
    arr.push(n);
    byCol.set(n.col, arr);
  }
  const maxRows = Math.max(1, ...[...byCol.values()].map((a) => a.length));
  const p = new Map<string, { x: number; y: number }>();
  const height = maxRows * ROW_GAP + 60;
  for (const [col, arr] of byCol) {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    arr.forEach((n, i) => p.set(n.name, { x: 90 + col * COL_GAP, y: 40 + i * ROW_GAP + (height - arr.length * ROW_GAP) / 2 - 20 }));
  }
  return { p, height, width: 90 + (Math.max(0, ...nodes.value.map((n) => n.col)) + 1) * COL_GAP };
});

const shownInstances = computed(() => {
  if (!focus.value) return [];
  return store.data.instances.filter((i) => i.name === focus.value);
});
</script>

<template>
  <div>
    <div class="panel">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="panel-title mb-0"><AppIcon name="graph" :size="15" class="mr-1 text-amber-brand" />生产链依赖图（按物资名称）</h2>
        <span class="flex-1" />
        <label class="flex items-center gap-1.5 text-xs text-fog-400">聚焦物资：
          <select v-model="focus">
            <option value="">全部</option>
            <option v-for="n in store.resourceNames" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <button v-if="focus" class="btn" @click="focus = ''">清除</button>
      </div>
      <p class="mt-1.5 text-xs text-fog-400">
        实线=消耗关系（左输入 → 右产出） · <span class="text-amber-brand">黄色虚线⚡=通电条件（发电消耗不计入总需求）</span> · 点击节点只看该物资的上下游。
      </p>
    </div>

    <div class="panel overflow-x-auto">
      <svg :width="pos.width" :height="pos.height" class="block">
        <g v-for="(e, i) in edges" :key="`e${i}`">
          <template v-if="pos.p.has(e.from) && pos.p.has(e.to)">
            <path
              :d="`M ${pos.p.get(e.from)!.x} ${pos.p.get(e.from)!.y} C ${(pos.p.get(e.from)!.x + pos.p.get(e.to)!.x) / 2} ${pos.p.get(e.from)!.y}, ${(pos.p.get(e.from)!.x + pos.p.get(e.to)!.x) / 2} ${pos.p.get(e.to)!.y}, ${pos.p.get(e.to)!.x} ${pos.p.get(e.to)!.y}`"
              fill="none"
              :stroke="e.power ? '#e8a33d' : '#3a4656'"
              :stroke-dasharray="e.power ? '4 3' : undefined"
              stroke-width="1.2"
            />
            <text v-if="e.power"
              :x="(pos.p.get(e.from)!.x + pos.p.get(e.to)!.x) / 2"
              :y="(pos.p.get(e.from)!.y + pos.p.get(e.to)!.y) / 2 - 4"
              text-anchor="middle" class="fill-amber-brand text-[11px]"
            >⚡</text>
          </template>
        </g>

        <template v-for="n in nodes" :key="n.name">
          <g v-if="pos.p.has(n.name)" class="cursor-pointer" @click="focus = n.name">
            <circle :cx="pos.p.get(n.name)!.x" :cy="pos.p.get(n.name)!.y" r="13" fill="#1b212a"
              :stroke="n.name === POWER_NAME ? '#e8a33d' : n.producers ? '#4f9dd9' : '#58b368'" stroke-width="1.4" />
            <use
              :href="`#icon-${resolveIcon(n.name)}`"
              :x="pos.p.get(n.name)!.x - 8" :y="pos.p.get(n.name)!.y - 8" width="16" height="16"
              :style="{ color: n.name === POWER_NAME ? '#e8a33d' : n.producers ? '#4f9dd9' : '#58b368' }"
            />
            <text :x="pos.p.get(n.name)!.x" :y="pos.p.get(n.name)!.y - 19" text-anchor="middle" class="text-[12px]">
              {{ n.name }}
            </text>
          </g>
        </template>
      </svg>
      <p class="mt-1 text-xs text-fog-400">绿=无配方输入（外部/采集） · 蓝=有生产配方 · 黄=电力（特殊外部供给源）</p>
    </div>

    <div v-if="focus" class="panel">
      <h2 class="panel-title">「{{ focus }}」的全部实例（物资主表）</h2>
      <table class="w-full text-[13px]">
        <thead><tr class="border-b border-ink-600 text-left">
          <th class="py-1.5">实例ID</th><th class="py-1.5">配方输入</th><th class="py-1.5">外部获取</th><th class="py-1.5">电力依赖</th><th class="py-1.5">单产/单耗</th>
        </tr></thead>
        <tbody>
          <tr v-for="it in shownInstances" :key="it.id" class="border-b border-ink-600/60">
            <td class="py-1.5 font-mono text-xs">{{ it.id }}</td>
            <td class="cell-muted py-1.5">{{ it.inputs.join('、') || '—' }}</td>
            <td class="py-1.5">{{ it.external ? it.obtain : '—' }}</td>
            <td class="py-1.5"><AppIcon v-if="it.needsPower" name="power" :size="13" class="text-amber-brand" /><span v-else>—</span></td>
            <td class="py-1.5">
              <template v-if="it.perOut != null">{{ it.perOut }} / {{ it.perIn ?? 0 }}</template>
              <span v-else class="text-fog-500 italic text-[11px]">关卡动态</span>
            </td>
          </tr>
          <tr v-if="!shownInstances.length"><td colspan="5" class="py-2 text-fog-400">无该物资实例</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
