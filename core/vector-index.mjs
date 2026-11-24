// 向量索引：archive 正文切块后 embedding，存 库/.cache/vectors.json（派生缓存，gitignore）。
// 低配机友好：按内容哈希增量复用；每文档落盘 checkpoint，可中断续建；块级进度回调。
// 模型缺失时返回 no-model，不破坏关键词检索。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { scanLibrary } from './scanner.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { chunkBody } from './chunker.mjs';
import { createEmbedder, modelReady, defaultModelDir, MODEL_ID } from './embedder.mjs';

export const VECTOR_REL = join('.cache', 'vectors.json');
const round4 = (v) => v.map((x) => Math.round(x * 1e4) / 1e4);
const pad = (n) => String(n).padStart(2, '0');
const BATCH = 16; // 每批块数：批间回调进度/检查中断

export function loadVectorIndex(libDir) {
  const file = join(libDir, VECTOR_REL);
  if (!existsSync(file)) return null;
  try {
    const idx = JSON.parse(readFileSync(file, 'utf8'));
    if (idx && idx.version === 1 && idx.docs && typeof idx.docs === 'object') return idx;
  } catch { /* 损坏视为无索引 */ }
  return null;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function updateVectorIndex(libDir, { modelDir = defaultModelDir(), embedder = null, onProgress = null, shouldStop = null, now = new Date() } = {}) {
  const old = loadVectorIndex(libDir) || { docs: {} };
  const { archive } = scanLibrary(libDir);
  const valid = new Set(archive.map((e) => e.relPath));
  const docs = Object.fromEntries(Object.entries(old.docs).filter(([k]) => valid.has(k)));
  let dim = old.dim || 0;

  // 阶段一：切块与复用判定（不推理），得到全局块总数供进度条
  const plan = [];
  let totalChunks = 0;
  for (const e of archive) {
    const raw = readFileSync(e.path, 'utf8');
    const fm = parseFrontmatter(raw);
    const body = fm ? fm.body : raw;
    const title = e.data.title ?? e.relPath.split('/').pop();
    const topic = e.data.topic ?? '';
    const hash = createHash('sha1').update(title + ' ' + topic + ' ' + body).digest('hex');
    const prev = old.docs[e.relPath];
    const reuse = prev && prev.hash === hash;
    const cs = reuse ? null : chunkBody(body);
    const n = reuse ? prev.chunks.length : cs.length;
    totalChunks += n;
    plan.push({ e, title, topic, hash, prev, reuse, cs, n });
  }

  const file = join(libDir, VECTOR_REL);
  mkdirSync(join(libDir, '.cache'), { recursive: true });
  const updated = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const checkpoint = () => writeFileSync(file, JSON.stringify({ version: 1, model: MODEL_ID, dim, updated, docs }));

  let embed = embedder;
  let own = false;
  let embedded = 0, chunkDone = 0, done = 0;
  const finish = (status) => {
    checkpoint();
    if (own) embed.dispose();
    return { status, docs: Object.keys(docs).length, chunks: Object.values(docs).reduce((s, d) => s + d.chunks.length, 0), embedded, totalChunks };
  };

  for (const p of plan) {
    if (shouldStop?.()) return finish('stopped');
    if (p.reuse) {
      docs[p.e.relPath] = p.prev;
    } else if (p.cs.length > 0) {
      if (!embed) {
        if (!modelReady(modelDir)) return { status: 'no-model', docs: Object.keys(docs).length, totalChunks };
        embed = await createEmbedder({ modelDir });
        own = true;
      }
      const vecs = [];
      for (let i = 0; i < p.cs.length; i += BATCH) {
        if (shouldStop?.()) { // 文档内中断：已算的块先落盘成部分文档？不——整文档未完成则不写，续建重算该文档
          return finish('stopped');
        }
        const group = p.cs.slice(i, i + BATCH);
        const gv = await embed.embed(group.map((c) => p.title + (p.topic ? ' / ' + p.topic : '') + '\n' + c.text));
        vecs.push(...gv);
        chunkDone += group.length;
        onProgress?.({ done, total: archive.length, relPath: p.e.relPath, chunkDone, totalChunks });
      }
      docs[p.e.relPath] = {
        hash: p.hash, title: p.title, topic: p.topic,
        chunks: p.cs.map((c, i) => ({ start: c.start, text: c.text, v: round4(vecs[i]) })),
      };
      dim = vecs[0].length;
      embedded += p.cs.length;
    }
    done++;
    checkpoint(); // 每文档落盘：中断/崩溃后可续建
    onProgress?.({ done, total: archive.length, relPath: p.e.relPath, chunkDone, totalChunks });
  }
  return finish('ok');
}