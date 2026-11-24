// 图标生成脚本的验收：ICO 容器结构合法、四尺寸齐备、PNG 为 256x256
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('make-icon：生成合法多尺寸 ICO 与 256 PNG', () => {
  const r = spawnSync(electron, [join(root, 'scripts', 'make-icon.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const ico = readFileSync(join(root, 'build', 'icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0, 'ICO reserved 位');
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type 应为 icon');
  assert.equal(ico.readUInt16LE(4), 4, '应含 4 个尺寸条目');
  // 每个条目指向的数据必须是 PNG 签名
  for (let i = 0; i < 4; i++) {
    const off = ico.readUInt32LE(6 + 16 * i + 12);
    assert.equal(ico.readUInt32BE(off), 0x89504e47, `条目 ${i} 应为 PNG 数据`);
  }
  const png = readFileSync(join(root, 'build', 'icon.png'));
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
});