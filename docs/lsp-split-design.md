# dsh-ide-layout LSP 拆分工程 — 阶段 0 设计文档

> 日期：2026-08-21 · 状态：已确认方向（B 方案），机制验证完成，待大都督确认后进入阶段 1
> 决策记录：编辑器留在外壳但**语言无关**；monorepo 组织；先 Python 垂直切片；四项驱动（按需安装 / 故障隔离 / 加语言方便 / 可维护性）

## 1. 目标架构

```
E:\dsh-plugins（monorepo 根，pnpm workspace）
├── pnpm-workspace.yaml
├── dsh-ide-layout       外壳：文件树 / 编辑器(语言无关) / 终端 / Git / 问题面板 / 状态栏
├── dsh-lsp-core         LSP 基础设施：host 桥（进程管理/WS/门禁）+ client 库（LanguageCapability）
│                        + 语言注册表（client：语法包；host：服务器配置）
├── dsh-lsp-python       Python 插件（pyright）——垂直切片第一个
└── （后续）dsh-lsp-java / dsh-lsp-typescript / dsh-lsp-powershell
```

协作关系（client）：
```
dsh-lsp-python ──ctx.lspRegistry.register({python, [py,pyw], syntax: () => python(), ...})──▶ dsh-lsp-core
dsh-ide-layout ──inject ['lspRegistry']，打开 .py 时 ctx.lspRegistry.match(path) ──▶ 编辑器拿语法包 + LanguageCapability
```

协作关系（host）：
```
dsh-lsp-python ──ctx.lspServerRegistry.register({languageId:'python', command:['pyright-langserver','--stdio']})──▶ dsh-lsp-core
dsh-ide-layout ──（不动，fs/路由/终端/git 保持）──▶ 编辑器经 client 能力层请求 /dsh-lsp/ws
```

## 2. DSH 多插件机制验证结论（阶段 0 关键产出）

| # | 机制 | 结论 | 证据 |
|---|------|------|------|
| 1 | **host 侧跨插件服务** | `class X extends Service { constructor(ctx){ super(ctx,'name') } }`，消费方 `inject=['name']` | 宿主 `@deepseek-ai/dsh-fs`：`class FileSystem extends Service { super(ctx,'fs') }` → `ctx.fs` |
| 2 | **client 侧跨插件服务** | `ctx.provide('name', service)` 在 apply() 开头发布；消费方 `inject=['name']`，**服务就绪后才激活**（cordis 保证） | `dsh-better-sidebar/src/client/index.tsx`：`ctx.provide('betterSidebar', service)`；AGENTS.md 消费文档 |
| 3 | **类型合并** | 提供方 `declare module 'cordis'` + `declare module '@deepseek-ai/cordis'` 双 scope；消费方 `import type {}` 触发 | `dsh-better-sidebar/src/context-types.ts:414-476` |
| 4 | **生命周期** | 注册必须 `ctx.effect(() => register(...), label)`，disposer 由 fiber 卸载自动调用（HMR-safe） | better-sidebar AGENTS.md §6 |
| 5 | **挂载/安装** | 每插件自带 `cordis.patch.yml`（`dsh.bundle.patch`），官方 CLI `dsh plugin add` 自动 append 到 profile bundle 栈；或 profile 手动引用 | better-sidebar cordis.patch.yml 注释；file-upload/drop-in 同构 |
| 6 | **构建纯度门** | client bundle 禁止 value-import 其他插件；**类型 import 可自由共享**；运行时交互全走 ctx 服务方法 | better-sidebar AGENTS.md §7 |
| 7 | **跨 bundle 值传递** | 注册 descriptor 可含函数引用（组件/语法工厂），运行时 JS 对象传递可行 | better-sidebar `registerTab({component})` 先例 |
| 8 | **host 路由** | `ctx.webServer.register({kind:'prefix',path,handler})` 每插件独立前缀，互不冲突 | layout `/dsh-ide/*`；lsp-core 用 `/dsh-lsp/*` |
| 9 | **消费方骨架** | 提供方声明为 `peerDependencies`（`workspace:*`）+ `peerDependenciesMeta.optional`，未装提供方也能加载 | better-sidebar AGENTS.md §2.1 |
| 10 | **CI 冒烟** | 打包 → 真实 profile 挂载 → 无头渲染断言（Playwright），可作为拆分回归门禁 | better-sidebar `.github/workflows/ci.yml` plugin-mount job |

**结论：DSH 多插件 client/host 协作机制完备且有双先例（宿主 dsh-fs + better-sidebar），拆分方案可行，无需退回折中方案。**

## 3. 接口设计（阶段 0 交付物）

### 3.1 client：语言注册表（`dsh-lsp-core` 提供 `ctx.lspRegistry`）

```ts
// dsh-lsp-core/src/client/registry.ts（提供方导出类型）
import type { Extension } from '@codemirror/state'

export interface LanguageDescriptor {
  /** 唯一 id：'python' / 'java' … */
  id: string
  displayName: string
  /** 小写扩展名（无点）：['py','pyw'] */
  extensions: readonly string[]
  /** CodeMirror 语法扩展工厂（值在语言插件 bundle 内；跨 bundle 函数引用） */
  syntax?: () => Extension
}

export interface LspRegistryService {
  /** 语言插件调用；返回 disposer（必须包在 ctx.effect 里） */
  register(descriptor: LanguageDescriptor): () => void
  get(id: string): LanguageDescriptor | undefined
  /** 按路径扩展名匹配 */
  match(path: string): LanguageDescriptor | undefined
  list(): readonly LanguageDescriptor[]
  /** 注册表变化订阅（编辑器 useSyncExternalStore） */
  subscribe(listener: () => void): () => void
}

declare module 'cordis' {
  interface Context { lspRegistry: LspRegistryService }
}
declare module '@deepseek-ai/cordis' {
  interface Context { lspRegistry: LspRegistryService }
}
```

### 3.2 client：语言能力（编辑器消费；LSP 会话的封装）

```ts
// dsh-lsp-core/src/client/capability.ts（LanguageCapability 接口 + SessionManager 实现）
export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }
export interface LspCompletionItem { label: string; kind?: number; detail?: string; documentation?: unknown; insertText?: string; insertTextFormat?: number; textEdit?: { range: LspRange; newText: string }; commitCharacters?: string[]; sortText?: string }
export interface LspSignatureHelp { signatures: Array<{ label: string; documentation?: unknown }>; activeSignature?: number; activeParameter?: number }
export interface LspDiagnostic { severity: number; range: LspRange; message: string }

/** 一个文件的语言能力会话（连接生命周期内复用） */
export interface LanguageCapability {
  readonly languageId: string
  /** 'connecting' | 'ready' | 'error'（状态栏展示） */
  readonly status: 'connecting' | 'ready' | 'error'
  openDocument(path: string, content: string): void
  updateDocument(path: string, content: string): void
  closeDocument(path: string): void
  completion(path: string, position: LspPosition): Promise<LspCompletionItem[] | null>
  hover(path: string, position: LspPosition): Promise<{ contents: unknown } | null>
  signatureHelp(path: string, position: LspPosition): Promise<LspSignatureHelp | null>
  definition(path: string, position: LspPosition): Promise<Array<{ uri: string; range: LspRange }>>
  rename(path: string, position: LspPosition, newName: string): Promise<unknown | null>
  formatting(path: string): Promise<Array<{ range: LspRange; newText: string }>>
  codeAction(path: string, range: LspRange): Promise<Array<{ title: string; edit?: unknown }>>
  /** 诊断订阅（编辑器波浪线 + ProblemsPanel 共用） */
  onDiagnostics(cb: (uri: string, diagnostics: LspDiagnostic[]) => void): () => void
  onStatus(cb: (status: 'connecting' | 'ready' | 'error') => void): () => void
}

/** lsp-core 内部：按 (root, languageId) 管理连接（迁移自 EditorPane 的 tsLsp/pyLsp/psLsp/javaLsp 状态） */
export interface LspSessionManager {
  acquire(root: string, languageId: string): LanguageCapability | null
  disposeRoot(root: string): void
}
```

编辑器消费模式（layout 内，阶段 1 改造点）：
- 打开文件：`descriptor = ctx.lspRegistry.match(path)`；`descriptor?.syntax?.()` 得语法扩展；`capability = manager.acquire(root, descriptor.id)`（null = 纯高亮）
- 所有 LSP 交互（补全/悬停/签名/linter/跳转/重命名/格式化/codeAction）从"直接调 lsp-client"改为"调 capability"；诊断经 `onDiagnostics` 进 diagMap

### 3.3 host：语言服务器注册表（`dsh-lsp-core` 提供 `ctx.lspServerRegistry`）

```ts
// dsh-lsp-core/src/host/server-registry.ts
export interface LspServerConfig {
  languageId: string
  /** 启动命令（含参数）：['pyright-langserver','--stdio'] */
  command: readonly string[]
  /** 服务器发现（JDTLS 复用本机扩展场景；返回 null 表示不可用，编辑器降级纯高亮） */
  discover?: () => Promise<readonly string[] | null>
  initializationOptions?: unknown
}

export interface LspServerRegistryService {
  register(config: LspServerConfig): () => void
  match(languageId: string): LspServerConfig | undefined
}
```

- lsp-core host 迁移 `lsp-service.ts` 的进程管理 / stdio↔WS 透传 / URI 门禁 / FrameReader / 连接上限，服务器命令改从 `ctx.lspServerRegistry.match()` 查
- 路由前缀 `/dsh-lsp/ws?root=...&language=...`（与 `/dsh-ide/*` 隔离）

### 3.4 语言插件骨架（dsh-lsp-python 示例）

```
dsh-lsp-python/
├── package.json            # peerDependencies: dsh-lsp-core(workspace:*) optional + react; dependencies: pyright, @codemirror/lang-python
├── cordis.patch.yml        # insert: - id: lsp-python / name: 'dsh-lsp-python'
├── src/index.ts            # host: inject ['lspServerRegistry'] → register({python, pyright})
└── src/client/index.ts     # client: inject ['lspRegistry'] → register({python, syntax: () => python()})
```

## 4. 现有代码映射

| 现有（dsh-ide-layout） | 去向 | 说明 |
|---|---|---|
| `src/host/lsp-service.ts`（16KB） | → `dsh-lsp-core/src/host/` | 服务器命令改查 registry；路由前缀 /dsh-lsp |
| `src/client/lsp-client.ts`（24KB） | → `dsh-lsp-core/src/client/capability.ts` | 封装基本原样，导出为 LanguageCapability 实现 |
| EditorPane LSP 扩展（autocompletion override / hoverTooltip / signatureHelp / linter / F12/F2 / format / codeAction / shouldRequestSignature 等） | → 阶段 3 移入 lsp-core 的「编辑器适配层」或 layout 内 `lsp-editor-bridge.ts` | 阶段 1 先改为调 capability |
| EditorPane `languageFor()`（20+ lang-* switch） | 拆分：Python → dsh-lsp-python 注册；**其余高亮包暂留 layout**（后续可再抽语法包插件） | 阶段 1 只动 Python |
| `core/types.ts` `languageIdForPath()` | → 注册表 `match()` 逻辑 | 阶段 1 双轨 |
| `tests/language-support.test.ts` | → dsh-lsp-core | |
| pyright / ts-server / PSES / JDTLS 依赖 | → 各语言插件 | 按需安装 |

## 5. 分阶段计划与完成标准

- **阶段 1（Python 垂直切片）**：monorepo 骨架 → dsh-lsp-core（host 桥 + client 库 + 注册表）→ dsh-lsp-python → layout 的 Python 分支走新链路（ts/ps/java 双轨保留旧代码）→ 端到端验证
  - ✅ 完成标准：monorepo 一次安装；dsh-lsp-python 独立构建；打开 .py 高亮/补全/诊断/签名/跳转与拆分前一致；.ts/.ps1/.java 不回归；测试全绿（现有 76 项映射）
- **阶段 2**：java / typescript / powershell 逐个迁移（每语言一个切片，独立发版）
- **阶段 3**：删净 layout 旧 LSP 代码；编辑器完全语言无关；lsp-core 编辑器适配层成型；每插件独立版本/CHANGELOG/release

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 拆分期间编辑体验回归 | 双轨运行 + 每阶段 GUI 实测 + 测试映射 + （可选）better-sidebar 式 CI 挂载冒烟 |
| pyright 等依赖迁移后启动链路变化 | 语言插件独立依赖，lsp-core 不感知具体服务器；切片验证时重点测启动 |
| monorepo 影响现有 link 安装 | 阶段 1 先建 workspace 骨架并保持 layout 原位，验证 `pnpm install` + DSH 加载后再移动 |
| LSP 请求时序/竞态（历史教训） | capability 层完整保留 lsp-client 的竞态处理（补全 id 只增不减等），迁移时逐行对照 |

## 7. 待大都督确认

1. 本设计文档是否认可，是否进入阶段 1（monorepo 骨架 + Python 切片）
2. 语法高亮包策略：非 LSP 语言（json/md/yaml 等 20 个）阶段 1 暂留 layout，后续再抽「语法包插件」——是否同意
3. monorepo 根目录即 `E:\dsh-plugins`（现工作区）还是新建子目录（如 `E:\dsh-plugins\monorepo`）

---

## 8. 阶段 1 进展（2026-08-21 晚，已实现待 DSH 重启实测）

**已确认决策**：编辑器留在外壳但语言无关；monorepo 建在 `E:\dsh-plugins\monorepo`（原 dsh-ide-layout 已迁入，git 历史保留）；先 Python 垂直切片；高亮包阶段 1 留 layout。

**已落地**：
- `E:\dsh-plugins\monorepo`（pnpm workspace）：`dsh-ide-layout`（迁移，历史保留）+ `dsh-lsp-core` + `dsh-lsp-python` 三包，一次 `pnpm install` 全部构建 ✓
- **dsh-lsp-core**（0.1.0）：client `ctx.lspRegistry`（语言注册表）+ `ctx.lspCapabilities`（能力工厂，LspSession 会话管理）+ LanguageCapability 接口 + host `ctx.lspServerRegistry`（服务器注册表）；LSP 类型统一单一来源（`src/client/types.ts`）
- **dsh-lsp-python**（0.1.0）：client 注册 python 语言（语法包 + pyright 宽松配置：useLibraryCodeForTypes:false / autoImportCompletions）；host 注册 pyright 服务器命令
- **dsh-ide-layout**（0.3.1→开发中）：EditorPane 的 Python 分支改走 lsp-core 链路（`lspCapabilities.acquire(root,'python',{wsUrl:'/dsh-ide/ws/lsp?server=py'})`——host 桥未迁，阶段 2 换 /dsh-lsp/ws）；`languageFor()` Python 语法包查注册表（插件未装 fallback 内置）；旧 ts/ps/java 双轨保留（LspClient 已实现 LanguageCapability 接口）；旧 pyLsp 停建（防双 pyright 连接）
- **desktop profile**：dependencies 加 dsh-lsp-core / dsh-lsp-python link，`dsh.profile.bundles` 加两项；dsh-ide-layout link 改 monorepo 路径
- **测试**：layout 76 项 ✓（类型统一后语言支持测试仍绿）+ lsp-core 8 项 + lsp-python 9 项 ✓ = **93 项全绿**
- **跨插件链路冒烟（不依赖 DSH）**：`dsh-lsp-python/tests/host-apply.test.ts` 与 `client-apply.test.ts` 用模拟 cordis ctx（provide 挂属性 + effect 手动执行）验证：
  - host：lsp-core apply（提供 lspServerRegistry）→ lsp-python apply（注册 pyright）→ `match('python')` 命中且命令可解析
  - client：lsp-core apply（提供 lspRegistry/lspCapabilities）→ lsp-python apply（注册语言）→ 扩展名命中、语法工厂可用、`acquire('python')` 得会话 / 未注册语言得 null 能力

**关键实现经验（后续阶段参考）**：
- **浏览器纯度门**：client bundle 禁止 value-import 其他插件——跨插件交互只能经 ctx 属性；类型可 `import type` 自由共享。ctx 服务访问用「类型模板」断言（`LspRegistryAccessor` 等），避免依赖 cordis Context augmentation（`@deepseek-ai/cordis` 的 .d.ts 引用不存在的 .ts 文件，augmentation 解析失败）
- **cordis ctx.effect 类型**：DSH client/host 的 `ctx.effect` 要求回调返回 disposer（`() => void` 直接报类型错）；语言插件注册用 `effectCtx.effect(() => registry.register(d), label)`
- **wsUrl 保留参数**：LspSession 连接时合并 URL 既有 search（阶段 1 旧桥 `?server=py` 不被覆盖）

**待 DSH 重启实测**（client 刷新页面 + host 重启）：打开 .py 文件 → 高亮（来自 dsh-lsp-python bundle）/ 补全 / 诊断 / 签名 / 跳转与拆分前一致；ts/ps/java 不回归。host 桥迁移（lsp-service → lsp-core 的 /dsh-lsp/ws + 注册表驱动）与 ts/ps/java 插件化属阶段 2。

---

## 9. 阶段 2 / 3 执行计划（2026-08-21 夜，待阶段 1 实测通过后执行）

### 阶段 2A：host 桥迁移到 dsh-lsp-core

1. **`dsh-lsp-core/src/host/bridge.ts`**（从 layout `lsp-service.ts` 迁移，370 行）：
   - FrameReader / uriWithinRoot / uriPrefixFor / LSP_MAX_CONNECTIONS(8) / LSP_MAX_FRAME_BYTES(4MB) 原样
   - `attachLspSocket(ctx, req, ws)` 改造：URL 参数 **`language`**（替代 `server`）→ `getLspServerRegistry(ctx).match(language)` 取 `LspServerConfig` → `spawn(config.command, { cwd, env: { ELECTRON_RUN_AS_NODE: '1' } })`
   - `config.discover?.()` 支持（JDTLS 场景：返回 null → close(1011, '语言服务器不可用')）
   - 连接上限 / URI 门禁 / 单帧上限 / stdio↔WS 透传 / stderr 完整日志原样
   - 来源校验：从 layout `security.ts` 迁移 `isLoopbackRequest` 副本（lsp-core 不依赖 layout）
2. **`dsh-lsp-core/src/host/index.ts`**：inject 加 `'webServer'`；注册 upgrade `/dsh-lsp/ws`（参照 layout index.ts 的 LSP WebSocket 块，WebSocketServer({noServer:true}) + handleUpgrade）
3. `package.json`：dependencies 已有 ws ✓

**⚠️ 接口修正（阶段 2 必须）**：`LspServerConfig.command` 是静态 `readonly string[]`，但 JDTLS 的 `-data <dir>` 依赖 root（`join(tmpdir(), 'dsh-ide-jdtls', sha1(root))`）。需支持动态命令：加 `commandFor?: (root: string) => readonly string[]`（优先于 command）；`discover` 语义保持「探测可用性」（JDTLS 场景：discover 找到 launcher 后由 commandFor 构造完整命令）。

### 阶段 2B：ts / ps / java 插件化（同步进行，避免桥迁移后断档）

| 插件 | host 注册（lspServerRegistry） | client 注册（lspRegistry） |
|---|---|---|
| `dsh-lsp-typescript` | `{languageId:'typescript', command:[process.execPath, require.resolve('typescript-language-server/lib/cli.mjs'), '--stdio']}`（ts/tsx/js/jsx 共用） | ts/tsx/mts/cts/js/mjs/cjs + jsx 语法包（`javascript({typescript:true,jsx:true})`） |
| `dsh-lsp-powershell` | PSES 启动：`pwsh -NoLogo -NoProfile -Command "& '<plugin>/vendor/PowerShellEditorServices/Start-EditorServices.ps1' -Stdio -HostName 'DSH IDE' -HostProfileId 'dsh-ide' -HostVersion '1.0.0' -BundledModulesPath '<plugin>/vendor' -LogLevel Error"`；**插件自带 vendor/**（PSES 模块随包，按需安装的代价） | ps1/psm1/psd1 + PowerShell 语法包（legacy-modes） |
| `dsh-lsp-java` | `discover` 复用本机 JDTLS（`DSH_JAVA_LS_HOME` / `~/.vscode/extensions/redhat.java-*`，参照 findJavaLauncher）+ `commandFor` 构造完整命令（含 `-data <tmpdir>/dsh-ide-jdtls/<sha1(root)>`）；找不到返回 null → 编辑器降级纯高亮 | java + Java 语法包 |

- 每个插件：cordis.patch.yml + profile link + bundles 加项；descriptor 带完整 server 配置（ts: null 配置即可；ps: 需要 window/logMessage 透传；java: initializationOptions 参照旧 LspClient）
- **语言专属配置从 layout 的 LspClient.configFor 迁出**（py 已在 lsp-python；ts/ps/java 各自的 workspaceConfiguration/didChangeConfiguration 移入对应插件）

### 阶段 2C：layout 侧收敛

- 删 `attachLspSocket` 挂载 + `lsp-service.ts`；`routes.ts` 的 `/dsh-ide/*` 保留（fs/git/run 与 LSP 无关）
- `PYTHON_WS_URL` → `'/dsh-lsp/ws'`；`lspFor()` 统一 `capabilities.acquire(root, language)`（删 ts/ps/java 硬编码分支）
- 删旧 `LspClient` 与 tsLsp/psLsp/javaLsp 状态；诊断/状态统一走 capability 订阅
- `languageFor()` 的 Python 查注册表逻辑扩展为全语言（非 LSP 语言 json/md/yaml 等保留内置 fallback）

### 阶段 3：编辑器语言知识收敛（2026-08-22 定案并完成）

原计划（editor-bridge 迁移 + lsp-client.ts 删除）经宿主能力验证后**修订**：

- **@codemirror/* 宿主单来源不可行**：宿主 `dsh-client-web` 的 `getStaticModules()` 是硬编码清单（react 系 + @deepseek-ai 系九个），浏览器 `__ModuleLoader__` 的 require 只查 seed/statics/factories 三表，任意 npm 包无法注入——语言插件**永不注册 syntax**，语法高亮固定由 dsh-ide-layout 内置表单副本构造（新语言要高亮需 layout 内置表支持；LSP 则完全插件化零改编辑器）。
- **editor-bridge.ts 不迁移**：在单来源不可行的前提下，扩展对象必须由消费者 bundle 构造（双副本硬崩），lsp-core 反向接收全部 CodeMirror 构造器的「模块注入式」成本高收益低——**现状（layout 组装扩展 + lsp-core 提供 LSP 逻辑）即合理终态**。
- **已完成**：`LspCapabilityService.languageFor(path)` 返回 `LanguageSummary { id, displayName, sessionId }`（纯查询无副作用）——EditorPane 的 lspFor/lspEnabled/状态栏语言名与 LSP 会话组指示全部改走它，`languageIdForPath`（core/types.ts）删除；lsp-client.ts **保留**（纯度门下 layout 侧的工具函数必要副本：纯函数双副本无害，value-import dsh-lsp-core 会 miss module table）。轻微展示变化：json/md 等非 LSP 语言状态栏语言名显示 plaintext（原显示 'json'/'markdown'）。
- 待大都督拍板：各插件独立版本 / CHANGELOG / release 与 monorepo git 结构。

### 阶段 1 实测清单（大都督重启 DSH 后）

1. 打开 `.py`：高亮（插件 bundle 提供）/ 补全 / 诊断波浪线 / 函数签名 / F12 跳转 —— 与拆分前一致
2. 打开 `.ts` / `.ps1` / `.java`：不回归（双轨旧链路）
3. 若 Python LSP 未启动：查状态栏 LSP 显示、浏览器控制台 `[dsh-lsp-core]` 日志、host 侧 `[dsh-ide-lsp]` 日志
