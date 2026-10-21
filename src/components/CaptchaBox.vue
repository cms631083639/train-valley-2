<script setup lang="ts">
/**
 * 验证码统一组件（Phase 0 唯一入口）
 *
 * provider 由 `VITE_CAPTCHA_PROVIDER` 决定，对外契约固定为 CaptchaPayload：
 * - simple    → 自研 6 位图形码（Mock / 本地阶段用）
 * - turnstile → Cloudflare Turnstile（Phase 1 正式上线用）
 * 业务页面只写 `<CaptchaBox v-model="captcha" />`，不出现任何 provider 判断。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CaptchaPayload } from '@/types';
import AppIcon from '@/components/AppIcon.vue';

const props = defineProps<{
  /** 便于父组件在提交失败后重置 */
  label?: string;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', v: CaptchaPayload | null): void }>();

const PROVIDER = (import.meta.env.VITE_CAPTCHA_PROVIDER || 'simple') as 'simple' | 'turnstile';
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const turnstileRef = ref<HTMLDivElement | null>(null);
const challengeId = ref('');
const answer = ref('');
const token = ref('');
const error = ref('');
const loading = ref(false);

const payload = computed<CaptchaPayload | null>(() => {
  if (PROVIDER === 'turnstile') return token.value ? { provider: 'turnstile', token: token.value } : null;
  if (!challengeId.value || !answer.value.trim()) return null;
  return { provider: 'simple', challengeId: challengeId.value, answer: answer.value.trim().toUpperCase() };
});

watch(payload, (v) => emit('update:modelValue', v), { immediate: true });

// ————————— simple：自研图形码 —————————

/** 在 canvas 上绘制验证码（字符 + 干扰线 + 噪点） */
function draw(code: string) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.fillStyle = '#232b36';
  ctx.fillRect(0, 0, width, height);

  // 干扰线
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = `rgba(139,152,169,${0.25 + Math.random() * 0.25})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.random() * width, Math.random() * height);
    ctx.lineTo(Math.random() * width, Math.random() * height);
    ctx.stroke();
  }

  // 字符
  const step = width / (code.length + 1);
  for (let i = 0; i < code.length; i++) {
    const x = step * (i + 1);
    const y = height / 2 + (Math.random() - 0.5) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.5);
    ctx.font = 'bold 20px "Segoe UI", monospace';
    ctx.fillStyle = '#e6ebf2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }

  // 噪点
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(230,235,242,0.35)';
    ctx.fillRect(Math.random() * width, Math.random() * height, 1, 1);
  }
}

/** 向 Mock 后端领取新挑战（正式实现里应只在简单码阶段存在） */
async function loadChallenge() {
  loading.value = true;
  error.value = '';
  answer.value = '';
  token.value = '';
  try {
    const resp = await fetch('/api/captcha/challenge');
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.msg || '获取验证码失败');
    challengeId.value = data.id;
    await nextTick();
    draw(data.code);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

// ————————— turnstile：Phase 1 分支 —————————

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

let widgetId = '';

function loadTurnstileScript(): Promise<TurnstileApi | null> {
  if (!TURNSTILE_SITE_KEY) {
    error.value = '未配置 VITE_TURNSTILE_SITE_KEY，验证码不可用';
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (existing) return resolve(existing);
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile?: TurnstileApi }).turnstile || null);
    script.onerror = () => {
      error.value = 'Turnstile 脚本加载失败（国内网络可能受限）';
      resolve(null);
    };
    document.head.appendChild(script);
  });
}

async function mountTurnstile() {
  const api = await loadTurnstileScript();
  if (!api || !turnstileRef.value) return;
  widgetId = api.render(turnstileRef.value, {
    sitekey: TURNSTILE_SITE_KEY,
    callback: (t: string) => {
      token.value = t;
      error.value = '';
    },
    'expired-callback': () => {
      token.value = '';
    },
  });
}

/** 父组件提交失败后可调用，重置验证码 */
function reset() {
  if (PROVIDER === 'turnstile') {
    token.value = '';
    const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (api && widgetId) {
      api.remove(widgetId);
      widgetId = '';
      mountTurnstile();
    }
    return;
  }
  loadChallenge();
}

/** 供父组件在提交失败后重置验证码 */
defineExpose({ reset });

onMounted(() => {
  if (PROVIDER === 'turnstile') mountTurnstile();
  else loadChallenge();
});

onBeforeUnmount(() => {
  const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
  if (api && widgetId) api.remove(widgetId);
});
</script>

<template>
  <div class="flex flex-col gap-1">
    <span v-if="props.label" class="text-[11px] text-fog-400">{{ props.label }}</span>

    <!-- simple：图形码 + 输入框 -->
    <div v-if="PROVIDER === 'simple'" class="flex items-center gap-2">
      <canvas ref="canvasRef" width="120" height="36" class="rounded border border-ink-600 bg-ink-700" />
      <button
        type="button"
        class="btn flex h-9 w-9 shrink-0 items-center justify-center p-0"
        :disabled="loading"
        title="换一张"
        @click="loadChallenge"
      >
        <AppIcon name="reset" :size="13" />
      </button>
      <input
        v-model="answer"
        type="text"
        inputmode="text"
        maxlength="6"
        placeholder="验证码"
        class="h-9 w-28 text-center uppercase tracking-[0.2em]"
      />
    </div>

    <!-- turnstile：Cloudflare 托管 widget -->
    <div v-else ref="turnstileRef" class="min-h-[64px]" />

    <span v-if="error" class="text-[11px] text-bad">{{ error }}</span>
  </div>
</template>
