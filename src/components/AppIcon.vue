<script setup lang="ts">
/**
 * 矢量图标组件（SVG Symbol / iconfont 兼容）
 * 用法：<AppIcon name="wood" class="size-4 text-good" />
 */
import { computed } from 'vue';
import { resolveIcon } from '@/icons/registry';

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 });

const symbolId = computed(() => `#icon-${resolveIcon(props.name || '')}`);
</script>

<template>
  <svg class="icon" :width="size" :height="size" aria-hidden="true" focusable="false">
    <use :href="symbolId" />
  </svg>
</template>
