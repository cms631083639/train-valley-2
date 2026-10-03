import { defineConfig, type Connect } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, 'src/data/tv2.json');
console.log('[vite] 📁 DATA_FILE:', DATA_FILE);

/** 返回一个 Vite plugin，在 configureServer 阶段注册保存中间件 */
function saveDataPlugin(): any {
  return {
    name: 'save-data-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        // GET /api/load-data —— dev 模式读文件系统最新 tv2.json
        if (req.url?.startsWith('/api/load-data') && req.method === 'GET') {
          try {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(raw);
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, msg: e.message }));
          }
          return;
        }
        if (req.url !== '/api/save-data' || req.method !== 'POST') return next();
        console.log('[api] 📨 收到 /api/save-data 请求');

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = Buffer.concat(chunks).toString('utf-8');
          const parsed = JSON.parse(body);

          if (!parsed.instances || !parsed.levels || !parsed.trains) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, msg: '数据缺少必要字段' }));
            return;
          }

          // 重要：合并实例数据，以文件中的实例为准（防止浏览器旧数据覆盖新增实例）
          let existingInstances: any[] = [];
          try {
            const existingRaw = fs.readFileSync(DATA_FILE, 'utf-8');
            const existing = JSON.parse(existingRaw);
            existingInstances = existing.instances || [];
          } catch {}
          if (existingInstances.length > 0) {
            // 只保留 saved 中不在文件里的新实例（如 user 新增的）
            const existingIds = new Set(existingInstances.map((i: any) => i.id));
            const newInstances = parsed.instances.filter((i: any) => !existingIds.has(i.id));
            parsed.instances = [...existingInstances, ...newInstances];
          }

          fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
          const stat = fs.statSync(DATA_FILE);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, bytes: stat.size, mtime: stat.mtimeMs }));
          console.log(`[api] 💾 写入 src/data/tv2.json (${stat.size} bytes)`);
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, msg: e.message }));
          console.error('[api] ❌ 写入失败:', e.message);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), saveDataPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 关键：排除 tv2.json 的文件系统变化从 HMR 中，写存档不会触发整页 reload
    watch: {
      ignored: [path.resolve(__dirname, 'src/data/tv2.json'), path.resolve(__dirname, 'src/data/instances_from_base.ndjson')],
    },
  },
});
