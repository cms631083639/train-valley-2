/**
 * shared/enums.js 的类型声明（改运行时值时必须同步改这里）
 *
 * 为什么不直接把 enums.js 写成 .ts：Node 侧脚本无法加载 .ts（见 enums.js 顶部注释），
 * 所以运行时用 JS、类型用同目录 .d.ts 的惯例。
 */

export declare const CONTENT: {
  readonly BASE: '游戏本体';
  readonly DLC: 'DLC';
};

export declare const CONSTRAINT_COLS: readonly string[];
