import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadModel } from './download-model.mjs';
import { MODEL_FILES, MODEL_ID } from '../core/embedder.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'memdl-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const okRes = (buf) => ({ ok: true, headers: { get: () => String(buf.length) }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });

test('下载四个文件落盘，二次调用跳过', async () => {
  const dir = mkdtempSync(join(tmp, 'm-'));
  let calls = 0;
  const fetchImpl = async () => { calls++; return okRes(Buffer.from('x')); };
  const r1 = await downloadModel({ modelDir: dir, fetchImpl });
  assert.equal(calls, MODEL_FILES.length);
  assert.ok(r1.files.every((f) => f.status === 'done'));
  for (const f of MODEL_FILES) assert.ok(existsSync(join(dir, MODEL_ID, f)));
  assert.ok(!existsSync(join(dir, MODEL_ID, MODEL_FILES[0]) + '.part'));
  const r2 = await downloadModel({ modelDir: dir, fetchImpl });
  assert.equal(calls, MODEL_FILES.length); // 未新增请求
  assert.ok(r2.files.every((f) => f.status === 'skip'));
});

test('force 重下；首镜像失败自动兜底', async () => {
  const dir = mkdtempSync(join(tmp, 'm2-'));
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.startsWith('https://hf-mirror.com')) return { ok: false, status: 503, headers: { get: () => '0' } };
    return okRes(Buffer.from('mirror2'));
  };
  await downloadModel({ modelDir: dir, fetchImpl });
  assert.equal(calls, MODEL_FILES.length * 2);
  assert.equal(readFileSync(join(dir, MODEL_ID, 'config.json'), 'utf8'), 'mirror2');
  const before = calls;
  await downloadModel({ modelDir: dir, fetchImpl, force: true });
  assert.ok(calls > before);
});

test('两镜像都失败抛错且不留下半成品', async () => {
  const dir = mkdtempSync(join(tmp, 'm3-'));
  const fetchImpl = async () => { throw new Error('断网'); };
  await assert.rejects(() => downloadModel({ modelDir: dir, fetchImpl }), /下载失败/);
  assert.ok(!existsSync(join(dir, MODEL_ID, 'config.json')));
});