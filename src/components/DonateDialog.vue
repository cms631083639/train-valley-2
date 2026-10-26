<script setup lang="ts">
/**
 * 支持作者弹窗（赞赏码）
 *
 * 合规约定：只做「自愿赞赏」，不设任何对价（不影响功能、不解锁内容、无会员）。
 * 二维码随包构建（文件名带 hash），不依赖第三方图床，避免被替换。
 */
import { nextTick, ref, watch } from 'vue';
import qrImage from '@/assets/donate-qr.png';
import AppIcon from '@/components/AppIcon.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const dialogRef = ref<HTMLDivElement | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    dialogRef.value?.focus();
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 p-4"
      @click.self="emit('close')"
    >
      <div
        ref="dialogRef"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-label="支持作者"
        class="w-full max-w-[340px] rounded-lg border border-ink-600 bg-ink-800 p-4 shadow-xl outline-none"
        @keydown.esc="emit('close')"
      >
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-amber-brand">☕ 支持作者</h3>
          <span class="flex-1" />
          <button
            class="flex h-6 w-6 items-center justify-center rounded text-fog-400 transition-colors hover:bg-ink-700 hover:text-fog-100"
            aria-label="关闭"
            @click="emit('close')"
          >
            <AppIcon name="reset" :size="12" />
          </button>
        </div>

        <p class="mt-2 text-[13px] leading-relaxed text-fog-100">
          如果这个攻略帮到了你，可以请我喝杯咖啡。
        </p>
        <p class="mt-1 text-[11px] text-fog-400">
          完全自愿，不影响任何功能 · 微信扫码 · 金额随意
        </p>

        <img
          :src="qrImage"
          alt="微信赞赏码"
          class="mx-auto mt-3 w-[260px] max-w-full rounded-md border border-ink-600"
        />

        <p class="mt-3 text-center text-[10px] leading-relaxed text-fog-500">
          本站为非官方粉丝攻略站，与游戏开发 / 发行方无关；<br />
          游戏名称与素材版权归原权利人所有。
        </p>
      </div>
    </div>
  </Teleport>
</template>
