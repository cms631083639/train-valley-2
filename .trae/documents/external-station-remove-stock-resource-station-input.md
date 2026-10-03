# 外部站移除库存 + 资源站点输入交互改造

## 背景

用户要求：
1. 外部站类型按钮仅保留"刷新"和"购买"，移除"库存"（库存属于初始配置）
2. 将库存归类到资源站点（资源站点已有库存支持）
3. 资源站点的实例选择交互改为与外部站一致：先输入物资名称搜索，再从下拉框选择实例

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/pages/LevelsPage.vue` | 主要改动：脚本逻辑 + 模板 |
| `src/components/TreeNode.vue` | 移除 `STATION_KIND.STOCK` 分支 |

## 改动步骤

### 1. 外部站移除"库存" — 脚本逻辑

**`allResourceNames`** — 移除 `OBTAIN.STOCK` 过滤条件
**`instancesOfName`** — 加 `i.obtain !== OBTAIN.STOCK` 排除库存实例
**`availableKindsForStation`** — 移除 `STATION_KIND.STOCK` 相关逻辑
**`kindFromObtain`** — 移除 `OBTAIN.STOCK` 映射
**`ensureKindDefaults`** — 移除 `STATION_KIND.STOCK` 分支（2处）
**`updateStation`** — 移除 `merged.kind === STATION_KIND.STOCK` 判断
**`stationInfoByName`** — 移除 `STATION_KIND.STOCK` 分支
**`StationInfo` 类型** — `kind` 移除 `'库存'`
**`resolveExternalSupply`** — 移除 `OBTAIN.STOCK` 三元分支

### 2. 外部站移除"库存" — 模板

**类型按钮区** — 移除"库存"按钮，`grid-cols-3` → `grid-cols-2`
**库存配置区** — 移除整个 `<template v-else-if="s.kind === STATION_KIND.STOCK">` 块

### 3. TreeNode.vue 更新

- `StationInfo` 类型 `kind` 移除 `'库存'`
- `resolveQty` 返回类型移除 `'库存'`
- `viaText` 函数移除 `STATION_KIND.STOCK` 分支（2处）

### 4. 资源站点输入交互改造 — 新增状态

在 `stationKeywords` 附近新增：

```typescript
const rsKeywords = ref<Record<number, string>>({});
const activeRsSuggest = ref(-1);
const rsSuggestCursor = ref<Record<number, number>>({});
const activeRsInst = ref(-1);
const rsInstCursor = ref<Record<number, number>>({});
```

### 5. 资源站点输入交互改造 — 新增函数

- `rsResourceNames` computed — 从 `initialSetupInstances` 提取唯一名称
- `rsInstancesOfName(name)` — 按名称过滤 `initialSetupInstances`
- `suggestRsResources(idx)` — 按关键词过滤名称
- `pickRsSuggest(idx, name)` — 选联想项，自动选第一个实例，打开实例下拉
- `onRsSuggestKeydown(idx, e)` — 联想键盘导航
- `openRsInst(idx)` — 打开实例下拉
- `pickRsInst(idx, instId)` — 选实例
- `onRsInstKeydown(idx, e)` — 实例下拉键盘导航

### 6. 资源站点输入交互改造 — 模板

将 `<select>` 替换为：
- 物资名输入框 + 联想下拉列表
- 实例按钮 + 实例下拉列表
- 保持原有的库存控件（totalStock、autoRefresh、refreshInterval）不变

### 7. 辅助函数更新

- `closeStationPopups` 添加 `activeRsSuggest` / `activeRsInst` 清理
- `addResourceStation` 添加 `rsKeywords` 清理
- `removeResourceStation` 添加 `rsKeywords` 清理

## 注意事项

- `StationExternalKind` 和 `STATION_KIND` 常量保留 `'库存'` 不做移除，兼容旧数据
- 旧数据中 `kind: '库存'` 的外部站不再显示 UI，但不崩溃
- 资源站点原有库存控件逻辑不变

## 验证

1. `npm run build` 通过
2. 外部站类型按钮仅显示"刷新"和"购买"
3. 资源站点输入框支持搜索联想 + 实例下拉
4. 资源站点选中库存实例后显示库存控件