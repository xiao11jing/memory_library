#!/usr/bin/env node
// DSH（DeepSeek Harness）会话导出脚本
// 用法：node scripts/export-dsh.mjs [--source <会话目录>] [--out <输出目录>] [--state <状态文件>] [--force]
// 默认：~/.dsh/sessions → 记忆库/inbox/，增量导出（按源文件 mtime+size 判断变化）。
// 事实依据（2026-11-12 实地调研）：
//   - 会话文件为多帧拼接的 zstd 压缩 JSONL，需逐帧解压
//   - 同一会话可能有 session.jsonl.zstd（v0 全量事件）与 session.v4.jsonl.zstd（精简版），优先 v4
//   - 真实用户输入：type=user/message 且 data.source.kind === "user"（其余 kind 为系统注入）
//   - 助手正文：type=assistant/message 的 data.message.content 中 type=text 部分
//   - 标题：type=session/title；模型：type=request/context

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

// 多帧 zstd 解压：按魔数切分逐帧解压；魔数在压缩数据内部误现时向后扩展边界重试
export function decompressFrames(buf) {
  const pos = [];
  let i = 0;
  while ((i = buf.indexOf(MAGIC, i)) !== -1) { pos.push(i); i += 4; }
  if (pos.length === 0) throw new Error('不是 zstd 文件（未找到魔数）');
  const parts = [];
  let k = 0;
  while (k < pos.length) {
    let end = k + 1;
    let ok = false;
    while (end <= pos.length) {
      const slice = buf.slice(pos[k], end < pos.length ? pos[end] : buf.length);
      try { parts.push(zstdDecompressSync(slice).toString('utf8')); ok = true; break; }
      catch { end++; }
    }
    if (!ok) throw new Error(`偏移 ${pos[k]} 处的帧无法解压`);
    k = end;
  }
  return parts.join('');
}

// 解析 JSONL 事件流，提取会话头、标题、模型与真实对话消息
export function parseSession(jsonlText) {
  let header = null;
  let title = null;
  const models = new Set();
  const messages = [];
  const seenIds = new Set();
  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'session') header = o;
    else if (o.type === 'session/title') title = o.data?.title ?? title;
    else if (o.type === 'request/context' && o.data?.model) models.add(`${o.data.provider}/${o.data.model}`);
    else if (o.type === 'user/message') {
      if (o.data?.source?.kind !== 'user') continue;
      const text = (o.data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n\n').trim();
      if (!text) continue;
      const id = o.data.id ?? `seq-${o.seq}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      messages.push({ role: 'user', time: o.time, seq: o.seq ?? 0, text });
    } else if (o.type === 'assistant/message') {
      const m = o.data?.message;
      if (!m) continue;
      const text = (m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n\n').trim();
      if (!text) continue;
      const id = m.id ?? `seq-${o.seq}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      messages.push({ role: 'assistant', time: o.time, seq: o.seq ?? 0, text });
    }
  }
  messages.sort((a, b) => a.seq - b.seq || a.time - b.time);
  return { header, title, models: [...models], messages };
}

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtTime(ms) {
  if (!ms) return '时间未知';
  const d = new Date(ms);
  return `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 转 Markdown：frontmatter + 按时间排序的对话正文
export function toMarkdown(parsed, { exportedAt = new Date() } = {}) {
  const h = parsed.header ?? {};
  const created = h.createdAt ? new Date(h.createdAt) : null;
  const firstUser = parsed.messages.find((m) => m.role === 'user');
  const title = parsed.title || (firstUser ? firstUser.text.slice(0, 30).replace(/\s+/g, ' ') : '未命名会话');
  const fm = [
    '---',
    'type: conversation',
    'source: deepseek-harness',
    `session_id: ${JSON.stringify(h.id ?? 'unknown')}`,
    `workspace: ${JSON.stringify(h.cwd ?? '')}`,
    `created: ${created ? isoDate(created) : 'unknown'}`,
    `exported: ${isoDate(exportedAt)}`,
    `models: ${JSON.stringify(parsed.models)}`,
    `title: ${JSON.stringify(title)}`,
    '---',
  ].join('\n');
  const body = parsed.messages
    .map((m) => `## ${m.role === 'user' ? '用户' : '助手'} · ${fmtTime(m.time)}\n\n${m.text}`)
    .join('\n\n');
  return `${fm}\n\n# ${title}\n\n${body}\n`;
}

function outputName(parsed, sessionDirName) {
  const h = parsed.header ?? {};
  const created = h.createdAt ? new Date(h.createdAt) : null;
  const datePart = created ? isoDate(created).replaceAll('-', '') : '00000000';
  const idPart = (h.id ?? sessionDirName).replace(/^session-/, '').slice(0, 8);
  return `dsh-${datePart}-${idPart}.md`;
}

// 扫描会话目录并增量导出。返回统计 { total, exported, skippedUnchanged, skippedEmpty, failed }
export function exportAll({ sourceDir, outDir, stateFile, force = false, now = new Date() }) {
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const stats = { total: 0, exported: 0, skippedUnchanged: 0, skippedEmpty: 0, failed: 0 };
  mkdirSync(outDir, { recursive: true });
  for (const ws of readdirSync(sourceDir)) {
    const wsDir = join(sourceDir, ws);
    if (!statSync(wsDir).isDirectory()) continue;
    for (const s of readdirSync(wsDir)) {
      const sDir = join(wsDir, s);
      if (!statSync(sDir).isDirectory()) continue;
      const v4 = join(sDir, 'session.v4.jsonl.zstd');
      const v0 = join(sDir, 'session.jsonl.zstd');
      const p = existsSync(v4) ? v4 : existsSync(v0) ? v0 : null;
      if (!p) continue;
      stats.total++;
      const key = `${ws}/${s}`;
      const st = statSync(p);
      const prev = state[key];
      if (!force && prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size && (prev.out === null || existsSync(prev.out))) {
        stats.skippedUnchanged++;
        continue;
      }
      try {
        const parsed = parseSession(decompressFrames(readFileSync(p)));
        if (parsed.messages.length === 0) {
          stats.skippedEmpty++;
          state[key] = { mtimeMs: st.mtimeMs, size: st.size, out: null };
          continue;
        }
        const outPath = join(outDir, outputName(parsed, s));
        writeFileSync(outPath, toMarkdown(parsed, { exportedAt: now }));
        state[key] = { mtimeMs: st.mtimeMs, size: st.size, out: outPath };
        stats.exported++;
      } catch (e) {
        stats.failed++;
        console.warn(`跳过无法解析的会话 ${key}: ${e.message}`);
      }
    }
  }
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  return stats;
}

// CLI 入口（被 import 时不执行）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };
  const sourceDir = opt('--source', join(homedir(), '.dsh', 'sessions'));
  const outDir = opt('--out', join(root, '记忆库', 'inbox'));
  const stateFile = opt('--state', join(root, 'scripts', '.dsh-export-state.json'));
  const force = args.includes('--force');
  const stats = exportAll({ sourceDir, outDir, stateFile, force });
  console.log(`导出完成：共 ${stats.total} 个会话，新导出 ${stats.exported}，未变化跳过 ${stats.skippedUnchanged}，空会话 ${stats.skippedEmpty}，失败 ${stats.failed}`);
  console.log(`输出目录：${outDir}`);
  process.exit(stats.failed > 0 ? 1 : 0);
}