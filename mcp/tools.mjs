// MCP 工具层：纯函数便于测试；server.mjs 只做协议包装。
// 库路径由调用方传入；read 做越界保护，add 只写 inbox。
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { searchLibrary } from '../core/search.mjs';

export function memoryOverview(libDir) {
  const p = join(libDir, 'index', '总索引.md');
  if (!existsSync(p)) throw new Error('总索引不存在，请先建库：' + p);
  return readFileSync(p, 'utf8');
}

export async function memorySearch(libDir, query, limit = 20) {
  const results = await searchLibrary(libDir, query, { limit });
  return results.map((r) => ({
    title: r.title,
    topic: r.topic,
    created: r.created,
    location: r.location,
    path: r.relPath,
    snippet: r.snippet,
    score: r.score,
    via: r.via, // keyword | semantic | both：语义路在本机模型+向量索引就绪时自动启用
  }));
}

export function memoryRead(libDir, path) {
  const base = resolve(libDir);
  const p = resolve(base, String(path));
  if (p !== base && !p.startsWith(base + sep)) throw new Error('路径越界：只能读记忆库内的文件');
  if (!existsSync(p) || !statSync(p).isFile()) throw new Error('文件不存在：' + path);
  return { path: p, text: readFileSync(p, 'utf8') };
}

export function memoryAdd(libDir, content, title = '') {
  const body = String(content ?? '');
  if (!body.trim()) throw new Error('内容不能为空');
  const inbox = join(libDir, 'inbox');
  mkdirSync(inbox, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = String(title ?? '').trim().replace(/[\\/:*?"<>|\s.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const name = slug ? `${stamp}-${slug}.md` : `${stamp}.md`;
  const p = join(inbox, name);
  writeFileSync(p, body);
  return { path: p, relPath: 'inbox/' + name };
}