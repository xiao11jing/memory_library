// 扫描记忆库：inbox 顶层（文件 + 文件夹整体）与 archive 的 Markdown 元数据。
// 只保留元数据不保留正文（检索时按需读取），保证扫描轻量。
// inbox 不展开文件夹：文件夹是整体待整理项（展开会扫进 node_modules 等噪音）;
// archive 跳过 node_modules/.git 与作品原件区 files/（原件由整理笔记代表索引）。
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git']);

function mdEntry(p, libDir, location) {
  const text = readFileSync(p, 'utf8');
  const fm = parseFrontmatter(text);
  return {
    path: p,
    relPath: relative(libDir, p).replaceAll('\\', '/'),
    location,
    data: fm ? fm.data : {},
    hasFrontmatter: Boolean(fm),
    mtimeMs: statSync(p).mtimeMs,
  };
}

function walkMd(dir, libDir, location, out) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkMd(p, libDir, location, out);
    } else if (e.name.endsWith('.md')) {
      out.push(mdEntry(p, libDir, location));
    }
  }
}

export function scanLibrary(libDir) {
  const entries = [];
  const inbox = [];
  const inboxFolders = [];
  const inboxDir = join(libDir, 'inbox');
  if (existsSync(inboxDir)) {
    for (const e of readdirSync(inboxDir, { withFileTypes: true })) {
      const p = join(inboxDir, e.name);
      if (e.isDirectory()) {
        inboxFolders.push({ name: e.name, path: p, relPath: relative(libDir, p).replaceAll('\\', '/') });
      } else if (e.name.endsWith('.md') || e.name.endsWith('.txt')) {
        const entry = mdEntry(p, libDir, 'inbox');
        entries.push(entry);
        inbox.push(entry);
      }
    }
  }
  const archive = [];
  const archiveDir = join(libDir, 'archive');
  if (existsSync(archiveDir)) {
    for (const e of readdirSync(archiveDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'files') continue; // files/ 为作品原件区，不逐文件索引
      walkMd(join(archiveDir, e.name), libDir, 'archive', archive);
    }
  }
  entries.push(...archive);
  const topics = [...new Set(archive.map((e) => e.data.topic).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh'));
  return { entries, inbox, archive, topics, inboxFolders };
}