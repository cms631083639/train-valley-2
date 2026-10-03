<script setup lang="ts">
/** 物资实例管理（CRUD） */
import { CATEGORY, FILTER_ALL } from '@/constants';
import { computed, ref } from 'vue';
import { useGameStore } from '@/stores/game';
import type { ResourceInstance } from '@/types';
import InstanceForm from '@/components/InstanceForm.vue';

const store = useGameStore();

const kw = ref('');
const filterExternal = ref<'all' | 'yes' | 'no'>('all');
const filterNeedsPower = ref<'all' | 'yes' | 'no'>('all');
const filterObtain = ref<'all' | '刷新' | '购买' | '无限' | '库存' | '客流'>('all');

const showForm = ref(false);
const editing = ref<ResourceInstance | null>(null);
const flash = ref('');

function classifyType(r: ResourceInstance): 'raw' | 'processed' | 'compound' {
  if (r.external) return CATEGORY.RAW;
  const nonWorker = r.inputs.filter((i) => i !== '工人');
  if (nonWorker.length === 0) return CATEGORY.RAW;       // 只有工人 → 原料
  if (nonWorker.length === 1) return CATEGORY.PROCESSED;   // 1 种原料 → 加工品
  return CATEGORY.COMPOUND;                                // ≥2 种 → 复合品
}

const filtered = computed(() => {
  return store.data.instances.filter((r) => {
    if (kw.value && !r.name.includes(kw.value) && !r.id.includes(kw.value)) return false;
    if (filterExternal.value === 'yes' && !r.external) return false;
    if (filterExternal.value === 'no' && r.external) return false;
    if (filterNeedsPower.value === 'yes' && !r.needsPower) return false;
    if (filterNeedsPower.value === 'no' && r.needsPower) return false;
    if (filterObtain.value !== FILTER_ALL && r.obtain !== filterObtain.value) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
});

const counts = computed(() => {
  const total = store.data.instances.length;
  const byName = new Map<string, number>();
  store.data.instances.forEach((i) => byName.set(i.name, (byName.get(i.name) ?? 0) + 1));
  return { total, names: byName.size };
});

function flashMsg(msg: string) {
  flash.value = msg;
  setTimeout(() => flash.value = '', 2500);
}

function onNew() { editing.value = null; showForm.value = true; }
function onEdit(r: ResourceInstance) { editing.value = r; showForm.value = true; }

function onSubmit(data: ResourceInstance) {
  if (editing.value) {
    const res = store.instanceUpdate(editing.value.id, data);
    if (!res.ok) { flashMsg('❌ ' + (res.msg ?? '更新失败')); return; }
    flashMsg(`✅ 已更新 ${data.id}`);
  } else {
    const res = store.instanceAdd(data);
    if (!res.ok) { flashMsg('❌ ' + (res.msg ?? '新增失败')); return; }
    flashMsg(`✅ 已新增 ${data.id}`);
  }
  showForm.value = false;
}

function onRemove(r: ResourceInstance) {
  const ok = confirm(`⚠️ 确认删除实例「${r.id}」？\n\n可能引用该实例的关卡目标会报错。\n此操作不可恢复。`);
  if (!ok) return;
  const res = store.instanceRemove(r.id);
  if (res.ok) flashMsg(`✅ 已删除 ${r.id}`);
  else flashMsg('❌ ' + (res.msg ?? '删除失败'));
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <!-- 工具栏（固定） -->
    <div class="panel shrink-0">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="panel-title mb-0">📦 物资实例管理</h2>
        <span class="text-xs text-fog-500">{{ counts.total }} 个实例 · {{ counts.names }} 种物资名</span>
        <span class="flex-1" />

        <input v-model="kw" class="w-[180px]" placeholder="🔍 搜实例ID / 物资名" />

        <select v-model="filterExternal" class="w-[110px]">
          <option value="all">全部来源</option>
          <option value="yes">外部获取</option>
          <option value="no">工人生产</option>
        </select>
        <select v-model="filterNeedsPower" class="w-[110px]">
          <option value="all">电力不限</option>
          <option value="yes">⚡ 需要电力</option>
          <option value="no">无需电力</option>
        </select>
        <select v-model="filterObtain" class="w-[110px]">
          <option value="all">获取不限</option>
          <option value="刷新">刷新</option>
          <option value="购买">购买</option>
          <option value="无限">无限</option>
          <option value="库存">库存</option>
          <option value="客流">客流</option>
        </select>

        <button class="btn !px-3 bg-amber-brand text-ink-900 hover:bg-amber-brand/80" @click="onNew">➕ 新增实例</button>
      </div>
      <div v-if="flash" class="mt-2 text-xs" :class="flash.startsWith('✅') ? 'text-good' : 'text-bad'">{{ flash }}</div>
    </div>

    <!-- 列表容器（独立滚动） -->
    <div class="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <!-- 表头 -->
      <div class="flex shrink-0 items-center border-b border-ink-600 text-[11px] font-medium uppercase tracking-wider text-fog-400">
        <div class="w-[110px] px-2 py-1.5">实例ID</div>
        <div class="w-[110px] px-2 py-1.5">物资名称</div>
        <div class="w-[80px] px-2 py-1.5 text-center">类型</div>
        <div class="w-[80px] px-2 py-1.5 text-center">⚡电力</div>
        <div class="w-[100px] px-2 py-1.5 text-center">获取方式</div>
        <div class="w-[140px] px-2 py-1.5">配方输入</div>
        <div class="w-[100px] px-2 py-1.5 text-center">产出·消耗</div>
        <div class="w-[160px] px-2 py-1.5 text-center">备注</div>
        <div class="flex-1" />
        <div class="w-[100px] px-2 py-1.5 text-center">操作</div>
      </div>

      <!-- 滚动行区 -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="!filtered.length" class="py-6 text-center text-xs text-fog-500">没有匹配的实例</div>

        <div v-for="r in filtered" :key="r.id" class="flex items-center border-b border-ink-600/50 py-1.5 text-[12px] hover:bg-ink-700/30">
          <div class="w-[110px] font-mono text-fog-100 truncate px-2" :title="r.id">{{ r.id }}</div>
          <div class="w-[110px] text-fog-200 truncate px-2" :title="r.name">{{ r.name }}</div>

          <div class="flex w-[80px] justify-center px-2">
            <span class="whitespace-nowrap rounded border px-1.5 py-0.5 text-center text-[11px] font-medium"
              :class="{
                'border-good/30 bg-good/15 text-good': classifyType(r) === CATEGORY.RAW,
                'border-steel-brand/30 bg-steel-brand/15 text-steel-brand': classifyType(r) === CATEGORY.PROCESSED,
                'border-amber-brand/30 bg-amber-brand/15 text-amber-brand': classifyType(r) === CATEGORY.COMPOUND,
              }">
              {{ classifyType(r) === CATEGORY.RAW ? '原料' : classifyType(r) === CATEGORY.PROCESSED ? '加工品' : '复合品' }}
            </span>
          </div>

          <div class="w-[80px] px-2 text-center">
            <span v-if="r.needsPower" class="text-[11px] text-amber-brand">⚡ 需电</span>
            <span v-else class="text-[11px] text-fog-500">—</span>
          </div>

          <div class="w-[100px] px-2 text-center">
            <span v-if="r.external || r.obtain" class="rounded border border-fog-500/40 px-1.5 py-0.5 text-[11px] text-fog-200">{{ r.obtain ?? '外部' }}</span>
            <span v-else class="text-[11px] text-fog-500">工人生产</span>
          </div>

          <div class="w-[140px] truncate px-2 text-fog-400" :title="r.inputs.join(' + ') || '—'">
            {{ r.inputs.length ? r.inputs.join(' + ') : '—' }}
          </div>

          <div class="w-[100px] px-2 text-center text-fog-300">
            <template v-if="!r.external && (r.perOut || r.perIn)">{{ r.perOut ?? '?' }} · {{ r.perIn ?? '?' }}</template>
            <template v-else><span class="text-fog-500">—</span></template>
          </div>

          <div class="w-[160px] truncate px-2 text-fog-400 text-[11px]" :title="r.notes || ''">{{ r.notes || '—' }}</div>

          <div class="flex-1" />

          <div class="w-[100px] px-2 text-center">
            <button class="mr-2 text-[11px] text-steel-brand hover:text-fog-100" @click="onEdit(r)">编辑</button>
            <button class="text-[11px] text-bad/80 hover:text-bad" @click="onRemove(r)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <InstanceForm
      v-if="showForm"
      :original="editing"
      :existing-ids="store.data.instances.map((i) => i.id)"
      @close="showForm = false"
      @submit="onSubmit"
    />
  </div>
</template>
