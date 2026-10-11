import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * 单元测试配置（与 vite.config.ts 独立，避免带入 dev server 保存中间件）。
 * 目前只跑纯逻辑（domain / engine），无需 DOM/jsdom。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});