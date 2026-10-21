/**
 * 鉴权原语：口令哈希、AccessToken（HS256 JWT）、RefreshToken 会话。
 *
 * 与 scripts/mock-api.mjs 的算法保持一致，便于前端在 Mock / 真后端之间无感切换。
 * 路由层只调用这里的函数，不直接碰 crypto / bcrypt。
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

/** 公开用户字段（任何时候都不下发口令哈希） */
export function publicUser(u) {
  return u && { id: u.id, email: u.email, nickname: u.nickname, role: u.role };
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64url(input) {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

export function signAccessToken(user, config) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ sub: user.id, role: user.role, iat: now, exp: now + config.accessTtlSec }),
  );
  const sig = base64url(crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

export function verifyAccessToken(token, config) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expect = base64url(crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${payload}`).digest());
  if (sig !== expect) return null;
  try {
    const data = JSON.parse(fromBase64url(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function cookieAttrs(config, maxAge) {
  return [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
    config.cookieSecure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function setRefreshCookie(reply, token, config) {
  reply.header('Set-Cookie', `${config.cookieName}=${token}; ${cookieAttrs(config, config.refreshTtlSec)}`);
}

export function clearRefreshCookie(reply, config) {
  reply.header('Set-Cookie', `${config.cookieName}=; ${cookieAttrs(config, 0)}`);
}

/**
 * 签发一对 Token。exclusive=true 时清掉该用户其它会话（单设备登录）。
 * @returns {string} accessToken
 */
export function issueSession(db, user, request, reply, config, { exclusive = true } = {}) {
  if (exclusive) db.deleteSessionsByUser(user.id);
  const refreshToken = crypto.randomBytes(32).toString('hex');
  db.createSession({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: sha256(refreshToken),
    deviceInfo: String(request.headers['user-agent'] || '').slice(0, 120),
    createdAt: Date.now(),
    expiresAt: Date.now() + config.refreshTtlSec * 1000,
  });
  setRefreshCookie(reply, refreshToken, config);
  return signAccessToken(user, config);
}

/** 从 Authorization: Bearer 解析当前用户（不自动续期，续期只走 /api/auth/refresh） */
export function currentUser(request, db, config) {
  const auth = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = verifyAccessToken(token, config);
  if (!claims) return null;
  return db.findUserById(claims.sub);
}

/** 读取 RefreshToken Cookie */
export function refreshTokenOf(request, config) {
  const raw = request.cookies?.[config.cookieName];
  return typeof raw === 'string' ? raw : '';
}
