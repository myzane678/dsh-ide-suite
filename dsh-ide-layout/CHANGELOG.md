# Changelog

本项目版本与更新记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### 新增

- **文件树搜索（资源管理器式）**：树顶搜索框输入即过滤（防抖 250ms）——host 新增 `/dsh-ide/search`（`fs.search` 递归 BFS 遍历授权工作区，跳过 `node_modules`/`.git`，结果 500 条 / 目录 2 万双上限防拖死，workspace gate 门禁与 realpath 防护全程复用）；结果名称命中子串高亮，文件点击打开、目录点击退出搜索并在树中展开定位到该目录；清空 / Esc 恢复完整树。新增 `tests/fs-search.test.ts`（5 项）。

### 修复

- **LSP 状态订阅硬编码四语言**：会话组列表改由 `lspCapabilities.sessionLanguages()`（注册表驱动）提供——rust 等新语言插件的状态此前无人订阅，状态栏永远显示「… LSP」（服务器实际已连接）。

## [1.0.1] - 2026-08-22

### 修复

- **非 LSP 语言状态栏语言名显示 plaintext**（1.0.0 LSP 拆分引入的退化）：json/md/yaml 等恢复真实展示名。新增轻量语法注册表 `src/client/language-names.ts`（扩展名 → 展示名，与内置语法表同步维护）；状态栏三级 fallback：`lspCapabilities.languageFor` → `languageNameFor` → `plaintext`——LSP 语言仍优先走注册表 displayName，语言路由约定不变。新增 `tests/language-names.test.ts`（本包测试 69 → 73 项）。

## [1.0.0] - 2026-08-22

LSP 拆分工程完成——本包自 v0.3.1 起 LSP 能力全部移交 dsh-lsp-core 管线，编辑器外壳语言无关化。仓库已并入 monorepo `dsh-ide-suite`（历史保留）。

### 重构（LSP 拆分工程，阶段 1-3）

- **统一 LSP 管线**：Python / TypeScript / PowerShell / Java 四语言全部走 `dsh-lsp-core` 注册表驱动链路（`lspCapabilities.acquire`），删除旧 LSP 桥（`lsp-service.ts`，370 行）与旧 `LspClient`（约 440 行）；新增语言插件零改编辑器。
- **语言知识收敛**：`lspFor` / LSP 扩展启用 / 状态栏语言名与 LSP 会话组指示全部改走 `lspCapabilities.languageFor(path)`（LanguageSummary），`languageIdForPath` 删除——编辑器零语言知识。
- **LSP 订阅统一**：诊断 / 状态 / 服务器完整错误（状态栏 hover）按会话组（sessionId）统一订阅管理；tsserver 一条会话服务 ts/tsx/js/jsx（不再每语言一进程）。
- **依赖瘦身**：pyright / typescript-language-server 移交语言插件；PSES vendor 移交 dsh-lsp-powershell。

### 修复

- 启动崩溃：client inject 漏声明 `lspRegistry`（cordis 强制 inject）与 host 入口 inject 被 tsdown 摇掉（必须显式导出）两处产物级问题。
- `.py` 文件打不开：CodeMirror 扩展跨 bundle 双副本抛 `Unrecognized extension value`——语法高亮改由本包内置表单副本构造，语言插件不注册 syntax。

### 变化

- 非 LSP 语言（json/md 等）状态栏语言名显示 `plaintext`（原显示 'json'/'markdown'）。
- 语言插件的 LSP 服务器配置（如 pyright 宽松防误报）随插件分发，见各语言插件 CHANGELOG。

## [0.3.1] - 2026-08-21

### 修复

- **编码选择菜单被覆盖**：状态栏点击编码后菜单看不到——菜单改为贴按钮上沿向上生长（`bottom` 定位，按钮上方空间不足时自动向下弹防截断）
- **浮层 z-index 统一拉满**：编辑区右键菜单 / 快速修复 / 重命名框 / 编码菜单 / blame 悬停 / 终端右键菜单 / 文件树右键菜单与新建确认遮罩的 body 浮层 z-index 统一提到 2147483000，杜绝被 workbench（z-index 20）或皮肤浮层覆盖

## [0.3.0] - 2026-08-21

### 新增

- **编辑器编码选择**：状态栏显示当前文件编码（默认 UTF-8），点击弹出编码菜单——UTF-8 / 自动检测 / GB18030 / GBK / Big5 / UTF-16 LE / ISO-8859-1；切换后以新编码重新加载文件（未保存修改先确认），保存时按所选编码写回（GBK 等中文旧文件不再乱码、不会保存成 UTF-8）；「自动检测」对乱码文件先做严格 UTF-8 校验，失败则按 GB18030 解码，检测结果回写状态栏；读取时剥离 BOM、UTF-16LE 写入带 BOM
- **图片预览**：文件树双击 png / jpg / jpeg / gif / webp / bmp / ico / avif 直接在编辑区显示图片（不再是乱码）；滚轮缩放、双击回到适合窗口、底部工具栏缩放 / 适合 / 1:1 原始大小；只读不可保存/运行；host 侧按扩展名白名单限定 MIME 并限制 25MB，防任意文件被当图片读取
- **Tab 键缩进**：无补全/snippet 时 Tab 缩进、Shift+Tab 反缩进（多行选中整块缩进），行为对齐 VS Code

### 修复

- **Enter 换行只缩进 2 空格**：CodeMirror 全局 `indentUnit` 默认为 2 空格且项目未显式设置——统一为 4 空格（`indentUnit.of('    ')` + `EditorState.tabSize.of(4)`），语言包未自设缩进单位的语言（含 Python 循环/分支自动缩进）全部按 4 空格
- **Tab 无法缩进**：原 keymap 在无补全时返回 `false`，CodeMirror 默认行为把焦点移出编辑器——补上 `indentMore` / `indentLess` fallback

## [0.2.0] - 2026-08-20

### 新增

- **GitLens 式行内 blame**：编辑器左侧 gutter 逐行标注「短 hash + 作者」（未提交行显示「未提交」），悬停浮层显示完整提交信息（提交/作者/日期/说明）；状态栏光标行显示「◉ 作者 · 相对时间 · 短 hash」；嵌套仓库自动定位（工作区根非 Git 仓库时从文件向上找最近仓库根）；整文件标注默认关闭（工具栏「○ Blame」开关，localStorage 记忆，未启用时整列不渲染）
- **PowerShell 语言智能**（PowerShell Editor Services v4.7.0 + PSScriptAnalyzer）：`.ps1` / `.psm1` / `.psd1` 的补全、悬停帮助、实时语义分析（Script Analyzer 波浪线）、跳转定义、格式化、重命名、快速修复；捆绑模块放在插件 `vendor/` 目录（从 GitHub releases / PSGallery 手动更新，不入 git 仓库）
- **Java 语言智能**：接入 Eclipse JDT Language Server；优先复用本机 Red Hat VS Code Java 扩展中的 JDTLS（JDK 21+），支持通过 `DSH_JAVA_LS_HOME` 指定；未安装 JDTLS 时自动降级为 Java 语法高亮
- **Java 单文件运行**：点击运行后用 `javac` 编译到系统临时目录，再用 `java` 执行；支持 `package` 声明，Maven/Gradle 项目请使用终端
- **终端右键菜单**：复制选中 / 粘贴 / 清屏 / **🔄 重启终端**（立即杀掉当前 shell 并重连全新 shell，无需重启 DSH）
- 编辑器右键菜单选项悬停背景加深

### 修复

- **PowerShell 语言服务器启动路径 bug**：`vendor` 相对路径按源码位置推导、打包后在 `lib/` 多上跳一级导致找不到 `Start-EditorServices.ps1`（报「命令不存在」）——改为以构建产物位置为基准
- **WebSocket 关闭闪退**：close reason 超过协议 123 字节上限时 ws 库抛错导致宿主进程退出（DSH 整体闪退）——新增 `closeWs()` 统一按 UTF-8 字节截断，覆盖语言服务器与终端全部关闭点
- **LSP 状态栏按服务器分槽**（ts / py / ps 各自独立），一个语言服务器失败不再污染其他语言的状态显示；服务器退出时完整 stderr 经 `window/logMessage` 发到界面（状态栏悬停可见全文，不再截断）
- **高亮配色去红**：字符串改暖棕、非法字符改中性灰、符号类兜底主文字色——普通高亮不再出现红色，红色只留给 LSP 诊断的红色下波浪线（错误语义唯一来源）

## [0.1.0] - 2026-08-19

- 初始发布：DSH Web GUI IDE 布局插件
- 文件树（flex 流嵌入、懒加载、右键菜单、拖拽调高）
- CodeMirror 6 编辑器 + LSP（TypeScript / Python，补全/诊断/悬停/跳转/重命名/格式化/快速修复）
- xterm 终端（node-pty）+ Git 面板 + 问题面板 + 脚本运行输出

### 安全修复（审查整改，2026-08-18）

根据独立安全审查（`dsh-ide-layout-审查整改清单.md`）完成 18 项整改：

- **P0-01** 终端/LSP WebSocket 接入与 HTTP 同级的来源校验（loopback + Host + Origin，严格要求同源 Origin，拒绝缺失/跨源/伪造 Host/DNS rebinding）
- **P0-02** PTY 改为按 canonical root 独立管理（`Map<root, handle>`）+ 连接引用计数（最后连接断开才启动回收计时）+ 禁止向新连接重放历史 transcript
- **P0-03** Git 操作要求所选 root 即仓库根（`repoTopLevel` realpath 校验），拒绝从子目录上溯操作父仓库
- **P1-01** 文件写/改名/删除前二次 canonical 校验（symlink / reparse point 缓解；如实标注无法完全消除 TOCTOU 竞态）
- **P1-02** 脚本运行接入首次确认（localStorage 记忆）+ 并发上限 3 进程
- **P1-03** LSP 增加 URI 门禁（文件 URI 必须在授权工作区内）、连接上限 8、单帧 4MB、请求 10s 超时、初始化失败主动重连（不再保留「OPEN 但未初始化」假连接）
- **P1-04** 大文件截断后只读并禁止保存（防尾部数据覆盖丢失）
- **P1-05** dirty tab 关闭 / 关闭编辑区 / 切换工作区均有保存确认守卫
- **P1-06** 异步打开文件改用函数式 update 合并（防陈旧快照覆盖并发打开的文件）
- **P1-07** 跨文件 WorkspaceEdit 写入携带 baseMtime 冲突检测，拒绝截断/工作区外目标
- **P2-01** 修复关闭活动中间 tab 时 activeTabId 指向已移除 tab 的问题
- **P2-02** 宿主 DOM 重建后自动重新挂载面板（`waitForElement` 持续监听）；sidebar 宽度实时读取
- **P2-03** 文件树 / Git 面板异步响应增加 root/repo 代际校验（generation token）
- **P2-04** LSP 客户端仅对支持语言创建（md/go/rust 等不再误拿 TS client）
- **P2-05** 诊断缓存随 root 切换 / 文件关闭清理
- **P2-06** `pnpm-workspace.yaml` 的 `allowBuilds.node-pty` 改为显式布尔值 `true`；`package.json` 锁定 `packageManager: pnpm@11.7.0`
- **P2-07** README 补充 desktop profile 必需说明、卸载/回退步骤、测试命令
- **P2-08** 新增 vitest 单测（来源校验 / LSP URI 门禁 / tab 关闭规则，17 项）+ GitHub Actions CI（typecheck → test → build）

### 功能

- 侧边栏改为文件树常驻主视图 + 右上角小图标切换 Git/问题（问题图标带诊断计数角标）
- 编辑器新增 💾 保存按钮（有未保存更改时可用）
- 编辑器 Ctrl/Cmd + 滚轮调整字号（9–24px，localStorage 记忆，状态栏显示）
- Git 面板支持嵌套仓库发现与选择（工作区根不是 Git 仓库时自动扫描子目录仓库）
- 语法高亮扩展：YAML / XML / SQL / Java / C/C++ / Rust / Go / PHP / Vue / SCSS / LESS / TOML / Batch（.cmd/.bat，自写 StreamParser）/ PowerShell / Shell（共 23 种格式）
- Markdown 高亮补充标题/强调/链接/引用/删除线配色
- 一键安装：`dsh plugin --profile desktop add "dsh-ide-layout@git+https://github.com/myzane678/dsh-ide-layout.git"`（`prepare` 自动构建）
