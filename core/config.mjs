// 本地 API 配置：key 只存本地文件（config.local.json，已 gitignore），绝不入库。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 默认使用 DeepSeek 官方 API（OpenAI 兼容格式）；用户可在设置中修改地址与模型。
export const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  lastLibrary: '', // 上次打开的记忆库路径：启动时自动连接（本机配置，不入库）
  semanticSearch: true, // 语义检索开关：模型/索引缺失时自动退回关键词
};

export function loadConfig(file) {
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(file, cfg) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
}