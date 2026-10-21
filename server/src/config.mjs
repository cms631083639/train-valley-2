/**
 * 服务端配置：优先读 server/.env，其次读项目根 .env.local（Vite 用的那份）。
 * 已存在的环境变量不会被覆盖（便于命令行临时覆盖）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(file) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* 文件不存在或 Node 版本不支持则忽略 */
  }
}

// 根目录 .env.local 先加载，server/.env 后加载（同名变量以进程已有值为准）
loadEnvFile(path.resolve(here, '../../.env.local'));
loadEnvFile(path.resolve(here, '../.env'));

const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.JWT_SECRET) {
  throw new Error('生产环境必须提供 JWT_SECRET');
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 3001),
  dbDriver: process.env.DB_DRIVER || 'sqlite',
  dbPath: path.resolve(here, '..', process.env.DB_FILE || 'data/tv2.sqlite'),
  adminEmail: String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  jwtSecret: process.env.JWT_SECRET || 'tv2-dev-secret-change-me',
  accessTtlSec: Number(process.env.ACCESS_TTL_SEC || 60 * 60),
  refreshTtlSec: Number(process.env.REFRESH_TTL_SEC || 7 * 24 * 60 * 60),
  cookieName: process.env.REFRESH_COOKIE_NAME || 'tv2_refresh',
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  captchaProvider: process.env.CAPTCHA_PROVIDER || 'simple',
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY || '',
  captchaTtlSec: Number(process.env.CAPTCHA_TTL_SEC || 120),
  captchaMaxAttempts: Number(process.env.CAPTCHA_MAX_ATTEMPTS || 5),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};
