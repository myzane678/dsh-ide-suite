# dsh-ide-suite

[![CI](https://github.com/myzane678/dsh-ide-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/myzane678/dsh-ide-suite/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.6.1-blue)](https://github.com/myzane678/dsh-ide-suite/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-green)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-orange)](https://pnpm.io)
[![Tests](https://img.shields.io/badge/tests-143%20passed-brightgreen)](#开发)

DSH（DeepSeek Harness）Web GUI 的 IDE 插件套件（monorepo，pnpm workspace）：**编辑器外壳 + 会话置顶条 + LSP 基础设施 + 六语言插件**。v1.6.1——置顶条（dsh-question-pin）设置面板打开时让位，不再遮挡设置。新增一种语言的 LSP 支持 = 新增一个插件，编辑器零改动。

## 功能特性

### 编辑器（CodeMirror 6，`dsh-ide-layout`）

- 浮岛卡片化布局：三分区（侧栏 / agent 卡 / 编辑区）圆角浮岛卡 + 绿色气隙 + 立绘镜像窗
- VS Code 式预览：右键「以预览方式打开」斜体预览 tab（只读），Markdown 渲染文档视图（防注入渲染）；点击 tab / 再点文件 / 开始编辑固定为正式打开
- 终端独立面板：不开编辑区可开终端（高度可拖拽）；编辑区与终端都关时右上悬浮终端钮常驻，动态对齐 Session log
- 语法高亮 23 种语言/格式；行号、代码折叠、状态栏（语言 / 行列 / 诊断数 / LSP 状态）
- LSP 智能能力：自动补全、诊断波浪线、悬停提示、签名提示、F12 / Ctrl+点击 跳转定义、F2 重命名、Shift+Alt+F 格式化、右键快速修复
- Tab / Shift+Tab 缩进（无补全时，多行整块）；Enter 自动缩进 4 空格（VS Code 习惯）
- 编码选择：UTF-8 / 自动检测 / GB18030 / GBK / Big5 / UTF-16 LE / ISO-8859-1——GBK 等中文旧文件不乱码，保存按所选编码写回
- 图片预览（png/jpg/gif/webp/bmp/ico/avif，滚轮缩放）；Ctrl+滚轮字号缩放（9–24px 记忆）
- GitLens 式行内 blame（gutter 逐行标注 + 悬停完整提交信息）
- 工作区文件树（真实文件系统，fs 变更自动刷新；**资源管理器式搜索**：输入即过滤、命中高亮、目录定位回树）、xterm 终端、问题面板、Git 面板

### LSP（语言插件决定）

| 语言插件 | 语言 | 服务器 | 说明 |
|---|---|---|---|
| `dsh-lsp-python` | Python | pyright | 宽松配置防第三方库误报（useLibraryCodeForTypes:false，Pylance 同款行为） |
| `dsh-lsp-typescript` | TS / TSX / JS / JSX | typescript-language-server | 四种 languageId 共享一条 tsserver 会话 |
| `dsh-lsp-powershell` | PowerShell | PowerShell Editor Services | vendor 随插件分发（Release tgz 资产） |
| `dsh-lsp-java` | Java | Eclipse JDTLS | 复用本机 Red Hat VS Code Java 扩展或 `DSH_JAVA_LS_HOME`；未找到自动降级纯高亮 |
| `dsh-lsp-rust` | Rust | rust-analyzer | 复用本机 rust-analyzer（rustup / `DSH_RUST_LS_HOME` / PATH）；未找到自动降级纯高亮 |

架构要点：每条 WebSocket 连接对应一个语言服务器子进程（stdio ↔ WS 透传）；连接上限 8、单帧 4MB、URI 门禁（文件 URI 限授权工作区内）、workspace 门禁、本机 loopback + 同源 Origin 严格校验。

## 包结构

| 包 | 职责 |
|---|---|
| `dsh-ide-layout` | 编辑器外壳（文件树 / 编辑器 / 终端 / Git / 问题面板 / 状态栏）——零语言知识，LSP 全部经 `lspCapabilities` |
| `dsh-question-pin` | 会话置顶条：「这条回答对应哪条提问」——提问滚出视口时 agent 区顶部悬浮提示并可点击跳回（纯浏览器端外挂，可单独安装） |
| `dsh-lsp-core` | LSP 基础设施：client 语言注册表 + 能力工厂（acquire / languageFor）；host 服务器注册表 + `/dsh-lsp/ws` 桥（commandFor / discover） |
| `dsh-lsp-python` / `dsh-lsp-typescript` / `dsh-lsp-powershell` / `dsh-lsp-java` / `dsh-lsp-rust` | 语言插件（dual-face：client 注册语言 + host 注册服务器） |

每包为独立 DSH 插件：host 半区跑在宿主进程（Node/Electron），浏览器半区（`./client` 导出）跑在 Web GUI。

## 环境要求

- DSH Desktop（插件宿主）
- 本地开发：Node ≥ 22、pnpm ≥ 11
- 可选：PowerShell 7（`pwsh`，PowerShell 插件）、JDK 21+ 与 JDTLS（Java 插件）、rust-analyzer（Rust 插件，`rustup component add rust-analyzer`）

## 安装（DSH 插件）

在 DSH profile 的 `package.json` 加依赖并列入 `dsh.profile.bundles`，然后 `pnpm install` 并重启 DSH：

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-ide-layout": "github:myzane678/dsh-ide-suite#v1.6.1",
    "dsh-lsp-core": "github:myzane678/dsh-ide-suite#v1.6.1",
    "dsh-lsp-python": "github:myzane678/dsh-ide-suite#v1.6.1",
    "dsh-lsp-typescript": "github:myzane678/dsh-ide-suite#v1.6.1",
    "dsh-lsp-java": "github:myzane678/dsh-ide-suite#v1.6.1",
    "dsh-lsp-rust": "github:myzane678/dsh-ide-suite#v1.6.1",
    // PowerShell 插件用 Release 的 tgz 资产（vendor 不在 git 内）：
    "dsh-lsp-powershell": "https://github.com/myzane678/dsh-ide-suite/releases/download/v1.0.0/dsh-lsp-powershell-1.0.0.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-ide-layout", "dsh-question-pin", "dsh-lsp-core", "dsh-lsp-python",
        "dsh-lsp-typescript", "dsh-lsp-powershell", "dsh-lsp-java"
      ]
    }
  }
}
```

语言插件按需安装（未装的语言退化为纯高亮，不影响其他语言）。

## 开发

```powershell
git clone https://github.com/myzane678/dsh-ide-suite.git
cd dsh-ide-suite
pnpm install                        # 一次安装全部包
pnpm -r --filter "./*" run build    # 全量构建（dual-face：host esm + browser cjs）
pnpm -r --filter "./*" test         # 全量测试（143 项）
pnpm --filter dsh-lsp-core test     # 单包测试
```

改 src 后必须 rebuild 才生效（DSH 加载的是 `lib/` 构建产物）；client 侧改动刷新页面即可，host 侧改动需完全退出 DSH 重启。

本地联调用 link 安装：profile 依赖写 `"dsh-lsp-core": "link:E:/path/to/dsh-ide-suite/dsh-lsp-core"`。

### 新增语言插件（三步）

1. 复制 `dsh-lsp-python` 骨架（dual-face 包：`src/index.ts` host 注册服务器 + `src/client/index.ts` client 注册语言 + `cordis.patch.yml` + `tsdown.config.ts`）
2. host：`inject = ['lspServerRegistry']`，注册 `{ languageId, command | commandFor | discover }`
3. client：`inject = ['lspRegistry']`，注册 `{ id, displayName, extensions, server }`——**不要注册 `syntax`**（CodeMirror 扩展跨 bundle 会双副本硬崩；新语言的高亮需在 dsh-ide-layout 内置语法表添加）

## 仓库结构

```
dsh-ide-suite/
├── dsh-ide-layout/          # 编辑器外壳（v0.1.0 起的完整历史）
├── dsh-question-pin/        # 会话置顶条（v1.6.0 起，从 dsh-ide-layout 剥离）
├── dsh-lsp-core/            # LSP 基础设施（client 服务 + host 桥）
├── dsh-lsp-python/          # 语言插件 × 4（python / typescript / powershell / java）
│   └── ...
├── docs/lsp-split-design.md # 拆分工程设计文档（阶段 0-3 全记录）
├── CHANGELOG.md             # suite 级更新日志（逐版记录）
└── pnpm-workspace.yaml
```

## 设计文档

LSP 拆分工程的设计与分阶段记录：[docs/lsp-split-design.md](docs/lsp-split-design.md)——阶段 0 机制验证 / 阶段 1 Python 垂直切片 / 阶段 2 host 桥迁移与语言插件化 / 阶段 3 语言无关化收尾（含宿主能力验证结论：`@codemirror/*` 无法注入浏览器，故语法高亮固定由编辑器内置表构造）。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)——v0.1.0 → v1.6.1 逐版记录（v0.x 为 `dsh-ide-layout` 并入前历史）。各子包明细见其各自 CHANGELOG。

## 跨插件协作约定（贡献必读）

- **浏览器纯度门**：client bundle 禁止 value-import 其他插件；跨插件交互只能经 `ctx` 属性，类型经 `import type` 自由共享；工具函数各包留副本（纯函数双副本无害）。
- **CodeMirror 扩展禁止跨 bundle**：`@codemirror/*` 无法注入浏览器（宿主 seed 模块表硬编码），语法高亮固定由 `dsh-ide-layout` 内置表单副本构造，语言插件不注册 syntax。
- **LSP 会话按 sessionId 分组**：同组语言共享一条会话/一个服务器进程（tsserver 一条服务 ts/tsx/js/jsx）。
- **host 入口 `inject` 必须显式导出**：未导出会被 tsdown 摇掉 → DSH 启动即崩（`cannot get property … without inject`）。
- **服务访问**：用「类型模板」断言（`LspRegistryAccessor` 等），不依赖 cordis Context augmentation。
- **生命周期**：语言插件的注册必须包在 `ctx.effect(() => registry.register(d), label)` 里（HMR-safe）。

## 致谢

- [dsh-web-ui](https://github.com/omdsh-dev/dsh-web-ui) / aionui-panel（Apache-2.0）——IDE 布局的参考实现
- [PowerShell Editor Services](https://github.com/PowerShell/PowerShellEditorServices) + [PSScriptAnalyzer](https://github.com/PowerShell/PSScriptAnalyzer)（vendor 内分发）
- pyright / typescript-language-server / Eclipse JDTLS 等语言服务器项目

## License

[MIT](LICENSE) © 2026 myzane678（vendor 内第三方组件遵循各自许可）
