import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initLibrary, isLibrary, resolveStartupLibrary } from './library.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memlib-init-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

test('空文件夹建库：目录与总索引齐备', () => {
  const dir = join(tmp, 'newlib');
  mkdirSync(dir);
  assert.equal(isLibrary(dir), false);
  initLibrary(dir, { now: new Date('2026-11-13T12:00:00') });
  assert.equal(isLibrary(dir), true);
  for (const d of ['inbox', 'archive/conversations/deepseek', 'archive/notes', 'archive/files', 'index/topics', 'journal']) {
    assert.ok(existsSync(join(dir, d)), `缺少目录 ${d}`);
  }
  assert.match(readFileSync(join(dir, 'index', '总索引.md'), 'utf8'), /type: master-index/);
});

test('重复初始化不破坏已有画像', () => {
  const dir = join(tmp, 'lib2');
  mkdirSync(dir);
  initLibrary(dir);
  const master = join(dir, 'index', '总索引.md');
  writeFileSync(master, readFileSync(master, 'utf8').replace('（待整理。）', '这是珍贵画像。'));
  initLibrary(dir);
  assert.match(readFileSync(master, 'utf8'), /这是珍贵画像。/);
});

test('启动解析：记住的库仍存在且是库 → 返回该路径', () => {
  const dir = join(tmp, 'startup-ok');
  initLibrary(dir);
  assert.equal(resolveStartupLibrary({ lastLibrary: dir }), dir);
});

test('启动解析：路径不存在 → null', () => {
  assert.equal(resolveStartupLibrary({ lastLibrary: join(tmp, 'gone') }), null);
  assert.equal(resolveStartupLibrary({ lastLibrary: join(tmp, 'startup-ok') }, () => false), null);
});

test('启动解析：文件夹存在但不是记忆库 → null', () => {
  const dir = join(tmp, 'notlib');
  mkdirSync(dir);
  assert.equal(resolveStartupLibrary({ lastLibrary: dir }), null);
});

test('启动解析：无记录或空配置 → null', () => {
  assert.equal(resolveStartupLibrary({}), null);
  assert.equal(resolveStartupLibrary({ lastLibrary: '' }), null);
  assert.equal(resolveStartupLibrary(null), null);
});