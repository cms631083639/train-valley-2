import { CATEGORY } from '@/constants';
import type { ContentCategory, ObtainMethod, ResourceCategory } from '@/types';

/** 内容分类（游戏本体 / DLC）显示文案 */
export const CONTENT_CATEGORY_LABEL: Record<ContentCategory, string> = {
  游戏本体: '本体',
  DLC: 'DLC',
};

/**
 * 物资分类（原料 / 加工品 / 复合品）展示元数据 —— 全项目唯一来源。
 * label：文案；tag：完整标签配色（底+边+字）；chip：内联胶囊配色（底+字）；tree：拆解树标签配色（边+字）
 */
export const RESOURCE_CATEGORY_STYLE: Record<
  ResourceCategory,
  { label: string; tag: string; chip: string; tree: string }
> = {
  [CATEGORY.RAW]: {
    label: '原料',
    tag: 'bg-good/15 text-good border border-good/30',
    chip: 'bg-good/15 text-good',
    tree: 'border-good/60 text-good',
  },
  [CATEGORY.PROCESSED]: {
    label: '加工品',
    tag: 'bg-steel-brand/15 text-steel-brand border border-steel-brand/30',
    chip: 'bg-steel-brand/15 text-steel-brand',
    tree: 'border-steel-brand/60 text-steel-brand',
  },
  [CATEGORY.COMPOUND]: {
    label: '复合品',
    tag: 'bg-amber-brand/15 text-amber-brand border border-amber-brand/30',
    chip: 'bg-amber-brand/15 text-amber-brand',
    tree: 'border-amber-brand/70 text-amber-brand',
  },
};

export const OBTAIN_LABEL: Record<ObtainMethod, string> = {
  刷新: '定时站点（解锁后循环产出·NPC火车）',
  购买: '空投购买（花钱·需玩家列车出货）',
  无限: '无限供给（初始站点直供）',
  库存: '初始库存（关卡自带物资·可直接运输）',
  客流: '客流（乘客运输）',
};

/** 限制条件列名 → 展示文案（value 为表内原始值） */
export function constraintText(key: string, value: string): string {
  switch (key) {
    case '碰撞数量': return `允许碰撞 ≤ ${value}`;
    case '进错站数': return `允许错站 ≤ ${value}`;
    case '摧毁物价值': return `摧毁物价值 ≤ ${value}`;
    case '铺片限制': return `铺片限制 ${value}`;
    case '桥梁限制': return `桥梁限制 ${value}`;
    case '隧道限制': return `隧道限制 ${value}`;
    case '买车限制': return `买车限制 ${value}`;
    case '建造桥梁': return `需建桥 ${value}`;
    case '建造隧道': return `需建隧 ${value}`;
    default: return `${key}：${value}`;
  }
}

/** 完美通关条件（星级 = 3 + 有值列数）
 *  阈值方向：
 *    ≤ 型（上限）：买车限制、铺片限制、摧毁物价值、桥梁限制、隧道限制、避免碰撞、避免错站
 *    ≥ 型（下限）：进错站数、运送列车、建造桥梁、建造隧道、花钱、挣钱
 *    布尔型（打勾=必须）：不停车、不掉头、不升车、不造桥、不摧毁铺片
 */

/** 完美通关条件 key → 人类可读文案（飞书表格语义，值为原始字符串）
 *  支持 {n} / {dollars} 占位符自动替换
 */
export function starConditionText(key: string, value: string): string {
  const n = Number(value);
  const dollars = Number(value).toLocaleString();
  switch (key) {
    // —— 布尔型（打勾 = 必须满足）——
    case '不停车': return '不要停止任何列车';
    case '不掉头': return '不要掉转任何列车';
    case '不升车': return '不要升级火车头';
    case '不造桥':
    case '不造桥梁': return '不要建造任何桥梁';
    case '不造隧':
    case '不造隧道': return '不要建造任何隧道';
    case '不摧毁铺片': return '不要摧毁任何轨道铺片';
    case '避免碰撞': return '避免列车碰撞';
    case '避免错站': return '不要让任何列车到错站';

    // —— ≤ 型（上限，不能超过）——
    case '买车限制': return `不要购买超过 ${n} 个火车头`;
    case '铺片限制': return `不要建造超过 ${n} 块轨道铺片`;
    case '摧毁物价值':
    case '摧毁限制': return `不要摧毁总价值超过 $${dollars} 的物体`;
    case '桥梁限制': return `建造不超过 ${n} 座桥梁`;
    case '隧道限制': return `建造不超过 ${n} 条隧道`;

    // —— ≥ 型（下限，至少要）——
    case '建造桥梁': return `建造至少 ${n} 座桥梁`;
    case '建造隧道': return `建造至少 ${n} 条隧道`;
    case '花钱': return `花钱 $${dollars} 以上`;
    case '挣钱': return `挣钱 $${dollars} 以上`;

    default: return `${key}: ${value}`;
  }
}

/** 游戏秒 -> 可读时长 */
export function fmtSeconds(s: number): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
}

/** 秒 -> "X分Y秒"；sec<=0 时返回 empty（默认 '-'，树节点里传 ''） */
export function fmtMinSec(sec: number, empty = '-'): string {
  if (sec <= 0) return empty;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m && s) return `${m}分${s}秒`;
  if (m) return `${m}分`;
  return `${s}秒`;
}
