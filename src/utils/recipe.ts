/** 配方文本工具：统一各处配方展示，避免多份手写拼接产生格式分歧 */
import type { ResourceInstance } from '@/types';
import { WORKER_NAME } from '@/types';

/** 统计配方输入的同名数量，保留首次出现顺序 */
export function dedupeInputs(inputs: string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const name of inputs) map.set(name, (map.get(name) ?? 0) + 1);
  return Array.from(map.entries());
}

/** 输入名去重计数文本："原木 + 工人×2" */
export function recipeInputText(inputs: string[]): string {
  return dedupeInputs(inputs)
    .map(([name, cnt]) => (cnt > 1 ? `${name}×${cnt}` : name))
    .join(' + ');
}

/** 配方简写："原木 + 工人 → 木板 ×2"；外部实例显示获取方式，无配方则显示「工人 → 名称」 */
export function recipeText(inst: ResourceInstance): string {
  if (inst.inputs.length) {
    const arrow = `${recipeInputText(inst.inputs)} → ${inst.name}`;
    return (inst.perOut ?? 1) > 1 ? `${arrow} ×${inst.perOut}` : arrow;
  }
  if (inst.external) return `${inst.obtain ?? '外部'} · ${inst.name}`;
  return `${WORKER_NAME} → ${inst.name}`;
}