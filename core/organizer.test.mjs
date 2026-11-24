import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { organizeLibrary } from './organizer.mjs';
import { parseFrontmatter } from './frontmatter.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memorg-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function makeLib() {
  const lib = mkdtempSync(join(tmp, 'lib-'));
  for (const d of ['inbox', 'archive/conversations/deepseek', 'archive/notes', 'index/topics', 'journal']) mkdirSync(join(lib, d), { recursive: true });
  return lib;
}

const config = { apiBaseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'deepseek-chat' };
const classify = { topic: '测试主题', tags: ['甲', '乙'], summary: '测试摘要' };
const okFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(classify) } }] }) });
const now = new Date('2026-11-13T12:00:00');

test('整理：归档、注入元数据、正文零改动、索引重建、写日志、非文本跳过', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'inbox', 'note.md'), '裸笔记正文\r\n第二行');
  writeFileSync(join(lib, 'inbox', 'dsh-conv.md'), '---\ntype: conversation\nsource: deepseek-harness\ntitle: "对话"\n---\n\n用户问你好');
  writeFileSync(join(lib, 'inbox', 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const stats = await organizeLibrary({ libDir: lib, config, fetchImpl: okFetch, now });
  assert.equal(stats.organized, 2);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.failed, 0);

  const note = parseFrontmatter(readFileSync(join(lib, 'archive', 'notes', 'note.md'), 'utf8'));
  assert.equal(note.data.topic, '测试主题');
  assert.equal(note.data.type, 'note');
  assert.equal(note.body, '裸笔记正文\r\n第二行');

  const convPath = join(lib, 'archive', 'conversations', 'deepseek', 'dsh-conv.md');
  assert.ok(existsSync(convPath));
  const conv = parseFrontmatter(readFileSync(convPath, 'utf8'));
  assert.equal(conv.data.topic, '测试主题');
  assert.equal(conv.body, '\n用户问你好');

  assert.deepEqual(readdirSync(join(lib, 'inbox')), ['photo.png']);
  assert.ok(existsSync(join(lib, 'index', 'topics', '测试主题.md')));
  assert.ok(existsSync(join(lib, 'index', '总索引.md')));
  assert.ok(existsSync(join(lib, 'journal', '2026-11-13-整理.md')));
});

test('单文件失败不中断：失败文件留在 inbox，其余正常归档', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'inbox', 'a.md'), '---\ntitle: "A"\n---\n正文A');
  writeFileSync(join(lib, 'inbox', 'b.md'), '---\ntitle: "B"\n---\n正文B');
  let n = 0;
  const flaky = async () => {
    n++;
    if (n === 1) throw new Error('网络错误');
    return okFetch();
  };
  const stats = await organizeLibrary({ libDir: lib, config, fetchImpl: flaky, now });
  assert.equal(stats.failed, 1);
  assert.equal(stats.organized, 1);
  assert.ok(existsSync(join(lib, 'inbox', 'a.md')));
  assert.ok(existsSync(join(lib, 'archive', 'notes', 'b.md')));
});

test('txt 归档时转为 md', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'inbox', '想法.txt'), '一个想法');
  const stats = await organizeLibrary({ libDir: lib, config, fetchImpl: okFetch, now });
  assert.equal(stats.organized, 1);
  assert.ok(existsSync(join(lib, 'archive', 'notes', '想法.md')));
  assert.equal(readdirSync(join(lib, 'inbox')).length, 0);
});

test('文件夹整理：整体移入 archive/files，生成摘要笔记，原件零改动', async () => {
  const lib = makeLib();
  mkdirSync(join(lib, 'inbox', 'proj', 'node_modules'), { recursive: true });
  mkdirSync(join(lib, 'inbox', 'proj', '.git'), { recursive: true });
  writeFileSync(join(lib, 'inbox', 'proj', '.git', 'HEAD'), 'ref: refs/heads/main');
  writeFileSync(join(lib, 'inbox', 'proj', 'project.md'), '# 我的软件\n做了个聊天应用');
  writeFileSync(join(lib, 'inbox', 'proj', 'node_modules', 'x.md'), '依赖噪音');
  writeFileSync(join(lib, 'inbox', 'proj', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const stats = await organizeLibrary({ libDir: lib, config, fetchImpl: okFetch, now });
  assert.equal(stats.organized, 1);
  assert.equal(stats.failed, 0);
  // 原件整体移动、字节不动
  assert.ok(existsSync(join(lib, 'archive', 'files', 'proj', 'project.md')));
  assert.ok(existsSync(join(lib, 'archive', 'files', 'proj', 'node_modules', 'x.md')));
  assert.equal(readFileSync(join(lib, 'archive', 'files', 'proj', 'project.md'), 'utf8'), '# 我的软件\n做了个聊天应用');
  // 嵌套 .git 改名保留，避免外层 git 嵌入仓库 gitlink
  assert.ok(!existsSync(join(lib, 'archive', 'files', 'proj', '.git')));
  assert.equal(readFileSync(join(lib, 'archive', 'files', 'proj', '.git-original', 'HEAD'), 'utf8'), 'ref: refs/heads/main');
  // 摘要笔记代表索引
  const note = parseFrontmatter(readFileSync(join(lib, 'archive', 'notes', 'proj.md'), 'utf8'));
  assert.equal(note.data.topic, '测试主题');
  assert.equal(note.data.source, 'folder');
  assert.match(note.body, /archive\/files\/proj|files\/proj/);
  assert.match(note.body, /我的软件/);
  assert.equal(readdirSync(join(lib, 'inbox')).length, 0);
  assert.ok(existsSync(join(lib, 'index', 'topics', '测试主题.md')));
});

test('文件夹 API 失败：留在 inbox 可重试，不半途移动', async () => {
  const lib = makeLib();
  mkdirSync(join(lib, 'inbox', 'proj'), { recursive: true });
  writeFileSync(join(lib, 'inbox', 'proj', 'project.md'), '# 项目');
  const badFetch = async () => { throw new Error('网络错误'); };
  const stats = await organizeLibrary({ libDir: lib, config, fetchImpl: badFetch, now });
  assert.equal(stats.failed, 1);
  assert.equal(stats.organized, 0);
  assert.ok(existsSync(join(lib, 'inbox', 'proj', 'project.md')));
  assert.ok(!existsSync(join(lib, 'archive', 'files', 'proj')));
});