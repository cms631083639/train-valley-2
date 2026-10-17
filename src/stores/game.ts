import { USER_EDITABLE_FIELDS } from '@/domain/levelFields';
import { ensureWorkerEY, mergeWithSeed, migrateLevelStations, validate } from '@/domain/migration';
import { CONTENT } from '@/constants';
import {
  STORAGE_KEY,
  fetchFileData,
  idbDelete,
  idbLoad,
  idbSave,
  pushFileData,
  readLocal,
  removeLocal,
  writeLocal,
} from '@/stores/persistence';
import { defineStore, acceptHMRUpdate } from 'pinia';
import { computed, ref } from 'vue';
import seed from '@/data/tv2.json';
import type { GameData, ResourceInstance } from '@/types';

export const useGameStore = defineStore('game', () => {
  const initialData = ensureWorkerEY(seed as unknown as GameData);
  const data = ref<GameData>(initialData);
  /** 确保 data.value 始终包含 工人eY，防止文件覆盖后丢失 */
  function setData(d: GameData) {
    data.value = ensureWorkerEY(d);
  }
  /**
   * 是否已成功加载到有效存档。
   * 仅当 hydrate 从「文件系统 / 本地存档」成功加载后为 true；最终回退到编译时快照
   * （无可用存档）时保持 false。
   * 作用：persistNow 在未成功加载时拒绝写文件，避免「残缺运行时覆盖好存档」——
   * 这正是历史上电力来源等字段被静默抹掉的机制（beforeunload 自动保存 + 降级运行时）。
   */
  const hydrated = ref(false);
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
    // 未成功加载到有效存档时，拒绝回写：否则会把降级/残缺的运行时整份覆盖到文件与
    // localStorage，造成字段静默丢失（历史上电力来源就是这样消失的）。
    if (!hydrated.value) {
      console.warn('[store] ⏭️ 跳过保存：数据尚未成功加载，拒绝用残缺数据覆盖存档');
      return Promise.resolve(false);
    }
    // 写 localStorage 在当前数据之前，作为保险
    const wrapper = { ...data.value, __deletedSeedInstIds: [...deletedSeedInstIds.value] };
    writeLocal(STORAGE_KEY, wrapper);
    lastSaved.value = Date.now();

    if (import.meta.env.DEV) {
      // 文件 payload 也带上 __deletedSeedInstIds，确保 hydration 能恢复
      return pushFileData({
        instances: data.value.instances,
        trains: data.value.trains,
        levels: data.value.levels,
        __deletedSeedInstIds: [...deletedSeedInstIds.value],
      });
    }
    // 非 dev 模式
    idbSave(STORAGE_KEY, wrapper).catch(() => {});
    console.log('[store] 💾 localStorage + IndexedDB 已写入');
    return Promise.resolve(true);
  }

  // 轮询删掉，没用

  /** 加载存档：dev 模式优先代码 JSON，非 dev 读 localStorage/IndexedDB */
  async function hydrate(): Promise<void> {
    const countGoals = (d: GameData) => d.levels.reduce((sum, l) => sum + (l.goals?.length ?? 0), 0);
    const seedData = seed as unknown as GameData;

    if (import.meta.env.DEV) {
      // 🎯 dev 模式：fetch middleware 最新文件系统内容，不用编译时 import 快照
      try {
        const saved = await fetchFileData<GameData>();
        if (saved) {
          // dev：实例以文件系统为准（编译 seed 快照可能陈旧）
          const merged = mergeWithSeed(saved, seedData, deletedSeedInstIds.value, true);

          // 额外：合并 localStorage 中的用户修改（防止 POST 保存失败导致数据丢失）
          try {
            const localData = readLocal<GameData>(STORAGE_KEY);
            if (localData) {
              const localMap = new Map(localData.levels.map((l) => [l.id, l]));
              let mergedCount = 0;
              for (const lv of merged.levels) {
                const localLv = localMap.get(lv.id);
                if (localLv) {
                  for (const key of USER_EDITABLE_FIELDS) {
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
          hydrated.value = true;
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
        const localData = readLocal<GameData>(STORAGE_KEY);
        if (localData) {
          const localGoals = localData.levels?.reduce((s, l) => s + (l.goals?.length ?? 0), 0) ?? 0;
          if (localGoals > 0) {
            const merged = mergeWithSeed(localData, seedData, deletedSeedInstIds.value);
            migrateLevelStations(merged.levels);
            setData(merged);
            hydrated.value = true;
            source.value = '本地存档';
            lastSaved.value = Date.now();
            console.log(`[store] ✅ middleware 不可用，已从 localStorage 恢复 (${localGoals} goals)`);
            return;
          }
        }
      } catch { /* ignore */ }
      // 最终 fallback：编译时快照（属于降级状态，hydrated 保持 false，禁止回写文件）
      setData(seedData);
      source.value = '代码 JSON';
      console.log('[store] ⚠️ 无可用存档，使用编译时快照（本次不会回写文件，避免残缺数据覆盖存档）');
      return;
    }

    // ——— 非 dev 模式：localStorage + IndexedDB 双读 ———
    const idbRaw = await idbLoad<unknown>(STORAGE_KEY);
    const lsRaw = readLocal<unknown>(STORAGE_KEY);

    let idbData: GameData | null = null;
    let lsData: GameData | null = null;

    if (idbRaw) {
      const { data: v } = validate(idbRaw);
      if (v) idbData = v;
    }
    if (lsRaw) {
      const { data: v } = validate(lsRaw);
      if (v) lsData = v;
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

    const merged = mergeWithSeed(winner, seedData, deletedSeedInstIds.value);
    writeLocal(STORAGE_KEY, merged);
    idbSave(STORAGE_KEY, merged).catch(() => {});
    setData(merged);
    hydrated.value = true;
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
    hydrated.value = true; // 用户导入的是完整有效数据，允许回写
    issues.value = iss;
    source.value = '导入文件';
    // 立刻写入 localStorage + IndexedDB + 文件（防止后续保存失败导致数据丢失）
    writeLocal(STORAGE_KEY, v);
    idbSave(STORAGE_KEY, v).catch(() => {});
    lastSaved.value = Date.now();
    // 再写入文件（forceSave 会写 localStorage 一次，但没关系，覆盖相同数据）
    await forceSave();
    return true;
  }

  function reset(): void {
    removeLocal(STORAGE_KEY);
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
      writeLocal(STORAGE_KEY, wrapper);
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

  const baseLevels = computed(() => data.value.levels.filter((l) => l.category === CONTENT.BASE));
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
