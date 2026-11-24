// 预加载桥：渲染进程只能通过这组受控 API 与主进程通信（contextIsolation 开启）
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  boot: () => ipcRenderer.invoke('lib:boot'),
  openLibrary: () => ipcRenderer.invoke('lib:open'),
  newLibrary: () => ipcRenderer.invoke('lib:new'),
  status: () => ipcRenderer.invoke('lib:status'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  organize: () => ipcRenderer.invoke('organize:run'),
  onProgress: (cb) => ipcRenderer.on('organize:progress', (_e, p) => cb(p)),
  search: (q) => ipcRenderer.invoke('search:query', q),
  readFile: (arg) => ipcRenderer.invoke('file:read', arg),
  listIndex: () => ipcRenderer.invoke('index:list'),
  exportDsh: () => ipcRenderer.invoke('export:dsh'),
  semanticStatus: () => ipcRenderer.invoke('semantic:status'),
  semanticDownload: () => ipcRenderer.invoke('semantic:download'),
  semanticBuild: () => ipcRenderer.invoke('semantic:build'),
  semanticCancel: () => ipcRenderer.invoke('semantic:cancel'),
  onSemanticProgress: (cb) => ipcRenderer.on('semantic:progress', (_e, p) => cb(p)),
  onSemanticDownload: (cb) => ipcRenderer.on('semantic:download', (_e, p) => cb(p)),
  onSemanticDone: (cb) => ipcRenderer.on('semantic:done', (_e, r) => cb(r)),
});