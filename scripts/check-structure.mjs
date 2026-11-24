#!/usr/bin/env node
// 记忆库结构校验
// 用法：node scripts/check-structure.mjs [--lib <记忆库路径>]
// 校验项：目录骨架完整、总索引存在且 frontmatter 规范、索引内相对链接全部有效。
// 退出码：0 = 通过，1 = 失败（错误逐条列出）。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libArgIndex = process.argv.indexOf('--lib');
const lib = libArgIndex > -1 && process.argv[libArgIndex + 1]
  ? resolve(process.argv[libArgIndex + 1])
  : join(root, '记忆库');
const errors = [];

// 1. 目录骨架
const requiredDirs = [
  'inbox',
  'archive/conversations/deepseek',
  'archive/notes',
  'archive/files',
  'index',
  'index/topics',
  'journal',
];
for (const d of requiredDirs) {
  const p = join(lib, d);
  if (!existsSync(p) || !statSync(p).isDirectory()) {
    errors.push(`缺少目录: ${d}（库根: ${lib}）`);
  }
}

// 2. 总索引存在且 frontmatter 规范
const masterIndex = join(lib, 'index', '总索引.md');
if (!existsSync(masterIndex)) {
  errors.push(`缺少文件: index/总索引.md（库根: ${lib}）`);
} else {
  const text = readFileSync(masterIndex, 'utf8');
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) {
    errors.push('总索引.md 缺少 YAML frontmatter');
  }
  if (!/type:\s*master-index/.test(text)) {
    errors.push('总索引.md frontmatter 缺少 type: master-index');
  }
}

// 3. 项目计划存在
if (!existsSync(join(root, 'project.md'))) {
  errors.push('缺少文件: project.md');
}

// 4. 索引内相对链接有效性（跳过外链与纯锚点）
function walkMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walkMd(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}
for (const file of walkMd(join(lib, 'index'))) {
  // HTML 注释中的示例链接不是真实链接，先剔除注释再检查
  const text = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const pathPart = target.split('#')[0];
    if (!pathPart) continue;
    const resolved = resolve(dirname(file), decodeURI(pathPart));
    if (!existsSync(resolved)) {
      errors.push(`失效链接: ${file} -> ${target}`);
    }
  }
}

if (errors.length > 0) {
  console.error('结构校验失败:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`结构校验通过：${requiredDirs.length} 个目录、总索引格式、索引链接均正常。`);