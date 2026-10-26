<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';
import { useAuthStore } from '@/stores/auth';
import { USER_FEATURES_ENABLED } from '@/constants';
import AppIcon from '@/components/AppIcon.vue';
import DonateDialog from '@/components/DonateDialog.vue';

/** 顶部导航：管理员专属项按角色显隐 */
const NAV = [
  { to: '/', label: '关卡速查 / 物资拆解', icon: 'target', adminOnly: false },
  { to: '/graph', label: '生产链依赖图', icon: 'graph', adminOnly: false },
  { to: '/codex', label: '列车与物资图鉴', icon: 'book', adminOnly: false },
  { to: '/instances', label: '物资实例管理', icon: 'box', adminOnly: true },
  { to: '/admin/suggestions', label: '建议审批', icon: 'check', adminOnly: true },
] as const;

const store = useGameStore();
const auth = useAuthStore();
const router = useRouter();
const msg = ref('');
/** 赞赏码弹窗开关（纯前端、自愿赞赏，不影响任何功能） */
const donateOpen = ref(false);

const navItems = computed(() =>
  NAV.filter((n) => !n.adminOnly || (USER_FEATURES_ENABLED && auth.isAdmin)),
);

/** 构建时间：用于确认线上部署是否为最新版本 */
const buildTimeText = new Date(__BUILD_TIME__).toLocaleString('zh-CN', { hour12: false });

onMounted(async () => {
  await store.hydrate();

  // 页面关闭/刷新前自动保存，防止数据丢失
  window.addEventListener('beforeunload', () => {
    store.forceSave();
  });
});

const counts = computed(() =>
  `关卡 ${store.data.levels.length}（本体 ${store.baseLevels.length}） / 物资实例 ${store.data.instances.length} / 物资名称 ${store.resourceNames.length}`,
);

const savedText = computed(() => {
  if (!store.lastSaved) return '';
  const diff = Math.max(0, Math.floor((Date.now() - store.lastSaved) / 1000));
  if (diff < 5) return '✅ 已自动保存';
  if (diff < 60) return `✅ ${diff}秒前自动保存`;
  if (diff < 3600) return `✅ ${Math.floor(diff / 60)}分钟前自动保存`;
  return `✅ ${new Date(store.lastSaved).toLocaleString()}`;
});

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const ok = await store.importJson(String(reader.result));
    msg.value = ok ? `已导入 ${file.name}` : '导入失败，见上方告警';
  };
  reader.readAsText(file);
  (e.target as HTMLInputElement).value = '';
}

function exportJson() {
  const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tv2-data.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function handleReset() {
  const filled = store.data.levels.filter((l) => l.goals?.length).length;
  const ok = confirm(`⚠️ 确认恢复内置示例数据？\n\n将清空：${filled} 个关卡的目标录入 + 所有自定义配置\n\n此操作不可恢复，建议先点"导出当前数据"备份。`);
  if (!ok) return;
  store.reset();
  msg.value = '已恢复内置示例';
}

async function handleLogout() {
  await auth.logout();
  router.push('/');
}
</script>

<template>
  <div class="mx-auto flex h-screen min-w-[1280px] max-w-[1680px] flex-col overflow-hidden px-6">
    <header class="flex flex-wrap items-baseline gap-3 pt-5 pb-3 shrink-0">
      <h1 class="flex items-center gap-2 text-xl font-bold text-amber-brand">
        <AppIcon name="locomotive" :size="22" /> Train Valley 2 攻略助手
      </h1>
      <span class="text-xs text-fog-400">关卡条件速查 · 最终物资拆解 · 生产链推演</span>
      <span class="flex-1" />
      <span class="text-xs text-fog-500">{{ counts }}</span>
      <span class="text-[10px] text-fog-500">构建 {{ buildTimeText }}</span>

      <!-- 账号区：纯攻略模式下整体隐藏 -->
      <template v-if="USER_FEATURES_ENABLED">
        <template v-if="auth.isLoggedIn">
          <span class="flex items-center gap-1 text-xs text-fog-100">
            {{ auth.user?.nickname || auth.user?.email }}
            <span v-if="auth.isAdmin" class="rounded border border-amber-brand/50 bg-amber-brand/10 px-1 text-[10px] text-amber-brand">管理员</span>
          </span>
          <button class="btn" @click="handleLogout">退出</button>
        </template>
        <template v-else>
          <RouterLink to="/login" class="btn">登录</RouterLink>
          <RouterLink to="/register" class="btn btn-primary">注册</RouterLink>
        </template>
      </template>
    </header>

    <!-- 标签页 + 操作栏（合并为 Tailwind stacked shell 顶栏风格） -->
    <div class="mb-3 flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-600 pb-0">
      <nav class="flex gap-0.5">
        <RouterLink v-for="t in navItems" :key="t.to" :to="t.to" custom v-slot="{ isActive, navigate }">
          <button
            class="relative flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors"
            :class="isActive ? 'text-amber-brand' : 'text-fog-400 hover:text-fog-100'"
            @click="navigate"
          >
            <AppIcon :name="t.icon" :size="14" /> {{ t.label }}
            <span v-if="isActive" class="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-amber-brand" />
          </button>
        </RouterLink>
      </nav>
      <span class="flex-1" />
      <span v-if="savedText" class="text-xs text-good">{{ savedText }}</span>
      <span class="text-xs text-fog-500">{{ store.source }}</span>
      <!-- 数据导入 / 导出 / 重置会改动权威数据，仅管理员可用 -->
      <template v-if="auth.isAdmin">
        <label class="btn"><AppIcon name="import" :size="12" class="mr-1 inline align-[-0.1em]" />导入
          <input type="file" accept=".json,application/json" class="hidden" @change="onFile" />
        </label>
        <button class="btn" @click="exportJson"><AppIcon name="export" :size="12" class="mr-1 inline align-[-0.1em]" />导出</button>
        <button class="btn border-bad/50 text-bad hover:border-bad hover:bg-bad/10" @click="handleReset">
          <AppIcon name="reset" :size="12" class="mr-1 inline align-[-0.1em]" />恢复示例
        </button>
      </template>
      <span v-if="msg" class="text-xs text-fog-400">{{ msg }}</span>
    </div>

    <div class="flex-1 min-h-0">
      <RouterView />
    </div>

    <!-- 页脚：版权免责 + 请奶爸喝快乐水（自愿赞赏，不设对价） -->
    <footer class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-600/60 py-1.5 text-[11px] text-fog-500">
      <span>非官方粉丝攻略站 · 与游戏开发 / 发行方无关 · 游戏名称与素材版权归原权利人所有</span>
      <span class="flex-1" />
      <button class="cursor-pointer text-fog-400 transition-colors hover:text-amber-brand" @click="donateOpen = true">
        🥤 请奶爸喝快乐水
      </button>
    </footer>

    <DonateDialog :open="donateOpen" @close="donateOpen = false" />
  </div>
</template>
