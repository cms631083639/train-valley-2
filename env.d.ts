/// <reference types="vite/client" />

/** 构建时间（vite define 注入，用于确认线上部署版本） */
declare const __BUILD_TIME__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const c: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default c;
}
