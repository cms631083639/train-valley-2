/**
 * 管理员路由：建议审批 + 用户列表（role=admin 才能访问）。
 */
import { currentUser, publicUser } from '../auth.mjs';

export async function adminRoutes(app, { db, config }) {
  /** 管理员守卫 */
  function requireAdmin(request, reply) {
    const user = currentUser(request, db, config);
    if (!user) {
      reply.code(401).send({ ok: false, msg: '请先登录' });
      return null;
    }
    if (user.role !== 'admin') {
      reply.code(403).send({ ok: false, msg: '仅管理员可操作' });
      return null;
    }
    return user;
  }

  app.get('/suggestions', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const status = String(request.query.status || '');
    const list = db.suggestionsByStatus(status || null).map((s) => {
      const u = db.findUserById(s.userId);
      return { ...s, author: u ? u.nickname : '已注销用户', authorEmail: u ? u.email : '' };
    });
    return { ok: true, suggestions: list };
  });

  app.post('/suggestions/:id/review', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = request.body || {};
    const status = body.status;
    if (status !== 'approved' && status !== 'rejected') {
      return reply.code(400).send({ ok: false, msg: '审批结果不合法' });
    }
    const item = db.findSuggestion(String(request.params.id || ''));
    if (!item) return reply.code(404).send({ ok: false, msg: '建议不存在' });

    db.reviewSuggestion(item.id, status, String(body.note || ''), Date.now());
    return { ok: true };
  });

  app.get('/admin/users', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return {
      ok: true,
      users: db.listUsers().map((u) => ({
        ...publicUser(u),
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      })),
    };
  });
}
