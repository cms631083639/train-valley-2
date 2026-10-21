/**
 * Phase 0 Mock 后端（仅 dev 使用，随 Vite dev server 启动）
 *
 * 为什么放在 scripts/：
 *   这里是 Node 侧代码，读不了 TS / 不认 `@/` 别名，和 scripts/ 下其它 Node 脚本同属一类；
 *   vite.config.ts 直接 import 本模块挂载中间件。
 *
 * 与真后端（Phase 1 Fastify）保持完全一致的接口契约：
 *   - 统一 CaptchaPayload { provider, challengeId?, answer?, token? }
 *   - AccessToken 1h（Bearer）、RefreshToken 7d（HttpOnly Cookie）、轮转 + 单设备登录
 *   - 路由路径、请求体、响应体一致，前端切真后端时只需改 baseURL
 *
 * 数据落在 .mock/mock-db.json（已 gitignore），dev server 重启后账号/评论仍在。
 * 注意：simple 验证码会把明文 code 返回给前端，仅 Mock 阶段允许，正式上线必须切 Turnstile。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ACCESS_TTL_SEC = 60 * 60; // AccessToken 1 小时
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60; // RefreshToken 7 天
const COOKIE_NAME = 'tv2_refresh';
const CAPTCHA_TTL_SEC = 120;
const CAPTCHA_MAX_ATTEMPTS = 5;

/** 6 位验证码字符集：去掉易混淆的 0/O/1/I */
const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(input) {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** scrypt 口令哈希（真后端 Phase 1 换 bcrypt，接口不需要变） */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

// ————————————————— 数据存储 —————————————————

function createStore(dbPath) {
  /** @type {{users:any[],sessions:any[],comments:any[],likes:any[],suggestions:any[],challenges:Record<string,any>}} */
  let db = { users: [], sessions: [], comments: [], likes: [], suggestions: [], challenges: {} };
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(dbPath, 'utf-8')) };
  } catch {
    /* 首次运行没有数据文件 */
  }
  let timer = null;
  function save() {
    // 合并写：challenges 属于临时数据，不落盘
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const { challenges, ...persist } = db;
        fs.writeFileSync(dbPath, JSON.stringify(persist, null, 2), 'utf-8');
      } catch (e) {
        console.error('[mock] ⚠️ 写入 mock-db 失败:', e.message);
      }
    }, 50);
  }
  return { get db() { return db; }, save };
}

// ————————————————— 工具 —————————————————

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function publicUser(u) {
  return { id: u.id, email: u.email, nickname: u.nickname, role: u.role };
}

// ————————————————— JWT（HS256 手写，Mock 不引第三方依赖）—————————————————

function signAccessToken(user, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ sub: user.id, role: user.role, iat: now, exp: now + ACCESS_TTL_SEC }));
  const sig = base64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

function verifyAccessToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expect = base64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  if (sig !== expect) return null;
  try {
    const data = JSON.parse(fromBase64url(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

// ————————————————— 插件主体 —————————————————

/**
 * @param {{ adminEmail?: string, jwtSecret?: string }} [options]
 */
export function mockApiPlugin(options = {}) {
  const adminEmail = String(options.adminEmail || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const jwtSecret = options.jwtSecret || process.env.JWT_SECRET || 'tv2-mock-dev-secret';

  return {
    name: 'tv2-mock-api',
    configureServer(server) {
      const store = createStore(path.resolve(process.cwd(), '.mock/mock-db.json'));
      const db = store.db;

      /** 取当前登录用户：先看 Bearer，再看 RefreshToken（不自动续期，续期只走 /refresh） */
      function currentUser(req) {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        const claims = verifyAccessToken(token, jwtSecret);
        if (claims) return db.users.find((u) => u.id === claims.sub) || null;
        return null;
      }

      /** 签发一对 Token，并按「单设备登录」清理该用户其它 session */
      function issueSession(user, req, res, { exclusive = true } = {}) {
        if (exclusive) db.sessions = db.sessions.filter((s) => s.userId !== user.id);
        const refreshToken = crypto.randomBytes(32).toString('hex');
        db.sessions.push({
          id: crypto.randomUUID(),
          userId: user.id,
          tokenHash: sha256(refreshToken),
          deviceInfo: String(req.headers['user-agent'] || '').slice(0, 120),
          createdAt: Date.now(),
          expiresAt: Date.now() + REFRESH_TTL_SEC * 1000,
        });
        res.setHeader(
          'Set-Cookie',
          `${COOKIE_NAME}=${refreshToken}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${REFRESH_TTL_SEC}`,
        );
        return signAccessToken(user, jwtSecret);
      }

      /** 统一验证码校验入口：按 provider 分发（真后端同签名） */
      function verifyCaptcha(payload) {
        if (!payload || typeof payload !== 'object') return { ok: false, msg: '缺少验证码' };
        if (payload.provider === 'turnstile') {
          // Mock 阶段未接 Turnstile；切换到 Phase 1 时在此调用 siteverify
          return { ok: false, msg: 'Turnstile 尚未配置（Phase 1 启用）' };
        }
        const rec = db.challenges[payload.challengeId];
        if (!rec) return { ok: false, msg: '验证码已失效，请刷新' };
        if (rec.expiresAt < Date.now()) {
          delete db.challenges[payload.challengeId];
          return { ok: false, msg: '验证码已过期，请刷新' };
        }
        rec.attempts = (rec.attempts || 0) + 1;
        if (rec.attempts > CAPTCHA_MAX_ATTEMPTS) {
          delete db.challenges[payload.challengeId];
          return { ok: false, msg: '尝试次数过多，请刷新验证码' };
        }
        if (String(payload.answer || '').trim().toUpperCase() !== rec.code) {
          return { ok: false, msg: '验证码不正确' };
        }
        delete db.challenges[payload.challengeId]; // 单次有效
        return { ok: true };
      }

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();
        // 交还给已有 save/load-data 中间件处理
        if (url.pathname === '/api/load-data' || url.pathname === '/api/save-data') return next();

        const p = url.pathname;
        const method = req.method || 'GET';

        try {
          // ————————— 验证码挑战 —————————
          if (p === '/api/captcha/challenge' && method === 'GET') {
            let code = '';
            for (let i = 0; i < 6; i++) code += CAPTCHA_ALPHABET[crypto.randomInt(CAPTCHA_ALPHABET.length)];
            const id = crypto.randomUUID();
            db.challenges[id] = { code, expiresAt: Date.now() + CAPTCHA_TTL_SEC * 1000, attempts: 0 };
            return sendJson(res, 200, { id, code, ttl: CAPTCHA_TTL_SEC });
          }

          // ————————— 注册 —————————
          if (p === '/api/auth/register' && method === 'POST') {
            const body = await readBody(req);
            if (!body) return sendJson(res, 400, { ok: false, msg: '请求体不是合法 JSON' });
            const email = String(body.email || '').trim().toLowerCase();
            const password = String(body.password || '');
            const nickname = String(body.nickname || '').trim() || email.split('@')[0];
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { ok: false, msg: '邮箱格式不正确' });
            if (password.length < 8) return sendJson(res, 400, { ok: false, msg: '密码至少 8 位' });
            if (db.users.some((u) => u.email === email)) return sendJson(res, 409, { ok: false, msg: '该邮箱已注册' });
            const cap = verifyCaptcha(body.captcha);
            if (!cap.ok) return sendJson(res, 400, { ok: false, msg: cap.msg });
            const user = {
              id: crypto.randomUUID(),
              email,
              passwordHash: hashPassword(password),
              nickname,
              role: adminEmail && email === adminEmail ? 'admin' : 'user',
              createdAt: Date.now(),
              lastLoginAt: null,
            };
            db.users.push(user);
            store.save();
            const accessToken = issueSession(user, req, res);
            return sendJson(res, 200, { ok: true, user: publicUser(user), accessToken });
          }

          // ————————— 登录 —————————
          if (p === '/api/auth/login' && method === 'POST') {
            const body = await readBody(req);
            if (!body) return sendJson(res, 400, { ok: false, msg: '请求体不是合法 JSON' });
            const email = String(body.email || '').trim().toLowerCase();
            const password = String(body.password || '');
            const user = db.users.find((u) => u.email === email);
            if (!user || !verifyPassword(password, user.passwordHash)) {
              return sendJson(res, 401, { ok: false, msg: '邮箱或密码不正确' });
            }
            const cap = verifyCaptcha(body.captcha);
            if (!cap.ok) return sendJson(res, 400, { ok: false, msg: cap.msg });
            user.lastLoginAt = Date.now();
            const accessToken = issueSession(user, req, res);
            store.save();
            return sendJson(res, 200, { ok: true, user: publicUser(user), accessToken });
          }

          // ————————— 刷新（轮转：旧 RefreshToken 立即失效）—————————
          if (p === '/api/auth/refresh' && method === 'POST') {
            const token = parseCookies(req)[COOKIE_NAME];
            if (!token) return sendJson(res, 401, { ok: false, msg: '未登录' });
            const hash = sha256(token);
            const session = db.sessions.find((s) => s.tokenHash === hash);
            if (!session || session.expiresAt < Date.now()) {
              // 旧 token 二次使用 → 视为可能被盗，清掉该用户全部会话
              if (session) db.sessions = db.sessions.filter((s) => s.userId !== session.userId);
              res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
              store.save();
              return sendJson(res, 401, { ok: false, msg: '登录已失效，请重新登录' });
            }
            db.sessions = db.sessions.filter((s) => s.id !== session.id);
            const user = db.users.find((u) => u.id === session.userId);
            if (!user) return sendJson(res, 401, { ok: false, msg: '用户不存在' });
            const accessToken = issueSession(user, req, res);
            store.save();
            return sendJson(res, 200, { ok: true, user: publicUser(user), accessToken });
          }

          // ————————— 登出 —————————
          if (p === '/api/auth/logout' && method === 'POST') {
            const token = parseCookies(req)[COOKIE_NAME];
            if (token) db.sessions = db.sessions.filter((s) => s.tokenHash !== sha256(token));
            res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
            store.save();
            return sendJson(res, 200, { ok: true });
          }

          // ————————— 当前用户 —————————
          if (p === '/api/auth/me' && method === 'GET') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '未登录' });
            return sendJson(res, 200, { ok: true, user: publicUser(user) });
          }

          // ————————— 评论 —————————
          if (p === '/api/comments' && method === 'GET') {
            const targetType = url.searchParams.get('targetType') || '';
            const targetId = url.searchParams.get('targetId') || '';
            const me = currentUser(req);
            const list = db.comments
              .filter((c) => c.targetType === targetType && c.targetId === targetId)
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((c) => {
                const u = db.users.find((x) => x.id === c.userId);
                return {
                  id: c.id,
                  content: c.content,
                  createdAt: c.createdAt,
                  author: u ? u.nickname : '已注销用户',
                  mine: !!me && me.id === c.userId,
                };
              });
            return sendJson(res, 200, { ok: true, comments: list });
          }
          if (p === '/api/comments' && method === 'POST') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '请先登录' });
            const body = await readBody(req);
            const content = String(body?.content || '').trim();
            if (!content) return sendJson(res, 400, { ok: false, msg: '评论内容不能为空' });
            if (content.length > 1000) return sendJson(res, 400, { ok: false, msg: '评论最多 1000 字' });
            const comment = {
              id: crypto.randomUUID(),
              userId: user.id,
              targetType: String(body.targetType || ''),
              targetId: String(body.targetId || ''),
              content,
              createdAt: Date.now(),
            };
            db.comments.push(comment);
            store.save();
            return sendJson(res, 200, { ok: true, id: comment.id });
          }
          const delComment = p.match(/^\/api\/comments\/([^/]+)$/);
          if (delComment && method === 'DELETE') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '请先登录' });
            const id = decodeURIComponent(delComment[1]);
            const target = db.comments.find((c) => c.id === id);
            if (!target) return sendJson(res, 404, { ok: false, msg: '评论不存在' });
            if (target.userId !== user.id && user.role !== 'admin') return sendJson(res, 403, { ok: false, msg: '只能删除自己的评论' });
            db.comments = db.comments.filter((c) => c.id !== id);
            store.save();
            return sendJson(res, 200, { ok: true });
          }

          // ————————— 点赞（幂等切换）—————————
          if (p === '/api/likes' && method === 'POST') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '请先登录' });
            const body = await readBody(req);
            const key = { userId: user.id, targetType: String(body?.targetType || ''), targetId: String(body?.targetId || '') };
            const idx = db.likes.findIndex((l) => l.userId === key.userId && l.targetType === key.targetType && l.targetId === key.targetId);
            let liked;
            if (idx >= 0) {
              db.likes.splice(idx, 1);
              liked = false;
            } else {
              db.likes.push({ ...key, createdAt: Date.now() });
              liked = true;
            }
            store.save();
            const count = db.likes.filter((l) => l.targetType === key.targetType && l.targetId === key.targetId).length;
            return sendJson(res, 200, { ok: true, liked, count });
          }
          if (p === '/api/likes' && method === 'GET') {
            const user = currentUser(req);
            const targetType = url.searchParams.get('targetType') || '';
            const targetId = url.searchParams.get('targetId') || '';
            const all = db.likes.filter((l) => l.targetType === targetType && l.targetId === targetId);
            return sendJson(res, 200, {
              ok: true,
              count: all.length,
              liked: !!user && all.some((l) => l.userId === user.id),
            });
          }

          // ————————— 修改建议 —————————
          if (p === '/api/suggestions' && method === 'POST') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '请先登录' });
            const body = await readBody(req);
            const title = String(body?.title || '').trim();
            const content = String(body?.content || '').trim();
            if (!title) return sendJson(res, 400, { ok: false, msg: '标题不能为空' });
            if (!content) return sendJson(res, 400, { ok: false, msg: '建议内容不能为空' });
            const item = {
              id: crypto.randomUUID(),
              userId: user.id,
              category: String(body.category || 'level'),
              targetId: String(body.targetId || ''),
              title,
              content,
              status: 'pending',
              reviewNote: '',
              createdAt: Date.now(),
              reviewedAt: null,
            };
            db.suggestions.push(item);
            store.save();
            return sendJson(res, 200, { ok: true, id: item.id });
          }
          if (p === '/api/suggestions/me' && method === 'GET') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '请先登录' });
            const list = db.suggestions
              .filter((s) => s.userId === user.id)
              .sort((a, b) => b.createdAt - a.createdAt);
            return sendJson(res, 200, { ok: true, suggestions: list });
          }
          if (p === '/api/suggestions' && method === 'GET') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '请先登录' });
            if (user.role !== 'admin') return sendJson(res, 403, { ok: false, msg: '仅管理员可查看全部建议' });
            const status = url.searchParams.get('status') || '';
            const list = db.suggestions
              .filter((s) => !status || s.status === status)
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((s) => {
                const u = db.users.find((x) => x.id === s.userId);
                return { ...s, author: u ? u.nickname : '已注销用户', authorEmail: u ? u.email : '' };
              });
            return sendJson(res, 200, { ok: true, suggestions: list });
          }
          const review = p.match(/^\/api\/suggestions\/([^/]+)\/review$/);
          if (review && method === 'POST') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '请先登录' });
            if (user.role !== 'admin') return sendJson(res, 403, { ok: false, msg: '仅管理员可审批' });
            const body = await readBody(req);
            const status = body?.status;
            if (status !== 'approved' && status !== 'rejected') return sendJson(res, 400, { ok: false, msg: '审批结果不合法' });
            const item = db.suggestions.find((s) => s.id === decodeURIComponent(review[1]));
            if (!item) return sendJson(res, 404, { ok: false, msg: '建议不存在' });
            item.status = status;
            item.reviewNote = String(body.note || '');
            item.reviewedAt = Date.now();
            store.save();
            return sendJson(res, 200, { ok: true });
          }

          // ————————— 管理员：用户列表 —————————
          if (p === '/api/admin/users' && method === 'GET') {
            const user = currentUser(req);
            if (!user) return sendJson(res, 401, { ok: false, msg: '请先登录' });
            if (user.role !== 'admin') return sendJson(res, 403, { ok: false, msg: '仅管理员可查看' });
            return sendJson(res, 200, {
              ok: true,
              users: db.users.map((u) => ({ ...publicUser(u), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })),
            });
          }

          return sendJson(res, 404, { ok: false, msg: `Mock 未实现该接口：${method} ${p}` });
        } catch (e) {
          console.error('[mock] ❌ 接口异常:', e);
          return sendJson(res, 500, { ok: false, msg: e.message });
        }
      });
    },
  };
}
