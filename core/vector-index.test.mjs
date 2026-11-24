import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateVectorIndex, loadVectorIndex, cosine, VECTOR_REL } from './vector-index.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memvec-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function makeLib() {
  const lib = mkdtempSync(join(tmp, 'lib-'));
  for (const d of ['inbox', 'archive/notes', 'index/topics', 'journal']) mkdirSync(join(lib, d), { recursive: true });
  return lib;
}

// 假 embedder：概念轴向量（career/money/weather），记录调用次数
function fakeEmbedder() {
  const calls = { n: 0, texts: [] };
  const vec = (t) => {
    const career = /转行|转型|学习|规划|路线|步骤/.test(t) ? 1 : 0;
    const money = /记账|账单/.test(t) ? 1 : 0;
    const weather = /天气|散步/.test(t) ? 1 : 0;
    const norm = Math.sqrt(career + money + weather) || 1;
    return [career / norm, money / norm, weather / norm];
  };
  return {
    calls,
    embed: async (texts) => { calls.n += texts.length; calls.texts.push(...texts); return texts.map(vec); },
    dispose: () => {},
  };
}

test('建索引：写 .cache/vectors.json，块带偏移与向量', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'archive', 'notes', 'a.md'), '---\ntitle: "转型规划"\ntopic: "学习"\n---\n规划转型的步骤与路径。');
  const emb = fakeEmbedder();
  const stats = await updateVectorIndex(lib, { embedder: emb });
  assert.equal(stats.status, 'ok');
  assert.equal(stats.docs, 1);
  assert.equal(stats.embedded, 1);
  const idx = loadVectorIndex(lib);
  assert.equal(idx.version, 1);
  assert.equal(idx.dim, 3);
  const doc = idx.docs['archive/notes/a.md'];
  assert.ok(doc.hash);
  assert.equal(doc.chunks[0].start, 0);
  assert.equal(doc.chunks[0].v.length, 3);
  // embedding 文本带标题/主题前缀
  assert.match(emb.calls.texts[0], /转型规划 \/ 学习/);
});

test('增量：未改动复用旧向量，改动只重算该文档', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'archive', 'notes', 'a.md'), '---\ntitle: "A"\n---\n记账正文一。');
  writeFileSync(join(lib, 'archive', 'notes', 'b.md'), '---\ntitle: "B"\n---\n天气正文二。');
  const emb = fakeEmbedder();
  await updateVectorIndex(lib, { embedder: emb });
  assert.equal(emb.calls.n, 2);
  const again = await updateVectorIndex(lib, { embedder: emb });
  assert.equal(again.embedded, 0);
  assert.equal(emb.calls.n, 2);
  writeFileSync(join(lib, 'archive', 'notes', 'a.md'), '---\ntitle: "A"\n---\n记账正文改。');
  const third = await updateVectorIndex(lib, { embedder: emb });
  assert.equal(third.embedded, 1);
  assert.equal(emb.calls.n, 3);
});

test('删除文档后索引剔除；空库索引为空 docs', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'archive', 'notes', 'a.md'), '正文甲');
  const emb = fakeEmbedder();
  await updateVectorIndex(lib, { embedder: emb });
  rmSync(join(lib, 'archive', 'notes', 'a.md'));
  const stats = await updateVectorIndex(lib, { embedder: emb });
  assert.equal(stats.docs, 0);
  assert.deepEqual(loadVectorIndex(lib).docs, {});
});

test('模型缺失：返回 no-model，不写索引文件', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'archive', 'notes', 'a.md'), '正文甲');
  const stats = await updateVectorIndex(lib, { modelDir: join(tmp, 'no-models') });
  assert.equal(stats.status, 'no-model');
  assert.ok(!existsSync(join(lib, VECTOR_REL)));
});

test('损坏索引视为无索引；cosine 正确', () => {
  const lib = makeLib();
  mkdirSync(join(lib, '.cache'), { recursive: true });
  writeFileSync(join(lib, VECTOR_REL), '{bad json');
  assert.equal(loadVectorIndex(lib), null);
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
});

test('断点续建：shouldStop 落盘已完成的文档，续建只重算剩余', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'archive', 'notes', 'a.md'), '---\ntitle: "A"\n---\n记账甲。');
  writeFileSync(join(lib, 'archive', 'notes', 'b.md'), '---\ntitle: "B"\n---\n天气乙。');
  const emb = fakeEmbedder();
  let stop = false;
  const r1 = await updateVectorIndex(lib, {
    embedder: emb,
    shouldStop: () => stop,
    onProgress: (p) => { if (p.done === 1) stop = true; },
  });
  assert.equal(r1.status, 'stopped');
  assert.equal(r1.docs, 1);
  assert.ok(existsSync(join(lib, VECTOR_REL)));
  const callsAfterStop = emb.calls.n;
  const r2 = await updateVectorIndex(lib, { embedder: emb });
  assert.equal(r2.status, 'ok');
  assert.equal(r2.docs, 2);
  assert.equal(emb.calls.n - callsAfterStop, 1); // 只算了 b
});

test('进度回调带全局块总数与块级进度', async () => {
  const lib = makeLib();
  writeFileSync(join(lib, 'archive', 'notes', 'a.md'), '正文甲。');
  writeFileSync(join(lib, 'archive', 'notes', 'b.md'), '正文乙。');
  const seen = [];
  await updateVectorIndex(lib, { embedder: fakeEmbedder(), onProgress: (p) => seen.push(p) });
  assert.ok(seen.every((p) => p.totalChunks === 2));
  assert.equal(seen[seen.length - 1].chunkDone, 2);
  assert.equal(seen[seen.length - 1].done, 2);
});