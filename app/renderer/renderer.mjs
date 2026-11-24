// 渲染层：视图切换、检索、整理、浏览、设置。全部能力经 preload 桥接，不直接接触 Node。
const $ = (s) => document.querySelector(s);
let currentFile = null;
let lastView = 'home';
let libOpen = false;

// ---- 轻量 Markdown 渲染（先转义再转换，杜绝注入） ----
function esc(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function inline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, p) =>
      /^https?:/.test(p)
        ? `<a href="${p}" target="_blank" rel="noopener">${t}</a>`
        : `<a href="#" data-path="${p}">${t}</a>`);
}

function renderMd(text) {
  let meta = '';
  let body = text;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fm) {
    meta = `<div class="meta">${esc(fm[1]).split(/\r?\n/).map((l) => `<div>${l}</div>`).join('')}</div>`;
    body = text.slice(fm[0].length);
  }
  const lines = esc(body).split(/\r?\n/);
  let html = '';
  let inList = false;
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      html += inCode ? '</code></pre>' : '<pre class="code"><code>';
      inCode = !inCode;
      continue;
    }
    if (inCode) { html += line + '\n'; continue; }
    const h = line.match(/^(#{1,4}) (.*)$/);
    if (h) {
      if (inList) { html += '</ul>'; inList = false; }
      const lv = h[1].length + 1;
      html += `<h${lv}>${inline(h[2])}</h${lv}>`;
      continue;
    }
    if (/^[-*] /.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^---+$/.test(line.trim())) { html += '<hr>'; continue; }
    if (!line.trim()) continue;
    html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  if (inCode) html += '</code></pre>';
  return meta + html;
}

// ---- toast 通知 ----
function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' error' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('bye'), 2900);
  setTimeout(() => el.remove(), 3200);
}

// ---- 视图切换 ----
document.querySelectorAll('.nav-btn').forEach((btn) =>
  btn.addEventListener('click', () => showView(btn.dataset.view)));

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.body.dataset.view = name; // 背景 scrim 随视图微调浓度
  if (name === 'browse') loadBrowse();
  if (name === 'settings') { loadConfig(); refreshSemantic(); }
  if (name !== 'file') lastView = name;
}

// ---- 库选择与状态 ----
async function boot() {
  const b = await window.api.boot();
  if (b.dir) enterLib(b);
  else showWelcome(b.lastMissing);
}

function enterLib(s) {
  libOpen = true;
  $('#welcome').classList.add('hidden');
  $('#app').classList.remove('hidden');
  updateStatus(s);
  showView('home');
}

function showWelcome(lastMissing) {
  libOpen = false;
  $('#app').classList.add('hidden');
  $('#welcome').classList.remove('hidden');
  document.body.dataset.view = 'welcome';
  $('#welcome-hint').textContent = lastMissing
    ? '上次的记忆库找不到了（可能被移动或删除）。请重新打开，或新建一个库。'
    : '打开已有的记忆库文件夹，或选一个空文件夹新建。之后每次启动都会自动连接上次的库。';
}

async function pick(mode) {
  try {
    const r = mode === 'new' ? await window.api.newLibrary() : await window.api.openLibrary();
    if (!r) return; // 用户取消
    if (r.error) { toast(r.error, 'error'); return; }
    enterLib(r);
    toast(mode === 'new' ? '新库已建好，开始收集记忆吧' : '已连接记忆库');
  } catch (e) { toast(e.message, 'error'); }
}

$('#btn-open').addEventListener('click', () => pick('open'));
$('#btn-new').addEventListener('click', () => pick('new'));
$('#btn-switch').addEventListener('click', () => pick('open'));
$('#btn-new-top').addEventListener('click', () => pick('new'));

function updateStatus(s) {
  $('#lib-name').textContent = s.dir;
  $('#lib-info').textContent = `${s.dir}\ninbox ${s.inboxCount} · 归档 ${s.archiveCount}`;
  $('#topics').innerHTML = '<h3>主题</h3>' + s.topics.map((t) => `<div class="topic">${esc(t)}</div>`).join('');
  $('#stat-inbox').textContent = s.inboxCount;
  $('#stat-archive').textContent = s.archiveCount;
  $('#stat-topics').textContent = s.topics.length;
  const h = new Date().getHours();
  const greet = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  $('#home-greet').textContent = `${greet}，把今天也收进记忆里`;
  $('#home-sub').textContent = s.inboxCount
    ? `inbox 里还有 ${s.inboxCount} 条新记忆等着整理。`
    : 'inbox 空空的，一切都已归档。';
}

async function refreshStatus() {
  try { updateStatus(await window.api.status()); } catch { /* 尚未开库 */ }
}

// ---- 首页快捷入口 ----
$('#btn-home-organize').addEventListener('click', () => { showView('organize'); runOrganize(); });
$('#btn-home-export').addEventListener('click', () => { showView('organize'); runExport(); });
$('#btn-home-search').addEventListener('click', () => { showView('search'); $('#q').focus(); });

// ---- 检索 ----
$('#btn-search').addEventListener('click', doSearch);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const q = $('#q').value.trim();
  if (!q) return;
  try {
    const results = await window.api.search(q);
    $('#results').innerHTML = results.length
      ? results.map((r) => `
        <div class="result card glass rise" data-path="${esc(r.path)}">
          <div class="result-title">${esc(r.title)}</div>
          <div class="muted">${esc(r.topic || '未分类')} · ${esc(r.created || '日期未知')} · ${esc(r.location)}</div>
          <div class="snippet">${esc(r.snippet)}</div>
        </div>`).join('')
      : '<p class="muted glass pad">没有命中。换个关键词试试。</p>';
    document.querySelectorAll('.result').forEach((el, i) => {
      el.style.animationDelay = `${Math.min(i, 8) * 30}ms`;
      el.addEventListener('click', () => openFile(el.dataset.path));
    });
  } catch (e) {
    $('#results').innerHTML = `<p class="error glass pad">${esc(e.message)}</p>`;
  }
}

// ---- 文件查看 ----
async function openFile(p) {
  try {
    const { path, text } = await window.api.readFile(p);
    currentFile = path;
    $('#file-content').innerHTML = renderMd(text);
    showView('file');
  } catch (e) { toast(e.message, 'error'); }
}

$('#btn-back').addEventListener('click', () => showView(lastView));

// 文内相对链接：交给主进程解析并做越界检查
$('#file-content').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-path]');
  if (!a) return;
  e.preventDefault();
  window.api.readFile({ base: currentFile, rel: a.dataset.path })
    .then(({ path, text }) => {
      currentFile = path;
      $('#file-content').innerHTML = renderMd(text);
      $('#file-content').scrollTop = 0;
    })
    .catch((err) => toast(err.message, 'error'));
});

// ---- 整理 ----
// 日志逐行滑入并自动滚到底
function addLog(text) {
  const log = $('#organize-log');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

async function runOrganize() {
  $('#organize-log').innerHTML = '';
  addLog('整理中……');
  $('#btn-organize').disabled = true;
  try {
    const stats = await window.api.organize();
    addLog(`完成：归档 ${stats.organized} / 跳过 ${stats.skipped} / 失败 ${stats.failed}`);
    for (const d of stats.details) addLog(`  ${d.file}：${d.action}`);
    refreshStatus();
    toast(`整理完成：归档 ${stats.organized} 条`);
  } catch (e) {
    addLog('出错：' + e.message);
    toast(e.message, 'error');
  }
  $('#btn-organize').disabled = false;
}

$('#btn-organize').addEventListener('click', runOrganize);

window.api.onProgress((p) => {
  addLog(`  ✓ ${p.file} → ${p.topic}`);
});

async function runExport() {
  try {
    const s = await window.api.exportDsh();
    addLog(`DSH 导出：新 ${s.exported} / 未变 ${s.skippedUnchanged} / 空 ${s.skippedEmpty} / 失败 ${s.failed}`);
    refreshStatus();
    toast(`DSH 导出：新增 ${s.exported} 条`);
  } catch (e) {
    addLog('导出出错：' + e.message);
    toast(e.message, 'error');
  }
}

$('#btn-export').addEventListener('click', runExport);

// ---- 浏览索引 ----
async function loadBrowse() {
  try {
    const files = await window.api.listIndex();
    $('#browse-list').innerHTML = files.length
      ? files.map((f) => `<div class="card glass browse-item rise" data-path="${esc(f.path)}">${esc(f.name)}</div>`).join('')
      : '<p class="muted glass pad">索引为空。</p>';
    document.querySelectorAll('.browse-item').forEach((el, i) => {
      el.style.animationDelay = `${Math.min(i, 8) * 30}ms`;
      el.addEventListener('click', () => openFile(el.dataset.path));
    });
  } catch (e) {
    $('#browse-list').innerHTML = `<p class="error glass pad">${esc(e.message)}</p>`;
  }
}

// ---- 设置 ----
async function loadConfig() {
  try {
    const cfg = await window.api.getConfig();
    $('#cfg-url').value = cfg.apiBaseUrl;
    $('#cfg-key').value = cfg.apiKey;
    $('#cfg-model').value = cfg.model;
    $('#cfg-semantic').checked = cfg.semanticSearch !== false;
  } catch { /* 忽略 */ }
}

$('#btn-save-cfg').addEventListener('click', async () => {
  try {
    await window.api.saveConfig({
      apiBaseUrl: $('#cfg-url').value.trim(),
      apiKey: $('#cfg-key').value.trim(),
      model: $('#cfg-model').value.trim(),
      semanticSearch: $('#cfg-semantic').checked,
    });
    $('#cfg-status').textContent = '已保存到本机 ✓';
    setTimeout(() => { $('#cfg-status').textContent = ''; }, 2000);
  } catch (e) { toast(e.message, 'error'); }
});

// ---- 语义检索卡片 ----
async function refreshSemantic() {
  try {
    const s = await window.api.semanticStatus();
    const parts = [];
    parts.push(s.modelReady ? '模型已就绪 ✓' : '模型未下载（约 23MB，一次性）');
    if (s.index) parts.push(`索引：${s.index.docs} 篇 / ${s.index.chunks} 块（${s.index.updated}）`);
    else parts.push('索引未建立');
    if (!s.enabled) parts.push('语义开关已关闭');
    $('#sem-status').textContent = parts.join('；');
    $('#btn-sem-download').disabled = s.modelReady || s.building;
    $('#btn-sem-build').disabled = !s.modelReady || s.building;
    $('#btn-sem-cancel').classList.toggle('hidden', !s.building);
  } catch { /* 未开库时忽略 */ }
}

function semProgress(p) {
  $('#sem-progress').classList.remove('hidden');
  const pct = p.totalChunks ? Math.round(100 * p.chunkDone / p.totalChunks) : 0;
  $('#sem-bar').style.width = pct + '%';
  $('#sem-progress-text').textContent = `文档 ${p.done}/${p.total} · 块 ${p.chunkDone}/${p.totalChunks}（${pct}%）`;
}

$('#btn-sem-download').addEventListener('click', async () => {
  $('#btn-sem-download').disabled = true;
  $('#sem-status').textContent = '模型下载中…';
  try {
    await window.api.semanticDownload();
    toast('语义模型下载完成');
  } catch (e) { toast(e.message, 'error'); }
  refreshSemantic();
});

$('#btn-sem-build').addEventListener('click', async () => {
  $('#sem-progress').classList.remove('hidden');
  $('#sem-bar').style.width = '0%';
  $('#sem-progress-text').textContent = '准备中…';
  refreshSemantic();
  try {
    const r = await window.api.semanticBuild();
    if (r.status === 'stopped') toast('已停止，进度已保存，可续建');
    else if (r.status === 'ok') toast(`索引完成：${r.docs} 篇 / ${r.chunks} 块`);
    else if (r.status === 'no-model') toast('请先下载模型', 'error');
  } catch (e) { toast(e.message, 'error'); }
  $('#sem-progress').classList.add('hidden');
  refreshSemantic();
});

$('#btn-sem-cancel').addEventListener('click', () => window.api.semanticCancel());

window.api.onSemanticProgress(semProgress);
window.api.onSemanticDownload((p) => {
  if (p.status === 'downloading' && p.total) {
    $('#sem-status').textContent = `模型下载中 ${Math.round(100 * p.received / p.total)}%（${p.file}）`;
  }
});
window.api.onSemanticDone((r) => {
  if (r.status === 'ok') { $('#sem-progress').classList.add('hidden'); refreshSemantic(); }
});

boot();