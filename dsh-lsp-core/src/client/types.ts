/**
 * client 侧共享类型：语言注册表（LanguageDescriptor / LspRegistryService）与
 * 语言能力（LanguageCapability）接口。dsh-ide-layout 编辑器与各语言插件
 * （dsh-lsp-python 等）共同依赖；类型经 package.json 的 `./client` 子导出暴露，
 * 消费方 `import type {} from 'dsh-lsp-core/client'` 即触发 ctx 类型合并。
 */

import type { Extension } from '@codemirror/state'

/** 语言专属服务器行为（语言插件经 LanguageDescriptor.server 提供；LspSession 消费）。 */
export interface LspSessionConfig {
  /** initialize 请求的 initializationOptions。 */
  initializationOptions?: unknown
  /** 初始化后主动推送的配置（某些服务器只认 didChangeConfiguration）。 */
  didChangeConfiguration?: unknown
  /** workspace/configuration 请求的响应（section → 配置）。 */
  workspaceConfiguration?: (section: string) => unknown
}

/** 一种语言的声明（由语言插件经 ctx.lspRegistry.register 注册）。 */
export interface LanguageDescriptor {
  /** 唯一 id：'python' / 'java' / 'typescript' … */
  id: string
  /**
   * LSP 会话分组（缺省 = id）：同组语言共享一条会话/一个服务器进程。
   * tsserver 一进程服务 ts/tsx/js/jsx——四个 languageId 的 descriptor 共用
   * sessionId 'typescript'，避免按 languageId 分 session 起多个 tsserver。
   */
  sessionId?: string
  /** 展示名（状态栏）：'Python' */
  displayName: string
  /** 小写扩展名（无点）：['py', 'pyw'] */
  extensions: readonly string[]
  /**
   * CodeMirror 语法扩展工厂。值在语言插件 bundle 内（跨 bundle 函数引用，
   * 构建期不 value-import 其他插件），编辑器打开文件时调用取得 Extension。
   * 省略 = 无语法高亮（纯 LSP 或纯文本）。
   */
  syntax?: () => Extension
  /** 语言专属 LSP 服务器行为（可选；无则用默认初始化）。 */
  server?: LspSessionConfig
}

/** client 语言注册表（dsh-lsp-core client half 提供，ctx.lspRegistry）。 */
export interface LspRegistryService {
  /** 语言插件调用；返回 disposer（必须包在 ctx.effect 里，HMR-safe）。 */
  register(descriptor: LanguageDescriptor): () => void
  get(id: string): LanguageDescriptor | undefined
  /** 按文件路径扩展名匹配（小写、无点）。 */
  match(path: string): LanguageDescriptor | undefined
  list(): readonly LanguageDescriptor[]
  /** 注册表变化订阅（编辑器 useSyncExternalStore）。 */
  subscribe(listener: () => void): () => void
}

/** LSP 消息的共享形状（与 host 侧 /dsh-lsp 桥一致）。 */
export interface LspPosition {
  line: number
  character: number
}
export interface LspRange {
  start: LspPosition
  end: LspPosition
}
export interface LspTextEdit {
  range: LspRange
  newText: string
}
export interface LspTextDocumentIdentifier {
  uri: string
}
export interface LspVersionedTextDocumentIdentifier extends LspTextDocumentIdentifier {
  version: number
}

/** LSP 补全项（编辑器补全源与 host 桥共用）。documentation 为 LSP MarkupContent/MarkedString。 */
export interface LspCompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string | { kind: string; value: string }
  insertText?: string
  insertTextFormat?: number
  textEdit?: { range: LspRange; newText: string }
  additionalTextEdits?: LspTextEdit[]
  commitCharacters?: string[]
  filterText?: string
  sortText?: string
}

export type LspSignatureParameter = {
  label: string | [number, number]
  documentation?: string | { kind: string; value: string }
}

export type LspSignatureInformation = {
  label: string
  documentation?: string | { kind: string; value: string }
  parameters?: LspSignatureParameter[]
  activeParameter?: number
}

export interface LspSignatureHelp {
  signatures: LspSignatureInformation[]
  activeSignature?: number
  activeParameter?: number
}

export interface LspDiagnostic {
  range: LspRange
  /** LSP：1=Error, 2=Warning, 3=Information, 4=Hint（规范允许缺省）。 */
  severity?: number
  code?: number | string
  source?: string
  message: string
}

/** LSP hover 内容（纯字符串 / MarkupContent / MarkedString 列表）。 */
export type LspHoverContents =
  | string
  | Array<string | { language?: string; value: string }>
  | { kind: string; value: string }

export interface LspHover {
  contents: LspHoverContents
  range?: LspRange
}

export interface LspLocation {
  uri: string
  range: LspRange
}

/** 一个 WorkspaceEdit 内变更的文件（rename / codeAction）。 */
export interface LspTextDocumentEdit {
  textDocument: { uri: string; version?: number | null }
  edits: LspTextEdit[]
}

export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: LspTextDocumentEdit[]
}

export interface LspCodeAction {
  title: string
  kind?: string
  diagnostics?: LspDiagnostic[]
  edit?: LspWorkspaceEdit
  command?: { command: string; title: string; arguments?: unknown[] }
  isPreferred?: boolean
}

/** 一个文件的 LSP 会话能力（编辑器唯一消费入口；null 能力 = 纯高亮）。 */
export interface LanguageCapability {
  readonly languageId: string
  /** 服务器连接状态（状态栏展示）。 */
  readonly status: 'connecting' | 'ready' | 'error'
  openDocument(path: string, content: string): void
  updateDocument(path: string, content: string): void
  closeDocument(path: string): void
  completion(path: string, position: LspPosition): Promise<LspCompletionItem[] | null>
  hover(path: string, position: LspPosition): Promise<LspHover | null>
  signatureHelp(path: string, position: LspPosition): Promise<LspSignatureHelp | null>
  definition(path: string, position: LspPosition): Promise<LspLocation[]>
  rename(path: string, position: LspPosition, newName: string): Promise<LspWorkspaceEdit | null>
  formatting(path: string): Promise<LspTextEdit[]>
  codeAction(path: string, range: LspRange): Promise<LspCodeAction[]>
  /** 诊断推送订阅（编辑器波浪线 + 问题面板共用）；返回 disposer。 */
  onDiagnostics(callback: (uri: string, diagnostics: LspDiagnostic[]) => void): () => void
  onStatus(callback: (status: 'connecting' | 'ready' | 'error') => void): () => void
  /** 服务器主动日志订阅（window/logMessage；type 3 = Error，如退出时完整 stderr）。 */
  onServerLog(callback: (type: number, message: string) => void): () => void
  /** 永久释放（root 切换/编辑器关闭时）。 */
  dispose(): void
}

/** 会话管理器：按 (root, languageId) 复用连接（lsp-core 内部实现，编辑器不直接持有）。 */
export interface LspSessionManager {
  acquire(root: string, languageId: string): LanguageCapability | null
  disposeRoot(root: string): void
}

/** 语言注册表按路径查询的摘要（编辑器状态栏/会话路由用，无副作用）。 */
export interface LanguageSummary {
  id: string
  displayName: string
  /** 会话分组（acquire 的复用 key；tsserver 系统一 'typescript'）。 */
  sessionId: string
}

/** 能力工厂服务（ctx.lspCapabilities）：编辑器打开文件时按语言获取会话。 */
export interface LspCapabilityService {
  /**
   * 获取 (root, languageId) 的会话（按需创建、复用连接）。返回 null =
   * 该语言未注册 LSP（纯高亮）。
   * @param opts.wsUrl 阶段 1 双轨期可传旧桥路径（如 '/dsh-ide/ws/lsp?server=py'）；
   *   缺省用 /dsh-lsp/ws（阶段 2 host 桥）。
   */
  acquire(root: string, languageId: string, opts?: { wsUrl?: string }): LanguageCapability | null
  /**
   * 按文件路径查注册表语言（纯查询，无会话副作用）：编辑器的语言路由/
   * 状态栏展示用它，无需持有 lspRegistry。未注册（无语言插件）返回 null。
   */
  languageFor(path: string): LanguageSummary | null
  /**
   * 已注册语言的会话组列表（注册表驱动，按 sessionId 去重——typescript 系
   * 四个 languageId 共享 'typescript' 组只返回一条）：编辑器逐组 acquire 并
   * 订阅状态/诊断，新增语言插件零改编辑器（阶段 3 收敛漏网：EditorPane 曾
   * 硬编码四种语言，rust 插件踩中——状态无人订阅，永远显示「… LSP」）。
   */
  sessionLanguages(): ReadonlyArray<{ id: string; sessionId: string }>
  disposeRoot(root: string): void
}

/**
 * 服务访问（monorepo 内部统一方式，不依赖 @deepseek-ai/cordis 的 Context
 * augmentation——其类型声明引用 .ts 文件无法解析，且避免双 cordis 实例问题）：
 *   const registry = getLspRegistry(ctx)
 *   if (registry === undefined) return   // lsp-core 未安装
 */
export const lspRegistryKey = 'lspRegistry'

export function getLspRegistry(ctx: unknown): LspRegistryService | undefined {
  if (typeof ctx !== 'object' || ctx === null) return undefined
  return (ctx as Record<string, unknown>)[lspRegistryKey] as LspRegistryService | undefined
}

/**
 * 类型模板（供语言插件等**浏览器 bundle 消费方**使用：client bundle 禁止
 * value-import 其他插件——纯度门，因此不能 import getLspRegistry；用本类型
 * 断言 ctx 后直接访问 ctx.lspRegistry，运行时由 lsp-core provide 的属性提供）：
 *   const registry = (ctx as unknown as LspRegistryAccessor).lspRegistry
 *   if (registry === undefined) return
 */
export type LspRegistryAccessor = { lspRegistry: LspRegistryService }

/** 能力工厂的 ctx 访问模板（编辑器消费方用）。 */
export type LspCapabilitiesAccessor = { lspCapabilities: LspCapabilityService }
