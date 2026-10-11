<script setup lang="ts">
/**
 * 目标编辑器：2 列独立下拉 + 数量
 *   - 物资名称下拉（所有去重名称）
 *   - 配方实例下拉（按名称过滤，若未选名称则显示全部）
 *   两列顺序无关，选了名称会缩小实例范围，选了实例会自动锁定名称
 */
import { CATEGORY } from '@/constants';
import { computed, nextTick, reactive, ref, watch } from 'vue';
import type { LevelGoal, ResourceInstance, MultiChannelGroup, CoProductionGroup } from '@/types';
import { useGameStore } from '@/stores/game';
import { classifyInstance, classifyName } from '@/engine/breakdown';
import { dedupeInputs } from '@/utils/recipe';
import type { ResourceCategory, WorkerStation } from '@/types';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  goals: LevelGoal[];
  /** 关卡已有的站点标识（A/B/C…），如果有值则显示站点选择列 */
  stationLabels?: string[];
  /** 关卡活跃实例集合（来自 goals + initialStations），用于局部递归分类 */
  localInstances?: ResourceInstance[];
  /** 关卡局部覆盖（用户在警告面板选的实例），用于分类时优先用关卡选的实例 */
  localOverrides?: Record<string, string>;
  /** 工人站点配置数组（含 unlockCost），用于在分组标题旁渲染解锁 toggle */
  workerStations?: WorkerStation[];
  /** 多渠道生产组：同名多实例时，显示渠道文本而非实例下拉 */
  multiChannelGroups?: MultiChannelGroup[];
  /** 拆卸工厂组：用于判断多渠道实例是否在拆卸工厂中 */
  coProductionGroups?: CoProductionGroup[];
}>();
const emit = defineEmits<{
  (e: 'update', v: LevelGoal[]): void;
  /** 某个工人站 unlockCost 变化时 */
  (e: 'update:workerStations', v: WorkerStation[]): void;
}>();

const store = useGameStore();

/** 站点 label → 阿拉伯数字序号（基于 stationLabels 数组位置） */
function stationRoman(key: string): string {
  if (!key) return '全局';
  const idx = props.stationLabels?.indexOf(key) ?? -1;
  return idx >= 0 ? String(idx + 1) : key;
}


/** 获取某站点解锁状态（确保 workerStations 里有该 label，没有则返回已解锁默认值） */
function wState(label: string): { label: string; unlockCost?: number } {
  const found = props.workerStations?.find((w) => w.label === label);
  return found ?? { label };
}

/** 切换某站点解锁状态（已解锁 ↔ 未解锁 默认 $0）；找不到 label 就自动 push 一个 */
function toggleWorkerUnlock(label: string) {
  const arr = [...(props.workerStations ?? [])];
  let idx = arr.findIndex((w) => w.label === label);
  if (idx < 0) {
    arr.push({ label });
    idx = arr.length - 1;
  }
  const cur = arr[idx];
  if (cur.unlockCost !== undefined) {
    const next = { ...cur };
    delete next.unlockCost;
    arr[idx] = next;
  } else {
    arr[idx] = { ...cur, unlockCost: 0 };
  }
  emit('update:workerStations', arr);
}
/** 修改某站点解锁金额；找不到 label 就自动 push 一个 */
function setWorkerUnlockCost(label: string, cost: number) {
  const arr = [...(props.workerStations ?? [])];
  let idx = arr.findIndex((w) => w.label === label);
  if (idx < 0) {
    arr.push({ label });
    idx = arr.length - 1;
  }
  arr[idx] = { ...arr[idx], unlockCost: Math.max(0, cost || 0) };
  emit('update:workerStations', arr);
}

const CAT_LABEL: Record<ResourceCategory, string> = {
  raw: '原料',
  processed: '加工品',
  compound: '复合品',
};

interface RowState {
  /** 选中的物资名称（空 = 未选） */
  name: string;
  /** 搜索关键字（过滤名称下拉） */
  keyword: string;
}

/** 生成稳定行标识：行重排/删除时不随之改变，用于绑定行内 UI 状态 */
let uidSeq = 0;
function genUid(): string {
  return `g${Date.now().toString(36)}${(uidSeq++).toString(36)}`;
}

/** 当前展开联想的行 uid（'' = 全部收起） */
const activeSuggestRow = ref('');
/** 物资名称联想光标（按 uid 独立） */
const suggestCursor = reactive(new Map<string, number>());
/** 当前展开实例下拉的行 uid（'' = 全部收起） */
const activeInstRow = ref('');
/** 实例下拉光标（按 uid 独立） */
const instCursor = reactive(new Map<string, number>());

/** uid 兜底 key（缺失时用占位 key，保证 Map 读写不炸） */
function uidKey(uid: string | undefined): string {
  return uid ?? '__none__';
}

/** 当前下标 → 该行 uid（行状态一律以 uid 为键，避免重排后错位） */
function uidOf(i: number): string | undefined {
  return props.goals[i]?.uid;
}

/**
 * 行内 UI 状态（搜索词 / 已锁名称）按 uid 存储。
 * 新行有独立 uid → 拿到独立空状态，绝不会继承别行留下的旧值。
 */
const rowStates = reactive(new Map<string, RowState>());

function rowOf(uid: string | undefined): RowState {
  if (!uid) return { name: '', keyword: '' };
  let r = rowStates.get(uid);
  if (!r) {
    r = { name: '', keyword: '' };
    rowStates.set(uid, r);
  }
  return r;
}

/** 读联想光标 */
function sugCursor(uid: string | undefined): number {
  return suggestCursor.get(uidKey(uid)) ?? 0;
}
/** 读实例光标 */
function instCur(uid: string | undefined): number {
  return instCursor.get(uidKey(uid)) ?? 0;
}
/** 写实例光标（模板 mouseenter 用，传当前下标） */
function setInstCursor(i: number, v: number): void {
  instCursor.set(uidKey(uidOf(i)), v);
}

/** 老数据（无 uid）补发 uid 并回写父组件（每关卡一次性） */
watch(
  () => props.goals.some((g) => !g.uid),
  (missing) => {
    if (!missing) return;
    nextTick(() => {
      if (props.goals.some((g) => !g.uid)) {
        emit('update', props.goals.map((g) => (g.uid ? { ...g } : { ...g, uid: genUid() })));
      }
    });
  },
  { immediate: true },
);

/**
 * 依据 goals 同步各行状态（按 uid）：
 * - 有 resourceId → 反填 name/keyword（正在输入的行不打断）
 * - resourceId 为空 → 只保留（空）状态，不继承旧值
 * - 清理已删除行残留的状态
 */
watch(
  () => props.goals.map((g) => `${g.uid}|${g.resourceId}`).join(','),
  () => {
    const alive = new Set<string>();
    for (const g of props.goals) {
      if (!g.uid) continue;
      alive.add(g.uid);
      const st = rowOf(g.uid);
      if (activeSuggestRow.value === g.uid) continue;
      const inst = g.resourceId ? store.instById.get(g.resourceId) : undefined;
      if (inst && st.name !== inst.name) {
        st.name = inst.name;
        st.keyword = inst.name;
      }
    }
    for (const k of [...rowStates.keys()]) {
      if (!alive.has(k)) rowStates.delete(k);
    }
  },
  { immediate: true },
);

/** 所有去重名称 → 分类 */
const nameCategoryMap = computed(() => {
  const map = new Map<string, ResourceCategory>();
  for (const name of store.resourceNames) {
    map.set(name, classifyName(name, store.data));
  }
  return map;
});

/** 名称下拉选项（过滤后） */
function filteredNames(row: RowState): { name: string; cat: ResourceCategory }[] {
  const kw = row.keyword.trim();
  const list: { name: string; cat: ResourceCategory }[] = [];
  for (const [name, cat] of nameCategoryMap.value) {
    if (kw && !name.includes(kw)) continue;
    list.push({ name, cat });
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return list;
}

/** 实例下拉选项：如果 row.name 有值，只显示该名称的实例；否则显示全部 */
function filteredInstances(row: RowState) {
  const list = row.name
    ? store.data.instances.filter((i) => i.name === row.name)
    : store.data.instances;
  return list.slice().sort((a, b) => {
    if ((a.inputs.length > 0) !== (b.inputs.length > 0)) return b.inputs.length - a.inputs.length;
    return a.id.localeCompare(b.id);
  });
}

/** 选中名称 → 只改行状态，不 emit（实例等用户自己选 Enter/点击） */
function onNameChange(i: number, name: string) {
  const st = rowOf(uidOf(i));
  st.name = name;
  st.keyword = name;
}

/** 选中实例 → 自动锁定名称 */
function onInstanceChange(i: number, instanceId: string) {
  const inst = store.instById.get(instanceId);
  if (inst) {
    const st = rowOf(uidOf(i));
    st.name = inst.name;
    st.keyword = inst.name;
  }
  emit('update', props.goals.map((g, j) => (j === i ? { ...g, resourceId: instanceId } : g)));
}

/** 其它目标中同名物资已用过的实例 id（仅用于实例下拉默认高亮，不自动写入） */
function preferredInstanceId(name: string, excludeRow: number): string | null {
  if (!name) return null;
  for (let j = 0; j < props.goals.length; j++) {
    if (j === excludeRow) continue;
    const id = props.goals[j]?.resourceId;
    if (!id) continue;
    if (store.instById.get(id)?.name === name) return id;
  }
  return null;
}

/** 计算某行实例下拉的初始光标：优先当前行已选实例，其次其它目标的同名实例，最后第一项 */
function initialInstCursor(i: number): number {
  const list = filteredInstances(rowOf(uidOf(i)));
  if (!list.length) return 0;
  const own = props.goals[i]?.resourceId;
  if (own) {
    const idx = list.findIndex((x) => x.id === own);
    if (idx >= 0) return idx;
  }
  const preferred = preferredInstanceId(rowOf(uidOf(i)).name, i);
  if (preferred) {
    const idx = list.findIndex((x) => x.id === preferred);
    if (idx >= 0) return idx;
  }
  return 0;
}

/** 切换实例下拉展开 */
function toggleInst(i: number) {
  const uid = uidOf(i);
  if (activeInstRow.value === uid) {
    activeInstRow.value = '';
  } else {
    activeInstRow.value = uid ?? '';
    instCursor.set(uidKey(uid), initialInstCursor(i));
  }
}

/** 选中实例 + 关闭下拉 + emit */
function pickInstance(i: number, instId: string) {
  activeInstRow.value = '';
  onInstanceChange(i, instId);
  nextTick(() => focusNextInput());
}

/** 实例下拉键盘：↑↓ 导航、Enter 选中、Escape 关闭 */
function onInstKeydown(i: number, e: KeyboardEvent) {
  const uid = uidOf(i);
  const list = filteredInstances(rowOf(uid));
  if (e.key === 'Escape') {
    e.preventDefault();
    activeInstRow.value = '';
    return;
  }
  if (!list.length) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    if (activeInstRow.value !== uid) {
      // 没展开 → 展开
      activeInstRow.value = uid ?? '';
      instCursor.set(uidKey(uid), initialInstCursor(i));
    } else {
      // 已展开 → 选中当前光标
      const idx = Math.min(instCur(uid), list.length - 1);
      pickInstance(i, list[idx].id);
    }
    return;
  }

  if (activeInstRow.value !== uid) return; // 没展开时方向键不处理

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    instCursor.set(uidKey(uid), (instCur(uid) + 1) % list.length);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const cur = instCur(uid);
    instCursor.set(uidKey(uid), cur <= 0 ? list.length - 1 : cur - 1);
  }
}

/** 失焦后收起实例下拉 */
/** 失焦后延迟收起实例下拉（让 mousedown 能先触发 pickInstance） */
function blurInst() {
  const rowUid = activeInstRow.value;
  setTimeout(() => {
    // 只在 activeInstRow 没被其他代码改过的情况下才清
    if (activeInstRow.value === rowUid) activeInstRow.value = '';
  }, 150);
}

/** 焦点跳到下一个 input（数量输入框） */
function focusNextInput() {
  const el = document.activeElement;
  if (!el) return;
  const inputs = Array.from(document.querySelectorAll('input'));
  for (const inp of inputs) {
    if ((el as HTMLElement).compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING) {
      inp.focus();
      return;
    }
  }
}

function setQty(i: number, qty: number) {
  emit('update', props.goals.map((g, j) => (j === i ? { ...g, qty: Math.max(1, qty || 1) } : g)));
}

/** 数量步进 +/− 按钮 */
function stepQty(i: number, delta: number) {
  const cur = props.goals[i].qty ?? 1;
  setQty(i, Math.max(1, cur + delta));
}

// ==================== 多站点兼容层 ====================

/** 从 goal 里读取 stationLabels（自动兼容老 stationLabel） */
function getStationLabels(g: LevelGoal): string[] {
  if (g.stationLabels && g.stationLabels.length) return g.stationLabels;
  if (g.stationLabel) return [g.stationLabel];
  return [];
}

/** 主站点（用于栈分配和分组，多站点时取第一个） */
function primaryStation(g: LevelGoal): string {
  const list = getStationLabels(g);
  return list[0] ?? '';
}

/** 写入 stationLabels（自动清理老 stationLabel，保持向后兼容读） */
function writeStationLabels(g: LevelGoal, labels: string[]): LevelGoal {
  const clean = labels.filter(Boolean);
  return { ...g, stationLabels: clean.length ? clean : undefined, stationLabel: undefined };
}

// ====================================================

/** 找某站点的默认栈：已有栈里第一个，没有就返回 'A' */
function defaultStackOf(stationKey: string, goals = props.goals): string {
  const existing = new Set<string>();
  for (const g of goals) {
    if (getStationLabels(g).includes(stationKey) && g.stackId) existing.add(g.stackId);
  }
  if (existing.size === 0) return 'A';
  return [...existing].sort()[0];
}

/** 站点按钮点击：根据当前行状态自动选择 tab 切换 / checkbox */
function onStationClick(i: number, sl: string) {
  const curGoal = props.goals[i];
  const curLabels = getStationLabels(curGoal);
  const isSharedRow = curLabels.length >= 2;

  if (isSharedRow) {
    // 公共行 → checkbox toggle：
    //   加站点：正常加入，保持公共
    //   减站点：如果取消后只剩 ≤1 个 → 直接删行（不要降级成独占行）
    const next = new Set(curLabels);
    if (next.has(sl)) {
      next.delete(sl);
      if (next.size <= 1) {
        // 删行
        const arr = [...props.goals];
        arr.splice(i, 1);
        reindex(arr);
        emit('update', arr);
        return;
      }
    } else {
      next.add(sl);
    }
    applyStationLabels(i, [...next].sort());
  } else {
    // 独占行（labels.length === 1 或 0）→ tab 切换：直接换成点击的那个
    applyStationLabels(i, [sl]);
  }
}

/** 写 stationLabels + 自动处理栈 */
function applyStationLabels(i: number, newLabels: string[]) {
  const curGoal = props.goals[i];
  const oldPrimary = primaryStation(curGoal);
  let newStack = curGoal.stackId;

  // 主站点变了才调整栈
  if (oldPrimary && newLabels[0] && newLabels[0] !== oldPrimary) {
    const existsInNew = props.goals.some(
      (g, idx) => idx !== i && getStationLabels(g).includes(newLabels[0]) && g.stackId === curGoal.stackId,
    );
    newStack = existsInNew ? curGoal.stackId : defaultStackOf(newLabels[0] ?? '');
  }

  const next = props.goals.map((g, j) => (j === i ? { ...writeStationLabels(g, newLabels), stackId: newStack || undefined } : g));
  reindex(next);
  emit('update', next);
}

/** 把栈字母转成数值（A=1, B=2, ... Z=26, AA=27） */
function letterToNum(s: string): number {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  return n;
}
function numToLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode('A'.charCodeAt(0) + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * 新建栈 = 把第 i 行移到新栈（MOVE，不增不减）
 * 规则：每个栈至少有 1 项 → 若 goals 数 == 栈数（每条独占一个栈），则禁止新建
 * 位置：移到原栈的最后一条之后，新栈字母 = 当前站点最大字母 +1
 */
function createStack(i: number) {
  const g = props.goals[i];
  const stationKey = primaryStation(g);
  const origStack = g.stackId ?? '';

  // 1. 统计当前站点的 goals 数和唯一栈数（多站点 goal 也算入）
  const stationGoals = props.goals.filter((gg) => getStationLabels(gg).includes(stationKey));
  const stackSet = new Set(stationGoals.map((gg) => gg.stackId).filter(Boolean));

  if (stationGoals.length === stackSet.size) {
    alert(`当前站点已拆成 ${stackSet.size} 个栈，每条目标独占一个栈。\n请先「添加目标」，再从新目标拆出独立栈。`);
    return;
  }

  // 2. 找新字母（当前站点最大字母 +1）
  let maxNum = 0;
  for (const gg of stationGoals) {
    if (gg.stackId) {
      const n = letterToNum(gg.stackId);
      if (n > maxNum) maxNum = n;
    }
  }
  const newLetter = numToLetter(maxNum + 1);

  // 3. 找原栈的最后一条位置
  let lastInOrigStack = i;
  for (let j = i + 1; j < props.goals.length; j++) {
    const gg = props.goals[j];
    if (getStationLabels(gg).includes(stationKey) && (gg.stackId ?? '') === origStack) {
      lastInOrigStack = j;
    }
  }

  const next = [...props.goals];
  const moved = { ...next[i], stackId: newLetter };
  next.splice(i, 1);
  const insertAt = lastInOrigStack - (i < lastInOrigStack ? 1 : 0) + 1;
  next.splice(insertAt, 0, moved);

  reindex(next);
  emit('update', next);
}

function setStack(i: number, val: string) {
  const next = props.goals.map((g, j) => (j === i ? { ...g, stackId: val } : g));
  reindex(next);
  emit('update', next);
}

function remove(i: number) {
  const next = props.goals.filter((_, j) => j !== i);
  reindex(next);
  emit('update', next);
}

function add() {
  // 默认站点：取第一个有目标的主站点
  let defaultStation = '';
  for (const g of props.goals) {
    const ps = primaryStation(g);
    if (ps) { defaultStation = ps; break; }
  }
  if (!defaultStation && props.stationLabels?.length) defaultStation = props.stationLabels[0];
  const defaultStack = defaultStackOf(defaultStation);
  const next = [...props.goals, writeStationLabels(
    { uid: genUid(), resourceId: '', qty: 1, stackId: defaultStack },
    defaultStation ? [defaultStation] : [],
  )];
  reindex(next);
  emit('update', next);
}

/** 新增一条公共目标（默认全选所有站点，直接进公共区） */
function addShared() {
  const allLabels = [...(props.stationLabels ?? [])];
  if (allLabels.length < 2) return; // 站点不够，不能加公共目标
  const defaultStack = defaultStackOf(allLabels[0]);
  const next = [...props.goals, writeStationLabels(
    { uid: genUid(), resourceId: '', qty: 1, stackId: defaultStack },
    allLabels,
  )];
  reindex(next);
  emit('update', next);
}

/** 栈内上移/下移（按全局行号 + 栈索引定位） */
function moveWithinStack(rowIdx: number, delta: -1 | 1) {
  const g = props.goals[rowIdx];
  const stationKey = primaryStation(g);
  const stackId = g.stackId ?? '';
  const sameStack = props.goals
    .map((gg, idx) => ({ gg, idx }))
    .filter((x) => getStationLabels(x.gg).includes(stationKey) && (x.gg.stackId ?? '') === stackId);
  const pos = sameStack.findIndex((x) => x.idx === rowIdx);
  const newPos = pos + delta;
  if (pos < 0 || newPos < 0 || newPos >= sameStack.length) return;
  const targetIdx = sameStack[newPos].idx;
  const next = [...props.goals];
  [next[rowIdx], next[targetIdx]] = [next[targetIdx], next[rowIdx]];
  reindex(next);
  emit('update', next);
}

/** 行在同栈内是否能上移 */
function canMoveUpInStack(rowIdx: number): boolean {
  const g = props.goals[rowIdx];
  const stationKey = primaryStation(g);
  const stackId = g.stackId ?? '';
  for (let j = rowIdx - 1; j >= 0; j--) {
    const gj = props.goals[j];
    if (getStationLabels(gj).includes(stationKey) && (gj.stackId ?? '') === stackId) return true;
  }
  return false;
}

/** 行在同栈内是否能下移 */
function canMoveDownInStack(rowIdx: number): boolean {
  const g = props.goals[rowIdx];
  const stationKey = primaryStation(g);
  const stackId = g.stackId ?? '';
  for (let j = rowIdx + 1; j < props.goals.length; j++) {
    const gj = props.goals[j];
    if (getStationLabels(gj).includes(stationKey) && (gj.stackId ?? '') === stackId) return true;
  }
  return false;
}

/** 给 goals 重排 order：按 [站点, 栈, 原列表位置] 排序后编号；没有 stackId 的归到 "未归栈" */
/** 重排 order + 栈字母整理（确保每个站点的栈字母从 A 开始连续） */
function reindex(list: LevelGoal[]): void {
  // —— 栈字母整理：同站点内，非连续字母自动重映射为 A, B, C… ——
  // 按站点收集所有 stackId（多站点 goal 归入其主站点）
  const stationStacks = new Map<string, string[]>();
  for (const g of list) {
    const sk = primaryStation(g);
    if (g.stackId) {
      const arr = stationStacks.get(sk) ?? [];
      if (!arr.includes(g.stackId)) arr.push(g.stackId);
      stationStacks.set(sk, arr);
    }
  }
  const remap = new Map<string, string>();
  for (const [sk, ids] of stationStacks) {
    ids.sort((a, b) => letterToNum(a) - letterToNum(b));
    let needRemap = false;
    for (let i = 0; i < ids.length; i++) {
      if (letterToNum(ids[i]) !== i + 1) { needRemap = true; break; }
    }
    if (needRemap) {
      for (let i = 0; i < ids.length; i++) {
        remap.set(`${sk}|${ids[i]}`, numToLetter(i + 1));
      }
    }
  }
  if (remap.size) {
    for (const g of list) {
      const key = `${primaryStation(g)}|${g.stackId ?? ''}`;
      if (remap.has(key)) g.stackId = remap.get(key)!;
    }
  }

  // —— 原来的 order 重排 ——
  const orderMap = new Map<string, number>();
  for (const g of list) {
    const key = `${primaryStation(g)}|${g.stackId ?? '__unassigned__'}`;
    const cur = (orderMap.get(key) ?? 0) + 1;
    orderMap.set(key, cur);
    g.order = cur;
  }
}

/** 分组结构：站点 → 栈 → 行号数组 */
interface StationGroup {
  stationKey: string; // "" = 全局
  stationLabel: string;
  isShared: boolean; // 是否是多站点共享组
  sharedWith: string[]; // 共享的其他站点
  stacks: { stackId: string; label: string; order: number; rowIndices: number[]; isUnassigned?: boolean }[];
}

/** 某站点已存在的栈 id 列表（用于新 goal 选栈下拉） */
function stacksOfStation(stationKey: string): string[] {
  const ids = new Set<string>();
  for (const g of props.goals) {
    if (getStationLabels(g).includes(stationKey) && g.stackId) ids.add(g.stackId);
  }
  return [...ids];
}

const UNASSIGNED = '__unassigned__';

const groupedGoals = computed<StationGroup[]>(() => {
  const copy = props.goals.map((g) => ({ ...g }));
  reindex(copy);

  // 1. 先把所有 goal 分成两类
  //    — 共享类 labels.length > 1 → 按完整 labels 集合分组
  //    — 独占类 labels.length <= 1 → 按 primaryStation 分组
  const sharedGroups = new Map<string, number[]>();   // key = labels.join('|')
  const privateByStation = new Map<string, number[]>();

  for (let i = 0; i < copy.length; i++) {
    const labels = getStationLabels(copy[i]);
    if (labels.length > 1) {
      const key = labels.slice().sort().join('|');
      const arr = sharedGroups.get(key) ?? [];
      arr.push(i);
      sharedGroups.set(key, arr);
    } else {
      const sk = primaryStation(copy[i]);
      const arr = privateByStation.get(sk) ?? [];
      arr.push(i);
      privateByStation.set(sk, arr);
    }
  }

  // 通用子函数：给 rowIdxs 按 stack + order 分好栈
  function buildStacks(rowIdxs: number[]) {
    const byStack = new Map<string, number[]>();
    for (const idx of rowIdxs) {
      const sid = copy[idx].stackId ?? UNASSIGNED;
      const arr = byStack.get(sid) ?? [];
      arr.push(idx);
      byStack.set(sid, arr);
    }
    return [...byStack.entries()]
      .sort((a, b) => {
        if (a[0] === UNASSIGNED) return 1;
        if (b[0] === UNASSIGNED) return -1;
        const minA = Math.min(...a[1].map((i) => copy[i].order ?? 99));
        const minB = Math.min(...b[1].map((i) => copy[i].order ?? 99));
        return minA - minB;
      })
      .map(([stackId, idxs]) => {
        idxs.sort((a, b) => (copy[a].order ?? 0) - (copy[b].order ?? 0));
        const isUA = stackId === UNASSIGNED;
        return { stackId, label: isUA ? '未归栈' : stackId, order: copy[idxs[0]].order ?? 1, rowIndices: idxs, isUnassigned: isUA };
      });
  }

  const result: StationGroup[] = [];

  // 2. 共享组排在最前面（多个共享组按第一个站点字母序排）
  const sharedKeys = [...sharedGroups.keys()].sort();
  for (const sk of sharedKeys) {
    const labels = sk.split('|');
    const rowIdxs = sharedGroups.get(sk)!;
    result.push({
      stationKey: sk,  // 用 labels 集合本身做唯一 key
      stationLabel: labels.map((l) => stationRoman(l)).join(' + '),
      isShared: true,
      sharedWith: labels,
      stacks: buildStacks(rowIdxs),
    });
  }

  // 3. 独占站点组：按 A/B/C… + 全局（空）排
  const privKeys = [...privateByStation.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  for (const sk of privKeys) {
    const rowIdxs = privateByStation.get(sk)!;
    result.push({
      stationKey: sk,
      stationLabel: stationRoman(sk),
      isShared: false,
      sharedWith: [],
      stacks: buildStacks(rowIdxs),
    });
  }

  // 4. 补空站点：stationLabels 里声明了但 goals 里没出现的独占站点，也显示空分组（方便看到解锁状态）
  const allPrivateLabels = new Set([...privateByStation.keys()]);
  const allSharedLabels = new Set(sharedGroups.keys());
  for (const sk of allSharedLabels) for (const l of sk.split('|')) allPrivateLabels.add(l);
  if (props.stationLabels?.length) {
    const emptyToAdd = [];
    for (const label of props.stationLabels) {
      if (!allPrivateLabels.has(label)) {
        emptyToAdd.push({
          stationKey: label,
          stationLabel: stationRoman(label),
          isShared: false,
          sharedWith: [],
          stacks: [],
        });
      }
    }
    emptyToAdd.sort((a, b) => a.stationKey.localeCompare(b.stationKey));
    result.push(...emptyToAdd);
  }

  return result;
});

/** 当前实例 */
function currentInstance(i: number) {
  const g = props.goals[i];
  return g.resourceId ? store.instById.get(g.resourceId) : undefined;
}

/** 预览实例：如果该行走廊的实例下拉正展开且有光标，用光标所指的实例做实时预览，否则返回已选实例 */
function previewInstance(i: number) {
  const uid = uidOf(i);
  if (activeInstRow.value === uid) {
    const list = filteredInstances(rowOf(uid));
    const idx = instCursor.get(uidKey(uid));
    if (idx != null && idx >= 0 && idx < list.length) return list[idx];
  }
  return currentInstance(i);
}

/** 当前类型：与拆解树共用同一分类引擎（classifyInstance），localByName 优先查关卡指定实例（含警告面板选的 overrides），找不到 fallback 全局 data */
function currentCat(i: number): ResourceCategory | undefined {
  const inst = currentInstance(i);
  if (!inst) return undefined;
  const locals = props.localInstances;
  let localByName: Map<string, ResourceInstance> | undefined;
  // 构建 localByName：localInstances 打底 + localOverrides 覆盖
  if ((locals && locals.length) || props.localOverrides) {
    localByName = new Map();
    if (locals) for (const li of locals) localByName.set(li.name, li);
    if (props.localOverrides) {
      for (const [name, id] of Object.entries(props.localOverrides)) {
        const over = store.data.instances.find((x) => x.id === id);
        if (over) localByName.set(name, over);
      }
    }
  }
  return classifyInstance(inst, store.data, localByName);
}

/** 联想候选（输入关键字过滤后的 names） */
function suggestNames(row: RowState): { name: string; cat: ResourceCategory }[] {
  const kw = row.keyword.trim();
  if (!kw) return [];
  return filteredNames(row).slice(0, 10);
}

/** 判断名称是否有多渠道组 */
function hasMultiChannel(name: string): boolean {
  return (props.multiChannelGroups ?? []).some((mc) => mc.typeName === name && mc.instanceIds.length > 0);
}

/** 多渠道组对应的配方显示文本 */
function multiChannelLabel(name: string): string | null {
  const mc = props.multiChannelGroups?.find((mc) => mc.typeName === name);
  if (!mc || !mc.instanceIds.length) return null;
  const coIds = new Set<string>();
  for (const g of props.coProductionGroups ?? []) {
    for (const o of g.outputs) coIds.add(o.instanceId);
  }
  const allCo = mc.instanceIds.every((id) => coIds.has(id));
  const someCo = mc.instanceIds.some((id) => coIds.has(id));
  if (allCo) return `拆卸产出 → ${name}`;
  if (someCo) return `可拆卸和生产 → ${name}`;
  return `${name}渠道 → ${name}`;
}

/** 点击联想项：仅设置名称，不自动选中实例（实例由用户手动选择，避免提前触发多渠道组检测） */
function pickSuggest(i: number, name: string) {
  const uid = uidOf(i);
  onNameChange(i, name);
  activeSuggestRow.value = '';
  suggestCursor.set(uidKey(uid), 0);
  // 多渠道类型：自动选中第一个实例（组已存在，直接取已确定的实例）
  if (hasMultiChannel(name)) {
    const mc = props.multiChannelGroups!.find((mc) => mc.typeName === name)!;
    if (mc.instanceIds.length) onInstanceChange(i, mc.instanceIds[0]);
  }
  // 非多渠道：不自动选中实例，用户在实例下拉中手动选择
  // 只有用户明确选择了与已有目标不同的实例时，才会触发父组件 autoDetectMcGroups 创建多渠道组
}

/** 搜索框输入：更新关键字、展开联想、光标归零 */
function onSuggestInput(i: number, e: Event) {
  const uid = uidOf(i);
  rowOf(uid).keyword = (e.target as HTMLInputElement).value;
  activeSuggestRow.value = uid ?? '';
  suggestCursor.set(uidKey(uid), 0);
}

/** 搜索框键盘事件：Enter → 选中首项并跳焦点到实例下拉（自动展开）；↑↓ → 导航 */
function onSuggestKeydown(i: number, e: KeyboardEvent) {
  const uid = uidOf(i);
  const row = rowOf(uid);
  const list = suggestNames(row);
  if (!list.length) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    const idx = Math.min(sugCursor(uid), list.length - 1);
    pickSuggest(i, list[idx].name);
    // 跳到实例下拉 trigger 并自动展开
    setTimeout(() => {
      const trigger = document.querySelector<HTMLButtonElement>(`.inst-trigger[data-row="${i}"]`);
      if (trigger) {
        trigger.focus();
        // 打开实例下拉（让用户直接方向键选择）
        activeInstRow.value = uid ?? '';
        instCursor.set(uidKey(uid), initialInstCursor(i));
      }
    }, 0);
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    suggestCursor.set(uidKey(uid), (sugCursor(uid) + 1) % list.length);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const cur = sugCursor(uid);
    suggestCursor.set(uidKey(uid), cur <= 0 ? list.length - 1 : cur - 1);
  } else if (e.key === 'Escape') {
    activeSuggestRow.value = '';
  }
}

/** 搜索框失焦后延迟收起联想列表（让 mousedown 能先触发） */
function blurSuggest() {
  const rowUid = activeSuggestRow.value;
  setTimeout(() => {
    if (activeSuggestRow.value === rowUid) activeSuggestRow.value = '';
  }, 150);
}

defineExpose({ add, addShared });
</script>

<template>
  <div class="space-y-2">
    <!-- 空态提示 -->
    <div v-if="!goals.length" class="text-xs text-fog-400">
      还没添加任何目标 — 点右上角「添加目标」开始录入
    </div>

    <!-- 表头（所有栈共享，纯 flex） —— px-2 对齐下方 groupedGoals 外层容器的 p-2 -->
    <div class="flex items-center gap-1 border-b border-ink-600 pb-1 text-[11px] font-medium text-fog-400 px-2">
      <div class="w-[48px] flex-none flex items-center justify-center">层级</div>
      <div v-if="stationLabels?.length" class="flex-none flex items-center justify-center">站点</div>
      <div class="min-w-[80px] flex-none flex items-center justify-center">归栈</div>
      <div class="w-[68px] flex-none flex items-center justify-center">物资</div>
      <div class="w-[68px] flex-none flex items-center justify-center">实例</div>
      <div class="flex-1 min-w-[160px] flex items-center justify-center">配方</div>
      <div class="w-[48px] flex-none flex items-center justify-center">类型</div>
      <div class="w-[88px] flex-none flex items-center justify-center">数量</div>
      <div class="w-[28px] flex-none" />
    </div>

    <!-- 所有分组：共享组在前，独占站点组在后 -->
    <div
      v-for="sg in groupedGoals"
      :key="sg.stationKey || 'global'"
      class="mt-2 rounded-md p-2"
      :class="[
        sg.isShared
          ? 'border-2 border-dashed border-amber-brand/50 bg-amber-brand/5'
          : (groupedGoals.length > 1 || (props.stationLabels?.length ?? 0) > 1 ? 'border border-station-sel/40 bg-station-sel/5' : ''),
      ]"
    >

      <!-- 分组标题：只要有站点就显示（单站点也需要标注"唯一站点"） -->
      <div v-if="props.stationLabels?.length" class="mb-1 flex items-center gap-2 text-[11px]">
        <!-- 共享组标题：琥珀色虚线风 -->
        <template v-if="sg.isShared">
          <span class="inline-flex items-center gap-1 rounded bg-amber-brand/20 px-2 py-0.5 font-semibold text-amber-brand">🤝 公共区 · {{ sg.stationLabel }}</span>
          <span class="text-fog-400 text-[10px]">（{{ sg.sharedWith.map(s => stationRoman(s)).join('、') }} 共同接收 · 总量合并）</span>
        </template>
        <!-- 独占站点标题 -->
        <template v-else>
          <span class="inline-flex items-center gap-1 rounded bg-station-sel/25 px-2 py-0.5 font-semibold text-station-sel">📍 站点 {{ sg.stationLabel }}</span>
          <!-- 解锁 toggle（仅独占站点，且有 workerStations 配置时显示）
               注意：这里必须用 sg.stationKey（原始字母 A/B/C…），不能用于显示的 sg.stationLabel（数字序号），
               否则 toggle 会误把序号当成新站点 push 进 workerStationArr，凭空多出站点。 -->
          <template v-if="!sg.isShared && sg.stationKey">
            <button
              type="button"
              class="inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] font-medium transition"
              :class="wState(sg.stationKey).unlockCost !== undefined
                ? 'border-ink-500 bg-ink-700/60 text-fog-400 hover:border-amber-brand hover:text-amber-brand'
                : 'border-good/50 bg-good/15 text-good'"
              @click="toggleWorkerUnlock(sg.stationKey)"
              :title="wState(sg.stationKey).unlockCost !== undefined ? '已未解锁·点击标为已解锁' : '已解锁·点击标为未解锁'"
            >
              <span>{{ wState(sg.stationKey).unlockCost !== undefined ? '🔒 未解锁' : '✅ 已解锁' }}</span>
            </button>
            <template v-if="wState(sg.stationKey).unlockCost !== undefined">
              <span class="text-fog-500 text-[10px]">解锁金</span>
              <input
                type="text" inputmode="numeric"
                class="w-[72px] text-center text-[10px] h-6"
                :value="wState(sg.stationKey).unlockCost"
                @input="setWorkerUnlockCost(sg.stationKey, +($event.target as HTMLInputElement).value)"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <span class="text-fog-500 text-[10px]">$</span>
            </template>
          </template>
        </template>
        <span class="text-fog-400 ml-auto">{{ sg.stacks.length }} 条链 · 共 {{ sg.stacks.reduce((s, st) => s + st.rowIndices.length, 0) }} 项</span>
      </div>

      <template v-for="(stack, sIdx) in sg.stacks" :key="sg.stationKey + '-' + stack.stackId">

        <!-- 栈间细分隔（同站点内，非首栈前加一条浅线） -->
        <div v-if="sIdx > 0" class="mt-2 h-px bg-ink-600/40" />

        <!-- 栈内行 -->
        <div v-for="rowIdx in stack.rowIndices" :key="uidOf(rowIdx) ?? rowIdx" class="flex items-center gap-1 border-b border-ink-600/60 py-1">

          <!-- 层级（原序，含上下调整按钮） -->
          <div class="flex w-[48px] flex-none items-center justify-center gap-1">
            <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" :class="stack.isUnassigned ? 'bg-fog-600/40 text-fog-300' : 'bg-steel-brand/20 text-steel-brand'">
              {{ props.goals[rowIdx].order ?? 1 }}
            </span>
            <!-- 上下箭头：只在栈内有 2+ 项时才显示，Tailwind chevron 风格 -->
            <div v-if="!stack.isUnassigned && stack.rowIndices.length > 1" class="flex flex-col gap-px">
              <button
                type="button"
                class="inline-flex h-4 w-4 items-center justify-center rounded border border-ink-500 text-[8px] leading-none text-fog-400 transition hover:border-steel-brand hover:text-steel-brand disabled:opacity-30 disabled:hover:border-ink-500 disabled:hover:text-fog-400"
                :disabled="!canMoveUpInStack(rowIdx)"
                @click="moveWithinStack(rowIdx, -1)"
                title="同栈上移"
              >▲</button>
              <button
                type="button"
                class="inline-flex h-4 w-4 items-center justify-center rounded border border-ink-500 text-[8px] leading-none text-fog-400 transition hover:border-steel-brand hover:text-steel-brand disabled:opacity-30 disabled:hover:border-ink-500 disabled:hover:text-fog-400"
                :disabled="!canMoveDownInStack(rowIdx)"
                @click="moveWithinStack(rowIdx, 1)"
                title="同栈下移"
              >▼</button>
            </div>
          </div>

          <!-- 站点（多选切换 = 共享目标） -->
          <div v-if="stationLabels?.length" class="flex flex-none items-center justify-start gap-0.5">
            <button
              v-for="(sl, sIdx) in stationLabels"
              :key="sl"
              :class="[
                'inline-flex h-6 min-w-[22px] shrink-0 items-center justify-center rounded border text-[11px] font-semibold transition',
                getStationLabels(props.goals[rowIdx]).includes(sl)
                  ? 'border-transparent bg-station-sel text-white'
                  : 'border-ink-500 bg-transparent text-fog-300 hover:border-station-sel hover:text-station-sel',
              ]"
              @click="onStationClick(rowIdx, sl)"
              :title="getStationLabels(props.goals[rowIdx]).length >= 2
                ? (getStationLabels(props.goals[rowIdx]).includes(sl) ? '（已选，点击取消）' : '（点击加入）')
                : (getStationLabels(props.goals[rowIdx]).includes(sl) ? '（当前 tab）' : '（点此切换 tab）')"
            >{{ sIdx + 1 }}</button>
            <span v-if="getStationLabels(props.goals[rowIdx]).length > 1" class="text-[9px] text-amber-brand ml-0.5" title="多站点共享">🤝</span>
            <span v-else-if="stationLabels.length > 1" class="text-[9px] text-fog-600 ml-0.5" title="独占行：点其他按钮 tab 切换">◈</span>
          </div>

          <!-- 归栈 -->
          <div class="flex min-w-[80px] flex-none items-center justify-start gap-0.5 flex-wrap">
            <button
              v-for="sid in [...stacksOfStation(primaryStation(props.goals[rowIdx]))].sort()"
              :key="sid"
              :class="[
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-semibold transition',
                props.goals[rowIdx].stackId === sid
                  ? 'border-transparent bg-stack-sel text-ink-900'
                  : 'border-ink-500 bg-transparent text-fog-300 hover:border-stack-sel hover:text-stack-sel',
              ]"
              @click="setStack(rowIdx, sid)"
            >{{ sid }}</button>
            <button
              class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ink-500 text-sm text-fog-500 hover:border-stack-sel hover:text-stack-sel transition"
              title="新建栈"
              @click="createStack(rowIdx)"
            >＋</button>
          </div>

          <!-- 物资 -->
          <div class="relative w-[68px] flex-none">
            <input type="text" class="w-full min-w-0 text-center" 
              :value="rowOf(uidOf(rowIdx)).keyword"
              :placeholder="rowOf(uidOf(rowIdx)).name ? rowOf(uidOf(rowIdx)).name + '（已锁）' : '搜索…'"
              @input="onSuggestInput(rowIdx, $event)"
              @focus="activeSuggestRow = uidOf(rowIdx) ?? ''"
              @blur="blurSuggest()"
              @keydown="onSuggestKeydown(rowIdx, $event)"
            />
            <ul
              v-if="activeSuggestRow === (uidOf(rowIdx) ?? '') && suggestNames(rowOf(uidOf(rowIdx))).length"
              class="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-[200px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
            >
              <li
                v-for="(opt, liIdx) in suggestNames(rowOf(uidOf(rowIdx)))"
                :key="opt.name"
                :class="['cursor-pointer px-2 py-1 text-xs', sugCursor(uidOf(rowIdx)) === liIdx ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80']"
                @mousedown.prevent="pickSuggest(rowIdx, opt.name)"
              >{{ opt.name }}</li>
            </ul>
            <div
              v-if="activeSuggestRow === (uidOf(rowIdx) ?? '') && rowOf(uidOf(rowIdx)).keyword.trim() && !suggestNames(rowOf(uidOf(rowIdx))).length"
              class="absolute left-0 right-0 top-full z-20 mt-0.5 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-fog-400"
            >无匹配</div>
          </div>

          <!-- 实例（自定义下拉，彻底消除原生 select 兼容风险） -->
          <div class="relative w-[68px] flex-none">
            <template v-if="hasMultiChannel(rowOf(uidOf(rowIdx)).name)">
              <span class="inline-flex w-full min-w-0 items-center justify-center rounded border border-steel-brand/30 bg-steel-brand/10 px-1 text-[11px] text-steel-brand">多渠道</span>
            </template>
            <template v-else>
              <button
                class="inst-trigger flex w-full min-w-0 items-center justify-between rounded border border-ink-500 bg-ink-800 px-1 text-left text-[11px] text-fog-200 hover:border-steel-brand"
                :class="activeInstRow === (uidOf(rowIdx) ?? '') ? 'border-steel-brand' : ''"
                :data-row="rowIdx"
                type="button"
                @click="toggleInst(rowIdx)"
                @keydown="onInstKeydown(rowIdx, $event)"
                @blur="blurInst()"
              >
                <span class="truncate flex-1 text-center">{{ props.goals[rowIdx].resourceId || "—" }}</span>
                <span class="ml-0.5 shrink-0 text-fog-500">▾</span>
              </button>
              <ul
                v-if="activeInstRow === (uidOf(rowIdx) ?? '')"
                class="absolute left-0 top-full z-20 mt-0.5 max-h-[220px] min-w-[220px] overflow-auto rounded border border-ink-600 bg-ink-800 shadow-lg"
              >
                <li
                  v-for="(inst, liIdx) in filteredInstances(rowOf(uidOf(rowIdx)))"
                  :key="inst.id"
                  :class="['cursor-pointer px-2 py-1 text-xs', instCur(uidOf(rowIdx)) === liIdx ? 'bg-ink-600 text-amber-brand' : 'hover:bg-ink-600/80']"
                  @mouseenter="setInstCursor(rowIdx, liIdx)"
                  @mousedown.prevent="pickInstance(rowIdx, inst.id)"
                >{{ inst.id }}</li>
              </ul>
            </template>
          </div>

          <!-- 配方（flex-1 自适应） -->
          <div class="flex-1 min-w-0">
            <div v-if="previewInstance(rowIdx)" class="flex items-center gap-x-1 gap-y-0.5 rounded border border-ink-600 bg-ink-800/60 px-1.5 py-1 text-[11px] leading-tight">
              <template v-if="hasMultiChannel(rowOf(uidOf(rowIdx)).name) && multiChannelLabel(rowOf(uidOf(rowIdx)).name)">
                <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ multiChannelLabel(rowOf(uidOf(rowIdx)).name) }}</span>
              </template>
              <template v-else-if="previewInstance(rowIdx)!.inputs.length">
                <span v-if="previewInstance(rowIdx)!.needsPower" class="rounded bg-amber-brand/15 px-1 text-amber-brand">⚡️</span>
                <template v-for="([nm, cnt], idx) in dedupeInputs(previewInstance(rowIdx)!.inputs)" :key="nm">
                  <span class="rounded bg-ink-600/80 px-1 text-fog-100">{{ nm }}<template v-if="cnt > 1">×{{ cnt }}</template></span>
                  <span v-if="idx < dedupeInputs(previewInstance(rowIdx)!.inputs).length - 1" class="text-fog-500">+</span>
                </template>
                <span class="text-fog-400">→</span>
                <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ previewInstance(rowIdx)!.name }}<template v-if="(previewInstance(rowIdx)!.perOut ?? 1) > 1"> ×{{ previewInstance(rowIdx)!.perOut }}</template></span>
                <span v-if="previewInstance(rowIdx)!.external" class="ml-1 rounded bg-fog-600/30 px-1 text-fog-300">外部</span>
              </template>
              <template v-else-if="previewInstance(rowIdx)!.external || previewInstance(rowIdx)!.initialSetup">
                <span v-if="previewInstance(rowIdx)!.needsPower" class="rounded bg-amber-brand/15 px-1 text-amber-brand">⚡️</span>
                <span class="rounded bg-fog-600/30 px-1 text-fog-300">{{ previewInstance(rowIdx)!.obtain ?? '外部' }}</span>
                <span class="text-fog-400">·</span>
                <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ previewInstance(rowIdx)!.name }}<template v-if="(previewInstance(rowIdx)!.perOut ?? 1) > 1"> ×{{ previewInstance(rowIdx)!.perOut }}</template></span>
              </template>
              <template v-else-if="previewInstance(rowIdx)!.needsPower">
                <span class="rounded bg-amber-brand/15 px-1.5 py-0.5 text-amber-brand">⚡️ 通电自动 {{ previewInstance(rowIdx)!.name }}<template v-if="(previewInstance(rowIdx)!.perOut ?? 1) > 1"> ×{{ previewInstance(rowIdx)!.perOut }}</template></span>
              </template>
              <template v-else>
                <span class="rounded bg-fog-600/30 px-1 text-fog-300">{{ previewInstance(rowIdx)!.obtain ?? '未知' }}</span>
                <span class="text-fog-400">·</span>
                <span class="rounded bg-steel-brand/20 px-1 text-steel-brand font-medium">{{ previewInstance(rowIdx)!.name }}</span>
              </template>
            </div>
            <span v-else class="text-[11px] text-fog-500">选实例后显示配方</span>
          </div>

          <!-- 类型（whitespace-nowrap 防换行） -->
          <div class="flex w-[48px] flex-none items-center justify-start">
            <template v-if="currentCat(rowIdx)">
              <span class="inline-block rounded px-1.5 py-0.5 text-center text-[11px] font-medium whitespace-nowrap" :class="{
                'bg-good/15 text-good border border-good/30': currentCat(rowIdx) === CATEGORY.RAW,
                'bg-steel-brand/15 text-steel-brand border border-steel-brand/30': currentCat(rowIdx) === CATEGORY.PROCESSED,
                'bg-amber-brand/15 text-amber-brand border border-amber-brand/30': currentCat(rowIdx) === CATEGORY.COMPOUND,
              }">{{ CAT_LABEL[currentCat(rowIdx)!] }}</span>
            </template>
            <span v-else class="text-[11px] text-fog-400">—</span>
          </div>

          <!-- 数量（自定义步进器，消除系统 number 控件） -->
          <div class="flex w-[88px] flex-none items-center justify-start">
            <div class="flex h-8 w-full overflow-hidden rounded border border-ink-500 bg-ink-800 text-xs">
              <button
                type="button"
                class="shrink-0 w-6 text-ink-300 hover:bg-ink-600 hover:text-amber-brand active:bg-ink-700 disabled:opacity-30"
                :disabled="(props.goals[rowIdx].qty ?? 1) <= 1"
                @click="stepQty(rowIdx, -1)"
              >−</button>
              <input
                type="text"
                inputmode="numeric"
                class="min-w-0 flex-1 border-x border-ink-600 bg-transparent text-center text-fog-100 outline-none"
                :value="props.goals[rowIdx].qty"
                @keydown.enter="setQty(rowIdx, Number(($event.target as HTMLInputElement).value))"
                @blur="setQty(rowIdx, Number(($event.target as HTMLInputElement).value))"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <button
                type="button"
                class="shrink-0 w-6 text-ink-300 hover:bg-ink-600 hover:text-amber-brand active:bg-ink-700"
                @click="stepQty(rowIdx, 1)"
              >+</button>
            </div>
          </div>

          <!-- 删除 -->
          <div class="flex w-[28px] flex-none items-center justify-end">
            <button class="btn !px-1 !py-0.5" @click="remove(rowIdx)" title="删除"><AppIcon name="close" :size="12" /></button>
          </div>

        </div>
      </template>
    </div>

    <!-- 操作提示 -->
    <div v-if="goals.length" class="pt-1 text-xs text-fog-400">
      点行内 ＋ 新建栈 · 同栈内有先后顺序 · 不同栈并行运送
    </div>
  </div>
</template>
