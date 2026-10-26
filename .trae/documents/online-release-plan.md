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
| **Phase 1** | 真后端 Fastify + SQLite（部署时可选 Postgres）+ JWT/RefreshToken 轮转 | 前后端联调通过 |
| **Phase 2** | 部署到**国内轻量服务器**（Nginx + systemd）、ICP 备案、商业验证码、导流 | 可对外访问 |
| **Phase 3** | 迭代：建议审批落地、通关记录、数据上云、多管理员 | 按需 |

---

## 3. 验证码方案（重点：两阶段可切换设计）

### 3.1 为什么分两阶段

- **Phase 0 不需要真实验证码能力**：Mock 阶段没有真实注册风险，只需挡住脚本级暴力提交、验证前后端契约完整即可。
- **正式上线必须有真实反 bot 能力**：自研 canvas 图形码只能防脚本，防不了 OCR / 打码平台，**上线前必须切到商业验证码**。
- **部署改为国内服务器后，Cloudflare Turnstile 不再适用**：`challenges.cloudflare.com` 在国内加载不稳定（经常超时），玩家会卡在验证环节。改用**腾讯云验证码**（若服务器选腾讯云，同生态、有免费额度）或**极验 GeeTest**（不绑定云厂商）。

### 3.2 统一契约（前端 ⇄ 后端）

无论哪种 provider，登录 / 注册请求体里的验证码字段统一为：

```ts
// 前端提交形态（字段名固定，provider 只决定填哪些字段）
interface CaptchaPayload {
  provider: 'simple' | 'tencent' | 'geetest' // 当前生效的验证码类型
  challengeId?: string               // simple 专用：服务端下发的挑战 id
  answer?: string                    // simple 专用：用户输入的 6 位字符
  token?: string                     // tencent / geetest 专用：前端 SDK 回调拿到的票据
}
```

后端只暴露一个内部函数，按 `provider` 分发，路由层不感知具体实现：

```ts
// 后端：统一校验入口（所有需要验证码的接口都调它）
async function verifyCaptcha(payload: CaptchaPayload, ip: string): Promise<boolean>
//   provider === 'simple'  → 查 challenge 存储（单次有效 + 过期 + 失败次数限制）
//   provider === 'tencent' → 调腾讯云验证码票据校验接口（CaptchaAppId + AppSecretKey）
//   provider === 'geetest' → 调极验二次校验接口（captchaId + privateKey）
```

### 3.3 前端抽象层

新增**唯一**验证码组件 `src/components/CaptchaBox.vue`，内部按环境变量分支，对外 props/emit 不变：

```vue
<!-- 对外契约固定：父组件只关心 v-model 绑定的 CaptchaPayload -->
<CaptchaBox v-model="captcha" />
```

- `provider === 'simple'`：canvas 绘制 6 位字符 + 干扰线，点击刷新，本地不上报明文；提交时带上 `challengeId + answer`
- `provider === 'tencent'`：动态加载腾讯云验证码 SDK，回调写入 `token`（票据）
- `provider === 'geetest'`：动态加载极验 SDK，回调写入 `token`
- provider 来源：`import.meta.env.VITE_CAPTCHA_PROVIDER`，**不在业务组件里出现任何 provider 判断**

### 3.4 环境变量

| 变量 | 阶段 | 说明 |
|---|---|---|
| `VITE_CAPTCHA_PROVIDER` | Phase 0/1 | 前端：`simple` \| `tencent` \| `geetest` |
| `CAPTCHA_PROVIDER` | Phase 0/1 | 后端：`simple` \| `tencent` \| `geetest` |
| `CAPTCHA_CHALLENGE_TTL` | Phase 0 | simple 挑战有效期（秒，默认 120） |
| `VITE_TENCENT_CAPTCHA_APP_ID` / `TENCENT_CAPTCHA_APP_SECRET` | 上线前 | 腾讯云验证码：前端 AppId + 服务端密钥 |
| `VITE_GEETEST_CAPTCHA_ID` / `GEETEST_PRIVATE_KEY` | 上线前 | 极验：前端 CaptchaId + 服务端私钥 |
| `ADMIN_EMAIL` | Phase 1 | 该邮箱注册后自动获得 admin 角色 |
| `JWT_SECRET` | Phase 1 | AccessToken 签名密钥 |
| `DATABASE_URL` | 切 Postgres 时 | 数据库连接串（当前 SQLite 不需要） |

> `.env` 不进仓库；仓库只留 `.env.example`，且**只写变量名与占位符**，禁止出现可直接复用的弱默认口令。

### 3.5 切换清单（Phase 0 → Phase 1）

切换验证码只需动 **3 处**，业务页面零改动：

1. **环境变量**：`VITE_CAPTCHA_PROVIDER=simple → tencent`（或 `geetest`），`CAPTCHA_PROVIDER` 同步，补对应密钥
2. **前端**：`CaptchaBox.vue` 启用商业验证码分支（SDK 加载 + 回调写入 token）
3. **后端**：`verifyCaptcha` 增加对应票据校验分支，simple 分支保留但仅限非生产环境

回归验证：注册 + 登录各走一遍；伪造 / 重复使用的票据应被拒绝；国内网络下 SDK 能正常加载。

### 3.6 Phase 0 自研码的安全边界（必须写死）

- 只允许用于 **Mock / 本地 / 内部预览**，不得作为正式上线方案
- 挑战 id 单次有效、有 TTL、有失败次数上限，避免被无限重试
- 上线前必须确认 `CAPTCHA_PROVIDER=tencent`（或 `geetest`），否则视为未达上线标准

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

## 8. 部署（国内单机方案）

面向 B站 / 小黑盒的中文玩家，选择国内服务器，前后端同机部署。

| 部分 | 方案 | 备注 |
|---|---|---|
| 服务器 | 国内轻量应用服务器 2C2G（腾讯云 / 阿里云，约 ¥50-80/月） | 系统建议 Ubuntu 22.04 LTS |
| 前端 | Nginx 托管 `dist/` 静态文件 | 构建产物，无需 Node 运行 |
| 后端 | Fastify 由 systemd 守护，仅监听 `127.0.0.1:3001` | 不直接暴露公网端口 |
| 反向代理 | Nginx `/api` → `127.0.0.1:3001`；其余走 `index.html` | 同源，无跨域问题，Cookie 直接生效 |
| HTTPS | 备案通过后 certbot 申请 Let's Encrypt 证书 | 国内服务器 80/443 需域名已备案 |
| 数据库 | 初期继续 SQLite（WAL，单机足够）；需要多进程/多实例时再切 Postgres | SQLite 备份 = 定时复制 `server/data/` |
| 备案 | **关键路径**：域名实名 + ICP 备案（约 7-20 天） | 备案期间可先用 `http://IP:端口` 内测 |

### 上线步骤（备案通过后）

1. 服务器装 Node 24、Nginx、git，拉取仓库
2. `npm ci && npm run build`（前端）；`cd server && npm ci`（后端）
3. 配置 `/etc/tv2/server.env`（`JWT_SECRET`、`ADMIN_EMAIL`、`CORS_ORIGIN`、`COOKIE_SECURE=true`）
4. systemd 启动后端，Nginx 配置静态 + `/api` 反代
5. certbot 签证书，开启 HTTP→HTTPS 跳转
6. 验证：注册 / 登录 / RefreshToken 轮转 / 评论 / 审批 / 移动端访问
7. 数据备份：cron 每日复制 `server/data/tv2.sqlite*` 到备份目录，保留 30 份

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

---

## 11. 零成本先上线（纯攻略模式）

### 11.1 现实约束（先说清楚）

- **没有「免费 + 国内稳定 + 免备案」三者兼得**的方案：
  - Vercel / Cloudflare Pages 免费，但国内部分运营商网络不可达（Vercel 社区已记录中国移动 AS9808 无法路由的案例）
  - 腾讯云 CloudBase 默认域名仅限调试（10KB/s 限速、有效期限制），生产要绑已备案域名
- 因此本阶段定位为**临时导流**：先让能打开网络的玩家查攻略，不等备案、不花钱。

### 11.2 纯攻略模式

构建开关：`VITE_ENABLE_USER_FEATURES=false`

```bash
# PowerShell
$env:VITE_ENABLE_USER_FEATURES="false"; npm run build; Remove-Item Env:VITE_ENABLE_USER_FEATURES
```

开启后：
- 隐藏登录 / 注册 / 退出 / 物资实例管理 / 建议审批
- 隐藏关卡页与图鉴页的讨论、点赞、修改建议面板
- 直接访问 `#/login`、`#/register`、`#/instances` 会被重定向回首页
- 启动时不再请求 `/api/auth/refresh`，控制台无 401 噪音
- 页头显示构建时间，便于确认线上版本

### 11.3 发布链路（0 元）

```
本地/Gitee 主仓 → 镜像到 GitHub → Vercel Git 集成 → 自动构建 dist/ → vercel.app
```

1. 推送仓库到 Gitee（主仓）
2. Gitee 仓库设置 → 镜像管理 → 添加 GitHub 镜像（需 GitHub Token），push 自动同步
3. Vercel 用 GitHub 登录 → Import 仓库
4. Framework 选 Vite，Build Command `npm run build`，Output `dist`
5. 环境变量（Production）：`VITE_ENABLE_USER_FEATURES=false`
6. Deploy 后得到 `https://<project>.vercel.app`

> 若不想接 Gitee 镜像：本地 `npm run build` 后把 `dist/` 拖到 Vercel 网页端，同样 0 元，只是每次手动。

### 11.4 数据更新流程（纯静态）

| 场景 | 操作 |
|---|---|
| 本地改数据（推荐） | `npm run dev` → 编辑 → 自动写回 `src/data/tv2.json` → commit → push → Vercel 自动部署 |
| 线上临时改 | 线上编辑只写浏览器 localStorage → 导出 JSON → 覆盖本地 `src/data/tv2.json` → commit → push |
| 飞书批量同步 | 跑 `scripts/` 脚本写 `tv2.json` → commit → push |

每次 dev 保存会在 `src/data/backups/` 留 30 份时间戳备份。

### 11.5 升级到完整模式

拿到任意 Linux 机器（Oracle 永久免费实例 / 国内轻量 / 香港轻量）后：
1. 部署后端与 Nginx（见 §8）
2. 构建时去掉 `VITE_ENABLE_USER_FEATURES=false`（或设为 `true`）
3. 前后端同域，登录 / 评论 / 建议 / 审批全部自动恢复，前端代码无需修改

---

## 12. 赞赏码（自愿赞赏）

- **定位**：非官方粉丝攻略站，纯自愿赞赏，不设任何对价（不影响功能、不解锁内容、无会员 / 去广告）
- **措辞**：使用「请奶爸喝瓶快乐水」等生活化表达，**禁用**「捐款 / 募捐 / 众筹 / 公益」字样（个人无公开募捐资格）
- **入口**：全局页脚「🥤 请奶爸喝快乐水」→ 弹窗展示赞赏码；页脚常驻版权免责声明
- **资产**：`src/assets/donate-qr.png`，随构建生成带 hash 的文件名，不依赖第三方图床（防替换）
- **边界**：不接第三方商业广告 / 推广返佣，不售卖游戏素材，不提供游戏本体下载
- **平台**：使用 WorkBuddy 默认域名托管，无需自行备案；需留意其服务条款是否允许收款二维码
