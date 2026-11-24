// 安装版冒烟：启动已安装的 exe（SMOKE 模式），断言启动自动连上记住的库。
// 用法：node scripts/smoke-exe.mjs <exe路径>
// 例：node scripts/smoke-exe.mjs "D:/制作记忆库/dist/smoke-install/记忆库.exe"
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const exe = process.argv[2];
if (!exe || !existsSync(exe)) {
  console.error('用法：node scripts/smoke-exe.mjs <exe路径>');
  process.exit(1);
}

// 与主进程一致：userData = %APPDATA%/记忆库（app.setName 统一）
const cfgFile = join(process.env.APPDATA, '记忆库', 'config.local.json');
let remembered = '';
try { remembered = JSON.parse(readFileSync(cfgFile, 'utf8')).lastLibrary || ''; } catch { /* 无配置 */ }

const r = spawnSync(exe, [], { env: { ...process.env, SMOKE: '1' }, encoding: 'utf8', timeout: 60000 });
assert.equal(r.status, 0, r.stderr || r.stdout);
const line = (r.stdout || '').trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
assert.ok(line, '冒烟应输出 JSON：' + r.stdout);
const state = JSON.parse(line);
assert.equal(state.smoke, 'ok');
if (remembered && existsSync(remembered)) {
  assert.equal(state.libDir, remembered, '启动应自动连上记住的库');
  assert.ok(state.archiveCount > 0, '应能扫到归档内容');
} else {
  assert.equal(state.libDir, null, '无有效记住路径时应回退欢迎页');
}
console.log('安装版冒烟通过：' + JSON.stringify(state));