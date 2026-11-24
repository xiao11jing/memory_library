import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from './api-client.mjs';

// 全部使用注入的 mock fetch：不发真实网络请求，并断言请求只发往配置的官方地址。
const okResponse = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
function fakeFetch(response) {
  const calls = [];
  return { calls, impl: async (url, opts) => { calls.push({ url, opts }); return response; } };
}
const cfg = { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'deepseek-chat' };

test('请求发往配置的官方地址，带鉴权头与模型参数', async () => {
  const { calls, impl } = fakeFetch(okResponse('{"topic":"X"}'));
  const client = createApiClient({ ...cfg, fetchImpl: impl });
  const result = await client.chatJson('sys', 'user');
  assert.deepEqual(result, { topic: 'X' });
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer sk-test');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].content, 'user');
});

test('baseUrl 尾部斜杠归一化', async () => {
  const { calls, impl } = fakeFetch(okResponse('{}'));
  const client = createApiClient({ ...cfg, baseUrl: 'https://api.deepseek.com/v1/', fetchImpl: impl });
  await client.chatJson('s', 'u');
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
});

test('容忍 markdown 围栏包裹的 JSON', async () => {
  const { impl } = fakeFetch(okResponse('```json\n{"a":1}\n```'));
  const client = createApiClient({ ...cfg, fetchImpl: impl });
  assert.deepEqual(await client.chatJson('s', 'u'), { a: 1 });
});

test('非 200 响应抛出含状态码的错误', async () => {
  const impl = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  const client = createApiClient({ ...cfg, fetchImpl: impl });
  await assert.rejects(() => client.chatJson('s', 'u'), /API 请求失败（401）/);
});

test('缺少 key 时明确报错', async () => {
  const { impl } = fakeFetch(okResponse('{}'));
  const client = createApiClient({ ...cfg, apiKey: '', fetchImpl: impl });
  await assert.rejects(() => client.chatJson('s', 'u'), /缺少 API key/);
});

test('无效 JSON 抛出可读错误', async () => {
  const { impl } = fakeFetch(okResponse('不是JSON'));
  const client = createApiClient({ ...cfg, fetchImpl: impl });
  await assert.rejects(() => client.chatJson('s', 'u'), /未返回有效 JSON/);
});

test('缺少 baseUrl 直接抛错', () => {
  assert.throws(() => createApiClient({ ...cfg, baseUrl: '' }), /缺少 API 地址/);
});