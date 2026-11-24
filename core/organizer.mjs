// AI 整理器：inbox → 调 API 分类摘要 → 字节级注入元数据 → 归档 → 重建索引 → 写 journal。
// 原文正文零改动（injectFields 只插入）；单文件失败不中断整体。
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname, relative } from 'node:path';
import { scanLibrary } from './scanner.mjs';
import { parseFrontmatter, injectFields, serializeFrontmatter } from './frontmatter.mjs';
import { rebuildIndexes } from './indexer.mjs';
import { createApiClient } from './api-client.mjs';

const SYSTEM = `你是个人记忆库的整理员。阅读用户提供的内容，输出严格的 JSON（不要 markdown 围栏、不要多余文字）：
{"topic":"主题名","tags":["关键词1","关键词2","关键词3"],"summary":"一两句话摘要"}
要求：
- topic 优先从给定主题列表中选择；内容明显不属于任何现有主题时可新建简短主题名
- tags 为 3-6 个中文关键词
- summary 用中文写"做了什么/决定了什么/学到了什么，结果如何"，不要空话，内部不要出现英文双引号`;

function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtTime(d) { return `${isoDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// 长文取头尾拼接，保证摘要能看到开头需求与结尾结果
function excerpt(body, max = 12000) {
  if (body.length <= max) return body;
  return body.slice(0, 8000) + '\n\n[……中间部分省略……]\n\n' + body.slice(-4000);
}

// 来源 → 归档目录映射：与库内既有结构保持一致（archive/conversations/deepseek/）
const SOURCE_DIRS = { 'deepseek-harness': 'deepseek' };

// 文件夹整理：根目录文档优先序（项目说明类最能代表一个作品文件夹）
const DOC_PRIORITY = ['project.md', 'readme.md', 'agents.md', '提示词.md'];

function folderDocs(dir) {
  const docs = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && ['.md', '.txt'].includes(extname(e.name).toLowerCase()))
    .map((e) => join(dir, e.name))
    .sort((a, b) => {
      const pa = DOC_PRIORITY.indexOf(basename(a).toLowerCase());
      const pb = DOC_PRIORITY.indexOf(basename(b).toLowerCase());
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb) || a.localeCompare(b, 'zh');
    });
  return docs.slice(0, 6);
}

function treeOverview(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.name !== '.gitkeep')
    .slice(0, 40)
    .map((e) => (e.isDirectory() ? e.name + '/' : e.name))
    .join('\n');
}

// 文件夹 → 整体移入 archive/files/（原件零改动）+ 生成摘要笔记代表索引
async function organizeFolder({ p, name, libDir, client, topics, now, stats, onProgress }) {
  const docs = folderDocs(p);
  const excerpts = docs.map((d) => {
    const text = readFileSync(d, 'utf8');
    const parsed = parseFrontmatter(text);
    const body = parsed ? parsed.body : text;
    return `### ${basename(d)}\n${body.slice(0, 1500)}`;
  }).join('\n\n');
  const overview = treeOverview(p);
  const user = `现有主题列表：${topics.join('、') || '（空）'}\n\n待整理内容（作品文件夹 ${name}，根目录文档 ${docs.length} 份）：\n${excerpts || '（无根目录文档）'}\n\n目录概览：\n${overview}`;
  const result = await client.chatJson(SYSTEM, user);
  if (!result || typeof result.topic !== 'string' || !result.topic.trim()) throw new Error('返回缺少有效 topic');
  const topic = result.topic.trim();
  const tags = Array.isArray(result.tags) ? result.tags.map(String).slice(0, 6) : [];
  const summary = String(result.summary ?? '').replaceAll('"', "'").slice(0, 300);

  const filesDir = join(libDir, 'archive', 'files');
  mkdirSync(filesDir, { recursive: true });
  const dest = uniqueDest(filesDir, name);
  renameSync(p, dest); // 同盘 rename：瞬间完成，原件字节不动
  // 嵌套 .git 会被外层 git 当嵌入仓库（gitlink）致内容不入库：改名保留历史字节，改回即恢复
  let gitNote = '';
  if (existsSync(join(dest, '.git'))) {
    renameSync(join(dest, '.git'), join(dest, '.git-original'));
    gitNote = '\n\n> 项目 git 历史保存为 `.git-original/`（改回 `.git` 即恢复仓库）。';
  }

  const notesDir = join(libDir, 'archive', 'notes');
  mkdirSync(notesDir, { recursive: true });
  const notePath = uniqueDest(notesDir, name + '.md');
  const rel = relative(notesDir, dest).replaceAll('\\', '/');
  const fm = serializeFrontmatter({
    type: 'note',
    title: name,
    created: isoDate(new Date(statSync(dest).mtimeMs)),
    added: isoDate(now),
    topic, tags, summary,
    source: 'folder',
  });
  const body = `# ${name}\n\n${summary}\n\n## 原件位置\n\n[${name}/](${rel}/)（整体归档，字节零改动）${gitNote}\n\n## 关键文档摘录\n\n${excerpts || '（无根目录文档）'}\n\n## 目录概览\n\n${overview}\n`;
  writeFileSync(notePath, fm + body);

  stats.organized++;
  stats.details.push({ file: name + '/', action: `文件夹归档到 archive/files/${basename(dest)}，摘要笔记 ${basename(notePath)}`, topic });
  onProgress({ file: name + '/', topic });
}

function uniqueDest(destDir, name) {
  let dest = join(destDir, name);
  if (!existsSync(dest)) return dest;
  const ext = extname(name);
  const stem = basename(name, ext);
  for (let i = 1; ; i++) {
    dest = join(destDir, `${stem}-${i}${ext}`);
    if (!existsSync(dest)) return dest;
  }
}

function writeJournal(libDir, stats, now) {
  const dir = join(libDir, 'journal');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${isoDate(now)}-整理.md`);
  const lines = [`\n## ${fmtTime(now)} 整理（${stats.organized} 归档 / ${stats.skipped} 跳过 / ${stats.failed} 失败）\n`];
  for (const d of stats.details) lines.push(`- ${d.file}：${d.action}${d.topic ? `（${d.topic}）` : ''}`);
  if (existsSync(file)) appendFileSync(file, lines.join('\n') + '\n');
  else writeFileSync(file, `---\ntype: journal\ndate: ${isoDate(now)}\n---\n\n# ${isoDate(now)} 整理日志\n${lines.join('\n')}\n`);
}

export async function organizeLibrary({ libDir, config, fetchImpl, now = new Date(), onProgress = () => {} }) {
  const client = createApiClient({ baseUrl: config.apiBaseUrl, apiKey: config.apiKey, model: config.model, fetchImpl });
  const { topics } = scanLibrary(libDir);
  const stats = { organized: 0, skipped: 0, failed: 0, details: [] };
  const textExts = new Set(['.md', '.txt']);

  // 直接列 inbox 顶层全部条目：文件按文本/非文本处理，文件夹整体整理（不再无声忽略）
  const inboxDir = join(libDir, 'inbox');
  const items = existsSync(inboxDir)
    ? readdirSync(inboxDir, { withFileTypes: true })
        .filter((e) => e.name !== '.gitkeep')
        .map((e) => ({ path: join(inboxDir, e.name), name: e.name, isDir: e.isDirectory() }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    : [];

  for (const { path: p, name, isDir } of items) {
    if (isDir) {
      try {
        await organizeFolder({ p, name, libDir, client, topics, now, stats, onProgress });
      } catch (err) {
        stats.failed++;
        stats.details.push({ file: name + '/', action: `失败：${err.message}` });
      }
      continue;
    }
    const ext = extname(p).toLowerCase();
    if (!textExts.has(ext)) {
      stats.skipped++;
      stats.details.push({ file: name, action: '跳过（非文本文件，请手动归档）' });
      continue;
    }
    try {
      const text = readFileSync(p, 'utf8');
      const parsed = parseFrontmatter(text);
      const body = parsed ? parsed.body : text;
      const user = `现有主题列表：${topics.join('、') || '（空）'}\n\n待整理内容（文件名 ${name}）：\n${excerpt(body)}`;
      const result = await client.chatJson(SYSTEM, user);
      if (!result || typeof result.topic !== 'string' || !result.topic.trim()) throw new Error('返回缺少有效 topic');
      const topic = result.topic.trim();
      const tags = Array.isArray(result.tags) ? result.tags.map(String).slice(0, 6) : [];
      const summary = String(result.summary ?? '').replaceAll('"', "'").slice(0, 300);

      // 无 frontmatter 的裸文件：先补基础元数据；.txt 归档时转为 .md
      let newText = text;
      if (!parsed) {
        newText = serializeFrontmatter({
          type: 'note',
          title: basename(p, ext),
          created: isoDate(new Date(statSync(p).mtimeMs)),
          added: isoDate(now),
        }) + text;
      }
      newText = injectFields(newText, { topic, tags, summary });

      const type = parsed?.data?.type;
      const source = parsed?.data?.source;
      const sourceDir = SOURCE_DIRS[source] ?? String(source || 'other').replace(/[^\w-]/g, '_');
      const sub = type === 'conversation' ? join('conversations', sourceDir) : 'notes';
      const destDir = join(libDir, 'archive', sub);
      mkdirSync(destDir, { recursive: true });
      const destName = ext === '.txt' ? basename(p, ext) + '.md' : name;
      const dest = uniqueDest(destDir, destName);

      writeFileSync(p, newText);
      renameSync(p, dest);
      stats.organized++;
      stats.details.push({ file: name, action: `归档到 archive/${sub.replaceAll('\\', '/')}`, topic });
      onProgress({ file: name, topic });
    } catch (err) {
      stats.failed++;
      stats.details.push({ file: name, action: `失败：${err.message}` });
    }
  }

  if (stats.organized > 0) {
    rebuildIndexes(libDir, { now, activity: `AI 整理 ${stats.organized} 条内容入库` });
  }
  writeJournal(libDir, stats, now);
  return stats;
}