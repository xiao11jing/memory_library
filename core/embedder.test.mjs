// 真模型验收：模型未下载时跳过（客户端设置页可下载）；下载后验证语义质量与形状。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedder, modelReady } from './embedder.mjs';
import { cosine } from './vector-index.mjs';

const skip = modelReady() ? false : '语义模型未下载（设置页或 scripts/download-model.mjs）';

test('真模型：同义改写相似度显著高于无关句，512 维单位向量', { skip }, async () => {
  const emb = await createEmbedder();
  const [a, b, c] = await emb.embed(['我的转行学习路线', '转型学习的规划与步骤', '今天天气不错适合散步']);
  assert.equal(a.length, 512);
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-3);
  const simAB = cosine(a, b);
  const simAC = cosine(a, c);
  console.log(`  实测相似度 同义=${simAB.toFixed(3)} 无关=${simAC.toFixed(3)}`);
  assert.ok(simAB > simAC + 0.1, `同义 ${simAB} 应显著高于无关 ${simAC}`);
  emb.dispose();
});

test('真模型：批量与单条一致、长文本截断不报错', { skip }, async () => {
  const emb = await createEmbedder();
  const [single] = await emb.embed(['记忆库检索']);
  const same = await emb.embed(['记忆库检索', '记忆库检索']);
  assert.ok(cosine(single, same[0]) > 0.9999); // 等长批量应完全一致
  const batch = await emb.embed(['记忆库检索', '无关内容'.repeat(300)]);
  // int8 量化图对 padding 有 ~0.01 量级固有漂移，远小于检索阈值间隔，可接受
  assert.ok(cosine(single, batch[0]) > 0.99);
  assert.equal(batch[1].length, 512);
  emb.dispose();
});