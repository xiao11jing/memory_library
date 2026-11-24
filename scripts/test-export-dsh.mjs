// export-dsh.mjs 的测试：node --test scripts/test-export-dsh.mjs
// 用合成会话样本（逐行压缩成多帧 zstd，模拟 DSH 追加写入）验证导出逻辑。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zstdCompressSync } from 'node:zlib';
import { decompressFrames, parseSession, toMarkdown, exportAll } from './export-dsh.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'dsh-export-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// ---- 合成样本工具 ----
let seqCounter = 0;
const header = (id, createdAt = 1789351182292) => ({ type: 'session', version: 4, id, createdAt, cwd: 'D:\\test\\proj', agentPreset: 'code' });
const userMsg = (text, kind = 'user') => ({ type: 'user/message', seq: seqCounter++, time: 1789351182292 + seqCounter * 1000, data: { role: 'user', id: `u-${seqCounter}`, source: { kind }, content: [{ type: 'text', text }] } });
const asstMsg = (text, extra = []) => ({ type: 'assistant/message', seq: seqCounter++, time: 1789351182292 + seqCounter * 1000, data: { message: { role: 'assistant', id: `a-${seqCounter}`, content: [...extra, { type: 'text', text }] } } });
const titleEvt = (title) => ({ type: 'session/title', seq: seqCounter++, time: 1789351182292, data: { title } });
const modelEvt = (provider, model) => ({ type: 'request/context', seq: seqCounter++, time: 1789351182292, data: { provider, model } });

function writeSession(sourceDir, name, events, { v4 = false } = {}) {
  const sd = join(sourceDir, 'ws-test', name);
  mkdirSync(sd, { recursive: true });
  const fname = v4 ? 'session.v4.jsonl.zstd' : 'session.jsonl.zstd';
  const frames = events.map((e) => zstdCompressSync(Buffer.from(JSON.stringify(e) + '\n')));
  writeFileSync(join(sd, fname), Buffer.concat(frames));
  return sd;
}

// ---- 测试 ----
test('多帧 zstd 解压还原完整内容', () => {
  const lines = Array.from({ length: 50 }, (_, i) => JSON.stringify({ i, text: `第${i}行` }) + '\n');
  const buf = Buffer.concat(lines.map((l) => zstdCompressSync(Buffer.from(l))));
  assert.equal(decompressFrames(buf), lines.join(''));
});

test('解析：过滤系统注入消息与工具/推理噪音，保留真实对话', () => {
  seqCounter = 0;
  const events = [
    header('session-abc12345-0000-0000-0000-000000000000'),
    titleEvt('测试会话标题'),
    modelEvt('xiaomi', 'mimo-v2.5'),
    userMsg('系统注入应被过滤', 'plugin'),
    userMsg('审批通知应被过滤', 'user-approval'),
    userMsg('真实用户问题'),
    asstMsg('真实助手回答', [{ type: 'reasoning', text: '推理噪音' }, { type: 'tool-call', id: 't1', name: 'run_code', arguments: '{}' }]),
    { type: 'tool/result', seq: seqCounter++, time: 1789351182292, data: {} },
  ];
  const parsed = parseSession(events.map((e) => JSON.stringify(e)).join('\n'));
  assert.equal(parsed.title, '测试会话标题');
  assert.deepEqual(parsed.models, ['xiaomi/mimo-v2.5']);
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages[0].role, 'user');
  assert.equal(parsed.messages[0].text, '真实用户问题');
  assert.equal(parsed.messages[1].text, '真实助手回答');
});

test('导出：生成带 frontmatter 的 Markdown，空会话被跳过', () => {
  const sourceDir = join(tmp, 'src1');
  const outDir = join(tmp, 'out1');
  const stateFile = join(tmp, 'state1.json');
  seqCounter = 0;
  writeSession(sourceDir, 'session-real', [
    header('session-11111111-2222-3333-4444-555555555555'),
    titleEvt('我的第一个会话'),
    userMsg('你好，帮我看看这个问题'),
    asstMsg('好的，我来分析'),
  ], { v4: true });
  writeSession(sourceDir, 'session-empty', [header('session-99999999-0000-0000-0000-000000000000')], { v4: true });
  const stats = exportAll({ sourceDir, outDir, stateFile });
  assert.equal(stats.total, 2);
  assert.equal(stats.exported, 1);
  assert.equal(stats.skippedEmpty, 1);
  const files = readdirSync(outDir).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^dsh-\d{8}-11111111\.md$/);
  const md = readFileSync(join(outDir, files[0]), 'utf8');
  assert.match(md, /type: conversation/);
  assert.match(md, /source: deepseek-harness/);
  assert.match(md, /session_id: "session-11111111-2222-3333-4444-555555555555"/);
  assert.match(md, /title: "我的第一个会话"/);
  assert.match(md, /## 用户 · /);
  assert.match(md, /你好，帮我看看这个问题/);
  assert.match(md, /## 助手 · /);
  assert.match(md, /好的，我来分析/);
});

test('同一会话存在双格式时优先 v4', () => {
  const sourceDir = join(tmp, 'src2');
  const outDir = join(tmp, 'out2');
  seqCounter = 0;
  const id = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  writeSession(sourceDir, id, [header(id), titleEvt('v0旧标题'), userMsg('问题'), asstMsg('回答')]);
  writeSession(sourceDir, id, [header(id), titleEvt('v4新标题'), userMsg('问题'), asstMsg('回答')], { v4: true });
  const stats = exportAll({ sourceDir, outDir, stateFile: join(tmp, 'state2.json') });
  assert.equal(stats.exported, 1);
  const md = readFileSync(join(outDir, readdirSync(outDir)[0]), 'utf8');
  assert.match(md, /v4新标题/);
  assert.doesNotMatch(md, /v0旧标题/);
});

test('增量：未变化不重复导出，源文件更新后重新导出', () => {
  const sourceDir = join(tmp, 'src3');
  const outDir = join(tmp, 'out3');
  const stateFile = join(tmp, 'state3.json');
  seqCounter = 0;
  const id = 'session-bbbbbbbb-0000-0000-0000-000000000000';
  const sd = writeSession(sourceDir, id, [header(id), userMsg('第一问'), asstMsg('第一答')], { v4: true });
  const first = exportAll({ sourceDir, outDir, stateFile });
  assert.equal(first.exported, 1);
  const second = exportAll({ sourceDir, outDir, stateFile });
  assert.equal(second.exported, 0);
  assert.equal(second.skippedUnchanged, 1);
  // 追加一帧新消息并更新 mtime，模拟会话继续
  appendFileSync(join(sd, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(JSON.stringify(userMsg('第二问')) + '\n')));
  const future = new Date(Date.now() + 5000);
  utimesSync(join(sd, 'session.v4.jsonl.zstd'), future, future);
  const third = exportAll({ sourceDir, outDir, stateFile });
  assert.equal(third.exported, 1);
  const md = readFileSync(join(outDir, readdirSync(outDir)[0]), 'utf8');
  assert.match(md, /第二问/);
});

test('损坏文件被跳过且不中断整体导出', () => {
  const sourceDir = join(tmp, 'src4');
  const outDir = join(tmp, 'out4');
  seqCounter = 0;
  const badDir = join(sourceDir, 'ws-test', 'session-bad');
  mkdirSync(badDir, { recursive: true });
  writeFileSync(join(badDir, 'session.v4.jsonl.zstd'), Buffer.from('这不是压缩数据'));
  writeSession(sourceDir, 'session-good', [header('session-cccccccc-0000-0000-0000-000000000000'), userMsg('正常问题'), asstMsg('正常回答')], { v4: true });
  const stats = exportAll({ sourceDir, outDir, stateFile: join(tmp, 'state4.json') });
  assert.equal(stats.failed, 1);
  assert.equal(stats.exported, 1);
});

test('toMarkdown：无标题时回退到首条用户消息摘要', () => {
  seqCounter = 0;
  const parsed = parseSession([header('session-dddddddd-0000-0000-0000-000000000000'), userMsg('这是一个很长很长的问题开头')].map((e) => JSON.stringify(e)).join('\n'));
  const md = toMarkdown(parsed);
  assert.match(md, /# 这是一个很长很长的问题开头/);
});