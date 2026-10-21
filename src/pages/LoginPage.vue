<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import CaptchaBox from '@/components/CaptchaBox.vue';
import type { CaptchaPayload } from '@/types';
import AppIcon from '@/components/AppIcon.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref('');
const password = ref('');
const captcha = ref<CaptchaPayload | null>(null);
const captchaBox = ref<InstanceType<typeof CaptchaBox> | null>(null);

const canSubmit = computed(() => !!email.value.trim() && !!password.value && !!captcha.value && !auth.loading);

async function submit() {
  if (!canSubmit.value) return;
  const ok = await auth.login(email.value.trim(), password.value, captcha.value!);
  if (ok) {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.replace(redirect);
  } else {
    captchaBox.value?.reset();
  }
}
</script>

<template>
  <div class="flex h-full items-start justify-center overflow-y-auto py-10">
    <form class="panel w-[360px]" @submit.prevent="submit">
      <h2 class="panel-title flex items-center gap-2">
        <AppIcon name="locomotive" :size="16" class="text-amber-brand" /> 登录
      </h2>
      <p class="mb-4 text-xs text-fog-400">公开攻略无需登录；登录后可评论、点赞、提交修改建议。</p>

      <label class="mb-3 flex flex-col gap-1">
        <span class="text-[11px] text-fog-400">邮箱</span>
        <input v-model="email" type="email" autocomplete="username" placeholder="you@example.com" />
      </label>

      <label class="mb-3 flex flex-col gap-1">
        <span class="text-[11px] text-fog-400">密码</span>
        <input v-model="password" type="password" autocomplete="current-password" placeholder="至少 8 位" />
      </label>

      <CaptchaBox ref="captchaBox" v-model="captcha" label="验证码" class="mb-3" />

      <p v-if="auth.error" class="mb-3 text-xs text-bad">{{ auth.error }}</p>

      <button type="submit" class="btn btn-primary w-full py-1.5" :disabled="!canSubmit">
        {{ auth.loading ? '登录中…' : '登录' }}
      </button>

      <p class="mt-3 text-center text-xs text-fog-400">
        还没有账号？
        <RouterLink to="/register" class="text-steel-brand hover:text-amber-brand">去注册</RouterLink>
      </p>
    </form>
  </div>
</template>
