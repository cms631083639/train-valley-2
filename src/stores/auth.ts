/**
 * 账号状态（L3 编排层）
 *
 * 负责登录 / 注册 / 登出 / 会话恢复。AccessToken 只存内存（经 utils/http 注入），
 * RefreshToken 由服务端写在 HttpOnly Cookie 里，前端完全不接触。
 * 用户公开信息持久化到 localStorage，刷新页面即可立即渲染登录态，随后 bootstrap 再校验一次。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { http, setAccessToken, refreshAccessToken, onAuthLost, errorMessage } from '@/utils/http';
import type { AuthUser, CaptchaPayload } from '@/types';

export const useAuthStore = defineStore(
  'auth',
  () => {
    const user = ref<AuthUser | null>(null);
    const loading = ref(false);
    const error = ref('');

    const isLoggedIn = computed(() => !!user.value);
    const isAdmin = computed(() => user.value?.role === 'admin');

    /** 登录 / 注册共用的响应落地逻辑 */
    function applySession(data: { user: AuthUser; accessToken: string }) {
      user.value = data.user;
      setAccessToken(data.accessToken);
      error.value = '';
    }

    async function login(email: string, password: string, captcha: CaptchaPayload): Promise<boolean> {
      loading.value = true;
      error.value = '';
      try {
        const { data } = await http.post('/api/auth/login', { email, password, captcha });
        applySession(data);
        return true;
      } catch (e) {
        error.value = errorMessage(e, '登录失败');
        return false;
      } finally {
        loading.value = false;
      }
    }

    async function register(
      email: string,
      password: string,
      nickname: string,
      captcha: CaptchaPayload,
    ): Promise<boolean> {
      loading.value = true;
      error.value = '';
      try {
        const { data } = await http.post('/api/auth/register', { email, password, nickname, captcha });
        applySession(data);
        return true;
      } catch (e) {
        error.value = errorMessage(e, '注册失败');
        return false;
      } finally {
        loading.value = false;
      }
    }

    async function logout(): Promise<void> {
      try {
        await http.post('/api/auth/logout', {});
      } catch {
        /* 网络异常也要清本地态 */
      }
      user.value = null;
      setAccessToken(null);
    }

    /**
     * 启动时静默恢复：先用 HttpOnly Cookie 里的 RefreshToken 换新 AccessToken，
     * 再拉一次 /me 校准角色（例如后台把角色改成了 admin）。
     */
    async function bootstrap(): Promise<void> {
      const token = await refreshAccessToken();
      if (!token) {
        user.value = null;
        return;
      }
      try {
        const { data } = await http.get('/api/auth/me');
        user.value = data.user;
      } catch {
        user.value = null;
        setAccessToken(null);
      }
    }

    // 会话彻底失效（刷新也失败）时清空用户态，路由守卫会自动把用户挡回登录页
    onAuthLost(() => {
      user.value = null;
      setAccessToken(null);
    });

    return { user, loading, error, isLoggedIn, isAdmin, login, register, logout, bootstrap };
  },
  {
    persist: {
      key: 'tv2:auth',
      // v3 插件用 paths（v4 才是 pick）
      paths: ['user'],
    },
  },
);
