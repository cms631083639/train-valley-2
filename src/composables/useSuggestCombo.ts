/**
 * 通用「物资名联想输入 + 实例下拉」状态机。
 *
 * 页面中原本有 4~5 套结构完全相同、仅在数据来源与选中回调上有差异的键盘下拉逻辑
 * （外部站 / 资源站 / 拆卸产出 / 多渠道组 / 目标编辑器）。此处把「关键字 / 展开行 /
 * 光标」三组状态与 ↑↓ 导航、Enter 选中、Esc 关闭、失焦延迟收起等交互收敛到一处，
 * 调用方只需提供候选来源、实例来源与选中回调。
 *
 * 用法：一个实例可服务多行，通过 key 区分（数字行号或 `cpIdx-oi` 之类字符串）。
 */
import { nextTick, reactive, ref } from 'vue';
import type { ResourceInstance } from '@/types';

/** 行标识：数字行号或复合字符串 key */
export type ComboKey = string | number;

export interface SuggestComboConfig {
  /** 返回某行在给定关键字下的候选名称（过滤/排序/截断由调用方决定） */
  suggestions: (key: ComboKey, keyword: string) => string[];
  /** 返回某行当前可选实例；不提供表示该组没有实例下拉 */
  instances?: (key: ComboKey) => ResourceInstance[];
  /** 选中物资名称 */
  pickName: (key: ComboKey, name: string) => void;
  /** 选中实例（提供了 instances 时必填） */
  pickInst?: (key: ComboKey, instId: string) => void;
  /** 打开实例下拉时计算初始光标（默认 0） */
  initialInstCursor?: (key: ComboKey) => number;
  /** 关键字输入副作用（例如直接把输入值写回关卡数据） */
  onInput?: (key: ComboKey, keyword: string) => void;
  /** 联想回车但无候选时的兜底处理（如「用关键字直接查实例」） */
  enterFallback?: (key: ComboKey, keyword: string) => void;
  /** 选中名称后要聚焦并展开的实例触发器 class（如 'rs-inst-trigger'） */
  instTriggerClass?: string;
  /** 实例光标是否循环（默认 true；false 时到首尾即停） */
  instCursorWrap?: boolean;
  /** 实例下拉未展开时，是否支持在触发器上按 Enter 直接展开 */
  instEnterOpens?: boolean;
  /** 失焦延迟收起毫秒数（默认 150，给 mousedown 留出触发时间） */
  blurDelay?: number;
}

/**
 * 创建一组联想下拉状态机。返回对象用 reactive 包裹，使内部 ref 在模板中自动解包
 * （可直接写 `combo.suggestOpen === idx`，赋值 `combo.suggestOpen = null`）。
 */
export function useSuggestCombo(config: SuggestComboConfig) {
  const blurDelay = config.blurDelay ?? 150;
  const instCursorWrap = config.instCursorWrap ?? true;

  /** 每行输入框关键字 */
  const keywords = reactive<Record<string, string>>({});
  /** 当前展开联想的行（null = 收起） */
  const suggestOpen = ref<ComboKey | null>(null);
  /** 联想光标（每行独立） */
  const suggestCursor = reactive<Record<string, number>>({});
  /** 当前展开实例下拉的行（null = 收起） */
  const instOpen = ref<ComboKey | null>(null);
  /** 实例光标（每行独立） */
  const instCursor = reactive<Record<string, number>>({});

  const kw = (key: ComboKey) => keywords[key] ?? '';
  const sugCur = (key: ComboKey) => suggestCursor[key] ?? 0;
  const instCur = (key: ComboKey) => instCursor[key] ?? 0;

  const suggestions = (key: ComboKey) => config.suggestions(key, kw(key));
  const instances = (key: ComboKey) => config.instances?.(key) ?? [];

  function setKeyword(key: ComboKey, value: string) {
    keywords[key] = value;
  }

  // ——— 名称联想 ———

  function openSuggest(key: ComboKey) {
    suggestOpen.value = key;
    suggestCursor[key] = 0;
  }

  /** 收起联想；不传 key 时无条件收起 */
  function closeSuggest(key?: ComboKey) {
    if (key === undefined || suggestOpen.value === key) suggestOpen.value = null;
  }

  /** 失焦延迟收起（让 mousedown 能先触发选中） */
  function blurSuggest(key: ComboKey) {
    setTimeout(() => {
      if (suggestOpen.value === key) suggestOpen.value = null;
    }, blurDelay);
  }

  function onSuggestFocus(key: ComboKey) {
    suggestOpen.value = key;
  }

  function onSuggestInput(key: ComboKey, e: Event) {
    const value = (e.target as HTMLInputElement).value;
    keywords[key] = value;
    config.onInput?.(key, value);
    openSuggest(key);
  }

  function pickName(key: ComboKey, name: string) {
    keywords[key] = name;
    config.pickName(key, name);
    suggestOpen.value = null;
    suggestCursor[key] = 0;
    // 选中名称后，若配置了实例触发器则把焦点移过去并直接展开实例下拉
    if (config.instTriggerClass && config.instances) {
      nextTick(() => {
        const btn = document.querySelector<HTMLButtonElement>(
          `.${config.instTriggerClass}[data-row="${key}"]`,
        );
        btn?.focus();
        openInst(key, true);
      });
    }
  }

  function onSuggestKeydown(key: ComboKey, e: KeyboardEvent) {
    if (e.key === 'Escape') {
      suggestOpen.value = null;
      return;
    }
    const list = suggestions(key);
    if (!list.length) {
      if (e.key === 'Enter' && config.enterFallback) {
        e.preventDefault();
        config.enterFallback(key, kw(key));
        suggestOpen.value = null;
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pickName(key, list[Math.min(sugCur(key), list.length - 1)]!);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestCursor[key] = (sugCur(key) + 1) % list.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestCursor[key] = sugCur(key) <= 0 ? list.length - 1 : sugCur(key) - 1;
    }
  }

  // ——— 实例下拉 ———

  /** 打开/切换实例下拉；force=true 时强制展开（用于选完名称后自动弹开） */
  function openInst(key: ComboKey, force = false) {
    if (!config.instances) return;
    if (!force && instOpen.value === key) {
      instOpen.value = null;
      return;
    }
    instOpen.value = key;
    instCursor[key] = config.initialInstCursor?.(key) ?? 0;
  }

  function closeInst(key?: ComboKey) {
    if (key === undefined || instOpen.value === key) instOpen.value = null;
  }

  /** 失焦延迟收起实例下拉 */
  function blurInst(key: ComboKey) {
    setTimeout(() => {
      if (instOpen.value === key) instOpen.value = null;
    }, blurDelay);
  }

  function pickInst(key: ComboKey, instId: string) {
    instOpen.value = null;
    config.pickInst?.(key, instId);
  }

  function onInstKeydown(key: ComboKey, e: KeyboardEvent) {
    if (e.key === 'Escape') {
      instOpen.value = null;
      return;
    }
    if (instOpen.value !== key) {
      // 未展开：仅在开启 instEnterOpens 时支持按 Enter 直接展开
      if (config.instEnterOpens && e.key === 'Enter' && instances(key).length) {
        e.preventDefault();
        openInst(key, true);
      }
      return;
    }
    const list = instances(key);
    if (!list.length) return;
    const cur = instCur(key);
    if (e.key === 'Enter') {
      e.preventDefault();
      pickInst(key, list[Math.min(cur, list.length - 1)]!.id);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      instCursor[key] = instCursorWrap ? (cur + 1) % list.length : Math.min(cur + 1, list.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      instCursor[key] = instCursorWrap ? (cur <= 0 ? list.length - 1 : cur - 1) : Math.max(0, cur - 1);
    }
  }

  return reactive({
    keywords,
    kw,
    setKeyword,
    suggestOpen,
    suggestCursor,
    sugCur,
    suggestions,
    openSuggest,
    closeSuggest,
    blurSuggest,
    onSuggestFocus,
    onSuggestInput,
    onSuggestKeydown,
    pickName,
    instOpen,
    instCursor,
    instCur,
    instances,
    openInst,
    closeInst,
    blurInst,
    pickInst,
    onInstKeydown,
  });
}