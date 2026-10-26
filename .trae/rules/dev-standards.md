# 开发规范：架构归属与冗余治理（强制）

> 本文件与 `ui-dev.md` 并列，由项目维护者制定，每次新对话自动加载。
> - **UI 相关**（设计令牌、组件结构、控件样式）→ 见 `ui-dev.md`
> - **架构与冗余治理**（分层、常量归属、改动纪律）→ 见本文件
>
> **核心目的**：接到新需求时，必须先定位到既有架构里的正确归属地，再做最小改动。
> **明确禁止**：哪里报错就改哪里、就地复制一份、绕过既有常量重写字符串。

---

## 1. 分层与依赖方向（只许向下，禁止反向）

| 层 | 目录 | 职责 | 允许 import |
|---|---|---|---|
| L0 基础 | `src/types.ts`、`src/constants.ts`、`src/icons/`、`shared/enums.js`（跨 TS/JS 两侧共用的纯值对象） | 类型与值对象、图标注册表 | 仅 L0 |
| L1 领域 | `src/domain/*.ts` | 纯函数派生逻辑（无 Vue、无 I/O、无副作用） | L0 |
| L1 引擎 | `src/engine/*.ts` | 拆解计算（含其专属策略常量） | L0 |
| L2 展示工具 | `src/utils/*.ts` | 纯格式化 / 文案映射 | L0 |
| L3 编排 | `src/composables/*.ts`、`src/stores/*.ts` | 组合式函数、数据层与编排 | L0–L2 |
| L4 UI | `src/components/**`、`src/pages/*`、`src/App.vue` | 渲染与事件绑定 | L0–L3 |

**铁律**：
1. `domain/`、`engine/`、`utils/` 禁止 import `@/stores`、`@/composables`、`@/components`、`@/pages`。
2. `composables/` 禁止 import `@/stores`。依赖一律以 `Ref` / `ComputedRef` 显式注入，保持「store → 组合式函数 → 组件」单向数据流。
3. `stores/` 只做数据层与编排，不得含渲染逻辑。
4. 需要新依赖时，**向下取或显式注入**，不得为了少写一个参数而反向 import。

**现状已满足**，改动后自检（两条都必须为空输出）：
```bash
grep -rn "from '@/\(stores\|composables\|pages\|components\)" src/domain src/engine src/utils
grep -rn "useGameStore\|from '@/stores" src/composables
```

---

## 2. 常量权威归属表（唯一来源）

**一个业务概念有且仅有一个定义处。同一个概念出现第 2 处定义 = 违规，必须合并回权威处。**

| 概念 | 权威定义处 | 消费方 import 自 |
|---|---|---|
| `OBTAIN`、`STATION_KIND`、`REFRESH_START`、`VIA`、`CATEGORY`、`STRATEGY_CARD`、`FILTER_ALL` | `src/constants.ts` | `@/constants` |
| `RECIPE_CHOICE`、`BREAKDOWN_STRATEGY`（引擎策略参数） | `src/engine/breakdown.ts` | `@/engine/breakdown` |
| `POWER_NAME`、`WORKER_NAME` | `src/types.ts` | `@/types`（**是值，不能用 `import type`**） |
| 上线站用户态 DTO：`AuthUser`、`CaptchaPayload`、`CommentItem`、`SuggestionItem`、`SuggestionStatus` | `src/types.ts` | `@/types`（类型，用 `import type`） |
| 内容分类文案 `CONTENT_CATEGORY_LABEL`、物资分类样式 `RESOURCE_CATEGORY_STYLE`、`OBTAIN_LABEL` | `src/utils/format.ts` | `@/utils/format` |
| 展示文案函数 `constraintText` / `starConditionText` / `fmtSeconds` / `fmtMinSec` | `src/utils/format.ts` | `@/utils/format` |
| 跨 TS/JS 两侧共用的纯值对象：`CONTENT`（内容分类值）、constraints 列清单 | `shared/enums.js`（类型在 `shared/enums.d.ts`，需同步改） | 应用侧经 `src/constants.ts` re-export 后仍从 `@/constants` 取；脚本侧 `import ... from '../shared/enums.js'` |
| 飞书 Base 表 ID、字段名（含历史别名）、Excel 工作表/列名 | `scripts/feishu-fields.cjs` | 脚本内 `require('./feishu-fields.cjs')` / `import fields from './feishu-fields.cjs'` |

**写法约定**：
- 值对象一律 `as const` 值对象 + `(typeof X)[keyof typeof X]` 派生类型。
- `types.ts` 有值导出与 type 导出混用，导入值时必须用普通 `import`。
- 当「类型在 `types.ts`、值在 `constants.ts`」时，必须用 `Record<该类型, ...>` 消费（如 `OBTAIN_LABEL: Record<ObtainMethod, string>`），让 TS 强制两份定义对齐，防止静默漂移。
- 两个**同名但不同命名空间**的表必须在定义处写注释说明边界（范例：`STRATEGY_CARD` 与 `BREAKDOWN_STRATEGY` 重名但一个是 UI 卡片标识、一个是引擎参数，**不得互相顶替引用**）。
- `scripts/` 是 Node 侧、不受第 1 节分层约束（无法 import `src/` 的 TS），但飞书侧的表/字段名只许在 `feishu-fields.cjs` 定义一次；飞书改字段名时在字典的**别名数组**里追加新名、保留旧名，业务脚本禁止再写裸字符串。理由：这些脚本多含**整表替换写回**，字段名取不到值时会静默把 `tv2.json` 的 `name`/`inputs` 写空（2026-10-18 飞书把「物资名称」改名「物资类型」即触发此风险）。
- 跨 TS/JS **两侧都要用**的值对象一律下沉到 `shared/enums.js`，禁止两侧各写一份：应用侧由 `src/constants.ts` re-export（消费方仍从 `@/constants` 取），脚本侧直接 import 该 JS 模块。原因：Node 加载不了 `.ts`、也不认 `@/` 别名，"共享同一份"只能靠一个 JS 模块实现；此时在 TS 侧再写一份即违规。注意 `.cjs` 脚本在 Node 20 下不能 `require` ESM，需要用到该模块时先把脚本改名 `.mjs`。

---

## 3. 新增 / 修改业务概念的三步检查清单（强制顺序）

**Step 1 查重** —— 动手前先搜全项目，确认这个概念是否已经存在：
```bash
grep -rn "<中文名\|英文标识\|近义命名>" src
```
已存在同义/近义定义 → **复用**，不得新建；若有多个 → 先合并再继续。

**Step 2 定归属** —— 对照第 2 节权威表确定该概念的归属文件。
若权威表里没有这类概念 → **先把新行补进第 2 节表格**，再写代码。

**Step 3 再写业务** —— 所有判断、比较、传参一律引用常量，禁止裸字面量。

---

## 4. 禁止清单（P0–P3 已清理过的反面模式，不得重犯）

| # | 反面模式 | 判定 | 正确做法 |
|---|---|---|---|
| 1 | **重复定义** | 同一枚举在 `constants.ts` 与 `engine` 各定义一份 | 只留权威处，另一处删并从权威处 import |
| 2 | **死代码** | 导出但全项目零引用的常量/映射 | 直接删除 |
| 3 | **逃逸字面量** | 值对象之外的裸字符串联合（如 `NodeVia` 外挂 `\| 'power'`） | 收编进值对象（`VIA.POWER`） |
| 4 | **重复映射表** | 同一概念的 label/class 映射在多个组件各写一份 | 合并进 `utils/format.ts`（范例：`RESOURCE_CATEGORY_STYLE`） |
| 5 | **命名空间混用** | 用 UI 标识常量顶替引擎策略参数 | 各按权威表取用，不得互换 |
| 6 | **魔法值** | 标签前缀（`'m'+(i+1)`、`'r'+n`）、localStorage 键等散落字面量 | 抽为常量，按权威表归档 |
| 7 | **越界改类型** | 顺手把类型注解里的字符串联合也"统一"掉 | 类型注解保持不动 —— 那是类型不是值 |
| 8 | **事件越界** | 用 `window` / `document` 全局监听 + `e.target` 类型守卫，去凑出"只在某区域内生效" | 监听器直接挂在**该区域容器本身**（如 `@keydown`），由 DOM 作用域天然隔离；容器需要可聚焦时加 `tabindex="-1"` |

**事件与副作用的作用域判据**：作用域由**挂载位置**决定，不得靠运行时条件判断去"补救"作用域。

**已发生的历史案例（可回看 commit 对照）**：
- `3a4b906` P0 —— 业务字面量未收敛为常量引用
- `15e7b35` P1 —— 物资分类标签 4 份文案 + 3 份样式映射重复
- `c10f15e` P3 —— 策略常量两份定义 + 值不一致、3 处死代码、`'power'` 逃逸
- `关卡列表键盘导航` —— 首版把 `keydown` 挂在 `window` 上、用 `INPUT/TEXTAREA/SELECT` 守卫兜底：该守卫假设"焦点一定在输入类控件上"，而目标录入区实例下拉的 ↑↓ 焦点并不总落在 `<input>`，于是那些按键被全局监听抢走、顺手切了关卡。改为 `@keydown` 挂到列表容器后，越界在结构上不再可能

---

## 5. 改动纪律

1. **行为等价重构**：只做搬运 / 收敛 / 替换，不改业务逻辑与计算结果；文件里的注释随代码一起搬运。
2. **重构后必须全绿**：`npm run test` + `npm run build`（`vue-tsc --noEmit && vite build`）都通过才算完成。
3. **功能变更不得夹带重构**：不顺手清理无关代码；不为假想的未来需求提前加抽象（三行相似代码优于过早抽象）。
4. **不许动 `src/data/tv2.json`**：dev server 运行期间浏览器侧持续回写该文件；非用户明确要求不提交它。
5. **提交前自检**：死代码残留、裸字面量残留、权威表之外新增的定义，三项都要 grep 复核过。
6. **不主动 commit**：用户明确说提交才提交。
7. **提交必须双推（强制）**：每次 commit 后必须同时推送到 **Gitee（国内主仓）** 与 **GitHub（镜像/部署源）**，缺一不可。
   - `origin` 已配置双 pushurl，直接 `git push origin <branch>` 即同时推送两个远端
   - 也可单独补推：`git push github <branch>`
   - 推送后必须核对两边 HEAD 一致：`git ls-remote origin <branch>` 与 `git ls-remote github <branch>` 应返回同一 commit
   - 理由：Gitee 面向国内访问与备份，GitHub 供 WorkBuddy / Vercel 等平台拉取部署，落一边都会导致线上版本落后

---

## 6. 交付前固定自检

```bash
npm run test     # 基线：5 个测试文件 / 100 例全绿
npm run build    # vue-tsc 类型检查 + vite 构建，构建失败不得交付
```

改动涉及 `domain/` 或 `engine/` 的纯逻辑时，**应同步补/改对应 `*.test.ts`**（`domain/`、`engine/`、`composables/` 三层已有回归网）。

提交后固定双推并核对：

```bash
git push origin main                          # 同时推 Gitee + GitHub
git ls-remote origin main                     # 与下一行返回值必须相同
git ls-remote github main
```
