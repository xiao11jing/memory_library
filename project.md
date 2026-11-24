# 记忆库项目计划

> 个人记忆库：把每天的文件、想法、学习内容、AI 对话沉淀到本地，由 AI 整理分类、建立分层索引；
> 人和 agent 都能通过索引快速检索内容，agent 还能借此全面了解库主人。
> 路线：先做记忆库本体，exe 客户端与 MCP 接口分阶段生长。

## 一、已确定的决策

| 决策点 | 结论 |
|---|---|
| 数据存储 | 全部本地，纯 Markdown + git 版本管理 |
| 隐私 | 库内容默认不出本机；仅 AI 整理时把待整理正文发送给所配置的 API（默认 DeepSeek）；API key、模型与向量缓存全在本地 |
| 对话导入 | 先只做 DeepSeek Harness（DSH）；Qoder / MiMo 以后再说 |
| 定时任务 | 暂不做，整理先手动触发 |
| 产品形态 | 先做记忆库本体，exe 慢慢做 |
| exe 技术栈 | Electron v45 + NSIS 安装版（可选安装位置、桌面/开始菜单快捷方式、卸载入口） |
| agent 接口 | MCP 协议（DSH、Qoder 均支持） |

## 二、核心设计原则

1. **库是本体，客户端是壳**：记忆库是纯文件。exe 界面、MCP 接口、裸文件浏览是三个平等客户端，任何一个坏了，库都完好可用。
2. **原文与索引分离**：原始文件是唯一事实来源；摘要、标签、索引都是可再生的衍生品。AI 整理错了可重建、可回滚。
3. **分层索引**：总索引（用户画像 + 主题地图 + 最近动态）→ 主题子索引（摘要 + 关键词 + 原文链接）→ 原文。agent 先读总索引，按任务需要下钻。
4. **每次整理必 commit、必过校验**：遵守根目录 AGENTS.md；校验脚本全部通过才算完成。

## 三、目录结构

```
制作记忆库/                        # 项目根（git 仓库）
├── AGENTS.md                      # AI 工作守则：每次改动 commit + 测试通过
├── project.md                     # 本文件：项目计划
├── scripts/                       # 项目工具：导出、校验、图标、打包、冒烟
│   ├── check-structure.mjs        # 结构校验（目录骨架/总索引格式/链接有效性）
│   ├── export-dsh.mjs             # DSH 会话导出（zstd 解压转 Markdown，增量）
│   ├── make-icon.mjs              # 背景图裁脸部方形生成多尺寸 ICO（npx electron 运行）
│   ├── build-win.mjs              # workspace 外 NSIS 打包（绕本机 asar 锁），产物拷回 release/
│   └── smoke-exe.mjs              # 安装版冒烟：断言启动自动连上记住的库
└── 记忆库/                        # 记忆库本体（未来 exe 选择的就是这个文件夹）
    ├── inbox/                     # 收集箱：随手丢，不分类
    ├── archive/                   # 归档区（整理后移入）
    │   ├── conversations/deepseek/  # DSH 对话导出
    │   ├── notes/                 # 想法、学习笔记
    │   └── files/                 # 文档、作品
    ├── index/
    │   ├── 总索引.md              # 画像 + 主题地图 + 最近动态（AI 先读这个）
    │   └── topics/                # 每主题一个子索引
    └── journal/                   # 整理日志：每次整理做了什么
```

## 四、分步计划

### 阶段 1：地基（当前阶段）

- [x] 创建记忆库目录骨架与总索引
- [x] 结构校验脚本 scripts/check-structure.mjs（含正向/负向验证）
- [x] 编写本计划 project.md
- [x] AGENTS.md 补充守则：在库内工作前先读 记忆库/index/总索引.md
- [x] DSH 会话导出脚本：读取本地会话日志，解压转 Markdown，增量输出到 inbox/
- [x] 手动跑通首次完整整理：导出 → 分类摘要 → 归档 → 更新索引 → 校验 → commit

验收标准：真实 DSH 会话进库；总索引能反映库内容；校验脚本通过。

### 阶段 2：核心引擎 + exe

- [x] 核心引擎（Node/TypeScript）：扫描、索引管理、关键词检索
- [x] AI 整理模块：调 DeepSeek API（OpenAI 兼容格式），生成摘要/标签/分类，更新索引
- [x] 图形界面：选文件夹建库、API 配置（key 存本地、进 .gitignore 不入库）、一键整理、关键词检索、浏览索引与原文
- [x] 打包为 Windows exe（Electron）
- [x] NSIS 安装版：可选安装位置、桌面/开始菜单快捷方式、卸载入口
- [x] 记住上次记忆库：启动自动连库，欢迎页/切换库/新建库入口
- [x] 樱粉玻璃主题：角色背景与应用图标、首页视图、安静的交互动效（可读性优先）
- [x] 文件夹入库：inbox 文件夹整体移入 archive/files/（原件零改动），AI 读根目录文档生成摘要笔记代表索引；扫描跳过 node_modules/.git 与 files/ 原件区

验收标准：exe 能对一个空文件夹建库、导入内容、AI 整理、关键词检索。
验收状态：建库/整理/检索逻辑经 47 项测试验证（AI 用 mock）；安装版冒烟通过（静默安装→启动自动连库→截屏目检→卸载清理）；真实 API 整理待用户在设置中填 key 后实测确认。

### 阶段 3：MCP 接口

- [x] MCP 服务（独立进程，不依赖 exe 窗口），四个工具：
  - `memory_overview`：返回总索引（agent 对话开始时"认识你"）
  - `memory_search`：关键词 + 本地语义混合检索，返回摘要 + 命中片段 + 文件位置 + via 来源
  - `memory_read`：按路径读某条内容完整原文
  - `memory_add`：agent 把值得记的内容写进 inbox
- [x] Qoder 接入：连接器 memory-library 已 ready，live list_tools 四工具齐备（新会话即可调用）
- [ ] DSH 实测：cordis.patch.yml 条目 + 插件已装（0.2.2-rc.3），启动 DSH 后完成一次问答验收

验收标准：在两个 agent 里各完成一次"基于记忆库回答关于我的问题"。
验收状态：协议级集成测试（真实 MCP client 走 stdio）通过；Qoder 连接器 ready 且工具在线；
DSH 待重启后一问验收。

### 阶段 4：语义检索（本地向量，已完成）

- [x] 本地 embedding：bge-small-zh-v1.5 int8（ONNX，23MB），onnxruntime-node 纯 CPU、线程限 2、会话温缓存闲置 60s 释放；自实现 WordPiece 分词（不引 transformers.js）
- [x] 切块（~500 字/块，标题边界、超长硬切、短尾合并）+ 增量向量索引（库/.cache/vectors.json，gitignore；按内容哈希复用、每文档 checkpoint 可断点续建、块级进度）
- [x] 混合排序：关键词字段加权 + 向量余弦（下限 0.45，真实库校准）RRF 融合；同标题同片段副本去重；模型/索引缺失自动退回纯关键词
- [x] 模型下载：scripts/download-model.mjs（hf-mirror 优先、huggingface 兜底、原子落盘）；模型存 %APPDATA%/记忆库/models（客户端与 MCP 共享，不入库）
- [x] 客户端设置页语义卡片：开关 / 下载进度 / 建索引进度条 / 停止续建；整理后已有索引自动增量更新
- [x] MCP memory_search 自动受益（新进程协议级实测：同义查询 semantic 命中、无关对照 0 命中）
- [x] 打包：asarUnpack onnxruntime-node 原生件；download-model.mjs 进安装包；
  排除 darwin/linux/win-arm64 原生件（安装包 206MB → 140MB）；安装版冒烟含 unpack 目录裁剪断言

验收：84 项测试全绿（含真模型相似度/批量一致性、断点续建、去重、混合排序）；
真实库首建 53 篇 / 1749 块约 3 分钟（本机 i3-9100F），搜索延迟 +0.1~0.4s；
同义查询"转行学习路线"命中学习路径类笔记（sim ≥0.58），无关对照"红烧肉的做法"0 命中；设置页截屏目检通过。

### 阶段 5：以后再说

- 定时自动整理
- Qoder / MiMo 对话导入
- 多库管理

## 五、技术备忘

- **DSH 会话日志位置**（已实地确认）：`~/.dsh/sessions/<工作区>/<session-id>\session.jsonl.zstd`，
  部分为 `session.v4.jsonl.zstd`。zstd 压缩的 JSONL，导出脚本需解压后逐行解析转 Markdown。
- **DeepSeek API**：OpenAI 兼容格式，整理成本低；API key 只存本地配置，严禁提交进 git。
- **MCP**：DSH 官方支持 MCP 服务接入；Qoder 同样支持。接口设计为独立进程，库文件夹路径作为配置传入。
- **本机 asar 锁（坑）**：工作区监控会锁住工作区内新建的 .asar 文件（EBUSY/EPERM，持久不释放），
  electron-builder 在工作区内解包/改名必失败。`npm run dist` 走 scripts/build-win.mjs：
  在 workspace 外临时目录构建（node_modules 用 junction 共享），完成后安装包拷回 release/。
  被锁的旧产物目录（release/win-unpacked 等）待锁释放（通常重启后）再清理。
- **配置目录**：app.setName('记忆库') 统一 dev 与打包版 userData（%APPDATA%/记忆库/config.local.json），
  存 apiKey 与 lastLibrary；绝不进入记忆库或 git。
- **冒烟验收**：SMOKE=1 输出启动状态 JSON；SMOKE_SHOT=路径 截屏；SMOKE_VIEW=视图名 指定截屏视图；
  scripts/smoke-exe.mjs 对已安装 exe 断言启动自动连库。
- **MCP 服务**：`node mcp/server.mjs [库路径]`（或 env MEMORY_LIBRARY_DIR），stdio 传输、官方 SDK；
  工具层 mcp/tools.mjs 纯函数含越界保护。DSH 侧条目在 ~/.dsh/profiles/desktop/cordis.patch.yml
  （id: mcp-memory-library，serverName: memory → 工具名 mcp__memory__*；原配置备份 .bak-20261115）；
  Qoder 侧为用户级连接器 memory-library（已实测 overview/search 真实调用通过）。
- **DSH 插件安装（坑）**：patch 里写插件名不会自动安装——DSH 插件经 pnpm 装进 profile 的
  node_modules（hoisted 布局）。已装 `@deepseek-ai/dsh-mcp-client@0.2.2-rc.3`（与本机 DSH 0.2.x 核心代际匹配;
  latest 标签 0.0.1-rc.1 是旧代际，勿用）。重装命令：cd ~/.dsh/profiles/desktop && pnpm add @deepseek-ai/dsh-mcp-client@0.2.2-rc.3。
- **语义检索（本机实测）**：i3-9100F 无 VNNI，int8 单块（~500 字）约 0.08~0.1s（干净环境）；
  并发两个推理会话会触发换页 thrashing、整机卡死——建索引务必单进程、线程限 2。
  首建 1749 块约 3 分钟；fp32 模型 hf-mirror 限流/直连被墙未采用。余弦下限 0.45（相关 ≥0.58、无关 ≤0.41）。
  int8 图对 padding 有 ~0.01 向量漂移（等长批量完全一致），远小于阈值间隔，可接受。
  向量索引是派生缓存（库/.cache/，gitignore）；模型在 %APPDATA%/记忆库/models，MCP 与客户端同址共享。
  **MCP 常驻进程加载的是启动时的代码**：升级 core 后已连接的 Qoder/DSH 服务进程仍是旧逻辑，
  需新会话/重启连接器才生效（验收时曾因此误判语义未生效）。

## 六、当前状态

- 2026-11-12：项目启动。完成目录骨架、总索引、结构校验脚本与本计划。
- 2026-11-13：阶段 1（地基）完成。20 个 DSH 对话归档并建立 4 大主题索引，总索引有了首版用户画像；
  导出脚本 7 项测试与结构校验全部通过，归档正文经字节级验证零改动。下一步：阶段 2（核心引擎 + exe）。
- 2026-11-13：阶段 2（核心引擎 + exe）构建完成。core/ 七大模块 + Electron 界面 + 便携版 exe
  （release/memory-library-0.1.0.exe）；41 项测试与 exe 冒烟测试全部通过。
  待办：用户填 API key 实测 AI 整理（最终验收）。下一步：阶段 3（MCP 接口）。
- 2026-11-14：体验重做完成。NSIS 安装版取代便携版（release/记忆库-Setup-0.1.0.exe，双击走安装向导、
  可选安装位置）;启动自动连接上次的记忆库（保留欢迎页/切换/新建）;樱粉玻璃主题 + 角色背景与图标 +
  安静的交互动效（仅交互反馈，无环境动画，可读性优先）；47 项测试、结构校验、安装版静默安装冒烟与
  截屏目检全部通过。待办不变：填 key 实测 AI 整理。下一步：阶段 3（MCP 接口）。
- 2026-11-15：修复"文件夹整理不动"——organizer 原先只列 inbox 顶层文件、文件夹被无声忽略（0/0/0）。
  现支持文件夹整体归档 + 摘要笔记;示例作品文件夹《聊天与学习软件》已入库（App项目开发）。
  测试范围限定 core/ 与 scripts/（避免扫到库内作品项目的 tests/）;51 项测试通过。
- 2026-11-15：阶段 3 MCP 服务完成（mcp/ 工具层 + stdio 服务 + 协议级集成测试，56 项测试通过）；
  Qoder 连接器 ready、四工具在线；DSH patch 条目已写入待重启实测。下一步：DSH 一问验收 → 阶段 4 议题。
- 2026-11-19：阶段 4 语义检索完成（本地 int8 向量 + 关键词 RRF 混合）。真实库索引 53 篇 / 1749 块已建；
  84 项测试全绿；设置页语义卡片截屏验收通过；MCP 新进程协议级语义实测通过。
  顺带修复：设置保存整份覆盖配置会丢 lastLibrary（改合并保存）。安装包已重建（含语义检索与 asarUnpack）。
  待办：DSH 新会话一问验收（阶段 3 收尾）；已连接的 Qoder/DSH MCP 进程需重启才用上语义路。
- 2026-11-19：安装包瘦身重建完成（release/记忆库-Setup-0.1.0.exe，140MB）：排除非 win-x64 原生件；
  临时安装冒烟通过（unpack 仅 win32/x64、SMOKE ok、设置页语义卡片截屏一致），冒烟安装已静默卸载、
  快捷方式与注册项清零。用户尚未正式安装过 NSIS 版——双击安装包走向导自选位置即可。
- 2026-11-24：开源至 GitHub：https://github.com/xiao11jing/memory_library （公开，MIT）。
  全新 git 历史，记忆库/ 不入仓库（本地保留，历史备份 bundle 在库外）；README/LICENSE/截图入库；
  发布前个人数据扫描通过（仅 gitignore 的会话导出状态文件含本机路径）。