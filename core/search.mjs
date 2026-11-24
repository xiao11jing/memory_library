// 混合检索：关键词（子串 AND + 字段加权）与语义（本地向量余弦）两路，RRF 融合排序。
// 语义路依赖 库/.cache/vectors.json 与本机模型；任一缺失自动退回纯关键词，搜索永远可用。
import { readFileSync } from 'node:fs';
import { scanLibrary } from './scanner.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import { loadVectorIndex, cosine } from './vector-index.mjs';
import { warmEmbedder, modelReady, defaultModelDir } from './embedder.mjs';

const WEIGHTS = { title: 10, tags: 8, summary: 5, topic: 3, body: 1 };
export const SEMANTIC_MIN_SIM = 0.45; // 余弦下限：真实库实测相关命中 ≥0.58、无关对照 ≤0.41
const RRF_K = 60;

function keywordRank(entries, tokens) {
  const results = [];
  for (const e of entries) {
    const text = readFileSync(e.path, 'utf8');
    const fm = parseFrontmatter(text);
    const body = fm ? fm.body : text;
    const fields = {
      title: String(e.data.title ?? '').toLowerCase(),
      tags: (Array.isArray(e.data.tags) ? e.data.tags : []).join(' ').toLowerCase(),
      summary: String(e.data.summary ?? '').toLowerCase(),
      topic: String(e.data.topic ?? '').toLowerCase(),
      body: body.toLowerCase(),
    };
    let score = 0;
    let allMatched = true;
    let firstBodyHit = -1;
    for (const t of tokens) {
      let hit = 0;
      for (const [name, weight] of Object.entries(WEIGHTS)) {
        const hay = fields[name];
        const idx = hay.indexOf(t);
        if (idx === -1) continue;
        hit += weight;
        if (name === 'body') {
          if (firstBodyHit === -1) firstBodyHit = idx;
          let count = 0;
          let i = idx;
          while (i !== -1 && count < 5) { count++; i = hay.indexOf(t, i + t.length); }
          hit += count - 1; // 正文多次命中适度加分，封顶 5 次
        }
      }
      if (hit === 0) { allMatched = false; break; }
      score += hit;
    }
    if (!allMatched) continue;
    let snippet;
    if (firstBodyHit !== -1) {
      const start = Math.max(0, firstBodyHit - 40);
      snippet = (start > 0 ? '…' : '') + body.slice(start, firstBodyHit + 80).replace(/\s+/g, ' ').trim();
    } else {
      snippet = String(e.data.summary ?? '').slice(0, 100);
    }
    results.push({
      relPath: e.relPath,
      path: e.path,
      title: e.data.title ?? e.relPath.split('/').pop(),
      topic: e.data.topic ?? '',
      created: e.data.created ?? '',
      location: e.location,
      score,
      snippet,
    });
  }
  results.sort((a, b) => b.score - a.score || String(b.created).localeCompare(String(a.created)));
  return results;
}

export async function searchLibrary(libDir, query, { limit = 20, semantic = true, embedder = null, modelDir = defaultModelDir(), vectorIndex = null } = {}) {
  const tokens = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const { entries } = scanLibrary(libDir);
  const kw = keywordRank(entries, tokens);

  let vec = [];
  const idx = vectorIndex ?? loadVectorIndex(libDir);
  if (semantic && idx && Object.keys(idx.docs).length > 0) {
    let emb = embedder;
    if (!emb && modelReady(modelDir)) emb = await warmEmbedder({ modelDir });
    if (emb) {
      const [qv] = await emb.embed([tokens.join(' ')]);
      for (const [relPath, doc] of Object.entries(idx.docs)) {
        let best = -1, bestChunk = null;
        for (const c of doc.chunks) {
          const s = cosine(qv, c.v);
          if (s > best) { best = s; bestChunk = c; }
        }
        if (best >= SEMANTIC_MIN_SIM) vec.push({ relPath, sim: best, chunk: bestChunk });
      }
      vec.sort((a, b) => b.sim - a.sim);
      vec = vec.slice(0, 40);
    }
  }

  if (vec.length === 0) return kw.slice(0, limit).map((r) => ({ ...r, via: 'keyword' }));

  // RRF 融合：两路排名倒数相加，语义独命中也能进结果
  const byPath = new Map();
  kw.forEach((r, i) => byPath.set(r.relPath, { ...r, kwRank: i + 1 }));
  vec.forEach((v, i) => {
    const cur = byPath.get(v.relPath);
    if (cur) { cur.vecRank = i + 1; cur.sim = v.sim; return; }
    const e = entries.find((x) => x.relPath === v.relPath);
    if (!e) return;
    byPath.set(v.relPath, {
      relPath: e.relPath,
      path: e.path,
      title: e.data.title ?? e.relPath.split('/').pop(),
      topic: e.data.topic ?? '',
      created: e.data.created ?? '',
      location: e.location,
      snippet: v.chunk.text.replace(/\s+/g, ' ').trim().slice(0, 120),
      vecRank: i + 1,
      sim: v.sim,
    });
  });
  const fused = [...byPath.values()].map((r) => ({
    ...r,
    score: Math.round(((r.kwRank ? 1 / (RRF_K + r.kwRank) : 0) + (r.vecRank ? 1 / (RRF_K + r.vecRank) : 0)) * 10000) / 10000,
    via: r.kwRank && r.vecRank ? 'both' : r.kwRank ? 'keyword' : 'semantic',
  }));
  fused.sort((a, b) => b.score - a.score || String(b.created).localeCompare(String(a.created)));
  // 库内可能存在同内容副本（对话导出+笔记）：同标题同片段只留排名最高的一条
  const seen = new Set();
  const dedup = [];
  for (const r of fused) {
    const key = r.title + '|' + r.snippet;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(r);
  }
  return dedup.slice(0, limit);
}