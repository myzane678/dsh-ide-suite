# Changelog

dsh-ide-suite（monorepo）版本与更新记录，跟随仓库 tag（v0.1.0 起）。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

v0.x 为 `dsh-ide-layout` 单包时代历史（全历史随 subtree 合入保留）；各子包完整明细见其各自 CHANGELOG：[layout](dsh-ide-layout/CHANGELOG.md) · [core](dsh-lsp-core/CHANGELOG.md) · [python](dsh-lsp-python/CHANGELOG.md) · [typescript](dsh-lsp-typescript/CHANGELOG.md) · [powershell](dsh-lsp-powershell/CHANGELOG.md) · [java](dsh-lsp-java/CHANGELOG.md)。

## [1.5.0] - 2026-08-30

代码高亮全面对齐 VS Code 默认主题（Light+ 官方色板 + Dark+ 暗色默认组）+ 编辑器语言覆盖扩展约 25 种 + 修复编辑区盖住原生标题栏。仅 `dsh-ide-layout` 升级（1.4.2 → 1.5.0），其余六包不变。

### 新增

- **代码高亮完全对齐 VS Code 默认主题**：亮色 = Light+ 官方色板（色值取自 microsoft/vscode 官方主题 JSON）——字符串 `#A31515`、变量/属性 `#001080`、控制流关键字紫色 `#AF00DB`、Markdown 标题 `#800000` 加粗；补齐正则/转义字符/HTML 标签与属性名/this/CSS 单位等 token；去掉 VS Code 没有的关键字加粗与注释斜体；编辑器默认文字色对齐 VS Code 前景。**暗色 = Dark+ 默认组**（挂载注入 `body[data-ds-dark-theme]` 变量组，暗色不再依赖皮肤覆盖，并修复暗主题下运算符/标点掉回亮色深灰、深底看不清的问题）。唯一保留偏差：invalid token 中性灰（红色只留给 LSP 报错波浪线）。
- **语言覆盖扩展（约 25 种，零新增依赖）**：配置/工程文件（Makefile、Dockerfile、.gitignore、.editorconfig/.npmrc/.env/.ini、Jenkinsfile/Gradle 等）+ 编程语言（C#、Kotlin、Scala、Objective-C、Ruby、Lua、Swift、R、Perl、Haskell、Clojure、Erlang、F#、OCaml、VB、CoffeeScript、Julia、Tcl、Scheme、汇编等）+ CMake/diff/Protobuf/LaTeX/Gherkin/Pug；状态栏展示名表同步；未收录扩展名仍为纯文本（同 VS Code）。

### 修复

- **编辑区盖住原生标题栏**：fixed workbench portal 与聊天拖拽手柄从实测原生标题栏底部开始（四级探测：WCO API → 忽略大小写 titlebar 类名 → elementsFromPoint 命中探针（不依赖类名）→ sidebar 顶部兜底；无标题栏环境回退 0 原行为；WCO geometrychange 自动跟随）。

### 版本

dsh-ide-layout 1.4.2 → 1.5.0；dsh-lsp-core / python / typescript / powershell / java / rust 不变。

> dsh-lsp-powershell 的 vendor tgz 资产无变化，仍使用 v1.0.0 提供的 dsh-lsp-powershell-1.0.0.tgz。

## [1.4.2] - 2026-08-23

编辑器交互打磨：补全框底部预留空间（对齐 VS Code scrollBeyondLastLine）+ 修复「运行后鼠标点不动光标」偶发 bug（签名框失焦残留）。仅 `dsh-ide-layout` 升级（1.4.1 → 1.4.2），其余六包不变。

### 新增

- **补全框底部预留空间**：编辑器底部保留 9 行空白（`scrollMargins` + `.cm-content` paddingBottom，em 跟随字号缩放）——代码写到底时补全框始终显示在光标下方，不再翻转盖住上方代码（对齐 VS Code scrollBeyondLastLine）。

### 修复

- **「运行完代码后鼠标无法点击光标」偶发 bug**（点不动光标、键盘无效、拖拽还能选中）：签名提示框失焦残留盖住编辑器、吞掉 mousedown——`signatureTooltipField` 只在 state 变化时更新，光标在括号内直接点「▶ 运行」→ 失焦无 transaction → 残留；修复为失焦即清除签名框（补全框 autocomplete 自带失焦清理，签名框此前没有）。

### 版本

dsh-ide-layout 1.4.1 → 1.4.2；dsh-lsp-core / python / typescript / powershell / java / rust 不变。

> dsh-lsp-powershell 的 vendor tgz 资产无变化，仍使用 v1.0.0 提供的 dsh-lsp-powershell-1.0.0.tgz。

## [1.4.1] - 2026-08-23

修复：外部 git 操作（命令行/外部工具 commit、checkout、push、pull）后 Git 面板与未提交角标不刷新。仅 `dsh-ide-layout` 升级（1.4.0 → 1.4.1），其余六包不变。

### 修复

- host watcher 不再整体抑制 `.git` 目录事件：`isIgnoredWatchPath` 放开 `.git`，新增 `isIgnoredDotGitPath` 只过滤高频噪声（`objects/**`、各类 `index.lock`、watchman cookie），保留 `HEAD`/`refs/**`/`index`/`ORIG_HEAD` 等关键变化——命令行 commit/checkout/push 后自动触发 gitTick 刷新（对齐 VS Code DotGitWatcher）。

### 版本

dsh-ide-layout 1.4.0 → 1.4.1；dsh-lsp-core / python / typescript / powershell / java / rust 不变。

> dsh-lsp-powershell 的 vendor tgz 资产无变化，仍使用 v1.0.0 提供的 dsh-lsp-powershell-1.0.0.tgz。

## [1.4.0] - 2026-08-23

Git 面板事件驱动自动刷新（对齐 VS Code）+ 未提交变更角标 + diff 收起修复。仅 `dsh-ide-layout` 升级（1.3.0 → 1.4.0），其余六包不变。

### 新增

- **Git 面板事件驱动自动刷新**：host 递归 fs.watch → SSE → `gitTick` 计数器（与文件树 `treeTick` 同源）→ GitPanel 收到后 1s 防抖 + 5s 冷却自动重刷 `git status`——改了 git 库内容面板自动提示，无需手动点 ⟳；写操作进行中跳过（防抢 index 锁）。
- **Git 未提交变更角标**：侧边栏「🛠 Git」按钮蓝底白字角标（汇总所有嵌套仓库变更总数，>99 显示 99+）；Git 面板仓库下拉框每个仓库选项显示各自未提交数（`name（main）· N`）。

### 修复

- Git 面板 diff 展开无法收起：`viewDiff` 补 toggle，再点同一行即收起。

### 版本

dsh-ide-layout 1.3.0 → 1.4.0；dsh-lsp-core / python / typescript / powershell / java / rust 不变。

> dsh-lsp-powershell 的 vendor tgz 资产无变化，仍使用 v1.0.0 提供的 dsh-lsp-powershell-1.0.0.tgz。

## [1.3.0] - 2026-08-23

Java 工具链 A 方案（构建/运行项目）+ 对话消息导航条（复刻网页版 ScrollNav）。仅 `dsh-ide-layout` 升级（1.2.0 → 1.3.0），其余六包不变。

### 新增

- **Java 工具链 A 方案**：文件树对项目根/标记文件右键「🔨 构建项目」「▶ 运行项目」——`/dsh-ide/build` 路由（workspace 门禁 + 120s 超时 + 8MB 输出上限）驱动 build-service（Maven 三步 / Gradle gradlew run、wrapper 优先、主类探测、多主类前端选择）；`spawnCommand` 重构（Windows cmd /c + cmdQuote 逐参转义，防注入）。
- **对话消息导航条 MessageNav**：聊天区右缘短横线节点条（每条用户消息一个节点），悬停「放大」为 240px 消息面板（复刻 DeepSeek 网页版 ScrollNav），点击跳转 + 目标行闪烁；动态避让贴合聊天区右缘，不遮编辑器。

### 版本

dsh-ide-layout 1.2.0 → 1.3.0；dsh-lsp-core / python / typescript / powershell / java / rust 不变。

> dsh-lsp-powershell 的 vendor tgz 资产无变化，仍使用 v1.0.0 提供的 dsh-lsp-powershell-1.0.0.tgz。

## [1.2.0] - 2026-08-22

编辑器交互打磨：右键「重启 LSP 连接」+ 补全/签名提示体验优化。仅 `dsh-ide-layout` 升级（1.1.0 → 1.2.0），其余六包不变。

### 新增

- **编辑器右键「🔄 重启 LSP 连接」菜单**（仅当前文件有 LSP 会话时显示）：`lspTick` +1 触发 LSP 订阅 effect 重跑——cleanup `disposeRoot` 销毁当前 root 全部会话，effect 按会话组重新 `acquire` + `connect`（新 WebSocket，宿主重新 spawn 语言服务器子进程）。专治 fatal（WS 1011：服务器进程退出/门禁拒绝/服务器不可用）停止重试后的「LSP 不可用」；仅重建连接，编辑器/终端/面板状态不受影响，状态栏自动回「连接中…」→「已连接」。

### 改进

- **补全门控对齐 VS Code 触发字符语义**：非显式触发（Ctrl+Space 除外）时，仅光标前为标识符字符或 `.` 才自动弹补全；敲完括号/逗号/空格等标点后不再弹候选（此时应显示签名框）。
- **签名框与补全框互斥让位 + 去闪烁**：补全框打开时隐藏签名框（等价 VS Code 参数提示让位）；括号内输入/移动不再每次隐藏重弹，改为原位刷新签名内容。

### 版本

dsh-ide-layout 1.1.0 → 1.2.0；dsh-lsp-core / python / typescript / powershell / java / rust 不变。

> dsh-lsp-powershell 的 vendor tgz 资产无变化，仍使用 v1.0.0 提供的 dsh-lsp-powershell-1.0.0.tgz。

## [1.1.0] - 2026-08-22

Rust 插件首发 + 文件树搜索 + LSP 会话链路三处修复；CI 回归门禁上线。`dsh-ide-layout` / `dsh-lsp-core` 升至 1.1.0，`dsh-lsp-rust` 首发 0.1.0，python / typescript / powershell / java 不变（1.0.0）。

### 新增

- **dsh-lsp-rust 0.1.0**：Rust 语言插件（rust-analyzer 本机发现：`DSH_RUST_LS_HOME` → `~/.cargo/bin` → PATH，未找到降级纯高亮）——「新语言插件 = 编辑器零改动」首次兑现（layout 内置表早有 rs 高亮与展示名）。
- **文件树搜索（资源管理器式）**：树顶搜索框输入即过滤（防抖），命中高亮、目录点击定位回树；host 递归遍历跳过 `node_modules`/`.git`，双上限防拖死，门禁复用。
- **CI 回归门禁**：GitHub Actions（ubuntu，Node 22 + pnpm frozen lockfile）七包 build + 全量测试（125 项）。
- `lspCapabilities.sessionLanguages()`：编辑器 LSP 状态订阅注册表驱动（新语言自动进列表）。

### 修复

- **JDTLS 等重型服务器 initialize 超时**（10s → 60s）：原超时引发重连风暴（JVM 抢 `-data` 工作区锁崩溃 + 占满桥连接上限连累其他语言卡「连接中」）。
- **LSP 状态订阅硬编码四语言**：rust 状态栏永远「… LSP」（服务器实际已连）。
- **Node（undici）WebSocket error 事件同步 close 重入爆栈**（CI ubuntu 复现，Windows 本地不触发）。

## [1.0.1] - 2026-08-22

仅 `dsh-ide-layout` 升级（1.0.0 → 1.0.1），其余五包不变。

### 修复

- 非 LSP 语言（json/md/yaml 等）状态栏语言名显示 `plaintext`（1.0.0 拆分引入的退化）——新增轻量语法注册表 `language-names.ts`（扩展名 → 展示名，与内置语法表同步维护）；状态栏按「LSP 注册表 → 内置展示名表 → plaintext」三级回退，LSP 语言仍优先走注册表 displayName。

## [1.0.0] - 2026-08-22

LSP 拆分工程完成，六包全家桶（超级大更新）。`dsh-ide-layout` 全历史并入 monorepo（v0.1.0 起保留）。

### 新增 / 重构

- monorepo `dsh-ide-suite`：编辑器外壳（`dsh-ide-layout`，语言无关化）+ LSP 基础设施（`dsh-lsp-core`）+ 四语言插件（python / typescript / powershell / java）——新增一种语言的 LSP 支持 = 新增一个插件，编辑器零改动。
- tsserver 会话归一：一条会话服务 ts/tsx/js/jsx（不再每语言一进程）。
- PowerShell vendor（PSES + PSSA）不入 git，经 Release tgz 资产分发。

### 修复

- 三处产物级 bug：client inject 漏声明 lspRegistry（启动崩）；CodeMirror 扩展跨 bundle 双副本（`.py` 打不开）；host 入口 inject 被 tsdown 摇掉。

## [0.3.1] - 2026-08-21（dsh-ide-layout）

- 编码选择菜单被覆盖：改为贴按钮上沿向上生长，空间不足自动向下弹防截断。
- 全部 body 浮层 z-index 统一拉满（2147483000），杜绝被 workbench 或皮肤浮层覆盖。

## [0.3.0] - 2026-08-21（dsh-ide-layout）

- 编辑器编码选择（UTF-8 / 自动检测 / GB18030 / GBK / Big5 / UTF-16 LE，中文旧文件不乱码、保存按所选编码写回）。
- 图片预览（png/jpg/gif/webp/bmp/ico/avif，滚轮缩放；host 侧 MIME 白名单 + 25MB 上限）。
- Tab / Shift+Tab 缩进（多行整块）、Enter 自动缩进 4 空格，行为对齐 VS Code。

## [0.2.0] - 2026-08-20（dsh-ide-layout）

- GitLens 式行内 blame（gutter 逐行标注 + 悬停完整提交信息）。
- PowerShell（PSES vendor，补全/诊断/跳转/格式化/重命名）与 Java（JDTLS，未装自动降级纯高亮）语言智能；Java 单文件运行。
- 终端右键菜单（复制 / 粘贴 / 清屏 / 重启终端）；LSP 状态栏按服务器分槽；高亮配色去红（红色只留给诊断波浪线）。

## [0.1.0] - 2026-08-19（dsh-ide-layout）

- 初始发布：文件树 + CodeMirror 6 编辑器（TS / Python LSP：补全/诊断/悬停/跳转/重命名/格式化/快速修复）+ xterm 终端 + Git 面板 + 问题面板。
- 含 18 项独立安全审查整改（WebSocket 来源校验、PTY 引用计数、Git 仓库根校验、LSP URI 门禁与连接/帧上限等）。
