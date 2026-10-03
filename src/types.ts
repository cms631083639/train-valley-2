/**
 * Train Valley 2 攻略辅助工具 —— 核心数据结构（对应飞书表《train valley 2.xlsx》）
 *
 * 关键设计：
 * 1. 物资实例模型：《物资主表》每行不是"一种物资"，而是"某物资的一种获取途径"。
 *    同一名称可有多个实例（如 木板5y=生产、木板b2=生产、木板GC=刷新、木板B5=购买），
 *    配方输入按"物资名称"引用；同一关卡内同名词只会出现一个实例。
 * 2. 电力隔离：电力是特殊外部供给源。电力本身也消耗物资（如 1 工人+1 煤炭可供电 20 秒），
 *    且通电不生产时仍在空耗，消耗量取决于通电时长（时间维度）；
 *    若把发电消耗拆进基础材料会让静态需求表无比复杂，
 *    因此最终需求只统计非电力消耗的物资，电力站点仅标记"需通电"条件。
 */

/** 内容来源 */
export type ContentCategory = '游戏本体' | 'DLC';

/** 外部获取方式 */
export type ObtainMethod = '刷新' | '购买' | '无限' | '库存' | '客流';

/** 物资实例（《物资主表》一行） */
export interface ResourceInstance {
  /** 表内唯一 ID，如 原木sv */
  id: string;
  /** 物资名称，如 原木（同名可多实例） */
  name: string;
  /** 生产输入：按物资名称引用（配方物资类型拆分）；空 = 该实例不生产 */
  inputs: string[];
  /** 是否可作为关卡外部物资站点候选（刷新/购买） */
  external?: boolean;
  /** 获取方式：刷新 / 购买 / 无限 / 库存 —— 独立于 external，初始配置类实例也有 */
  obtain?: ObtainMethod | null;
  /** 电力依赖：true = 生产该物资的站点需要通电（不计入消耗） */
  needsPower?: boolean;
  /** 单次产出（生产类必填；外部/初始配置类通常由关卡动态决定） */
  perOut?: number;
  /** 单次消耗（生产类必填；外部/初始配置类通常不需要） */
  perIn?: number;
  /** 是否标记为「关卡初始配置」候选 —— 可作为关卡资源站点（无限/库存）或外部物资站点 */
  initialSetup?: boolean;
  /** 备注信息 */
  notes?: string;
}

/** 关卡的一条交付目标（《关卡目标》） */
export interface LevelGoal {
  /** 稳定行标识：仅用于 UI 绑定行内状态（搜索词/光标），行重排/删除时不随之改变；不参与业务计算 */
  uid?: string;
  /** 物资实例 id */
  resourceId: string;
  qty: number;
  /** 所属站点标识列表（A/B/…）；多站点 = 共同接收此目标，总量 qty 一次性汇总 */
  stationLabels?: string[];
  /** 兼容老数据：单站点可存 stationLabel（迁移到 stationLabels[0]） */
  stationLabel?: string;
  /** 同一站点内的"生产栈"标识：同栈内有先后顺序，不同栈并行；为空自动归栈 */
  stackId?: string;
  /** 栈内顺序（1=最先送） */
  order?: number;
}

/** —— 站点类型：三种，独立编号、独立 resourceId 筛选 —— */

/** 外部物资站点的供给类型 */
export type StationExternalKind = '刷新' | '购买' | '库存' | '客流';
/** 刷新类的开始方式 */
export type RefreshStart = 'timed' | 'unlock';

/** 站点标签（各类型独立） */
export type WorkerLabel = string;    // A, B, C, ...
export type ResourceLabel = string;  // r1, r2, ...
export type ExternalLabel = string; // m1, m2, ...

/** 工人站点（编号 A/B/C...）：生产类配方（inputs 含"工人"），可配置 unlockCost */
export interface WorkerStation {
  label: WorkerLabel;
  /** 该站点生产的物资实例 id（inputs 含"工人"且非 initialSetup 的生产类） */
  resourceId?: string;
  /** 每周期生产量；undefined = 由关卡/引擎动态决定 */
  qty?: number;
  /** qty 是否跟随列车最高等级自动计算 */
  qtyAuto?: boolean;
  /** 解锁该站点需要的金钱；undefined = 默认解锁（关卡开始即存在） */
  unlockCost?: number;
}

/**
 * 资源站点（编号 r1/r2...）：关卡内可配置的初始物资供给站。
 * 仅限「obtain∈{无限, 库存}」且非工人/电力的 initialSetup 实例。
 * - obtain=无限 → 无限循环产出（类似原有行为）
 * - obtain=库存 → 有库存量上限，可配自动刷新
 */
export interface ResourceStation {
  label: ResourceLabel;
  /** 该站点产出的物资实例 id */
  resourceId?: string;
  /** 每次产出数量；undefined = 使用实例.perOut */
  qty?: number;
  /** 解锁该站点需要的金钱；undefined = 默认解锁 */
  unlockCost?: number;

  // —— obtain=库存 专属 ——
  /** 总库存量（件）；undefined / 空 = 无限（obtain=无限 的情况） */
  totalStock?: number;
  /** 库存是否自动刷新补充；默认 false（用完即止） */
  autoRefresh?: boolean;
  /** 自动刷新间隔（秒）；仅 autoRefresh=true 时生效 */
  refreshInterval?: number;
}

/** 客流站点（编号 A/B/C...）：乘客带来物资，每次1列车运载量，无定时/间隔，可解锁 */
export interface PassengerStation {
  label: string;
  /** 该站点产出的客流物资实例 id */
  resourceId?: string;
  /** 每次运送的数量（默认 = 1 列车的运载量） */
  qty?: number;
  /** 解锁该站点需要的金钱；undefined = 默认解锁 */
  unlockCost?: number;
}

/** 外部物资站点（编号 m1/m2...，原"关卡物资站点"）：刷新/购买/库存类型 */
export interface ExternalStation {
  label: ExternalLabel;
  /** 产出的物资实例 id（external=true 或 initialSetup+obtain=刷新/购买） */
  resourceId?: string;

  /** 每次刷新/购买的产出量；库存类=初始库存量；undefined = 动态计算 */
  qty?: number;
  qtyAuto?: boolean;

  // —— 刷新类 ——
  kind?: StationExternalKind;
  refreshStart?: RefreshStart;
  startDelay?: number;   // timed 模式
  unlockPrice?: number;  // unlock 模式
  interval?: number;

  // —— 购买类 / 库存类 ——
  price?: number;       // 仅购买类
  minQty?: number;
  minQtyAuto?: boolean;
  maxQty?: number;
  maxQtyAuto?: boolean;
}

/**
 * 旧 InitialStation —— 保留原字段以兼容迁移和现有 UI。
 * 运行时根据 kind 是否存在来判别站点类型：
 *   kind=刷新/购买 → externalStations[]
 *   kind=undefined → workerStations[]（或 resourceStations[]，按 resourceId 的 initialSetup 判断）
 */
export interface InitialStation {
  label: string;
  resourceId: string;
  qty?: number;
  qtyAuto?: boolean;
  kind?: StationExternalKind;
  refreshStart?: RefreshStart;
  startDelay?: number;
  unlockPrice?: number;
  interval?: number;
  price?: number;
  minQty?: number;
  minQtyAuto?: boolean;
  maxQty?: number;
  maxQtyAuto?: boolean;
}

/** 关卡初始列车配置 */
export interface InitialTrain {
  /** 列车等级（1-6） */
  level: number;
  /** 该等级的列车数量 */
  count: number;
}

/** 关卡（《关卡》一行） */
export interface Level {
  id: string;
  name: string;
  /** 内容类型：主线 / 客流 / 神话与铁路 … */
  contentType: string;
  /** 内容分类：游戏本体 / DLC */
  category: ContentCategory;
  /** 章节（时代），如 🔵 蒸汽时代 */
  chapter: string;
  /** 限时（秒） */
  seconds: number | null;
  /** 最佳时间（文本，如 5:00） */
  bestTime: string;
  /** 挣钱（表内原始值） */
  earn: string;
  /** 花钱（表内原始值） */
  spend: string;
  /** 限制条件：只保留非空列，key = 表列名（不停车/不掉头/避免碰撞…） */
  constraints: Record<string, string>;

  // ————————— 初始配置（可分步录入，全部可选）—————————

  /** 旧：工人站点数量（默认 1）；运行时会迁移为 workerStationArr */
  workerStations?: number;
  /** 旧：关卡自带站点数组；运行时会拆入 workerStationArr / externalStationArr */
  initialStations?: InitialStation[];

  // —— 新三类站点数组（归一化后使用）——
  /** 工人站点数组（编号 A/B/C...） */
  workerStationArr?: WorkerStation[];
  /** 资源站点数组（编号 r1/r2...）：初始配置实例（obtain=无限/库存） */
  resourceStationArr?: ResourceStation[];
  /** 客流站点数组（编号 A/B/C...）：乘客带来物资 */
  passengerStationArr?: PassengerStation[];
  /** 外部物资站点数组（编号 m1/m2...，原"关卡物资站点"） */
  externalStationArr?: ExternalStation[];

  /** 关卡初始可调度列车 */
  initialTrains?: InitialTrain[];
  /** 本关列车可升级到的最高等级（1-6）；未填则初始等级+1（上限6） */
  maxTrainLevel?: number;
  /** 最多可额外购买的列车数 */
  maxBuyTrains?: number | null;
  /** 需运送列车总数（关卡特殊要求） */
  shippedTrains?: number | null;
  /** 初始可用资金（文本，如 "30000"） */
  startMoney?: string;

  /** 最终交付目标（待录入时为空） */
  goals: LevelGoal[];

  /** 关卡局部覆盖：物资名 → 强制使用的实例 id（解决同一物资名在不同关卡用不同实例的问题） */
  instanceOverrides?: Record<string, string>;

  /**
   * 关卡可选电力来源实例 id 数组（name=电力 的 0~N 个实例）。
   * - 空 / undefined = 不配置电力，引擎默认策略自动选（通常是无限供给电力lf）
   * - 1 个 = 单实例电力，拆解树直接用它
   * - 多个 = 多实例电力来源并存（煤电 + 油电 + 核电…），UI 明确展示全部候选；
   *         引擎拆解时取 powerSources[0] 作为主计算依据
   */
  powerSources?: string[];

  /** 备注：过关思路简述 */
  notes?: string;

  // ————————— 关卡标记（待开发模块，纯标记用）—————————
  /** 是否有拦截站（强盗/事件站点） */
  hasInterception?: boolean;
  /** 是否有特殊生产站点（非标准工人站点） */
  hasSpecialProduction?: boolean;
  /** 是否有独立事件（剧情/随机事件） */
  hasIndependentEvent?: boolean;
  /** 是否有地形改变站（修路/改造地形） */
  hasTerrainChange?: boolean;
  /** 是否有合并生产（多站点合流 / 合并生产链） */
  hasMergedProduction?: boolean;
  /** 是否有多实例（同物资存在多配方/多获取路径） */
  hasMultipleInstances?: boolean;
  /** 是否有资源站点（初始配置） */
  hasResourceStation?: boolean;
  /** 是否有客流站点（乘客带来物资） */
  hasPassengerStation?: boolean;
  /** 是否有外部站点（定时周期/空投） */
  hasExternalStation?: boolean;
  /**
   * 合并生产站点（拆卸组）配置。
   * - 未定义 / 空数组 → 所有实例走旧逻辑（独立消耗）
   * - 有值 → 对应组内的实例按拆卸计算（共享配方消耗）
   *   未加入任何组的实例仍走旧逻辑
   */
  coProductionGroups?: CoProductionGroup[];
  /**
   * 多渠道生产组：同一类型物资存在多个实例时，在此配置具体实例列表。
   * 由关卡标记"多渠道生产"触发，在初始配置区编辑。
   */
  multiChannelGroups?: MultiChannelGroup[];
}

/** 列车等级（《列车》） */
export interface TrainLevel {
  level: number;
  /** 载货量 */
  capacity: number;
  price: number;
  /** 升级到下一级的费用；null = 不可再升 */
  upgrade: number | null;
  upgradable: boolean;
}

/** 整个数据集 */
export interface GameData {
  instances: ResourceInstance[];
  levels: Level[];
  trains: TrainLevel[];
}

/**
 * 资源分类（按生产链动态推导，不是静态字段）：
 * - 原料：仅由工人（+工人视为资源）生产，或外部供给（刷新/购买/无限）
 * - 加工品：配方 = 工人 + 至少1种原料（不含任何加工品/复合品）
 * - 复合品：配方含工人 + 至少1种加工品/复合品
 *
 * 分类从叶子向上递归：工人/外部供给 = 原料；其余配方看"非工人非电力"输入的最复杂类别。
 */
export type ResourceCategory = 'raw' | 'processed' | 'compound';

/** 拆卸组：多个实例共享同一配方，一次生产同时产出 */
export interface CoProductionGroup {
  /** 组 ID（如 'cp1', 'cp2'） */
  id: string;
  /** 组名（用户自定义，如 '建筑材料拆卸线'） */
  label?: string;
  /** 每次消耗量（默认 1） */
  perIn?: number;
  /** 库存上限：每次最多可处理的数量（默认不限制）。如列车运送4份但库存上限2，则只能拆出2份 */
  stockLimit?: number;
  /** 手动设定拆卸总个数：玩家直接填写拆卸工厂的总产出数量，替代趟数×每趟产出计算 */
  manualOutput?: number;
  /** 用户选择的产出实例列表 */
  outputs: CoProductionOutput[];
}

/** 多渠道生产组：同类型物资的多实例配置，由关卡标记"多渠道生产"触发 */
export interface MultiChannelGroup {
  /** 物资类型名称，如"钢坯" */
  typeName: string;
  /** 该类型下选中的实例 ID 列表 */
  instanceIds: string[];
}

/** 拆卸组产出实例 */
export interface CoProductionOutput {
  /** 实例 ID */
  instanceId: string;
  /** 每次产出该实例的数量 */
  perOut: number;
}

/** 电力物资名称（拆解时识别并隔离） */
export const POWER_NAME = '电力';
/** 工人：外部供给类，不进入消耗链 */
export const WORKER_NAME = '工人';
