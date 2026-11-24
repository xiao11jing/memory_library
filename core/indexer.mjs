// 索引重建：从 archive 的 frontmatter 重新生成主题子索引，更新总索引的主题地图。
// 保留人工策划内容：总索引的用户画像/最近动态/使用说明、主题导语与主题描述。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanLibrary } from './scanner.mjs';

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function rebuildIndexes(libDir, { now = new Date(), activity = null } = {}) {
  const { archive } = scanLibrary(libDir);
  const byTopic = new Map();
  for (const e of archive) {
    const t = e.data.topic || '未分类';
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(e);
  }
  const topicsDir = join(libDir, 'index', 'topics');
  mkdirSync(topicsDir, { recursive: true });
  const today = isoDate(now);
  const summaries = [];
  for (const [topic, items] of [...byTopic.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
    items.sort((a, b) => String(b.data.created ?? '').localeCompare(String(a.data.created ?? '')));
    const file = join(topicsDir, `${topic}.md`);
    let intro = `> 共 ${items.length} 条。`;
    if (existsSync(file)) {
      const m = readFileSync(file, 'utf8').match(/^> .*$/m);
      if (m) intro = m[0].replace(/共 \d+ 条/, `共 ${items.length} 条`);
    }
    const entries = items.map((e) => {
      const title = e.data.title ?? e.relPath.split('/').pop();
      const created = e.data.created ?? '未知日期';
      const summary = e.data.summary ?? '';
      const tags = Array.isArray(e.data.tags) ? e.data.tags.join('、') : '';
      return `- **[${title}](../../${e.relPath})**（${created}）\n  ${summary}${tags ? ` 关键词：${tags}` : ''}`;
    }).join('\n\n');
    writeFileSync(file, `---\ntype: topic-index\ntopic: ${JSON.stringify(topic)}\nupdated: ${today}\n---\n\n# ${topic}\n\n${intro}\n\n## 内容列表（新到旧）\n\n${entries}\n`);
    summaries.push({ topic, count: items.length });
  }

  const masterFile = join(libDir, 'index', '总索引.md');
  if (existsSync(masterFile)) {
    let text = readFileSync(masterFile, 'utf8');
    // 保留旧主题地图里的描述文字，只更新条数与链接
    const oldDesc = new Map();
    for (const m of text.matchAll(/- \[([^\]]+)\]\(topics\/[^)]+\)（\d+ 条）：([^\n]*)/g)) oldDesc.set(m[1], m[2]);
    const mapLines = summaries.map((s) => `- [${s.topic}](topics/${s.topic}.md)（${s.count} 条）${oldDesc.has(s.topic) ? '：' + oldDesc.get(s.topic) : ''}`).join('\n');
    text = text.replace(/updated: [^\n]*/, `updated: ${today}`);
    if (/## 主题地图\n/.test(text)) {
      text = text.replace(/(## 主题地图\n)[\s\S]*?(?=\n## |$)/, `$1\n${mapLines}\n`);
    }
    if (activity && /## 最近动态\n/.test(text)) {
      text = text.replace(/(## 最近动态\n)/, `$1\n- ${today}：${activity}\n`);
    }
    writeFileSync(masterFile, text);
  } else {
    const mapLines = summaries.map((s) => `- [${s.topic}](topics/${s.topic}.md)（${s.count} 条）`).join('\n');
    writeFileSync(masterFile, `---\ntype: master-index\nupdated: ${today}\n---\n\n# 总索引\n\n> 任何 AI 在本记忆库工作前，先读本文件。\n\n## 用户画像\n\n（待整理。）\n\n## 主题地图\n\n${mapLines}\n\n## 最近动态\n\n- ${today}：记忆库索引建立。\n\n## 使用说明\n\n- 检索路径：主题地图 → topics/ 子索引 → 原文\n`);
  }
  return { topics: summaries.length, entries: archive.length };
}