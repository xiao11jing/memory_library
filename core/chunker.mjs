// 正文切块：按段落/标题聚合成 ~500 字的块，超长段按句子硬切，过短尾块并入前块。
// 返回 [{text, start}]，start 为块在原文中的字符偏移，供命中片段定位。
export function chunkBody(body, { target = 500, max = 640, min = 80 } = {}) {
  const text = String(body ?? '');
  // 段落扫描：空行分段；标题行独立成段边界
  const paragraphs = [];
  let cur = null;
  let offset = 0;
  for (const line of text.split('\n')) {
    const isBlank = /^\s*$/.test(line);
    const isHead = /^#{1,6}\s/.test(line);
    if (isBlank || isHead) {
      if (cur) { paragraphs.push(cur); cur = null; }
      if (isHead) cur = { text: line, start: offset };
    } else if (cur) {
      cur.text += '\n' + line;
    } else {
      cur = { text: line, start: offset };
    }
    offset += line.length + 1;
  }
  if (cur) paragraphs.push(cur);

  // 超长段落硬切（优先句末边界）
  const pieces = [];
  for (const p of paragraphs) {
    if (p.text.length <= max) { pieces.push(p); continue; }
    let rest = p.text;
    let base = p.start;
    while (rest.length > max) {
      let cut = max;
      const window = rest.slice(0, max);
      const m = window.match(/[。！？!?\n][^。！？!?\n]*$/);
      if (m && m.index > max / 2) cut = m.index + 1;
      pieces.push({ text: rest.slice(0, cut), start: base });
      base += cut;
      rest = rest.slice(cut);
    }
    if (rest) pieces.push({ text: rest, start: base });
  }

  // 聚合到 target
  const chunks = [];
  let acc = null;
  for (const p of pieces) {
    if (acc && acc.text.length + p.text.length + 2 > max) { chunks.push(acc); acc = null; }
    if (acc) acc.text += '\n\n' + p.text;
    else acc = { text: p.text, start: p.start };
    if (acc.text.length >= target) { chunks.push(acc); acc = null; }
  }
  if (acc) chunks.push(acc);
  if (chunks.length > 1 && chunks[chunks.length - 1].text.length < min) {
    const tail = chunks.pop();
    chunks[chunks.length - 1].text += '\n\n' + tail.text;
  }
  return chunks.filter((c) => c.text.trim());
}