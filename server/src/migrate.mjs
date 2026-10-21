/** 手动执行建表（server 启动时也会自动建，此脚本用于独立初始化/检查） */
import { config } from './config.mjs';
import { createDb } from './db/index.mjs';

const db = createDb(config);
console.log(`[migrate] ✅ 数据库已就绪：${config.dbPath}`);
db.close();
