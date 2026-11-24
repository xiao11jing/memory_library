import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, saveConfig, DEFAULT_CONFIG } from './config.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memcfg-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

test('文件缺失返回默认配置（DeepSeek 官方地址）', () => {
  const cfg = loadConfig(join(tmp, 'none.json'));
  assert.deepEqual(cfg, DEFAULT_CONFIG);
  assert.equal(cfg.apiBaseUrl, 'https://api.deepseek.com/v1');
});

test('保存/读取往返', () => {
  const f = join(tmp, 'cfg.json');
  saveConfig(f, { apiBaseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'm' });
  const cfg = loadConfig(f);
  assert.equal(cfg.apiKey, 'sk-test');
  assert.equal(cfg.model, 'm');
  assert.equal(cfg.apiBaseUrl, 'https://example.com/v1');
});

test('损坏文件回退默认配置', () => {
  const f = join(tmp, 'bad.json');
  writeFileSync(f, '{不是JSON');
  assert.deepEqual(loadConfig(f), DEFAULT_CONFIG);
});

test('lastLibrary 默认为空且可保存往返', () => {
  assert.equal(DEFAULT_CONFIG.lastLibrary, '');
  const f = join(tmp, 'last.json');
  saveConfig(f, { ...DEFAULT_CONFIG, lastLibrary: join(tmp, 'somelib') });
  assert.equal(loadConfig(f).lastLibrary, join(tmp, 'somelib'));
});