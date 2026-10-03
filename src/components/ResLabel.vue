<script setup lang="ts">
/** 物资标签：矢量图标 + 名称（+ 可选数量）；按物资实例 id 或名称显示 */
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { useGameStore } from '@/stores/game';

const props = defineProps<{ id?: string; name?: string; qty?: number }>();

const store = useGameStore();
const inst = computed(() => (props.id ? store.instById.get(props.id) : undefined));
const displayName = computed(() => inst.value?.name ?? props.name ?? props.id ?? '');
</script>

<template>
  <span class="inline-flex items-center gap-1.5">
    <AppIcon :name="displayName" :size="15" />
    <span>{{ displayName }}</span>
    <span v-if="qty !== undefined" class="font-semibold text-amber-brand">×{{ qty }}</span>
  </span>
</template>
