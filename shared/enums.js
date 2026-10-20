/**
 * 跨 TS / JS 两侧共用的纯值对象（唯一来源）
 *
 * 为什么单独放这里：`src/` 是 TS、由 Vite / vue-tsc 消费；`scripts/` 由原生 Node 运行，
 * 读不了 `.ts`，也没有 `@/` 别名（本机 Node 20 无 type-stripping，也没装 tsx）。
 * 两侧都要用的值对象因此下沉到这个 JS 模块：
 *   - 应用侧：`src/constants.ts` 从这里 re-export，业务代码继续从 `@/constants` 取
 *   - 脚本侧：`import { X } from '../shared/enums.js'`
 *
 * 注意：`.cjs` 脚本（sync-instances.cjs）在 Node 20 下无法 require 本模块（ESM），
 * 将来若要在此取值，需先把该脚本改名为 `.mjs`。
 *
 * 类型声明见同目录 `enums.d.ts`（两者需同步修改）。
 */

/** 内容分类（对应 src/types.ts 的 ContentCategory 类型） */
export const CONTENT = Object.freeze({
  BASE: '游戏本体',
  DLC: 'DLC',
});

/** constraints 参与星级的列（顺序即导出顺序） */
export const CONSTRAINT_COLS = Object.freeze([
  '运送列车', '不停车', '不掉头', '不升车', '买车限制',
  '避免碰撞', '碰撞数量', '避免错站', '进错站数',
  '不摧毁物品', '摧毁物价值', '不摧毁铺片', '铺片限制',
  '不造桥', '桥梁限制', '建造桥梁', '不造隧道', '隧道限制', '建造隧道',
]);
