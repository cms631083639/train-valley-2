<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import CaptchaBox from '@/components/CaptchaBox.vue';
import type { CaptchaPayload } from '@/types';
import AppIcon from '@/components/AppIcon.vue';

const auth = useAuthStore();
const router = useRouter();

const email = ref('');
const nickname = ref('');
const password = ref('');
const confirm = ref('');
const captcha = ref<CaptchaPayload | null>(null);
const captchaBox = ref<InstanceType<typeof CaptchaBox> | null>(null);
const localError = ref('');

const canSubmit = computed(
  () => !!email.value.trim() && password.value.length >= 8 && !!captcha.value && !auth.loading,
);

async function submit() {
  localError.value = '';
  if (!canSubmit.value) return;
  if (password.value !== confirm.value) {
    localError.value = '两次输入的密码不一致';
    return;
  }
  const ok = await auth.register(email.value.trim(), password.value, nickname.value.trim(), captcha.value!);
  if (ok) {
    router.replace('/');
  } else {
    captchaBox.value?.reset();
  }
}
</script>

<template>
  <div class="flex h-full items-start justify-center overflow-y-auto py-10">
    <form class="panel w-[360px]" @submit.prevent="submit">
      <h2 class="panel-title flex items-center gap-2">
        <AppIcon name="locomotive" :size="16" class="text-amber-brand" /> 注册
      </h2>
      <p class="mb-4 text-xs text-fog-400">注册后即可评论、点赞、提交修改建议（建议需管理员审批）。</p>

      <label class="mb-3 flex flex-col gap-1">
        <span class="text-[11px] text-fog-400">邮箱</span>
        <input v-model="email" type="email" autocomplete="username" placeholder="you@example.com" />
      </label>

      <label class="mb-3 flex flex-col gap-1">
        <span class="text-[11px] text-fog-400">昵称（可选）</span>
        <input v-model="nickname" type="text" placeholder="留空则用邮箱前缀" />
      </label>

      <label class="mb-3 flex flex-col gap-1">
        <span class="text-[11px] text-fog-400">密码</span>
        <input v-model="password" type="password" autocomplete="new-password" placeholder="至少 8 位" />
      </label>

      <label class="mb-3 flex flex-col gap-1">
        <span class="text-[11px] text-fog-400">确认密码</span>
        <input v-model="confirm" type="password" autocomplete="new-password" placeholder="再输一次" />
      </label>

      <CaptchaBox ref="captchaBox" v-model="captcha" label="验证码" class="mb-3" />

      <p v-if="localError || auth.error" class="mb-3 text-xs text-bad">{{ localError || auth.error }}</p>

      <button type="submit" class="btn btn-primary w-full py-1.5" :disabled="!canSubmit">
        {{ auth.loading ? '注册中…' : '注册' }}
      </button>

      <p class="mt-3 text-center text-xs text-fog-400">
        已有账号？
        <RouterLink to="/login" class="text-steel-brand hover:text-amber-brand">去登录</RouterLink>
      </p>
    </form>
  </div>
</template>
