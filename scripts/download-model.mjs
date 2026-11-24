// 语义模型下载：hf-mirror 优先、huggingface 兜底；.part 原子落盘；已存在跳过（force 可重下）。
// 模型目录：%APPDATA%/记忆库/models（与客户端 userData 同址，MCP 共享），不入库不进 git。
import { existsSync, mkdirSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultModelDir, MODEL_ID, MODEL_FILES } from '../core/embedder.mjs';

export const MIRRORS = ['https://hf-mirror.com', 'https://huggingface.co'];

export async function downloadModel({ modelDir = defaultModelDir(), onProgress = () => {}, fetchImpl = fetch, force = false } = {}) {
  const files = [];
  for (const file of MODEL_FILES) {
    const dest = join(modelDir, MODEL_ID, file);
    if (!force && existsSync(dest) && statSync(dest).size > 0) {
      onProgress({ file, status: 'skip' });
      files.push({ file, status: 'skip' });
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    let lastErr = null;
    for (const base of MIRRORS) {
      try {
        const res = await fetchImpl(`${base}/${MODEL_ID}/resolve/main/${file}`, { redirect: 'follow' });
        if (!res.ok) { lastErr = new Error(`${base} HTTP ${res.status}`); continue; }
        const total = Number(res.headers.get('content-length')) || 0;
        const parts = [];
        let received = 0;
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(Buffer.from(value));
            received += value.length;
            onProgress({ file, status: 'downloading', received, total });
          }
        } else {
          const buf = Buffer.from(await res.arrayBuffer());
          parts.push(buf);
          received = buf.length;
        }
        const tmp = dest + '.part';
        writeFileSync(tmp, Buffer.concat(parts));
        renameSync(tmp, dest);
        onProgress({ file, status: 'done', bytes: received });
        files.push({ file, status: 'done', bytes: received });
        lastErr = null;
        break;
      } catch (err) { lastErr = err; }
    }
    if (lastErr) throw new Error(`下载失败 ${file}：${lastErr.message}`);
  }
  return { modelDir, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const t0 = Date.now();
  await downloadModel({
    onProgress: (p) => {
      if (p.status === 'downloading' && p.total) process.stdout.write(`\r${p.file} ${(100 * p.received / p.total).toFixed(1)}%   `);
      else console.log(`${p.file}: ${p.status}${p.bytes ? ` (${(p.bytes / 1048576).toFixed(1)}MB)` : ''}`);
    },
  });
  console.log(`\n模型就绪：${defaultModelDir()}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
}