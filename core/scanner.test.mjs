import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanLibrary } from './scanner.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memscan-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function makeLib() {
  const lib = mkdtempSync(join(tmp, 'lib-'));
  for (const d of ['inbox', 'archive/conversations/deepseek', 'archive/notes', 'archive/files', 'index/topics', 'journal']) {
    mkdirSync(join(lib, d), { recursive: true });
  }
  return lib;
}

test('扫描 inbox 与 archive，汇总主题列表', () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'inbox', 'a.md'), '---\ntitle: "A"\n---\n正文');
  writeFileSync(join(lib, 'archive', 'notes', 'b.md'), '---\ntitle: "B"\ntopic: "Beta"\n---\n正文');
  writeFileSync(join(lib, 'archive', 'conversations', 'deepseek', 'c.md'), '---\ntitle: "C"\ntopic: "Alpha"\n---\n正文');
  const { entries, inbox, archive, topics } = scanLibrary(lib);
  assert.equal(entries.length, 3);
  assert.equal(inbox.length, 1);
  assert.equal(archive.length, 2);
  assert.deepEqual(topics, ['Alpha', 'Beta']);
  assert.equal(inbox[0].relPath, 'inbox/a.md');
  assert.equal(inbox[0].hasFrontmatter, true);
});

test('无 frontmatter 的文件也能扫描到', () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'inbox', 'raw.md'), '裸正文');
  const { inbox } = scanLibrary(lib);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].hasFrontmatter, false);
  assert.deepEqual(inbox[0].data, {});
});

test('空库扫描不报错', () => {
  const lib = makeLib();
  const { entries, topics } = scanLibrary(lib);
  assert.equal(entries.length, 0);
  assert.deepEqual(topics, []);
});

test('inbox 文件夹作为整体待整理项，不展开内部文件', () => {
  const lib = makeLib();
  mkdirSync(join(lib, 'inbox', 'proj', 'node_modules'), { recursive: true });
  writeFileSync(join(lib, 'inbox', 'proj', 'project.md'), '# 项目');
  writeFileSync(join(lib, 'inbox', 'proj', 'node_modules', 'x.md'), '噪音');
  const { entries, inbox, inboxFolders } = scanLibrary(lib);
  assert.equal(inboxFolders.length, 1);
  assert.equal(inboxFolders[0].name, 'proj');
  assert.equal(inbox.length, 0);
  assert.equal(entries.length, 0);
});

test('archive 跳过 node_modules/.git 与 files 原件区', () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'archive', 'notes', 'n.md'), '---\ntopic: "T"\n---\n正文');
  mkdirSync(join(lib, 'archive', 'notes', 'node_modules'), { recursive: true });
  writeFileSync(join(lib, 'archive', 'notes', 'node_modules', 'm.md'), '噪音');
  mkdirSync(join(lib, 'archive', 'files', 'proj'), { recursive: true });
  writeFileSync(join(lib, 'archive', 'files', 'proj', 'p.md'), '原件不逐文件索引');
  const { archive, topics } = scanLibrary(lib);
  assert.equal(archive.length, 1);
  assert.deepEqual(topics, ['T']);
});