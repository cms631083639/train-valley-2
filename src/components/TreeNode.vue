<script setup lang="ts">
/** 拆解树节点（递归组件）：展示物资实例模型下的拆解结果，电力只作条件标记 */
import { VIA, STATION_KIND, CATEGORY } from '@/constants';
import type { BreakdownNode } from '@/engine/breakdown';
import { fmtMinSec } from '@/utils/format';
import AppIcon from './AppIcon.vue';
import ResLabel from './ResLabel.vue';

/** 关卡物资站点配置（可选）：按 name 索引，用于覆盖 perCycle / cycles / 间隔 / 金钱 */
type StationInfo = { qtyEach: number; intervalSec: number; kind: '刷新' | '购买' | '库存' | '客流'; price?: number };

const props = defineProps<{
  node: BreakdownNode;
  stationInfo?: Map<string, StationInfo>;
}>();

/** 从关卡站点配置计算实际的每次数量和周期数（覆盖引擎默认值） */
function resolveQty(n: BreakdownNode): { qtyEach: number; cycles: number; fromStation: boolean; intervalSec: number; stationKind?: '刷新' | '购买' | '库存' | '客流'; price?: number } {
  const si = props.stationInfo?.get(n.name);
  if (si) {
    return {
      qtyEach: si.qtyEach,
      cycles: Math.ceil(n.qty / si.qtyEach),
      fromStation: true,
      intervalSec: si.intervalSec,
      stationKind: si.kind,
      price: si.price,
    };
  }
  // fallback: 引擎原始值
  const per = Math.max(1, n.perCycle || 1);
  return {
    qtyEach: per,
    cycles: Math.ceil(n.qty / per),
    fromStation: false,
    intervalSec: 0,
  };
}

function viaText(n: BreakdownNode): string {
  switch (n.via) {
    case VIA.PRODUCE: {
      const r = resolveQty(n);
      // 关卡站点配了这个物资 → 显示为外部获取，不再说"工人生产"
      if (r.fromStation && r.stationKind) {
        if (r.stationKind === STATION_KIND.REFRESH) {
          const intervalText = r.intervalSec ? `，间隔 ${fmtMinSec(r.intervalSec, '')}` : '';
          return `定时站点（NPC火车·${r.cycles} 周期 × 每周期 ${r.qtyEach} 件${intervalText}）`;
        }
        if (r.stationKind === STATION_KIND.PASSENGER) {
          return `客流运送（乘客带来·${r.cycles} 次 × 每次 ${r.qtyEach} 件）`;
        }
        const priceText = r.price ? `，每次 ${r.price} 金钱` : '';
        return `空投购买（花钱·玩家列车出货·${r.cycles} 次 × 每次 ${r.qtyEach} 件${priceText}）`;
      }
      return `${n.cycles} 周期 × 每周期 ${n.perCycle || 1} 件`;
    }
    case VIA.REFRESH:
    case VIA.EXTERNAL: {
      const r = resolveQty(n);
      if (r.stationKind === STATION_KIND.BUY) {
        const priceText = r.price ? `，每次 ${r.price} 金钱` : '';
        return `空投购买（花钱·玩家列车出货·${r.cycles} 次 × 每次 ${r.qtyEach} 件${priceText}）`;
      }
      if (r.stationKind === STATION_KIND.PASSENGER) {
        return `客流运送（乘客带来·${r.cycles} 次 × 每次 ${r.qtyEach} 件）`;
      }
      // 刷新（关卡站点覆盖 或 引擎默认 refresh）
      const intervalText = r.intervalSec ? `，间隔 ${fmtMinSec(r.intervalSec, '')}` : '';
      return `定时站点（NPC火车·${r.cycles} 周期 × 每周期 ${r.qtyEach} 件${intervalText}）`;
    }
    case VIA.INFINITE: return '无限供给';
    case VIA.AUTO: return '通电自动生产';
    case VIA.CO_PRODUCTION: {
      const r = resolveQty(n);
      return `拆卸组 · ${r.cycles} 周期 × 每周期 ${n.perCycle || 1} 次消耗`;
    }
    case 'power': return '需通电（发电消耗不计入总需求）';
    case 'power-tag': return `⚡️ 需通电 ${n.qty} 次（多电力来源，不计入消耗）`;
    default: return '未知来源，需人工确认';
  }
}

const CAT_TAG: Record<string, { text: string; cls: string }> = {
  [CATEGORY.RAW]:       { text: '原料',   cls: 'border-good/60 text-good' },
  [CATEGORY.PROCESSED]: { text: '加工品', cls: 'border-steel-brand/60 text-steel-brand' },
  [CATEGORY.COMPOUND]:  { text: '复合品', cls: 'border-amber-brand/70 text-amber-brand' },
};
function catInfo(n: BreakdownNode) { return CAT_TAG[n.category]; }
</script>

<template>
  <li>
    <!-- 拆卸组节点：特殊渲染 -->
    <template v-if="node.via === VIA.CO_PRODUCTION">
      <div class="flex flex-col gap-1 py-1">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="inline-flex items-center gap-1 rounded bg-amber-brand/20 px-2 py-0.5 text-[12px] font-semibold text-amber-brand">🔗 拆卸组：{{ node.name }}</span>
          <span class="text-xs text-fog-400">（{{ viaText(node) }}）</span>
        </div>
        <!-- 配方信息 -->
        <div class="ml-2 flex flex-wrap items-center gap-1 text-[11px] text-fog-400">
          <span class="text-fog-500">配方：{{ node.inputNames.join(' + ') }}</span>
          <span class="text-fog-600">→</span>
          <template v-for="(o, oi) in node.coOutputs" :key="o.instanceId">
            <span class="rounded bg-steel-brand/20 px-1 font-medium text-steel-brand">{{ o.name }}</span>
            <span class="text-fog-400">×{{ o.perOut }}</span>
            <span v-if="oi < (node.coOutputs?.length ?? 0) - 1" class="text-fog-600">+</span>
          </template>
        </div>
        <!-- 产出明细 -->
        <div class="ml-2 space-y-0.5 text-[11px]">
          <div v-for="o in node.coOutputs" :key="o.instanceId" class="flex items-center gap-1">
            <span class="text-fog-500">产出</span>
            <span class="font-medium text-fog-100">{{ o.name }}</span>
            <span class="text-fog-400">× {{ o.produced }}</span>
            <span class="text-fog-500">（需求 {{ o.demanded }}</span>
            <span v-if="o.produced > o.demanded" class="text-amber-brand">富余 +{{ o.produced - o.demanded }}</span>
            <span v-else class="text-good">刚好</span>
            <span class="text-fog-500">）</span>
          </div>
        </div>
      </div>
      <ul v-if="node.children.length" class="ml-2 border-l border-dashed border-ink-600 pl-3">
        <TreeNode v-for="(c, i) in node.children" :key="`${c.name}-${i}`" :node="c" :station-info="stationInfo" />
      </ul>
    </template>

    <!-- 普通节点：原有渲染 -->
    <template v-else>
      <div class="flex flex-wrap items-baseline gap-2 py-0.5">
        <ResLabel :id="node.instanceId" :name="node.name" :qty="node.qty || undefined" />
        <span v-if="node.via !== VIA.POWER_TAG && catInfo(node)" class="tag" :class="catInfo(node).cls">{{ catInfo(node).text }}</span>
        <span v-if="node.via === VIA.PRODUCE" class="text-xs text-fog-400">← {{ viaText(node) }}</span>
        <span v-else-if="node.via !== VIA.POWER_TAG && node.via !== VIA.UNKNOWN" class="text-xs text-fog-400">（{{ viaText(node) }}）</span>
        <span v-else-if="node.via === VIA.POWER_TAG" class="text-xs text-amber-brand/80">{{ viaText(node) }}</span>
        <span v-else class="text-xs text-warn">（{{ viaText(node) }}）</span>
        <span v-if="node.requiresPower" class="tag tag-power">
          <AppIcon name="power" :size="11" /> 需通电
        </span>
        <span v-if="node.warning" class="text-xs text-warn">⚠ 多实例，已自动选择</span>
      </div>
      <ul v-if="node.children.length" class="ml-2 border-l border-dashed border-ink-600 pl-3">
        <TreeNode v-for="(c, i) in node.children" :key="`${c.name}-${i}`" :node="c" :station-info="stationInfo" />
      </ul>
    </template>
  </li>
</template>
