import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenizer } from './tokenizer.mjs';

// 合成 vocab：覆盖中文单字、英文整词与子词、特殊符
const vocab = {
  '[PAD]': 0, '[UNK]': 100, '[CLS]': 101, '[SEP]': 102,
  '你': 1, '好': 2, '世': 3, '界': 4,
  'hello': 5, 'hel': 6, '##lo': 7, '##xx': 8,
  '。': 9, '，': 10,
};
const tok = createTokenizer({ model: { vocab }, added_tokens: [] }, { maxLength: 16 });

test('中文逐字切分并加 CLS/SEP', () => {
  const { ids } = tok.encode('你好世界');
  assert.deepEqual(ids, [101, 1, 2, 3, 4, 102]);
});

test('英文子词 WordPiece 续接', () => {
  assert.deepEqual(tok.tokenize('hello'), ['hello']);
  assert.deepEqual(tok.tokenize('helxx'), ['hel', '##xx']);
});

test('未知词落到 UNK', () => {
  assert.deepEqual(tok.tokenize('zzz'), ['[UNK]']);
  const { ids } = tok.encode('zzz');
  assert.deepEqual(ids, [101, 100, 102]);
});

test('小写化与标点独立', () => {
  assert.deepEqual(tok.tokenize('HELLO。'), ['hello', '。']);
});

test('maxLength 截断保留 CLS/SEP', () => {
  const { ids } = tok.encode('你'.repeat(100));
  assert.equal(ids.length, 16);
  assert.equal(ids[0], 101);
  assert.equal(ids[ids.length - 1], 102);
});

test('mask 与 types 形状一致', () => {
  const { ids, mask, types } = tok.encode('你好');
  assert.equal(mask.length, ids.length);
  assert.equal(types.length, ids.length);
  assert.ok(mask.every((m) => m === 1));
  assert.ok(types.every((t) => t === 0));
});