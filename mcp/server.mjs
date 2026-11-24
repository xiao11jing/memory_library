#!/usr/bin/env node
// 记忆库 MCP 服务：独立进程、stdio 传输，不依赖 exe 窗口。
// 用法：node mcp/server.mjs [库路径]（或 env MEMORY_LIBRARY_DIR；默认本项目记忆库）
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryOverview, memorySearch, memoryRead, memoryAdd } from './tools.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const libDir = process.argv[2] || process.env.MEMORY_LIBRARY_DIR || join(here, '..', '记忆库');

const server = new McpServer({ name: 'memory-library', version: '0.1.0' });
const text = (s) => ({ content: [{ type: 'text', text: s }] });

server.registerTool('memory_overview', {
  description: '返回记忆库总索引（用户画像 + 主题地图 + 最近动态）。对话开始时先读它认识库主人。',
  inputSchema: {},
}, async () => text(memoryOverview(libDir)));

server.registerTool('memory_search', {
  description: '检索记忆库：关键词（多词 AND）+ 本地语义向量混合排序，返回标题/主题/摘要/命中片段/库内相对路径/via 来源。换说法的同义查询也能命中。',
  inputSchema: {
    query: z.string().describe('查询语句或关键词，多个关键词用空格分隔'),
    limit: z.number().int().min(1).max(50).optional().describe('返回条数上限，默认 20'),
  },
}, async ({ query, limit }) => text(JSON.stringify(await memorySearch(libDir, query, limit ?? 20), null, 2)));

server.registerTool('memory_read', {
  description: '按路径读某条记忆的完整原文（相对库根，如 archive/notes/x.md；越界路径被拒绝）。',
  inputSchema: { path: z.string().describe('库内相对路径或库内绝对路径') },
}, async ({ path }) => text(memoryRead(libDir, path).text));

server.registerTool('memory_add', {
  description: '把值得记的内容写进 inbox（待整理），返回写入路径。整理流程会分类归档并更新索引。',
  inputSchema: {
    content: z.string().describe('Markdown 正文'),
    title: z.string().optional().describe('可选标题，用于文件名 slug'),
  },
}, async ({ content, title }) => text(JSON.stringify(memoryAdd(libDir, content, title))));

await server.connect(new StdioServerTransport());
console.error(`memory-library MCP ready: ${libDir}`); // stderr 不污染 stdio 协议流