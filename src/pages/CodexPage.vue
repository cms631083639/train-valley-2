<script setup lang="ts">
/** 图鉴：列车等级 + 物资实例主表（对应飞书《列车》《物资主表》） */
import { computed, ref } from 'vue';
import { useGameStore } from '@/stores/game';
import { OBTAIN_LABEL } from '@/utils/format';
import AppIcon from '@/components/AppIcon.vue';

const store = useGameStore();
const kw = ref('');
const onlyPower = ref(false);

const resources = computed(() =>
  store.data.instances.filter(
    (r) =>
      (!kw.value || r.name.includes(kw.value) || r.id.includes(kw.value)) &&
      (!onlyPower.value || r.needsPower),
  ),
);

/** 该实例在生产链中的下游（谁把它作为配方输入） */
function consumersOf(name: string): string {
  const list = [...new Set(
    store.data.instances.filter((i) => i.inputs.includes(name)).map((i) => i.name),
  )];
  return list.join('、') || '—';
}
</script>

<template>
  <div>
    <div class="panel">
      <h2 class="panel-title"><AppIcon name="locomotive" :size="15" class="mr-1 text-amber-brand" />列车等级</h2>
      <table class="w-full text-[13px]">
        <thead><tr class="border-b border-ink-600 text-left">
          <th class="py-1.5">等级</th><th class="py-1.5">载货量</th><th class="py-1.5">购买价</th><th class="py-1.5">升级费</th><th class="py-1.5">可升级</th>
        </tr></thead>
        <tbody>
          <tr v-for="t in store.data.trains" :key="t.level" class="border-b border-ink-600/60">
            <td class="py-1.5 font-semibold">{{ t.level }}</td>
            <td class="py-1.5">{{ t.capacity }}</td>
            <td class="py-1.5">{{ t.price.toLocaleString() }}</td>
            <td class="py-1.5">{{ t.upgrade?.toLocaleString() ?? '—' }}</td>
            <td class="py-1.5"><AppIcon v-if="t.upgradable" name="check" :size="13" class="text-good" /><span v-else>—</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="panel-title mb-0"><AppIcon name="box" :size="15" class="mr-1 text-amber-brand" />物资实例图鉴</h2>
        <span class="flex-1" />
        <label class="flex items-center gap-1 text-xs text-fog-400">
          <input v-model="onlyPower" type="checkbox" /> 仅看需通电
        </label>
        <input v-model="kw" type="text" placeholder="搜索名称 / 实例ID" class="w-48" />
      </div>
      <table class="mt-3 w-full text-[13px]">
        <thead><tr class="border-b border-ink-600 text-left">
          <th class="py-1.5">物资（实例）</th><th class="py-1.5">配方输入</th><th class="py-1.5">外部获取</th>
          <th class="py-1.5">电力</th><th class="py-1.5">单产/单耗</th><th class="py-1.5">下游消耗方</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in resources" :key="r.id" class="border-b border-ink-600/60">
            <td class="py-1.5">
              <AppIcon :name="r.name" :size="15" class="mr-1 text-fog-100" />
              {{ r.name }}<span class="ml-1 font-mono text-[11px] text-fog-400">{{ r.id }}</span>
            </td>
            <td class="cell-muted py-1.5">{{ r.inputs.join('、') || '—' }}</td>
            <td class="py-1.5">{{ r.external ? (OBTAIN_LABEL[r.obtain!] ?? r.obtain) : '—' }}</td>
            <td class="py-1.5">
              <AppIcon v-if="r.needsPower" name="power" :size="13" class="text-amber-brand" /><span v-else>—</span>
            </td>
            <td class="py-1.5">
              <template v-if="r.perOut != null">{{ r.perOut }} / {{ r.perIn ?? 0 }}</template>
              <span v-else class="text-fog-500 italic text-[11px]">关卡动态</span>
            </td>
            <td class="cell-muted py-1.5">{{ consumersOf(r.name) }}</td>
          </tr>
          <tr v-if="!resources.length"><td colspan="6" class="py-2 text-fog-400">无匹配物资</td></tr>
        </tbody>
      </table>
      <p class="mt-2 text-xs text-fog-400">
        共 {{ resources.length }} 个实例 · 同名多实例=不同关卡的不同获取途径；电力只作通电条件，不计入消耗。
      </p>
    </div>
  </div>
</template>
