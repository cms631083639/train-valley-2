/**
 * 列车领域派生逻辑（纯函数集合）。
 *
 * 从 LevelsPage.vue 抽离：列车数据最高等级、关卡初始最低/最高等级、
 * 货运量按等级查表、升级下拉选项、升级次数步进器的取数与回算。
 * 所有函数均为纯函数，依赖的数据通过参数显式传入，便于复用与单测。
 */
import type { Level, TrainLevel } from '@/types';

/** 无关卡列车数据时的默认等级（初始最高/最低等级回落值） */
const DEFAULT_LEVEL = 1;
/** 无列车数据时的最高等级回落值 */
const DEFAULT_MAX_LEVEL = 6;

/** 列车数据里的最高等级（无数据时回落 6） */
export function maxTrainLevelOf(trains: TrainLevel[]): number {
  return trains.length ? Math.max(...trains.map((t) => t.level)) : DEFAULT_MAX_LEVEL;
}

/** 关卡初始列车的最高等级（无初始列车时回落 1） */
export function initMaxTrainLevel(lv: Level | undefined): number {
  const trains = lv?.initialTrains ?? [];
  return trains.length ? Math.max(...trains.map((t) => t.level)) : DEFAULT_LEVEL;
}

/** 关卡初始列车的最低等级（无初始列车时回落 1） */
export function initMinTrainLevel(lv: Level | undefined): number {
  const trains = lv?.initialTrains ?? [];
  return trains.length ? Math.min(...trains.map((t) => t.level)) : DEFAULT_LEVEL;
}

/**
 * 关卡当前可升到的最高火车等级。
 * 优先读用户配置（需落在 [初始最高等级, 列车最高等级] 区间内），否则取初始最高等级 +1，
 * 即"默认升 1 级"，使升级次数默认为 1；上限 = 列车最高等级。
 */
export function resolveMaxTrainLevel(lv: Level | undefined, dataMaxLevel: number): number {
  const initMax = initMaxTrainLevel(lv);
  const cfg = lv?.maxTrainLevel;
  if (cfg && cfg >= initMax && cfg <= dataMaxLevel) return cfg;
  return Math.min(dataMaxLevel, initMax + 1);
}

/** 根据火车等级查真实货运量（查 trains 的 capacity，找不到回落等级本身并夹在 1..最高等级） */
export function cargoOfLevel(level: number, trains: TrainLevel[], dataMaxLevel: number): number {
  const t = trains.find((x) => x.level === level);
  return t ? t.capacity : Math.max(1, Math.min(dataMaxLevel, level));
}

/** 最高升级下拉选项：从初始最高等级到列车最高等级 */
export function upgradeLevelOptionsOf(lv: Level | undefined, trains: TrainLevel[]): TrainLevel[] {
  const initLv = initMaxTrainLevel(lv);
  return trains.filter((t) => t.level >= initLv);
}

/** 升级次数（步进器展示用）= 当前最高等级 - 初始最高等级 */
export function upgradeCountOf(lv: Level | undefined, currentMaxLevel: number): number {
  return Math.max(0, currentMaxLevel - initMaxTrainLevel(lv));
}

/** 升级次数步进器允许的最大值 = 列车最高等级 - 初始最高等级 */
export function upgradeCountMaxOf(lv: Level | undefined, dataMaxLevel: number): number {
  return Math.max(0, dataMaxLevel - initMaxTrainLevel(lv));
}

/**
 * 由升级次数反算 maxTrainLevel 值（供 patchLevel 写入）。
 * count=0 代表"不升级"，最高等级 = 初始最高等级。
 */
export function maxTrainLevelFromCount(count: number, lv: Level | undefined, dataMaxLevel: number): number {
  const clamped = Math.max(0, Math.min(upgradeCountMaxOf(lv, dataMaxLevel), Math.floor(count)));
  return Math.min(dataMaxLevel, initMaxTrainLevel(lv) + clamped);
}
