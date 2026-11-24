// 协议级集成测试：真实 MCP client 经 stdio 连服务进程，list/call 四工具 + 越界拒绝
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'memmcp-srv-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

test('MCP stdio 协议：四工具可列可调，越界 read 返回 isError', async () => {
  const lib = mkdtempSync(join(tmp, 'lib-'));
  for (const d of ['inbox', 'archive/notes', 'index']) mkdirSync(join(lib, d), { recursive: true });
  writeFileSync(join(lib, 'index', '总索引.md'), '# 总索引\n\n画像。');
  writeFileSync(join(lib, 'archive', 'notes', 'n.md'), '---\ntitle: "种子笔记"\n---\n正文关键词甲');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'mcp', 'server.mjs'), lib],
  });
  const client = new Client({ name: 'integration-test', version: '0.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['memory_add', 'memory_overview', 'memory_read', 'memory_search']);

    const ov = await client.callTool({ name: 'memory_overview', arguments: {} });
    assert.match(ov.content[0].text, /# 总索引/);

    const sr = await client.callTool({ name: 'memory_search', arguments: { query: '关键词甲' } });
    assert.match(sr.content[0].text, /种子笔记/);
    assert.match(sr.content[0].text, /archive\/notes\/n\.md/);

    const rd = await client.callTool({ name: 'memory_read', arguments: { path: 'archive/notes/n.md' } });
    assert.match(rd.content[0].text, /正文关键词甲/);

    const bad = await client.callTool({ name: 'memory_read', arguments: { path: '../escape.md' } });
    assert.equal(bad.isError, true);

    const ad = await client.callTool({ name: 'memory_add', arguments: { content: '# 新记忆', title: '集成测试' } });
    assert.match(ad.content[0].text, /inbox/);
    assert.equal(readdirSync(join(lib, 'inbox')).length, 1);
  } finally {
    await client.close();
  }
});