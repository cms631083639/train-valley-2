<script setup lang="ts">
/**
 * 管理员：建议审批页
 *
 * 只有 role=admin 可进入（路由 meta.requiresAdmin）。审批结果写回后端，
 * 采纳后由管理员手动改动关卡数据（Phase 0 不自动合并进 tv2.json）。
 */
import { computed, onMounted, ref } from 'vue';
import { http, errorMessage } from '@/utils/http';
import type { SuggestionItem, SuggestionStatus } from '@/types';
import AppIcon from '@/components/AppIcon.vue';

const FILTERS: { id: SuggestionStatus | 'all'; label: string }[] = [
  { id: 'pending', label: '待审批' },
  { id: 'approved', label: '已采纳' },
  { id: 'rejected', label: '未采纳' },
  { id: 'all', label: '全部' },
];

const filter = ref<SuggestionStatus | 'all'>('pending');
const list = ref<SuggestionItem[]>([]);
const loading = ref(false);
const error = ref('');
const note = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/api/suggestions', {
      params: filter.value === 'all' ? {} : { status: filter.value },
    });
    list.value = data.suggestions ?? [];
  } catch (e) {
    error.value = errorMessage(e, '加载失败');
  } finally {
    loading.value = false;
  }
}

async function review(item: SuggestionItem, status: 'approved' | 'rejected') {
  try {
    await http.post(`/api/suggestions/${encodeURIComponent(item.id)}/review`, { status, note: note.value });
    note.value = '';
    await load();
  } catch (e) {
    error.value = errorMessage(e, '审批失败');
  }
}

const pendingCount = computed(() => list.value.filter((s) => s.status === 'pending').length);

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function statusLabel(s: SuggestionStatus) {
  return s === 'pending' ? '待审批' : s === 'approved' ? '已采纳' : '未采纳';
}

function statusClass(s: SuggestionStatus) {
  if (s === 'pending') return 'border-amber-brand/50 text-amber-brand';
  if (s === 'approved') return 'border-good/50 text-good';
  return 'border-bad/50 text-bad';
}

onMounted(load);
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="panel">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="panel-title mb-0 flex items-center gap-2">
          <AppIcon name="check" :size="15" class="text-amber-brand" /> 用户修改建议
        </h2>
        <span class="flex-1" />
        <nav class="flex gap-0.5">
          <button
            v-for="f in FILTERS" :key="f.id"
            class="rounded border px-2 py-0.5 text-[11px] transition-colors"
            :class="filter === f.id
              ? 'border-amber-brand bg-amber-brand/10 text-amber-brand'
              : 'border-ink-600 text-fog-400 hover:border-ink-500 hover:text-fog-100'"
            @click="filter = f.id; load()"
          >{{ f.label }}</button>
        </nav>
      </div>

      <p v-if="error" class="mt-2 text-xs text-bad">{{ error }}</p>
      <p class="mt-2 text-xs text-fog-500">
        当前列表 {{ list.length }} 条 · 待审批 {{ pendingCount }} 条 · 采纳后请手动修改关卡数据
      </p>

      <div class="mt-2 flex items-center gap-2">
        <input v-model="note" type="text" placeholder="审批备注（可选，采纳/拒绝时一并保存）" class="w-80" />
      </div>

      <ul class="mt-3 flex flex-col gap-2">
        <li v-for="s in list" :key="s.id" class="rounded border border-ink-600/60 bg-ink-700/30 px-3 py-2">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="rounded border px-1 text-[10px]" :class="statusClass(s.status)">{{ statusLabel(s.status) }}</span>
            <span class="text-sm font-semibold text-fog-100">{{ s.title }}</span>
            <span class="text-[11px] text-fog-500">{{ s.category }} · {{ s.targetId || '全局' }}</span>
            <span class="flex-1" />
            <span class="text-[11px] text-fog-500">{{ s.author || s.userId }} · {{ fmtTime(s.createdAt) }}</span>
          </div>
          <p class="mt-1 whitespace-pre-wrap text-[13px] text-fog-100">{{ s.content }}</p>
          <p v-if="s.reviewNote" class="mt-1 text-[11px] text-fog-400">备注：{{ s.reviewNote }}</p>
          <div v-if="s.status === 'pending'" class="mt-2 flex gap-2">
            <button class="btn border-good/50 text-good hover:border-good hover:bg-good/10" @click="review(s, 'approved')">采纳</button>
            <button class="btn border-bad/50 text-bad hover:border-bad hover:bg-bad/10" @click="review(s, 'rejected')">拒绝</button>
          </div>
        </li>
        <li v-if="!list.length && !loading" class="py-4 text-center text-xs text-fog-500">暂无建议</li>
      </ul>
    </div>
  </div>
</template>
