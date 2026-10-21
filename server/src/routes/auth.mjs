/**
 * 鉴权路由：注册 / 登录 / 刷新 / 登出 / 当前用户 / 验证码挑战。
 * 响应体与 scripts/mock-api.mjs 完全一致，前端无需改动。
 */
import crypto from 'node:crypto';
import {
  hashPassword,
  verifyPassword,
  sha256,
  publicUser,
  issueSession,
  currentUser,
  refreshTokenOf,
  clearRefreshCookie,
} from '../auth.mjs';
import { createChallenge, verifyCaptcha } from '../captcha.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function authRoutes(app, { db, config }) {
  // ————————— 验证码挑战（simple provider 专用）—————————
  app.get('/captcha/challenge', async (request, reply) => {
    if (config.captchaProvider === 'turnstile') {
      return reply.code(400).send({ ok: false, msg: '当前使用 Turnstile，无需挑战接口' });
    }
    return createChallenge(db, config);
  });

  // ————————— 注册 —————————
  app.post('/auth/register', async (request, reply) => {
    const body = request.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const nickname = String(body.nickname || '').trim() || email.split('@')[0];

    if (!EMAIL_RE.test(email)) return reply.code(400).send({ ok: false, msg: '邮箱格式不正确' });
    if (password.length < 8) return reply.code(400).send({ ok: false, msg: '密码至少 8 位' });
    if (db.findUserByEmail(email)) return reply.code(409).send({ ok: false, msg: '该邮箱已注册' });

    const cap = await verifyCaptcha(db, body.captcha, config);
    if (!cap.ok) return reply.code(400).send({ ok: false, msg: cap.msg });

    const user = db.createUser({
      id: crypto.randomUUID(),
      email,
      passwordHash: hashPassword(password),
      nickname,
      role: config.adminEmail && email === config.adminEmail ? 'admin' : 'user',
      createdAt: Date.now(),
    });
    const accessToken = issueSession(db, user, request, reply, config);
    return { ok: true, user: publicUser(user), accessToken };
  });

  // ————————— 登录 —————————
  app.post('/auth/login', async (request, reply) => {
    const body = request.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.findUserByEmail(email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ ok: false, msg: '邮箱或密码不正确' });
    }
    const cap = await verifyCaptcha(db, body.captcha, config);
    if (!cap.ok) return reply.code(400).send({ ok: false, msg: cap.msg });

    db.touchLogin(user.id, Date.now());
    const accessToken = issueSession(db, user, request, reply, config);
    return { ok: true, user: publicUser(user), accessToken };
  });

  // ————————— 刷新（轮转：旧 RefreshToken 立即失效）—————————
  app.post('/auth/refresh', async (request, reply) => {
    const token = refreshTokenOf(request, config);
    if (!token) return reply.code(401).send({ ok: false, msg: '未登录' });

    const hash = sha256(token);
    const session = db.findSessionByHash(hash);
    if (!session || session.expiresAt < Date.now()) {
      // 旧 token 二次使用 → 视为可能被盗，清掉该用户全部会话
      if (session) db.deleteSessionsByUser(session.userId);
      clearRefreshCookie(reply, config);
      return reply.code(401).send({ ok: false, msg: '登录已失效，请重新登录' });
    }

    db.deleteSession(session.id);
    const user = db.findUserById(session.userId);
    if (!user) return reply.code(401).send({ ok: false, msg: '用户不存在' });

    const accessToken = issueSession(db, user, request, reply, config);
    return { ok: true, user: publicUser(user), accessToken };
  });

  // ————————— 登出 —————————
  app.post('/auth/logout', async (request, reply) => {
    const token = refreshTokenOf(request, config);
    if (token) db.deleteSessionByHash(sha256(token));
    clearRefreshCookie(reply, config);
    return { ok: true };
  });

  // ————————— 当前用户 —————————
  app.get('/auth/me', async (request, reply) => {
    const user = currentUser(request, db, config);
    if (!user) return reply.code(401).send({ ok: false, msg: '未登录' });
    return { ok: true, user: publicUser(user) };
  });
}
