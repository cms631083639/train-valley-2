/**
 * 用户内容路由：评论 / 点赞 / 修改建议（均需登录）。
 */
import crypto from 'node:crypto';
import { currentUser } from '../auth.mjs';

/** 登录守卫：返回 user 或直接回 401 */
function requireUser(request, reply, db, config) {
  const user = currentUser(request, db, config);
  if (!user) {
    reply.code(401).send({ ok: false, msg: '请先登录' });
    return null;
  }
  return user;
}

export async function contentRoutes(app, { db, config }) {
  // ————————— 评论 —————————
  app.get('/comments', async (request) => {
    const targetType = String(request.query.targetType || '');
    const targetId = String(request.query.targetId || '');
    const me = currentUser(request, db, config);
    const comments = db.listComments(targetType, targetId).map((c) => {
      const u = db.findUserById(c.userId);
      return {
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        author: u ? u.nickname : '已注销用户',
        mine: !!me && me.id === c.userId,
      };
    });
    return { ok: true, comments };
  });

  app.post('/comments', async (request, reply) => {
    const user = requireUser(request, reply, db, config);
    if (!user) return;
    const body = request.body || {};
    const content = String(body.content || '').trim();
    if (!content) return reply.code(400).send({ ok: false, msg: '评论内容不能为空' });
    if (content.length > 1000) return reply.code(400).send({ ok: false, msg: '评论最多 1000 字' });

    const id = crypto.randomUUID();
    db.createComment({
      id,
      userId: user.id,
      targetType: String(body.targetType || ''),
      targetId: String(body.targetId || ''),
      content,
      createdAt: Date.now(),
    });
    return { ok: true, id };
  });

  app.delete('/comments/:id', async (request, reply) => {
    const user = requireUser(request, reply, db, config);
    if (!user) return;
    const target = db.findComment(String(request.params.id || ''));
    if (!target) return reply.code(404).send({ ok: false, msg: '评论不存在' });
    if (target.userId !== user.id && user.role !== 'admin') {
      return reply.code(403).send({ ok: false, msg: '只能删除自己的评论' });
    }
    db.deleteComment(target.id);
    return { ok: true };
  });

  // ————————— 点赞（幂等切换）—————————
  app.post('/likes', async (request, reply) => {
    const user = requireUser(request, reply, db, config);
    if (!user) return;
    const body = request.body || {};
    const targetType = String(body.targetType || '');
    const targetId = String(body.targetId || '');

    const liked = !db.hasLike(user.id, targetType, targetId);
    if (liked) db.addLike(user.id, targetType, targetId, Date.now());
    else db.removeLike(user.id, targetType, targetId);

    return { ok: true, liked, count: db.countLikes(targetType, targetId) };
  });

  app.get('/likes', async (request) => {
    const targetType = String(request.query.targetType || '');
    const targetId = String(request.query.targetId || '');
    const me = currentUser(request, db, config);
    return {
      ok: true,
      count: db.countLikes(targetType, targetId),
      liked: !!me && db.hasLike(me.id, targetType, targetId),
    };
  });

  // ————————— 修改建议 —————————
  app.post('/suggestions', async (request, reply) => {
    const user = requireUser(request, reply, db, config);
    if (!user) return;
    const body = request.body || {};
    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    if (!title) return reply.code(400).send({ ok: false, msg: '标题不能为空' });
    if (!content) return reply.code(400).send({ ok: false, msg: '建议内容不能为空' });

    const id = crypto.randomUUID();
    db.createSuggestion({
      id,
      userId: user.id,
      category: String(body.category || 'level'),
      targetId: String(body.targetId || ''),
      title,
      content,
      createdAt: Date.now(),
    });
    return { ok: true, id };
  });

  app.get('/suggestions/me', async (request, reply) => {
    const user = requireUser(request, reply, db, config);
    if (!user) return;
    return { ok: true, suggestions: db.suggestionsByUser(user.id) };
  });
}
