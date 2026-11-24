import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { searchLibrary } from './search.mjs';
import { updateVectorIndex } from './vector-index.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memsearch-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const lib = mkdtempSync(join(tmp, 'lib-'));
for (const d of ['inbox', 'archive/notes', 'index/topics', 'journal']) mkdirSync(join(lib, d), { recursive: true });
writeFileSync(join(lib, 'archive', 'notes', 'jizhang.md'), '---\ntitle: "记账应用"\ntags: ["记账", "本地存储"]\nsummary: "单文件记账"\ntopic: "Web项目"\ncreated: 2026-08-16\n---\n\n每周生成周报，每月生成月报。');
writeFileSync(join(lib, 'archive', 'notes', 'django.md'), '---\ntitle: "Django学习"\ncreated: 2026-11-01\n---\n\n修复了分页 bug。');
writeFileSync(join(lib, 'archive', 'notes', 'other.md'), '---\ntitle: "其他笔记"\ncreated: 2026-09-01\n---\n\n这里提到记账两个字。');

test('中文关键词命中，标题匹配排在仅正文匹配之前', async () => {
  const r = await searchLibrary(lib, '记账');
  assert.equal(r.length, 2);
  assert.equal(r[0].title, '记账应用');
  assert.ok(r[0].score > r[1].score);
});

test('AND 语义：所有词都命中才返回', async () => {
  const r = await searchLibrary(lib, 'django 分页');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Django学习');
  assert.equal((await searchLibrary(lib, 'django 不存在的词')).length, 0);
});

test('空查询返回空数组', async () => {
  assert.deepEqual(await searchLibrary(lib, '   '), []);
});

test('片段包含命中词', async () => {
  const r = await searchLibrary(lib, '周报');
  assert.equal(r.length, 1);
  assert.match(r[0].snippet, /周报/);
});

test('limit 生效', async () => {
  const r = await searchLibrary(lib, '记账', { limit: 1 });
  assert.equal(r.length, 1);
});

test('标签命中也能搜到', async () => {
  const r = await searchLibrary(lib, '本地存储');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '记账应用');
});

// ---- 混合检索：假 embedder（概念轴向量），验证语义独命中与融合 ----
function fakeEmbedder() {
  const vec = (t) => {
    const career = /转行|转型|学习|规划|路线|步骤/.test(t) ? 1 : 0;
    const money = /记账|账单/.test(t) ? 1 : 0;
    const weather = /天气|散步/.test(t) ? 1 : 0;
    const norm = Math.sqrt(career + money + weather) || 1;
    return [career / norm, money / norm, weather / norm];
  };
  return { embed: async (texts) => texts.map(vec), dispose: () => {} };
}

const lib2 = mkdtempSync(join(tmp, 'lib2-'));
for (const d of ['inbox', 'archive/notes', 'index/topics', 'journal']) mkdirSync(join(lib2, d), { recursive: true });
writeFileSync(join(lib2, 'archive', 'notes', 'plan.md'), '---\ntitle: "转型规划"\ncreated: 2026-10-01\n---\n规划转型的步骤与路径。');
writeFileSync(join(lib2, 'archive', 'notes', 'walk.md'), '---\ntitle: "散步记"\ncreated: 2026-10-02\n---\n今天天气不错适合散步。');

test('语义独命中：零关键词重叠的同义查询也能搜到', async () => {
  await updateVectorIndex(lib2, { embedder: fakeEmbedder() });
  const r = await searchLibrary(lib2, '转行学习路线', { embedder: fakeEmbedder() });
  assert.equal(r.length, 1);
  assert.equal(r[0].title, '转型规划');
  assert.equal(r[0].via, 'semantic');
  assert.match(r[0].snippet, /规划转型/);
});

test('融合：关键词与语义双命中排最前，via=both', async () => {
  const r = await searchLibrary(lib2, '转型', { embedder: fakeEmbedder() });
  assert.equal(r[0].title, '转型规划');
  assert.equal(r[0].via, 'both');
  assert.ok(!r.some((x) => x.title === '散步记')); // 无关文档被余弦下限挡掉
});

test('semantic:false 或无索引时退回纯关键词', async () => {
  const off = await searchLibrary(lib2, '转行学习路线', { embedder: fakeEmbedder(), semantic: false });
  assert.deepEqual(off, []);
  const noIdx = await searchLibrary(lib, '记账', { embedder: fakeEmbedder() });
  assert.ok(noIdx.every((x) => x.via === 'keyword'));
});

test('同标题同片段的副本去重，只留一条', async () => {
  const lib3 = mkdtempSync(join(tmp, 'lib3-'));
  for (const d of ['inbox', 'archive/notes', 'index/topics', 'journal']) mkdirSync(join(lib3, d), { recursive: true });
  writeFileSync(join(lib3, 'archive', 'notes', 'x.md'), '---\ntitle: "重复"\n---\n记账副本正文。');
  writeFileSync(join(lib3, 'archive', 'notes', 'y.md'), '---\ntitle: "重复"\n---\n记账副本正文。');
  await updateVectorIndex(lib3, { embedder: fakeEmbedder() });
  const r = await searchLibrary(lib3, '记账', { embedder: fakeEmbedder() });
  assert.equal(r.length, 1);
});