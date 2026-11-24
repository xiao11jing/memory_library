// 本地 embedding：onnxruntime-node 跑 bge-small-zh-v1.5 int8 量化模型，纯 CPU、用完即释放。
// 模型放在本机应用数据目录（%APPDATA%/记忆库/models），不入库、不进 git；缺失时上层自动退回关键词检索。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import ort from 'onnxruntime-node';
import { createTokenizer } from './tokenizer.mjs';

export const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
export const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

export function defaultModelDir() {
  if (process.env.MEMORY_MODEL_DIR) return process.env.MEMORY_MODEL_DIR;
  const base = process.env.APPDATA ? join(process.env.APPDATA, '记忆库') : join(homedir(), '.local', 'share', '记忆库');
  return join(base, 'models');
}

export function modelReady(modelDir = defaultModelDir()) {
  return MODEL_FILES.every((f) => existsSync(join(modelDir, MODEL_ID, f)));
}

// 返回 {embed(texts)->number[][], dispose()}；CLS pooling + L2 归一化（bge 约定）。
// threads 默认 2：低配机留余量，避免建索引时整机卡顿（4 线程实测仅快 ~25%）。
export async function createEmbedder({ modelDir = defaultModelDir(), maxLength = 512, batchSize = 8, threads = 2 } = {}) {
  if (!modelReady(modelDir)) throw new Error(`语义模型未下载（${join(modelDir, MODEL_ID)}），请先在设置页下载或运行 scripts/download-model.mjs`);
  const dir = join(modelDir, MODEL_ID);
  const tokenizerJson = JSON.parse(readFileSync(join(dir, 'tokenizer.json'), 'utf8'));
  let lowerCase = true;
  try { lowerCase = JSON.parse(readFileSync(join(dir, 'tokenizer_config.json'), 'utf8')).do_lower_case !== false; } catch { /* 默认小写 */ }
  const tok = createTokenizer(tokenizerJson, { lowerCase, maxLength });
  const session = await ort.InferenceSession.create(join(dir, 'onnx', 'model_quantized.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: threads });
  const inputNames = session.inputNames;
  const outputName = session.outputNames[0];

  async function embed(texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    const out = [];
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize).map((t) => tok.encode(t));
      const L = Math.max(...batch.map((b) => b.ids.length));
      const n = batch.length;
      const ids = new BigInt64Array(n * L);
      const mask = new BigInt64Array(n * L);
      const types = new BigInt64Array(n * L);
      batch.forEach((b, r) => {
        for (let c = 0; c < b.ids.length; c++) {
          ids[r * L + c] = BigInt(b.ids[c]);
          mask[r * L + c] = 1n;
        }
      });
      const feed = {};
      if (inputNames.includes('input_ids')) feed.input_ids = new ort.Tensor('int64', ids, [n, L]);
      if (inputNames.includes('attention_mask')) feed.attention_mask = new ort.Tensor('int64', mask, [n, L]);
      if (inputNames.includes('token_type_ids')) feed.token_type_ids = new ort.Tensor('int64', types, [n, L]);
      const res = await session.run(feed);
      const hidden = res[outputName];
      const H = hidden.dims[2];
      for (let r = 0; r < n; r++) {
        const cls = hidden.data.subarray(r * L * H, r * L * H + H);
        let norm = 0;
        for (const x of cls) norm += x * x;
        norm = Math.sqrt(norm) || 1;
        out.push(Array.from(cls, (x) => x / norm));
      }
    }
    return out;
  }

  return { embed, dispose: () => session.release() };
}

// 温缓存：搜索等高频短操作共享会话，免每次 ~0.7s 加载；闲置 idleMs 后释放内存（低配机友好）。
let warm = null;
let warmKey = '';
let warmTimer = null;
function disposeWarm() {
  if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
  if (warm) { warm.dispose(); warm = null; warmKey = ''; }
}
export async function warmEmbedder(opts = {}) {
  const idleMs = opts.idleMs ?? 60000;
  const key = JSON.stringify([opts.modelDir ?? defaultModelDir(), opts.maxLength ?? 512, opts.threads ?? 2]);
  if (!warm || warmKey !== key) {
    disposeWarm();
    warm = await createEmbedder(opts);
    warmKey = key;
  }
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(disposeWarm, idleMs);
  warmTimer.unref?.();
  return warm;
}
export function disposeWarmEmbedder() { disposeWarm(); }