/**
 * SQLite 数据适配层（Phase 1 本地开发用）
 *
 * 设计约束：**所有 SQL 只允许出现在本目录**。
 * 路由层只调用下面这些语义化方法，切换到 Postgres 时新增 db/postgres.mjs
 * 实现同一组方法即可，路由与业务逻辑零改动。
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const mapUser = (r) =>
  r && {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    nickname: r.nickname,
    role: r.role,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };

const mapSession = (r) =>
  r && {
    id: r.id,
    userId: r.user_id,
    tokenHash: r.token_hash,
    deviceInfo: r.device_info,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };

const mapComment = (r) =>
  r && {
    id: r.id,
    userId: r.user_id,
    targetType: r.target_type,
    targetId: r.target_id,
    content: r.content,
    createdAt: r.created_at,
  };

const mapSuggestion = (r) =>
  r && {
    id: r.id,
    userId: r.user_id,
    category: r.category,
    targetId: r.target_id,
    title: r.title,
    content: r.content,
    status: r.status,
    reviewNote: r.review_note,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
  };

/**
 * 打开（并在需要时创建）SQLite 数据库。
 * @param {string} filePath
 */
export function createSqliteDb(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf-8');
  sqlite.exec(schema);

  // ————————— 预编译语句 —————————
  const stmt = {
    userByEmail: sqlite.prepare('SELECT * FROM users WHERE email = ?'),
    userById: sqlite.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: sqlite.prepare(
      `INSERT INTO users (id, email, password_hash, nickname, role, created_at, last_login_at)
       VALUES (@id, @email, @passwordHash, @nickname, @role, @createdAt, NULL)`,
    ),
    touchLogin: sqlite.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    listUsers: sqlite.prepare('SELECT * FROM users ORDER BY created_at ASC'),

    insertSession: sqlite.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, device_info, created_at, expires_at)
       VALUES (@id, @userId, @tokenHash, @deviceInfo, @createdAt, @expiresAt)`,
    ),
    sessionByHash: sqlite.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    deleteSession: sqlite.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteSessionsByUser: sqlite.prepare('DELETE FROM sessions WHERE user_id = ?'),
    deleteSessionByHash: sqlite.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: sqlite.prepare('DELETE FROM sessions WHERE expires_at < ?'),

    insertComment: sqlite.prepare(
      `INSERT INTO comments (id, user_id, target_type, target_id, content, created_at)
       VALUES (@id, @userId, @targetType, @targetId, @content, @createdAt)`,
    ),
    listComments: sqlite.prepare(
      'SELECT * FROM comments WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC',
    ),
    commentById: sqlite.prepare('SELECT * FROM comments WHERE id = ?'),
    deleteComment: sqlite.prepare('DELETE FROM comments WHERE id = ?'),

    likeOne: sqlite.prepare('SELECT 1 FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?'),
    insertLike: sqlite.prepare(
      'INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    deleteLike: sqlite.prepare('DELETE FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?'),
    countLikes: sqlite.prepare('SELECT COUNT(*) AS c FROM likes WHERE target_type = ? AND target_id = ?'),

    insertSuggestion: sqlite.prepare(
      `INSERT INTO suggestions (id, user_id, category, target_id, title, content, status, review_note, created_at, reviewed_at)
       VALUES (@id, @userId, @category, @targetId, @title, @content, 'pending', '', @createdAt, NULL)`,
    ),
    suggestionsByUser: sqlite.prepare('SELECT * FROM suggestions WHERE user_id = ? ORDER BY created_at DESC'),
    suggestionsByStatus: sqlite.prepare('SELECT * FROM suggestions WHERE status = ? ORDER BY created_at DESC'),
    suggestionsAll: sqlite.prepare('SELECT * FROM suggestions ORDER BY created_at DESC'),
    suggestionById: sqlite.prepare('SELECT * FROM suggestions WHERE id = ?'),
    reviewSuggestion: sqlite.prepare(
      'UPDATE suggestions SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?',
    ),

    insertChallenge: sqlite.prepare(
      'INSERT INTO challenges (id, code, expires_at, attempts) VALUES (?, ?, ?, 0)',
    ),
    challengeById: sqlite.prepare('SELECT * FROM challenges WHERE id = ?'),
    incChallengeAttempts: sqlite.prepare('UPDATE challenges SET attempts = attempts + 1 WHERE id = ?'),
    deleteChallenge: sqlite.prepare('DELETE FROM challenges WHERE id = ?'),
  };

  return {
    // ————————— 用户 —————————
    createUser(u) {
      stmt.insertUser.run(u);
      return this.findUserById(u.id);
    },
    findUserByEmail(email) {
      return mapUser(stmt.userByEmail.get(email));
    },
    findUserById(id) {
      return mapUser(stmt.userById.get(id));
    },
    touchLogin(id, ts) {
      stmt.touchLogin.run(ts, id);
    },
    listUsers() {
      return stmt.listUsers.all().map(mapUser);
    },

    // ————————— 会话 —————————
    createSession(s) {
      stmt.insertSession.run(s);
    },
    findSessionByHash(hash) {
      return mapSession(stmt.sessionByHash.get(hash));
    },
    deleteSession(id) {
      stmt.deleteSession.run(id);
    },
    deleteSessionsByUser(userId) {
      stmt.deleteSessionsByUser.run(userId);
    },
    deleteSessionByHash(hash) {
      stmt.deleteSessionByHash.run(hash);
    },
    purgeExpiredSessions(now) {
      stmt.purgeSessions.run(now);
    },

    // ————————— 评论 —————————
    createComment(c) {
      stmt.insertComment.run(c);
    },
    listComments(targetType, targetId) {
      return stmt.listComments.all(targetType, targetId).map(mapComment);
    },
    findComment(id) {
      return mapComment(stmt.commentById.get(id));
    },
    deleteComment(id) {
      stmt.deleteComment.run(id);
    },

    // ————————— 点赞 —————————
    hasLike(userId, targetType, targetId) {
      return !!stmt.likeOne.get(userId, targetType, targetId);
    },
    addLike(userId, targetType, targetId, ts) {
      stmt.insertLike.run(userId, targetType, targetId, ts);
    },
    removeLike(userId, targetType, targetId) {
      stmt.deleteLike.run(userId, targetType, targetId);
    },
    countLikes(targetType, targetId) {
      return stmt.countLikes.get(targetType, targetId).c;
    },

    // ————————— 修改建议 —————————
    createSuggestion(s) {
      stmt.insertSuggestion.run(s);
    },
    suggestionsByUser(userId) {
      return stmt.suggestionsByUser.all(userId).map(mapSuggestion);
    },
    suggestionsByStatus(status) {
      const rows = status ? stmt.suggestionsByStatus.all(status) : stmt.suggestionsAll.all();
      return rows.map(mapSuggestion);
    },
    findSuggestion(id) {
      return mapSuggestion(stmt.suggestionById.get(id));
    },
    reviewSuggestion(id, status, note, ts) {
      stmt.reviewSuggestion.run(status, note, ts, id);
    },

    // ————————— 验证码挑战 —————————
    createChallenge(id, code, expiresAt) {
      stmt.insertChallenge.run(id, code, expiresAt);
    },
    getChallenge(id) {
      return stmt.challengeById.get(id);
    },
    incChallengeAttempts(id) {
      stmt.incChallengeAttempts.run(id);
    },
    deleteChallenge(id) {
      stmt.deleteChallenge.run(id);
    },

    close() {
      sqlite.close();
    },
  };
}
