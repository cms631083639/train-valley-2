# Train Valley 2 攻略站上线方案

> 状态：已确认，待执行 Phase 0
> 回滚点：git tag `standalone-v1`（commit `da1141b`，单机版完整状态）
> 本文档是上线改造的权威开发方案，后续任何实现以本文档为准；改动需同步更新本文档。

---

## 1. 已确认决策（基线）

| 项 | 决策 |
|---|---|
| 目标用户 | Train Valley 2 中文玩家（B站攻略视频 / 小黑盒社区导流） |
| 公开内容 | 关卡速查、物资拆解（含初始配置 / 最终需求 / 目标录入）、生产链依赖图、列车与物资图鉴 |
| 非公开内容 | `InstancesPage`（物资实例管理后台）仅 admin 可见 |
| 用户权限 | 注册用户全部只读；可评论、点赞、提交修改建议（pending 待审）；唯一 admin 为你本人 |
| 数据架构 | 静态 JSON + 后端只存用户态。`tv2.json` 仍由前端消费，后端只存账号 / 评论 / 点赞 / 建议 |
| 后端 | Node + Fastify |
| 数据库 | PostgreSQL（初期 Supabase free tier） |
| 鉴权 | 邮箱 + 密码注册登录（带验证码）；AccessToken 1h；RefreshToken 放 HttpOnly Cookie；轮转；单设备登录 |
| 密码存储 | bcrypt 哈希 |
| admin 初始化 | `ADMIN_EMAIL` 环境变量匹配自动授予 admin 角色 |
| 部署 | 方案 A：Vercel（前端）+ Supabase（数据库）；国内访问不佳时切方案 B（国内轻量服务器） |
| 前端 | 保持 Vue 3 + Vite + Pinia，新增 Vue Router |
| 响应式 | 桌面优先，移动端响应式 |
| 图片 | 暂无，后期可能补矢量图 |

---

## 2. 阶段路线

| 阶段 | 内容 | 产出 |
|---|---|---|
| **Phase 0** | Mock 后端 + Vue Router + Auth Store + 登录注册 + 评论区 + 建议提交 UI | 本地可完整走通全流程 |
| **Phase 1** | 真后端 Fastify + PostgreSQL + 真 JWT/RefreshToken 轮转 + 真验证码 | 前后端联调通过 |
| **Phase 2** | 部署上线（Vercel + Supabase）、admin 初始化、导流 | 可对外访问 |
| **Phase 3** | 迭代：建议审批落地、通关记录、数据上云、多管理员 | 按需 |

---

## 3. 验证码方案（重点：两阶段可切换设计）

### 3.1 为什么分两阶段

- **Phase 0 不需要真实验证码能力**：Mock 阶段没有真实注册风险，只需挡住脚本级暴力提交、验证前后端契约完整即可。
- **正式上线必须有真实反 bot 能力**：自研 canvas 图形码只能防脚本，防不了 OCR / 打码平台，**Phase 1 必须切到 Cloudflare Turnstile**。
- 选 Turnstile 而非 hCaptcha：免费、无感（多数用户看不到验证环节）、本身就是 Cloudflare 反 bot 体系；hCaptcha 为点图挑战，体验差一档，仅作备选。

### 3.2 统一契约（前端 ⇄ 后端）

无论哪种 provider，登录 / 注册请求体里的验证码字段统一为：

```ts
// 前端提交形态（字段名固定，provider 只决定填哪些字段）
interface CaptchaPayload {
  provider: 'simple' | 'turnstile'   // 当前生效的验证码类型
  challengeId?: string               // simple 专用：服务端下发的挑战 id
  answer?: string                    // simple 专用：用户输入的 6 位字符
  token?: string                     // turnstile 专用：widget 回调拿到的 token
}
```

后端只暴露一个内部函数，按 `provider` 分发，路由层不感知具体实现：

```ts
// 后端：统一校验入口（所有需要验证码的接口都调它）
async function verifyCaptcha(payload: CaptchaPayload, ip: string): Promise<boolean>
//   provider === 'simple'    → 查 challenge 存储（单次有效 + 过期 + 失败次数限制）
//   provider === 'turnstile' → POST https://challenges.cloudflare.com/turnstile/v0/siteverify
```

### 3.3 前端抽象层

新增**唯一**验证码组件 `src/components/CaptchaBox.vue`，内部按环境变量分支，对外 props/emit 不变：

```vue
<!-- 对外契约固定：父组件只关心 v-model 绑定的 CaptchaPayload -->
<CaptchaBox v-model="captcha" />
```

- `provider === 'simple'`：canvas 绘制 6 位字符 + 干扰线，点击刷新，本地不上报明文；提交时带上 `challengeId + answer`
- `provider === 'turnstile'`：动态加载 Cloudflare 脚本，渲染隐形/显式 widget，回调写入 `token`
- provider 来源：`import.meta.env.VITE_CAPTCHA_PROVIDER`，**不在业务组件里出现任何 provider 判断**

### 3.4 环境变量

| 变量 | 阶段 | 说明 |
|---|---|---|
| `VITE_CAPTCHA_PROVIDER` | Phase 0/1 | 前端：`simple` \| `turnstile` |
| `CAPTCHA_PROVIDER` | Phase 0/1 | 后端：`simple` \| `turnstile` |
| `CAPTCHA_CHALLENGE_TTL` | Phase 0 | simple 挑战有效期（秒，默认 120） |
| `VITE_TURNSTILE_SITE_KEY` | Phase 1 | Turnstile 站点公钥 |
| `TURNSTILE_SECRET_KEY` | Phase 1 | Turnstile 服务端私钥（**只进服务端 env，禁止进前端 / 仓库**） |
| `ADMIN_EMAIL` | Phase 1 | 该邮箱注册后自动获得 admin 角色 |
| `JWT_SECRET` | Phase 1 | AccessToken 签名密钥 |
| `REFRESH_TOKEN_SECRET` / `DATABASE_URL` | Phase 1 | 会话签名 / 数据库连接 |

> `.env` 不进仓库；仓库只留 `.env.example`，且**只写变量名与占位符**，禁止出现可直接复用的弱默认口令。

### 3.5 切换清单（Phase 0 → Phase 1）

切换验证码只需动 **3 处**，业务页面零改动：

1. **环境变量**：`VITE_CAPTCHA_PROVIDER=simple → turnstile`，`CAPTCHA_PROVIDER=simple → turnstile`，补两个 Turnstile key
2. **前端**：`CaptchaBox.vue` 启用 `turnstile` 分支（Phase 0 就已写好该分支骨架，切时只补脚本加载与回调）
3. **后端**：`verifyCaptcha` 启用 turnstile 分支（调 siteverify），simple 分支保留但置为不可用

回归验证：注册 + 登录各走一遍；关闭 JS / 伪造 token 应被拒绝；同一 token 重复使用应被拒绝。

### 3.6 Phase 0 自研码的安全边界（必须写死）

- 只允许用于 **Mock / 本地 / 内部预览**，不得作为正式上线方案
- 挑战 id 单次有效、有 TTL、有失败次数上限，避免被无限重试
- Phase 2 上线前必须确认 `CAPTCHA_PROVIDER=turnstile`，否则视为未达上线标准

---

## 4. 数据边界

```
前端静态（不打后端）              后端用户态（走 API）
├─ tv2.json：实例 / 关卡 / 列车    ├─ users（账号）
├─ 拆解计算（domain + engine）     ├─ sessions（RefreshToken 轮转）
├─ 关卡速查 / 图鉴 / 生产链图      ├─ comments（评论）
└─ 目标录入（本地编辑态）          ├─ likes（点赞）
                                  └─ suggestions（修改建议，pending）
```

**核心原则**：后端不可用时，攻略内容仍可正常浏览，仅登录 / 评论 / 点赞 / 建议不可用。

---

## 5. 鉴权设计

### 5.1 流程

1. `POST /api/auth/register|login` → 校验验证码 → 生成 `accessToken`（1h，返回 body，前端只放内存/Pinia）+ `refreshToken`（7d，写 HttpOnly + Secure + SameSite Cookie）
2. 业务请求带 `Authorization: Bearer <accessToken>`
3. 401 → axios 拦截器自动 `POST /api/auth/refresh`（自动带 Cookie）→ 拿到新 accessToken → 重放原请求
4. `/refresh` 轮转：校验旧 refreshToken 对应的 session → **立即删除旧 session** → 下发新 accessToken + 新 refreshToken
5. 旧 refreshToken 二次使用（查不到 session）→ 判定可能被盗 → 清 Cookie + 强制重新登录
6. 单设备：登录 / 刷新成功时删除该 `user_id` 所有其它 session

### 5.2 表结构

```sql
users(id uuid pk, email text unique, password_hash text, nickname text,
      role text default 'user', created_at timestamptz, last_login_at timestamptz)

sessions(id uuid pk, user_id uuid fk, refresh_token_hash text, device_info text,
         created_at timestamptz, expires_at timestamptz)

comments(id uuid pk, user_id uuid fk, target_type text, target_id text,
         content text, created_at timestamptz)

likes(user_id uuid fk, target_type text, target_id text, created_at timestamptz,
      primary key(user_id, target_type, target_id))

suggestions(id uuid pk, user_id uuid fk, category text, target_id text,
            title text, content text, status text default 'pending',
            review_note text, created_at timestamptz, reviewed_at timestamptz)
```

---

## 6. 后端 API 路由

```
公开
POST /api/auth/register          { email, password, nickname, captcha }
POST /api/auth/login             { email, password, captcha }
POST /api/auth/refresh           从 Cookie 读 refreshToken（轮转）
POST /api/auth/logout
GET  /api/auth/me
GET  /api/captcha/challenge      仅 simple provider 使用

需登录
GET|POST /api/comments           ?targetType=&targetId=
DELETE   /api/comments/:id       仅本人
POST     /api/likes              幂等切换
POST     /api/suggestions
GET      /api/suggestions/me

仅 admin
GET  /api/admin/suggestions
POST /api/admin/suggestions/:id/review   { status, note? }
GET  /api/admin/users
```

---

## 7. Phase 0 任务清单（前端）

| 任务 | 层级归属 | 说明 |
|---|---|---|
| 引入 Vue Router | L4 入口 | `/`、`/levels/:id`、`/codex`、`/graph`、`/login`、`/register`、`/admin/suggestions` |
| `src/stores/auth.ts` | L3 | 用户态、登录/注册/登出、token 刷新、持久化 |
| `src/utils/http.ts` | L2 | axios 实例 + 401 自动 refresh 拦截器 |
| `src/components/CaptchaBox.vue` | L4 | 双 provider 抽象（见 §3.3） |
| 登录 / 注册页 | L4 | 表单校验、错误提示、验证码 |
| 路由守卫 | L4 | `meta.requiresAuth` / `meta.requiresAdmin` |
| 评论区组件 | L4 | 关卡页 / 图鉴页底部；未登录只读 |
| 建议提交面板 | L4 | 提交后进 pending，提示"待管理员审批" |
| 后台入口隔离 | L4 | `InstancesPage` 仅 admin 可见；非 admin 直接隐藏 tab |
| Mock 后端 | dev-only | Vite middleware 提供与真后端**完全一致**的接口契约，数据存内存/localStorage |

**约束**：`domain/`、`engine/`、`utils/`、`composables/` 的既有业务逻辑一律不动；新增代码严格按 `dev-standards.md` 分层归属。

---

## 8. 部署（方案 A）

| 部分 | 方案 | 备注 |
|---|---|---|
| 前端 | Vercel free tier，`*.vercel.app` | HTTPS 自动、无需备案 |
| 后端 | Fastify 独立服务（后期可改 Vercel Function / 国内轻量） | 环境变量托管在平台侧 |
| 数据库 | 开发用 SQLite（`server/data/tv2.sqlite`，已 gitignore）；部署时切 Postgres | 用户暂无 Supabase，部署阶段可选 Neon 免费实例或国内轻量服务器自建 |
| 风险 | Vercel 无亚洲节点，国内晚间可能超时 | 反馈不佳时切方案 B（国内轻量服务器 + 域名备案） |

---

## 9. 验收标准

- `npm run test` 全绿（当前基线 6 文件 / 114 例）
- `npm run build` 通过（`vue-tsc --noEmit` + vite build）
- 未登录：关卡速查 / 拆解 / 图鉴 / 生产链全部可用，看不到后台入口，评论区只读
- 已登录：可评论、点赞、提交建议；刷新页面登录态保持
- admin：可见 `InstancesPage`，可查看待审建议
- 分层自检两条 grep 为空（见 `dev-standards.md` §1）

---

## 10. Phase 1 实现状态（已完成）

```
server/
├─ package.json          # 独立 Node 包（不污染前端依赖）
└─ src/
   ├─ index.mjs           # Fastify 入口：cookie / cors / 路由挂载 / 健康检查
   ├─ config.mjs          # 读 server/.env 与项目根 .env.local
   ├─ auth.mjs            # bcryptjs 哈希 + HS256 JWT + RefreshToken 会话
   ├─ captcha.mjs         # verifyCaptcha：simple / turnstile 双分支
   ├─ migrate.mjs         # 手动建表（启动时也会自动建）
   ├─ db/
   │  ├─ index.mjs        # 按 DB_DRIVER 选适配层
   │  ├─ sqlite.mjs       # better-sqlite3 适配层（**所有 SQL 只在这里**）
   │  └─ schema.sql       # 5 张业务表 + challenges
   └─ routes/
      ├─ auth.mjs         # 注册/登录/刷新/登出/me/挑战
      ├─ content.mjs      # 评论/点赞/建议
      └─ admin.mjs        # 建议审批/用户列表
```

### 运行方式

```bash
# 终端 1：真后端（默认 3001）
cd server && npm run dev

# 终端 2：前端（Vite 5173，/api 代理到 3001）
npm run dev
```

`.env.local` 开关：`USE_MOCK_API=false` 走真后端；`true` 回到 Phase 0 内置 Mock。
`API_PROXY_TARGET` 指定后端地址；`VITE_API_BASE_URL` 留空表示同源（走 Vite 代理）。

### 切 Postgres 的改动面

只改 `server/src/db/`：新增 `postgres.mjs` 实现与 `sqlite.mjs` 相同的方法集合，
在 `db/index.mjs` 里按 `DB_DRIVER` 分发。路由、鉴权、验证码、前端均零改动。

### 已验证

- 注册（`ADMIN_EMAIL` 自动 admin）/ 登录 / `/me`
- RefreshToken 轮转；旧 token 二次使用 → 401
- 评论 / 点赞 / 建议提交 / 管理员审批 / 用户列表
- 经 Vite 代理（5173）写入的评论可从 SQLite 读回，`npm run build` + 114 例测试全绿
