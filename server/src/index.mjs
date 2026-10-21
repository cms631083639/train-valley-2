/**
 * Train Valley 2 攻略站 —— Phase 1 真后端入口
 *
 * 技术栈：Fastify + better-sqlite3（本地开发）/ Postgres（部署时切适配层）
 * 接口契约与 scripts/mock-api.mjs 完全一致，前端只需把 baseURL 指过来。
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { config } from './config.mjs';
import { createDb } from './db/index.mjs';
import { authRoutes } from './routes/auth.mjs';
import { contentRoutes } from './routes/content.mjs';
import { adminRoutes } from './routes/admin.mjs';

const db = createDb(config);

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  trustProxy: config.isProd,
});

await app.register(cookie);
await app.register(cors, {
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
  credentials: true,
});

// 业务路由统一挂在 /api 下
await app.register(authRoutes, { prefix: '/api', db, config });
await app.register(contentRoutes, { prefix: '/api', db, config });
await app.register(adminRoutes, { prefix: '/api', db, config });

app.get('/api/health', async () => ({ ok: true, driver: config.dbDriver, ts: Date.now() }));

// 未命中的 /api 路由统一返回 JSON，避免前端拿到 HTML
app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ ok: false, msg: `接口不存在：${request.method} ${request.url}` });
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  reply.code(error.statusCode || 500).send({ ok: false, msg: error.message || '服务器内部错误' });
});

// 启动时清理过期会话
db.purgeExpiredSessions(Date.now());

const close = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
  app.log.info(
    `[server] 验证码=${config.captchaProvider} · 数据库=${config.dbDriver} · 管理员邮箱=${config.adminEmail || '(未配置)'}`,
  );
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
