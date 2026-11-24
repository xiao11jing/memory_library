import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { memoryOverview, memorySearch, memoryRead, memoryAdd } from './tools.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memmcp-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function makeLib() {
  const lib = mkdtempSync(join(tmp, 'lib-'));
  for (const d of ['inbox', 'archive/notes', 'index/topics', 'journal']) mkdirSync(join(lib, d), { recursive: true });
  writeFileSync(join(lib, 'index', '总索引.md'), '---\ntype: master-index\n---\n\n# 总索引\n\n画像与主题地图。');
  writeFileSync(join(lib, 'archive', 'notes', 'n.md'), '---\ntitle: "种子笔记"\ntopic: "T"\nsummary: "摘要"\n---\n正文关键词甲');
  return lib;
}

test('overview 返回总索引全文', () => {
  const lib = makeLib();
  assert.match(memoryOverview(lib), /# 总索引/);
});

test('search 返回摘要/片段/库内相对路径', async () => {
  const lib = makeLib();
  const r = await memorySearch(lib, '关键词甲');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '种子笔记');
  assert.equal(r[0].path, 'archive/notes/n.md');
  assert.match(r[0].snippet, /关键词甲/);
});

test('read 相对路径可读，越界与不存在被拒', () => {
  const lib = makeLib();
  assert.match(memoryRead(lib, 'archive/notes/n.md').text, /正文关键词甲/);
  assert.throws(() => memoryRead(lib, '../escape.md'), /越界/);
  assert.throws(() => memoryRead(lib, join(tmp, 'outside.md')), /越界/);
  assert.throws(() => memoryRead(lib, 'archive/notes/none.md'), /不存在/);
});

test('add 写入 inbox 且标题 slug 防穿越', () => {
  const lib = makeLib();
  const r = memoryAdd(lib, '# 新记忆\n内容', '../../坏 标题');
  assert.match(r.relPath, /^inbox\/\d{4}-\d{2}-\d{2}-\d{6}-坏-标题\.md$/);
  assert.equal(readFileSync(r.path, 'utf8'), '# 新记忆\n内容');
  assert.equal(readdirSync(join(lib, 'inbox')).length, 1);
  assert.throws(() => memoryAdd(lib, '   '), /不能为空/);
});