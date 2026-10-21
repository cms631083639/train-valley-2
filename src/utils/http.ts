/**
 * HTTP 客户端（L2 展示工具层）
 *
 * 职责：统一 axios 实例、自动附带 AccessToken、401 时自动走 RefreshToken 轮转并重放请求。
 * 本模块**不 import store**：token 通过模块级变量读写，由 auth store 调用 setAccessToken 注入，
 * 会话彻底失效时通过 onAuthLost 回调通知上层清理用户态。
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

const AUTH_LOST_EVENTS = new Set<() => void>();

/** 注册「会话已失效」回调（auth store 用它清空用户态） */
export function onAuthLost(fn: () => void): void {
  AUTH_LOST_EVENTS.add(fn);
}

function emitAuthLost() {
  for (const fn of AUTH_LOST_EVENTS) fn();
}

let accessToken = '';

/** 写入 / 清空内存中的 AccessToken（不落 localStorage，防 XSS 直取） */
export function setAccessToken(token: string | null): void {
  accessToken = token || '';
}

export const http = axios.create({
  withCredentials: true,
  timeout: 15000,
});

/** 刷新专用实例：不带请求拦截器，避免刷新请求自己又被 401 拦截 */
const bare = axios.create({ withCredentials: true, timeout: 15000 });

let refreshing: Promise<string | null> | null = null;

/** 单航班刷新：并发 401 只发一次 /refresh（轮转下重复刷新会把新 token 立刻判废） */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = bare
      .post('/api/auth/refresh')
      .then((r) => {
        const token = (r.data?.accessToken as string) || null;
        setAccessToken(token);
        return token;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { __retried?: boolean };

http.interceptors.response.use(
  (resp) => resp,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const url = config?.url || '';
    const isAuthEndpoint = url.startsWith('/api/auth/');

    if (status === 401 && config && !config.__retried && !isAuthEndpoint) {
      config.__retried = true;
      const token = await refreshAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return http.request(config);
      }
      emitAuthLost();
    }
    if (status === 401 && isAuthEndpoint && url !== '/api/auth/refresh') {
      emitAuthLost();
    }
    return Promise.reject(error);
  },
);

/** 从 axios 错误里取后端返回的中文提示 */
export function errorMessage(e: unknown, fallback = '请求失败'): string {
  const err = e as AxiosError<{ msg?: string }>;
  return err?.response?.data?.msg || err?.message || fallback;
}
