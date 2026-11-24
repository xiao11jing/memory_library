import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkBody } from './chunker.mjs';

test('短正文单块，偏移为 0', () => {
  const cs = chunkBody('一段短笔记。');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].start, 0);
  assert.equal(cs[0].text, '一段短笔记。');
});

test('空正文返回空数组', () => {
  assert.deepEqual(chunkBody(''), []);
  assert.deepEqual(chunkBody('   \n  \n'), []);
});

test('长文按 target 聚合且块不超 max', () => {
  const para = '这是一句话。'.repeat(40); // 240 字
  const body = [para, para, para, para].join('\n\n'); // ~960 字
  const cs = chunkBody(body, { target: 500, max: 640 });
  assert.ok(cs.length >= 2);
  for (const c of cs) assert.ok(c.text.length <= 640);
  // 偏移可定位回原文
  for (const c of cs) assert.equal(body.slice(c.start, c.start + c.text.length), c.text);
});

test('超长单段硬切不超 max', () => {
  const body = '无句末边界'.repeat(300); // 1800 字无标点
  const cs = chunkBody(body, { target: 500, max: 640 });
  for (const c of cs) assert.ok(c.text.length <= 640);
  assert.equal(cs.map((c) => c.text).join(''), body);
});

test('标题作为块边界', () => {
  const body = '# 标题一\n内容甲\n\n# 标题二\n内容乙';
  const cs = chunkBody(body, { target: 5, max: 640, min: 1 });
  assert.ok(cs.length >= 2);
  assert.match(cs[0].text, /标题一/);
  assert.ok(!/标题二/.test(cs[0].text));
});

test('过短尾块并入前块', () => {
  const body = '主内容。'.repeat(120) + '\n\n尾'; // 600 字 + 短尾
  const cs = chunkBody(body, { target: 500, max: 640, min: 80 });
  assert.ok(cs.length >= 1);
  assert.ok(cs[cs.length - 1].text.length >= 80);
  assert.match(cs[cs.length - 1].text, /尾$/);
});