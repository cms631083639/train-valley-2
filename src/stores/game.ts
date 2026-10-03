import { STATION_KIND } from '@/constants';
import { defineStore, acceptHMRUpdate } from 'pinia';
import { computed, ref } from 'vue';
import seed from '@/data/tv2.json';
import type { GameData, ResourceInstance, WorkerStation, ExternalStation, InitialStation, Level } from '@/types';

const STORAGE_KEY = 'tv2-assistant-data-v2';
const DB_NAME = 'tv2-assistant';
const DB_VERSION = 1;
const STORE_NAME = 'data';

const EMPTY: GameData = { instances: [], levels: [], trains: [] };

// ————————— 站点结构迁移（旧字段 → 三新数组）—————————
/**
 * 规则：只在旧字段存在但新数组为空时迁移一次；新数组一旦有值就不再覆盖。
 * - workerStations (number) → workerStationArr 数量生成 A/B/C…
 * - initialStations (array) → 按 kind 和实例属性拆入三数组
 * - goals.stationLabels / stationLabel → "工人N" 格式转成 A/B/C
 */
function migrateLevelStations(levels: Level[]): void {
  for (const lv of levels) {
    // —— 站点数组迁移 ——
    // 规则：workerStationArr 已有就不改；没有则从 workerStations(number) 或 goals.stationLabels 反推
    if (!lv.workerStationArr) {
      let count = 1;
      if (typeof lv.workerStations === 'number') {
        count = lv.workerStations;
      } else if (Array.isArray(lv.goals)) {
        // 从 goals 的 stationLabels 反推最大站点数
        const maxIdx = lv.goals.reduce((mx, g) => {
          const labels = [...(g.stationLabels ?? []), ...(g.stationLabel ? [g.stationLabel] : [])];
          for (const lb of labels) {
            // 支持 A/B/C 或 a/b/c 格式
            const m = lb.match(/^([a-zA-Z])(\d*)$/);
            if (m) {
              if (m[2]) { mx = Math.max(mx, +m[2]); }
              else { mx = Math.max(mx, m[1].toUpperCase().charCodeAt(0) - 64); }
            } else {
              // 旧格式 "工人N"
              const n = lb.match(/^工人(\d+)$/);
              if (n) mx = Math.max(mx, +n[1]);
            }
          }
          return mx;
        }, 0);
        if (maxIdx > 0) count = maxIdx;
      }
      const arr: WorkerStation[] = [];
      for (let i = 0; i < count; i++) arr.push({ label: String.fromCharCode(65 + i) });
      lv.workerStationArr = arr;
    }

    if (!lv.externalStationArr && Array.isArray(lv.initialStations) && lv.initialStations.length) {
      const external: ExternalStation[] = [];
      const worker: WorkerStation[] = [...(lv.workerStationArr ?? [])];

      for (const s of lv.initialStations as InitialStation[]) {
        if (s.kind === STATION_KIND.REFRESH || s.kind === STATION_KIND.BUY) {
          external.push({
            label: '',
            resourceId: s.resourceId,
            qty: s.qty, qtyAuto: s.qtyAuto,
            kind: s.kind,
            refreshStart: s.refreshStart, startDelay: s.startDelay,
            unlockPrice: s.unlockPrice, interval: s.interval,
            price: s.price, minQty: s.minQty, minQtyAuto: s.minQtyAuto,
            maxQty: s.maxQty, maxQtyAuto: s.maxQtyAuto,
          });
        } else {
          if (!worker.some((w) => w.label === s.label)) {
            worker.push({ label: s.label, resourceId: s.resourceId, qty: s.qty, qtyAuto: s.qtyAuto });
          }
        }
      }
      worker.sort((a, b) => a.label.localeCompare(b.label));
      external.forEach((e, i) => (e.label = 'm' + (i + 1)));

      if (worker.length) lv.workerStationArr = worker;
      if (external.length) lv.externalStationArr = external;
    }

    // —— goal stationLabel 格式迁移："工人N" → A/B/C ——
    if (Array.isArray(lv.goals)) {
      let changed = false;
      lv.goals = lv.goals.map((g) => {
        const fix = (old?: string): string | undefined => {
          if (!old) return old;
          const m = old.match(/^工人(\d+)$/);
          if (m) { changed = true; return String.fromCharCode(64 + (+m[1])); }
          return old;
        };
        const newLabels = g.stationLabels?.map(fix).filter(Boolean) as string[] | undefined;
        const newSingle = fix(g.stationLabel);
        if (!changed) return g;
        return { ...g, stationLabels: newLabels, stationLabel: newSingle };
      });
    }
  }
}

// ————————— IndexedDB 工具 —————————
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSave(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbLoad<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

// ————————— 导入校验 —————————
export function validate(raw: unknown): { data: GameData | null; issues: string[] } {
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { data: null, issues: ['根节点必须是对象'] };
  }
  const o = raw as Partial<GameData>;
  for (const key of ['instances', 'levels', 'trains'] as const) {
    if (!Array.isArray(o[key])) issues.push(`缺少数组字段「${key}」，将按空表处理`);
  }
  const data: GameData = { ...EMPTY, ...o } as GameData;

  const ids = new Set<string>();
  for (const it of data.instances) {
    if (!it.id) issues.push('物资实例缺少 id');
    else if (ids.has(it.id)) issues.push(`物资实例重复 id：${it.id}`);
    ids.add(it.id);
    if (!it.name) issues.push(`物资实例 ${it.id} 缺少名称`);
  }

  const names = new Set(data.instances.map((i) => i.name));
  for (const it of data.instances) {
    for (const input of it.inputs) {
      if (!names.has(input)) issues.push(`物资 ${it.id} 的配方输入「${input}」在物资主表中不存在`);
    }
  }

  for (const lv of data.levels) {
    for (const g of lv.goals ?? []) {
      if (!ids.has(g.resourceId)) issues.push(`关卡「${lv.name}」的目标引用了不存在的物资实例：${g.resourceId}`);
    }
  }

  return { data, issues };
}

function ensureWorkerEY(data: GameData): GameData {
  if (!data.instances.some((i) => i.id === '工人eY')) {
    const xdIdx = data.instances.findIndex((i) => i.id === '工人XD');
    if (xdIdx >= 0) {
      data.instances.splice(xdIdx + 1, 0, {
        id: '工人eY',
        name: '工人',
        inputs: [],
        perOut: 1,
        external: true,
        obtain: '刷新',
      });
    } else {
      data.instances.push({
        id: '工人eY',
        name: '工人',
        inputs: [],
        perOut: 1,
        external: true,
        obtain: '刷新',
      });
    }
  }
  return data;
}

export const useGameStore = defineStore('game', () => {
  const initialData = ensureWorkerEY(seed as unknown as GameData);
  const data = ref<GameData>(initialData);
  /** 确保 data.value 始终包含 工人eY，防止文件覆盖后丢失 */
  function setData(d: GameData) {
    data.value = ensureWorkerEY(d);
  }
  const issues = ref<string[]>([]);
  const source = ref<'内置数据' | '本地存档' | '导入文件' | '代码 JSON'>('内置数据');
  /** 上一次保存时间戳，UI 可显示 */
  const lastSaved = ref<number>(0);
  /** 用户主动删除过的 seed 实例 id 集合——hydration 时从合并结果里剔除 */
  const deletedSeedInstIds = ref<Set<string>>(new Set());

  // ————————— 自动持久化：暴露 scheduleSave debounce —————————
  // 组件 patchLevel 里主动调 scheduleSave()，不依赖任何 watch/轮询
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** debounce 300ms 后把当前 store.data 写入代码 JSON（dev）或浏览器存储（非 dev） */
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 300);
  }

  /** 取消 debounce 立即持久化（手动保存按钮用），返回 true 表示保存成功 */
  function forceSave(): Promise<boolean> {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    return persistNow();
  }

  // 统一写存档
  // dev 模式：POST 给 Vite middleware，直接写 src/data/tv2.json（同时附带 __deletedSeedInstIds）
  // 非 dev 模式：fallback localStorage + IndexedDB
  // 返回 true 表示文件写入成功（仅 dev 模式有意义），false 表示失败
  // 无论返回什么，localStorage 一定已同步写入
  function persistNow(): Promise<boolean> {
    console.log('[store] 📀 persistNow 被调用');
    // 写 localStorage 在当前数据之前，作为保险
    const wrapper = { ...data.value, __deletedSeedInstIds: [...deletedSeedInstIds.value] };
    const jsonAll = JSON.stringify(wrapper);
    try { localStorage.setItem(STORAGE_KEY, jsonAll); } catch { /* ignore */ }
    lastSaved.value = Date.now();

    if (import.meta.env.DEV) {
      // 文件 payload 也带上 __deletedSeedInstIds，确保 hydration 能恢复
      const payload = {
        instances: data.value.instances,
        trains: data.value.trains,
        levels: data.value.levels,
        __deletedSeedInstIds: [...deletedSeedInstIds.value],
      };
      const json = JSON.stringify(payload);
      // 再尝试写文件
      return fetch('/api/save-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      }).then(async (r) => {
        const text = await r.text();
        try {
          const res = JSON.parse(text);
          if (res.ok) {
            console.log(`[store] 💾 已写入 src/data/tv2.json (${res.bytes} bytes)`);
            return true;
          }
          console.warn('[store] ⚠️ middleware 返回失败:', res.msg);
          return false;
        } catch {
          console.warn('[store] ⚠️ 响应非 JSON (status=' + r.status + '), body=' + text.slice(0, 100));
          return false;
        }
      }).catch((e) => {
        console.warn('[store] ⚠️ middleware 请求失败:', e.message);
        return false;
      });
    }
    // 非 dev 模式
    idbSave(STORAGE_KEY, wrapper).catch(() => {});
    console.log('[store] 💾 localStorage + IndexedDB 已写入');
    return Promise.resolve(true);
  }

  // 轮询删掉，没用

  /**
   * 合并 seed 和存档。
   * @param preferSavedInstances dev 模式下为 true —— 此时文件系统 tv2.json 是唯一权威，
   *   且 vite 会把该文件从 watcher 排除（见 vite.config），编译时 seed 快照可能是陈旧的，
   *   因此 instances 必须以 saved（load-data 读到的文件内容）为准，seed 只兜底缺失 id。
   */
  function mergeWithSeed(saved: GameData, preferSavedInstances = false): GameData {
    const seedData = seed as unknown as GameData;

    // 从存档里恢复 deletedSeedInstIds（如果存档有这个字段）
    const savedDeleted = (saved as any).__deletedSeedInstIds as string[] | undefined;
    if (savedDeleted?.length) {
      for (const id of savedDeleted) deletedSeedInstIds.value.add(id);
    }

    let mergedInstances: ResourceInstance[];
    if (preferSavedInstances) {
      // dev：以文件系统为准（含 sync 对已有实例字段的更新），删除标记照常剔除
      const savedIds = new Set(saved.instances.map((i) => i.id));
      mergedInstances = [
        ...saved.instances.filter((i) => !deletedSeedInstIds.value.has(i.id)),
        // seed 里有而 saved 缺失的（理论上 dev 不该发生），兜底并入
        ...seedData.instances.filter((i) => !deletedSeedInstIds.value.has(i.id) && !savedIds.has(i.id)),
      ];
    } else {
      // 非 dev：seed 编译快照为最新元数据，用户新增的追加，用户删过的剔除
      const seedInstIds = new Set(seedData.instances.map((i) => i.id));
      const userAddedInsts = saved.instances.filter((i) => !seedInstIds.has(i.id));
      mergedInstances = [
        ...seedData.instances.filter((i) => !deletedSeedInstIds.value.has(i.id)),
        ...userAddedInsts,
      ];
    }

    const mergedTrains = seedData.trains;

    // 关卡：以 seed 为准，用户可编辑字段用存档值覆盖
    const userFields = ['goals', 'workerStations', 'workerStationArr', 'resourceStationArr', 'externalStationArr', 'initialStations', 'initialTrains', 'maxTrainLevel', 'maxBuyTrains', 'shippedTrains', 'startMoney', 'instanceOverrides', 'powerSources', 'notes', 'hasInterception', 'hasSpecialProduction', 'hasIndependentEvent', 'hasTerrainChange', 'hasMergedProduction', 'hasMultipleInstances', 'hasResourceStation', 'hasExternalStation', 'coProductionGroups', 'multiChannelGroups', 'deletedSeedInstIds'] as const;
    const savedMap = new Map(saved.levels.map((l) => [l.id, l]));

    const mergedLevels = seedData.levels.map((seedLv) => {
      const savedLv = savedMap.get(seedLv.id);
      if (!savedLv) return { ...seedLv };
      return { ...seedLv, ...Object.fromEntries(userFields.map((k) => [k, (savedLv as any)[k]])) };
    });

    // 存档里有但 seed 里没有的关卡（老版本遗留）—— 保留
    for (const savedLv of saved.levels) {
      if (!seedData.levels.some((s) => s.id === savedLv.id)) {
        mergedLevels.push(savedLv);
      }
    }

    // —— 站点结构迁移：旧字段 → 新三数组 ——
    migrateLevelStations(mergedLevels);

    const merged: GameData = {
      instances: mergedInstances,
      trains: mergedTrains,
      levels: mergedLevels,
    };

    // 检查是否有元数据变化
    let metaChanged = 0;
    for (const seedLv of seedData.levels) {
      const savedLv = savedMap.get(seedLv.id);
      if (!savedLv) { metaChanged++; continue; }
      const seedKey = JSON.stringify({ c: seedLv.constraints, e: seedLv.earn, s: seedLv.spend, sec: seedLv.seconds });
      const saveKey = JSON.stringify({ c: savedLv.constraints, e: savedLv.earn, s: savedLv.spend, sec: savedLv.seconds });
      if (seedKey !== saveKey) metaChanged++;
    }
    if (metaChanged > 0) {
      console.log(`[store] 🔄 检测到 ${metaChanged} 个关卡元数据已更新（来自最新 seed）`);
    }

    return merged;
  }

  /** 加载存档：dev 模式优先代码 JSON，非 dev 读 localStorage/IndexedDB */
  async function hydrate(): Promise<void> {
    const countGoals = (d: GameData) => d.levels.reduce((sum, l) => sum + (l.goals?.length ?? 0), 0);
    const seedData = seed as unknown as GameData;

    if (import.meta.env.DEV) {
      // 🎯 dev 模式：fetch middleware 最新文件系统内容，不用编译时 import 快照
      try {
        const resp = await fetch('/api/load-data?t=' + Date.now());
        if (resp.ok) {
          const saved = await resp.json();
          // dev：实例以文件系统为准（编译 seed 快照可能陈旧）
          const merged = mergeWithSeed(saved as GameData, true);

          // 额外：合并 localStorage 中的用户修改（防止 POST 保存失败导致数据丢失）
          try {
            const localRaw = localStorage.getItem(STORAGE_KEY);
            if (localRaw) {
              const localData = JSON.parse(localRaw) as GameData;
              const localMap = new Map(localData.levels.map((l) => [l.id, l]));
              const userFields = ['goals', 'workerStations', 'workerStationArr', 'resourceStationArr', 'externalStationArr', 'initialStations', 'initialTrains', 'maxTrainLevel', 'maxBuyTrains', 'shippedTrains', 'startMoney', 'instanceOverrides', 'powerSources', 'notes', 'hasInterception', 'hasSpecialProduction', 'hasIndependentEvent', 'hasTerrainChange', 'hasMergedProduction', 'hasMultipleInstances', 'hasResourceStation', 'hasExternalStation', 'coProductionGroups', 'multiChannelGroups', 'deletedSeedInstIds'] as const;
              let mergedCount = 0;
              for (const lv of merged.levels) {
                const localLv = localMap.get(lv.id);
                if (localLv) {
                  for (const key of userFields) {
                    if ((localLv as any)[key] !== undefined) {
                      (lv as any)[key] = (localLv as any)[key];
                    }
                  }
                  mergedCount++;
                }
              }
              if (mergedCount > 0) {
                console.log(`[store] 🔄 已从 localStorage 合并 ${mergedCount} 个关卡的修改`);
              }
            }
          } catch { /* ignore */ }

          migrateLevelStations(merged.levels);
          setData(merged);
          source.value = '代码 JSON';
          lastSaved.value = Date.now();
          const filled = merged.levels.filter((l) => l.goals?.length).length;
          const gCount = merged.levels.reduce((s, l) => s + (l.goals?.length ?? 0), 0);
          console.log(`[store] ✅ dev 模式：从文件系统加载，${filled}/${merged.levels.length} 关有目标 (${gCount} goals)`);
          return;
        }
      } catch { /* ignore */ }
      // fallback：先尝试从 localStorage 恢复（防止 middleware 写入失败导致数据丢失）
      try {
        const localRaw = localStorage.getItem(STORAGE_KEY);
        if (localRaw) {
          const localData = JSON.parse(localRaw) as GameData;
          const localGoals = localData.levels?.reduce((s, l) => s + (l.goals?.length ?? 0), 0) ?? 0;
          if (localGoals > 0) {
            const merged = mergeWithSeed(localData, false);
            migrateLevelStations(merged.levels);
            setData(merged);
            source.value = '本地存档';
            lastSaved.value = Date.now();
            console.log(`[store] ✅ middleware 不可用，已从 localStorage 恢复 (${localGoals} goals)`);
            return;
          }
        }
      } catch { /* ignore */ }
      // 最终 fallback：编译时快照
      setData(seedData);
      source.value = '代码 JSON';
      console.log('[store] ⚠️ 无可用存档，使用编译时快照');
      return;
    }

    // ——— 非 dev 模式：localStorage + IndexedDB 双读 ———
    const idbRaw = await idbLoad<unknown>(STORAGE_KEY);
    const lsRaw = localStorage.getItem(STORAGE_KEY);

    let idbData: GameData | null = null;
    let lsData: GameData | null = null;

    if (idbRaw) {
      const { data: v } = validate(idbRaw);
      if (v) idbData = v;
    }
    if (lsRaw) {
      try {
        const { data: v } = validate(JSON.parse(lsRaw));
        if (v) lsData = v;
      } catch { /* ignore */ }
    }

    if (!idbData && !lsData) {
      console.log('[store] ⚠️ 无存档，使用内置示例数据');
      return;
    }

    const idbGoals = idbData ? countGoals(idbData) : -1;
    const lsGoals = lsData ? countGoals(lsData) : -1;

    let winner: GameData;
    let winnerName: string;

    if (lsData) {
      winner = lsData;
      winnerName = 'localStorage';
    } else {
      winner = idbData!;
      winnerName = 'IndexedDB';
    }
    console.log(`[store] 📊 存储对比: LS goals=${lsGoals}, IDB goals=${idbGoals}, winner=${winnerName}`);

    const merged = mergeWithSeed(winner);
    const jsonStr = JSON.stringify(merged);
    try { localStorage.setItem(STORAGE_KEY, jsonStr); } catch { /* ignore */ }
    idbSave(STORAGE_KEY, merged).catch(() => {});
    setData(merged);
    source.value = '本地存档';
    lastSaved.value = Date.now();
    const filled = merged.levels.filter((l) => l.goals?.length).length;
    console.log(`[store] ✅ 从 ${winnerName} 加载 + seed 合并，${filled}/${merged.levels.length} 关有目标`);
  }

  async function importJson(json: string): Promise<boolean> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e: unknown) {
      issues.value = [`JSON 解析失败：${(e as Error).message}`];
      return false;
    }
    // 先提取 __deletedSeedInstIds（如果导入的 JSON 有的话）
    const rawDeleted = (parsed as any)?.__deletedSeedInstIds as string[] | undefined;
    const { data: v, issues: iss } = validate(parsed);
    if (!v) {
      issues.value = iss;
      return false;
    }
    deletedSeedInstIds.value.clear();
    if (rawDeleted?.length) {
      for (const id of rawDeleted) deletedSeedInstIds.value.add(id);
    }
    setData(v);
    issues.value = iss;
    source.value = '导入文件';
    // 立刻写入 localStorage + IndexedDB + 文件（防止后续保存失败导致数据丢失）
    const jsonStr = JSON.stringify(v);
    try { localStorage.setItem(STORAGE_KEY, jsonStr); } catch { /* ignore */ }
    idbSave(STORAGE_KEY, v).catch(() => {});
    lastSaved.value = Date.now();
    // 再写入文件（forceSave 会写 localStorage 一次，但没关系，覆盖相同数据）
    await forceSave();
    return true;
  }

  function reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    idbDelete(STORAGE_KEY).catch(() => {});
    deletedSeedInstIds.value.clear();
    setData(seed as unknown as GameData);
    issues.value = [];
    source.value = '内置数据';
    lastSaved.value = 0;
  }

  /** 从 IndexedDB 恢复（localStorage 被清了时救回用） */
  async function restoreFromIdb(): Promise<boolean> {
    try {
      const raw = await idbLoad<any>(STORAGE_KEY);
      if (!raw) return false;
      const wrapper = typeof raw === 'string' ? JSON.parse(raw) : raw;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapper));
      if (wrapper.__deletedSeedInstIds?.length) {
        deletedSeedInstIds.value = new Set(wrapper.__deletedSeedInstIds);
      }
      await hydrate();
      return true;
    } catch {
      return false;
    }
  }

  // ————————— 索引 —————————
  const instById = computed(() => new Map(data.value.instances.map((i) => [i.id, i])));
  const instsByName = computed(() => {
    const m = new Map<string, ResourceInstance[]>();
    for (const i of data.value.instances) {
      const arr = m.get(i.name) ?? [];
      arr.push(i);
      m.set(i.name, arr);
    }
    return m;
  });

  const baseLevels = computed(() => data.value.levels.filter((l) => l.category === '游戏本体'));
  const resourceNames = computed(() => [...instsByName.value.keys()]);

  function iconOf(item: { name: string; id: string }): string {
    return item.name || item.id;
  }

  // ————————— 物资实例 CRUD —————————
  function instanceAdd(inst: ResourceInstance): { ok: boolean; msg?: string } {
    if (!inst.id.trim()) return { ok: false, msg: '实例ID不能为空' };
    if (!inst.name.trim()) return { ok: false, msg: '物资名称不能为空' };
    if (data.value.instances.some((i) => i.id === inst.id)) {
      return { ok: false, msg: `实例ID「${inst.id}」已存在` };
    }
    data.value.instances.push({ ...inst });
    scheduleSave();
    return { ok: true };
  }

  function instanceUpdate(id: string, patch: Partial<ResourceInstance>): { ok: boolean; msg?: string } {
    const idx = data.value.instances.findIndex((i) => i.id === id);
    if (idx < 0) return { ok: false, msg: `实例「${id}」不存在` };
    const merged = { ...data.value.instances[idx], ...patch };
    if (patch.id && patch.id !== id) {
      if (!patch.id.trim()) return { ok: false, msg: '实例ID不能为空' };
      if (data.value.instances.some((i, j) => i.id === patch.id && j !== idx)) {
        return { ok: false, msg: `实例ID「${patch.id}」已存在` };
      }
    }
    data.value.instances[idx] = merged;
    scheduleSave();
    return { ok: true };
  }

  function instanceRemove(id: string): { ok: boolean; msg?: string } {
    const idx = data.value.instances.findIndex((i) => i.id === id);
    if (idx < 0) return { ok: false, msg: `实例「${id}」不存在` };
    // 如果删的是 seed 里本来就有的实例，登记到 deletedSeedInstIds，避免 hydration 时被 seed 覆盖回来
    const seedInstIds = (seed as unknown as GameData).instances.map((i) => i.id);
    if (seedInstIds.includes(id)) {
      deletedSeedInstIds.value.add(id);
    }
    data.value.instances.splice(idx, 1);
    scheduleSave();
    return { ok: true };
  }

  return {
      data, issues, source, lastSaved,
      instById, instsByName, baseLevels, resourceNames,
      iconOf, hydrate, importJson, reset, restoreFromIdb,
      instanceAdd, instanceUpdate, instanceRemove,
      scheduleSave,
      /** 取消 debounce 立即持久化 */
      forceSave,
    };
});

// 支持 Pinia HMR，使热更新时 store 实例自动更新新方法
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useGameStore, import.meta.hot));
}
