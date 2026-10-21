<script setup lang="ts">
/**
 * 修改建议提交面板
 *
 * 只读用户不能直接改数据，只能提交 pending 建议，由管理员在「建议审批」页处理。
 */
import { ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { http, errorMessage } from '@/utils/http';
import type { SuggestionItem } from '@/types';
import AppIcon from '@/components/AppIcon.vue';

const props = defineProps<{
  /** 关联对象类型：level / instance / layout */
  category: 'level' | 'instance' | 'layout';
  targetId: string;
}>();

const auth = useAuthStore();
const open = ref(false);
const title = ref('');
const content = ref('');
const sending = ref(false);
const error = ref('');
const done = ref(false);
const mine = ref<SuggestionItem[]>([]);

async function toggle() {
  open.value = !open.value;
  if (open.value && auth.isLoggedIn) await loadMine();
}

async function loadMine() {
  try {
    const { data } = await http.get('/api/suggestions/me');
    mine.value = (data.suggestions ?? []).filter((s: SuggestionItem) => s.targetId === props.targetId);
  } catch {
    /* 未登录 / 网络异常时忽略 */
  }
}

async function submit() {
  if (!title.value.trim() || !content.value.trim() || sending.value) return;
  sending.value = true;
  error.value = '';
  try {
    await http.post('/api/suggestions', {
      category: props.category,
      targetId: props.targetId,
      title: title.value.trim(),
      content: content.value.trim(),
    });
    title.value = '';
    content.value = '';
    done.value = true;
    await loadMine();
  } catch (e) {
    error.value = errorMessage(e, '提交失败');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="panel">
    <div class="flex items-center gap-2">
      <h3 class="panel-title mb-0 text-sm">📝 发现数据有误？</h3>
      <span class="flex-1" />
      <button class="btn" @click="toggle">{{ open ? '收起' : '提交修改建议' }}</button>
    </div>

    <div v-if="open" class="mt-3 flex flex-col gap-2">
      <p v-if="!auth.isLoggedIn" class="text-xs text-fog-400">
        提交建议需要先登录 ·
        <RouterLink to="/login" class="text-steel-brand hover:text-amber-brand">去登录</RouterLink>
      </p>
      <template v-else>
        <input v-model="title" type="text" placeholder="建议标题，如「基辅关卡限时应为 5:30」" />
        <textarea
          v-model="content"
          rows="3"
          maxlength="2000"
          placeholder="说明哪里不对、正确值是什么，最好附上依据…"
          class="w-full resize-y rounded border border-ink-600 bg-ink-700 px-2.5 py-1.5 text-[13px] text-fog-100 outline-none focus:outline focus:outline-1 focus:outline-steel-brand"
        />
        <div class="flex items-center gap-2">
          <button class="btn btn-primary" :disabled="!title.trim() || !content.trim() || sending" @click="submit">
            <AppIcon name="export" :size="12" class="mr-1 inline align-[-0.1em]" />{{ sending ? '提交中…' : '提交建议' }}
          </button>
          <span v-if="done" class="text-[11px] text-good">已提交，等待管理员审批</span>
        </div>
        <p v-if="error" class="text-xs text-bad">{{ error }}</p>

        <div v-if="mine.length" class="mt-1 flex flex-col gap-1 border-t border-ink-600/60 pt-2">
          <span class="text-[11px] text-fog-400">我提交过的建议</span>
          <div v-for="s in mine" :key="s.id" class="flex items-center gap-2 text-[11px]">
            <span
              class="rounded border px-1"
              :class="s.status === 'pending'
                ? 'border-amber-brand/50 text-amber-brand'
                : s.status === 'approved'
                  ? 'border-good/50 text-good'
                  : 'border-bad/50 text-bad'"
            >
              {{ s.status === 'pending' ? '待审' : s.status === 'approved' ? '已采纳' : '未采纳' }}
            </span>
            <span class="text-fog-100">{{ s.title }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
