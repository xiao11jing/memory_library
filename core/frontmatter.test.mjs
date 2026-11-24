import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter, injectFields } from './frontmatter.mjs';

test('解析：引号字符串、数组、普通值', () => {
  const title = '标题"引号';
  const text = `---\ntype: conversation\ntitle: ${JSON.stringify(title)}\ntags: ["a", "b"]\ncreated: 2026-08-14\n---\n\nbody`;
  const fm = parseFrontmatter(text);
  assert.equal(fm.data.type, 'conversation');
  assert.equal(fm.data.title, title);
  assert.deepEqual(fm.data.tags, ['a', 'b']);
  assert.equal(fm.data.created, '2026-08-14');
  assert.equal(fm.body, '\nbody');
});

test('无 frontmatter 返回 null', () => {
  assert.equal(parseFrontmatter('# 标题\n正文'), null);
});

test('注入：字节级保留（混合行尾正文零改动）', () => {
  const original = '---\ntitle: "t"\n---\n第一行\r\n第二行\r\n第三行\n';
  const injected = injectFields(original, { topic: 'X', tags: ['a'], summary: 's' });
  const back = injected.replace(/^topic: "X"\n|^tags: \["a"\]\n|^summary: "s"\n/gm, '');
  assert.equal(back, original);
});

test('注入：已存在的字段跳过，不产生重复键', () => {
  const original = '---\ntopic: "旧"\n---\nbody';
  const out = injectFields(original, { topic: '新', tags: ['a'] });
  assert.match(out, /topic: "旧"/);
  assert.doesNotMatch(out, /topic: "新"/);
  assert.match(out, /tags: \["a"\]/);
});

test('注入：无 frontmatter 时顶部 prepend，正文不变', () => {
  const original = '裸正文\r\n第二行';
  const out = injectFields(original, { title: 't' });
  assert.ok(out.startsWith('---\r\n'));
  const fm = parseFrontmatter(out);
  assert.equal(fm.data.title, 't');
  assert.equal(fm.body, original);
});

test('注入：CRLF 头部使用 CRLF 插入', () => {
  const original = '---\r\ntitle: "t"\r\n---\r\nbody';
  const out = injectFields(original, { topic: 'X' });
  assert.match(out, /topic: "X"\r\n---/);
});

test('序列化往返一致', () => {
  const data = { type: 'note', title: '标题', tags: ['一', '二'] };
  const fm = parseFrontmatter(serializeFrontmatter(data));
  assert.deepEqual(fm.data, data);
});