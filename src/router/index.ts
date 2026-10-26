import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import LevelsPage from '@/pages/LevelsPage.vue';
import GraphPage from '@/pages/GraphPage.vue';
import CodexPage from '@/pages/CodexPage.vue';
import InstancesPage from '@/pages/InstancesPage.vue';
import LoginPage from '@/pages/LoginPage.vue';
import RegisterPage from '@/pages/RegisterPage.vue';
import AdminSuggestionsPage from '@/pages/AdminSuggestionsPage.vue';
import { useAuthStore } from '@/stores/auth';
import { USER_FEATURES_ENABLED } from '@/constants';

declare module 'vue-router' {
  interface RouteMeta {
    /** 需要登录才能进入 */
    requiresAuth?: boolean;
    /** 仅管理员可进入 */
    requiresAdmin?: boolean;
    /** 已登录用户访问时直接回首页（登录 / 注册页用） */
    guestOnly?: boolean;
  }
}

/**
 * 路由表：公开攻略内容（关卡 / 图鉴 / 生产链）无需登录；
 * 物资实例后台与建议审批仅 admin 可见。
 * 使用 hash 模式，避免部署到 Vercel 后需要额外的 rewrite 配置。
 */
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'levels', component: LevelsPage },
  { path: '/graph', name: 'graph', component: GraphPage },
  { path: '/codex', name: 'codex', component: CodexPage },
  { path: '/instances', name: 'instances', component: InstancesPage, meta: { requiresAdmin: true } },
  { path: '/admin/suggestions', name: 'adminSuggestions', component: AdminSuggestionsPage, meta: { requiresAdmin: true } },
  { path: '/login', name: 'login', component: LoginPage, meta: { guestOnly: true } },
  { path: '/register', name: 'register', component: RegisterPage, meta: { guestOnly: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to) => {
  // 纯攻略模式：所有用户功能相关页面直接回首页
  if (!USER_FEATURES_ENABLED && (to.meta.requiresAdmin || to.meta.guestOnly)) return { path: '/' };

  const auth = useAuthStore();
  if (to.meta.requiresAdmin) {
    if (!auth.isLoggedIn) return { path: '/login', query: { redirect: to.fullPath } };
    if (!auth.isAdmin) return { path: '/' };
  }
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.guestOnly && auth.isLoggedIn) return { path: '/' };
});

export default router;
