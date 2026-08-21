# Changelog

dsh-ide-suite（monorepo）版本与更新记录，跟随仓库 tag（v0.1.0 起）。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

v0.x 为 `dsh-ide-layout` 单包时代历史（全历史随 subtree 合入保留）；各子包完整明细见其各自 CHANGELOG：[layout](dsh-ide-layout/CHANGELOG.md) · [core](dsh-lsp-core/CHANGELOG.md) · [python](dsh-lsp-python/CHANGELOG.md) · [typescript](dsh-lsp-typescript/CHANGELOG.md) · [powershell](dsh-lsp-powershell/CHANGELOG.md) · [java](dsh-lsp-java/CHANGELOG.md)。

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
