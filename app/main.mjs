// 记忆库桌面应用 —— 主进程
// 原则：库是本体，界面是壳。全部能力来自 core/ 与 scripts/，主进程只做窗口管理与 IPC 桥接。
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join, resolve, dirname, sep } from 'node:path';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { scanLibrary } from '../core/scanner.mjs';
import { searchLibrary } from '../core/search.mjs';
import { organizeLibrary } from '../core/organizer.mjs';
import { loadConfig, saveConfig } from '../core/config.mjs';
import { initLibrary, isLibrary, resolveStartupLibrary } from '../core/library.mjs';
import { updateVectorIndex, loadVectorIndex } from '../core/vector-index.mjs';
import { modelReady, defaultModelDir, disposeWarmEmbedder } from '../core/embedder.mjs';
import { downloadModel } from '../scripts/download-model.mjs';
import { exportAll } from '../scripts/export-dsh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// 统一应用名：dev 与打包版共用同一 userData 目录（配置/记住的库不分家）
app.setName('记忆库');
// API 配置存应用数据目录（本机），绝不进入记忆库或 git
const configFile = join(app.getPath('userData'), 'config.local.json');
let libDir = null;
let win = null;

function status() {
  const { inbox, archive, topics, inboxFolders } = scanLibrary(libDir);
  return { dir: libDir, inboxCount: inbox.length + inboxFolders.length, archiveCount: archive.length, topics };
}

function requireLib() {
  if (!libDir) throw new Error('尚未打开记忆库，请先在左侧选择文件夹');
  return libDir;
}

// 安全边界：渲染进程只能读记忆库内的文件
function assertInside(p) {
  const r = resolve(p);
  const base = requireLib();
  if (r !== base && !r.startsWith(base + sep)) throw new Error('路径越界：只能访问记忆库内的文件');
  return r;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#fdf3f7',
    icon: existsSync(join(here, '..', 'build', 'icon.png')) ? join(here, '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: join(here, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // ESM preload 需要非沙箱环境
    },
  });
  win.removeMenu();
  win.loadFile(join(here, 'renderer', 'index.html'));
}

// 打开/新建成功后记住路径，下次启动自动连接
function rememberLib(dir) {
  libDir = dir;
  saveConfig(configFile, { ...loadConfig(configFile), lastLibrary: dir });
}

ipcMain.handle('lib:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '打开已有记忆库',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  if (!isLibrary(dir)) return { error: '这个文件夹不是记忆库。请换一个已有库文件夹，或点「新建记忆库」。' };
  rememberLib(dir);
  return status();
});

ipcMain.handle('lib:new', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '新建记忆库（选一个空文件夹，将自动建库）',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  initLibrary(dir); // 幂等：已是库则只补缺失目录
  rememberLib(dir);
  return status();
});

// 启动状态：有 remembered 库则已自动连接，否则告知是否"上次的库找不到了"
ipcMain.handle('lib:boot', () => {
  if (!libDir) {
    const cfg = loadConfig(configFile);
    return { dir: null, lastMissing: !!(cfg.lastLibrary && !resolveStartupLibrary(cfg)) };
  }
  return { dir: libDir, ...status() };
});

ipcMain.handle('lib:status', () => { requireLib(); return status(); });

ipcMain.handle('config:get', () => loadConfig(configFile));
// 合并保存：渲染层只交部分字段时不丢 lastLibrary / semanticSearch 等本机状态
ipcMain.handle('config:save', (_e, cfg) => { saveConfig(configFile, { ...loadConfig(configFile), ...cfg }); return loadConfig(configFile); });

ipcMain.handle('organize:run', async () => {
  const stats = await organizeLibrary({
    libDir: requireLib(),
    config: loadConfig(configFile),
    onProgress: (p) => win?.webContents.send('organize:progress', p),
  });
  // 已有向量索引时整理后自动增量更新（首次全量建索引由设置页显式触发）
  if (stats.organized > 0 && !semanticBuilding && loadVectorIndex(libDir)) {
    updateVectorIndex(libDir, { onProgress: (p) => win?.webContents.send('semantic:progress', p) })
      .then((r) => win?.webContents.send('semantic:done', r))
      .catch(() => {});
  }
  return stats;
});

ipcMain.handle('search:query', (_e, q) => searchLibrary(requireLib(), q, { limit: 50, semantic: loadConfig(configFile).semanticSearch !== false }));

// ---- 语义检索：模型下载 / 索引建更 / 状态 ----
let semanticBuilding = false;
let semanticCancel = false;

ipcMain.handle('semantic:status', () => {
  const idx = libDir ? loadVectorIndex(libDir) : null;
  return {
    modelReady: modelReady(),
    modelDir: defaultModelDir(),
    enabled: loadConfig(configFile).semanticSearch !== false,
    building: semanticBuilding,
    index: idx ? { docs: Object.keys(idx.docs).length, chunks: Object.values(idx.docs).reduce((s, d) => s + d.chunks.length, 0), updated: idx.updated } : null,
  };
});

ipcMain.handle('semantic:download', () => downloadModel({
  onProgress: (p) => win?.webContents.send('semantic:download', p),
}));

ipcMain.handle('semantic:build', async () => {
  if (semanticBuilding) return { status: 'busy' };
  semanticBuilding = true;
  semanticCancel = false;
  try {
    const r = await updateVectorIndex(requireLib(), {
      onProgress: (p) => win?.webContents.send('semantic:progress', p),
      shouldStop: () => semanticCancel,
    });
    win?.webContents.send('semantic:done', r);
    return r;
  } finally { semanticBuilding = false; }
});

ipcMain.handle('semantic:cancel', () => { semanticCancel = true; return true; });

ipcMain.handle('file:read', (_e, arg) => {
  const p = typeof arg === 'string' ? arg : resolve(dirname(arg.base), arg.rel);
  const r = assertInside(p);
  return { path: r, text: readFileSync(r, 'utf8') };
});

ipcMain.handle('index:list', () => {
  const base = join(requireLib(), 'index');
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, rel + e.name + '/');
      else if (e.name.endsWith('.md')) out.push({ name: rel + e.name, path: p });
    }
  };
  if (existsSync(base)) walk(base, '');
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
});

ipcMain.handle('export:dsh', () => exportAll({
  sourceDir: join(homedir(), '.dsh', 'sessions'),
  outDir: join(requireLib(), 'inbox'),
  stateFile: join(app.getPath('userData'), 'dsh-export-state.json'),
}));

app.whenReady().then(() => {
  // 冒烟测试模式：验证主进程与依赖加载正常，输出启动状态 JSON 后立即退出，不开窗口
  if (process.env.SMOKE) {
    const lib = resolveStartupLibrary(loadConfig(configFile));
    const s = lib ? scanLibrary(lib) : null;
    console.log(JSON.stringify({
      smoke: 'ok',
      configFile,
      libDir: lib,
      inboxCount: s ? s.inbox.length + s.inboxFolders.length : 0,
      archiveCount: s ? s.archive.length : 0,
      topics: s ? s.topics : [],
    }));
    // SMOKE_SHOT：开窗口截屏后退出，用于界面视觉验收
    if (process.env.SMOKE_SHOT) {
      libDir = lib;
      createWindow();
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          const view = process.env.SMOKE_VIEW; // 指定截屏视图：search/organize/browse/settings/file
          if (view) {
            const js = (code) => win.webContents.executeJavaScript(code);
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            if (view === 'file') {
              await js(`document.querySelector('[data-view="browse"]').click();`);
              await wait(400); // 等浏览列表 IPC 返回
              await js(`const b = document.querySelector('.browse-item'); if (b) b.click();`);
            } else {
              await js(`document.querySelector('[data-view="${view}"]').click();`);
            }
            await wait(400);
          }
          const img = await win.webContents.capturePage();
          writeFileSync(process.env.SMOKE_SHOT, img.toPNG());
          app.quit();
        }, 800); // 等渲染层 boot IPC 往返与首屏绘制
      });
      return;
    }
    app.quit();
    return;
  }
  libDir = resolveStartupLibrary(loadConfig(configFile)); // 记住上次的库，启动自动连接
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => disposeWarmEmbedder());