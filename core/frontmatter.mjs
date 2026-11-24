// Frontmatter 解析与序列化（适配本库受控格式：key: value，字符串 JSON 引号，数组 JSON 风格）
// 核心纪律：注入新字段时保留原始字节（包括混合行尾），只插入、绝不重写。

// 解析文件头部 YAML frontmatter；无 frontmatter 返回 null
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('"') || val.startsWith('[')) {
      try { val = JSON.parse(val); } catch { /* 解析失败则按原字符串保留 */ }
    }
    data[key] = val;
  }
  return { data, body: text.slice(m[0].length), headerRaw: m[0] };
}

// 序列化 frontmatter（全部 JSON 引号风格，与本库现有格式一致）
export function serializeFrontmatter(data) {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

// 字节级保留的字段注入：
// - 有 frontmatter：在结束的 --- 之前插入新字段行，其余字节一律不动
// - 无 frontmatter：在文件顶部 prepend 新块
// - 已存在的字段跳过，避免重复键
export function injectFields(text, fields) {
  const parsed = parseFrontmatter(text);
  if (parsed) {
    const entries = Object.entries(fields).filter(([k]) => !(k in parsed.data));
    if (entries.length === 0) return text;
    const header = parsed.headerRaw;
    const eol = header.startsWith('---\r\n') ? '\r\n' : '\n';
    const closeIdx = header.lastIndexOf('---');
    const block = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}${eol}`).join('');
    return text.slice(0, closeIdx) + block + text.slice(closeIdx);
  }
  const entries = Object.entries(fields);
  if (entries.length === 0) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = serializeFrontmatter(Object.fromEntries(entries)).replaceAll('\n', eol);
  return block + text;
}