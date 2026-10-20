/**
 * 关卡「用户可编辑字段」白名单。
 *
 * 合并 seed 与存档时，只有名单内的字段允许被存档值覆盖（见 game.ts 的 mergeWithSeed
 * 与 hydrate 的 localStorage 合并）。此前该名单在 game.ts 里硬编码了两份，改一处漏一处
 * 就会产生静默 bug，故收敛为单一来源。
 */
export const USER_EDITABLE_FIELDS = [
  'goals',
  'workerStations',
  'workerStationArr',
  'resourceStationArr',
  'externalStationArr',
  'passengerStationArr',
  'initialTrains',
  'maxTrainLevel',
  'maxBuyTrains',
  'shippedTrains',
  'startMoney',
  'instanceOverrides',
  'powerSources',
  'notes',
  'hasInterception',
  'hasSpecialProduction',
  'hasIndependentEvent',
  'hasTerrainChange',
  'hasMergedProduction',
  'hasMultipleInstances',
  'hasResourceStation',
  'hasExternalStation',
  'hasPassengerStation',
  'coProductionGroups',
  'multiChannelGroups',
  'deletedSeedInstIds',
  'earnPlan',
] as const;

export type UserEditableField = (typeof USER_EDITABLE_FIELDS)[number];