<script setup lang="ts">
/**
 * 页面评论区（关卡 / 图鉴页复用）
 *
 * targetType + targetId 对应后端 comments.target_type / target_id。
 * 未登录时只读：可以看评论与点赞数，但不能发评论 / 点赞。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { http, errorMessage } from '@/utils/http';
import type { CommentItem } from '@/types';
import AppIcon from '@/components/AppIcon.vue';

const props = defineProps<{
  targetType: 'level' | 'instance';
  targetId: string;
}>();

const auth = useAuthStore();
const comments = ref<CommentItem[]>([]);
const content = ref('');
const loading = ref(false);
const error = ref('');
const likeCount = ref(0);
const liked = ref(false);

const canPost = computed(() => auth.isLoggedIn && !!content.value.trim() && !loading.value);

async function loadComments() {
  if (!props.targetId) {
    comments.value = [];
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const { data } = await http.get('/api/comments', {
      params: { targetType: props.targetType, targetId: props.targetId },
    });
    comments.value = data.comments ?? [];
    const likeResp = await http.get('/api/likes', {
      params: { targetType: props.targetType, targetId: props.targetId },
    });
    likeCount.value = likeResp.data.count ?? 0;
    liked.value = !!likeResp.data.liked;
  } catch (e) {
    error.value = errorMessage(e, '评论加载失败');
  } finally {
    loading.value = false;
  }
}

async function postComment() {
  if (!canPost.value) return;
  loading.value = true;
  error.value = '';
  try {
    await http.post('/api/comments', {
      targetType: props.targetType,
      targetId: props.targetId,
      content: content.value.trim(),
    });
    content.value = '';
    await loadComments();
  } catch (e) {
    error.value = errorMessage(e, '评论失败');
  } finally {
    loading.value = false;
  }
}

async function removeComment(id: string) {
  try {
    await http.delete(`/api/comments/${encodeURIComponent(id)}`);
    await loadComments();
  } catch (e) {
    error.value = errorMessage(e, '删除失败');
  }
}

async function toggleLike() {
  if (!auth.isLoggedIn) {
    error.value = '登录后才能点赞';
    return;
  }
  try {
    const { data } = await http.post('/api/likes', { targetType: props.targetType, targetId: props.targetId });
    liked.value = !!data.liked;
    likeCount.value = data.count ?? 0;
  } catch (e) {
    error.value = errorMessage(e, '点赞失败');
  }
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

onMounted(loadComments);
watch(() => props.targetId, loadComments);
</script>

<template>
  <div class="panel">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="panel-title mb-0 text-sm">💬 讨论（{{ comments.length }}）</h3>
      <span class="flex-1" />
      <button
        class="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors"
        :class="liked ? 'border-amber-brand bg-amber-brand/10 text-amber-brand' : 'border-ink-600 text-fog-400 hover:border-ink-500'"
        @click="toggleLike"
      >
        <AppIcon name="target" :size="11" /> {{ likeCount }} 赞
      </button>
    </div>

    <!-- 发表框 -->
    <div v-if="auth.isLoggedIn" class="mt-3 flex flex-col gap-2">
      <textarea
        v-model="content"
        rows="2"
        maxlength="1000"
        placeholder="友善讨论，说说你的过关思路…"
        class="w-full resize-y rounded border border-ink-600 bg-ink-700 px-2.5 py-1.5 text-[13px] text-fog-100 outline-none focus:outline focus:outline-1 focus:outline-steel-brand"
      />
      <div class="flex items-center gap-2">
        <button class="btn btn-primary" :disabled="!canPost" @click="postComment">{{ loading ? '发送中…' : '发表评论' }}</button>
        <span class="text-[11px] text-fog-500">{{ content.length }}/1000</span>
      </div>
    </div>
    <p v-else class="mt-3 text-xs text-fog-400">
      登录后可参与讨论 ·
      <RouterLink to="/login" class="text-steel-brand hover:text-amber-brand">去登录</RouterLink>
    </p>

    <p v-if="error" class="mt-2 text-xs text-bad">{{ error }}</p>

    <!-- 列表 -->
    <ul class="mt-3 flex flex-col gap-2">
      <li v-for="c in comments" :key="c.id" class="rounded border border-ink-600/60 bg-ink-700/30 px-3 py-2">
        <div class="flex items-baseline gap-2">
          <span class="text-xs font-medium text-fog-100">{{ c.author }}</span>
          <span class="text-[11px] text-fog-500">{{ fmtTime(c.createdAt) }}</span>
          <span class="flex-1" />
          <button v-if="c.mine || auth.isAdmin" class="text-[11px] text-fog-500 hover:text-bad" @click="removeComment(c.id)">删除</button>
        </div>
        <p class="mt-1 whitespace-pre-wrap text-[13px] text-fog-100">{{ c.content }}</p>
      </li>
      <li v-if="!comments.length && !loading" class="py-3 text-center text-xs text-fog-500">还没有评论，来抢沙发</li>
    </ul>
  </div>
</template>
