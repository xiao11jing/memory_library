// 记忆库的创建与识别：exe 用它在任意空文件夹建库，结构与本项目记忆库完全一致。
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { rebuildIndexes } from './indexer.mjs';

const DIRS = ['inbox', 'archive/conversations/deepseek', 'archive/notes', 'archive/files', 'index/topics', 'journal'];

export function isLibrary(dir) {
  return existsSync(join(dir, 'index')) && existsSync(join(dir, 'inbox')) && existsSync(join(dir, 'archive'));
}

// 启动解析：记住的库路径仍存在且仍是记忆库才自动连接，否则返回 null 由界面回退欢迎页。
export function resolveStartupLibrary(cfg, exists = existsSync) {
  const p = cfg && cfg.lastLibrary;
  if (p && exists(p) && isLibrary(p)) return p;
  return null;
}

// 幂等：重复初始化只补缺失目录，不破坏已有内容（总索引画像由 rebuildIndexes 保留）
export function initLibrary(dir, { now = new Date() } = {}) {
  for (const d of DIRS) mkdirSync(join(dir, d), { recursive: true });
  rebuildIndexes(dir, { now });
}