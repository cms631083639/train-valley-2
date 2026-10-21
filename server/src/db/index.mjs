/**
 * 数据库入口：按 DB_DRIVER 选择适配层。
 * 切换 Postgres 时只需新增 ./postgres.mjs 并实现与 sqlite.mjs 相同的方法集合。
 */
import { createSqliteDb } from './sqlite.mjs';

export function createDb(config) {
  if (config.dbDriver === 'sqlite') return createSqliteDb(config.dbPath);
  throw new Error(`暂不支持的 DB_DRIVER：${config.dbDriver}`);
}
