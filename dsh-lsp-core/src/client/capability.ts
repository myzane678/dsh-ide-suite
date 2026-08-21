/**
 * LanguageCapability 实现：每个 (root, languageId) 一个 LspSession（从
 * dsh-ide-layout 的 lsp-client.ts 迁移）——真实 LSP 协议（JSON-RPC over
 * WebSocket）与会话生命周期。语言专属行为（服务器配置响应等）经
 * LspSessionOptions.config 注入（由语言插件的 LanguageDescriptor.server 提供），
 * 本模块不含任何语言硬编码。
 */

import { normalizeUri, pathToUri } from './utils.ts'
import type {
  LanguageCapability,
  LspCodeAction,
  LspCompletionItem,
  LspDiagnostic,
  LspHover,
  LspLocation,
  LspPosition,
  LspRange,
  LspSessionConfig,
  LspSessionManager,
  LspSignatureHelp,
  LspTextEdit,
  LspWorkspaceEdit,
} from './types.ts'

/** JSON-RPC message envelope over the wire. */
type RpcMessage =
  | { jsonrpc: '2.0'; id: number; method: string; params?: unknown }
  | { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } }
  | { jsonrpc: '2.0'; method: string; params?: unknown }

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 4000
/** Server refusals with a reason stop the retry loop (like the terminal). */
const FATAL_CLOSE_CODE = 1011

export interface LspSessionOptions {
  root: string
  rootUri: string
  languageId: string
  /** WS 端点（默认 /dsh-lsp/ws；阶段 1 双轨期由调用方传入旧桥路径）。 */
  wsUrl?: string
  config?: LspSessionConfig
  onServerLog?: (type: number, message: string) => void
  onFatal?: (reason: string) => void
}

/**
 * One LSP session per workspace root × language. Documents are registered
 * with openDocument (didOpen), updated (didChange, version bump), released
 * (didClose). The socket reconnects with backoff; open documents are
 * re-synced after a reconnect (initialize → didOpen replay).
 */
export class LspSession implements LanguageCapability {
  private socket: WebSocket | null = null
  private closed = false
  private retryTimer: number | undefined
  private attempts = 0
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private readonly notifications = new Map<string, (params: unknown) => void>()
  private readonly docs = new Map<string, { uri: string; version: number; text: string; opened: boolean; path: string }>()
  private initialized = false
  private _status: 'connecting' | 'ready' | 'error' = 'connecting'
  private readonly statusListeners = new Set<(status: 'connecting' | 'ready' | 'error') => void>()
  private readonly diagListeners = new Set<(uri: string, diagnostics: LspDiagnostic[]) => void>()
  private readonly serverLogListeners = new Set<(type: number, message: string) => void>()

  constructor(private readonly options: LspSessionOptions) {}

  get languageId(): string {
    return this.options.languageId
  }

  /** True once the socket is open (used for status display). */
  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  get status(): 'connecting' | 'ready' | 'error' {
    return this._status
  }

  onStatus(callback: (status: 'connecting' | 'ready' | 'error') => void): () => void {
    this.statusListeners.add(callback)
    return () => this.statusListeners.delete(callback)
  }

  private setStatus(status: 'connecting' | 'ready' | 'error'): void {
    if (this._status === status) return
    this._status = status
    for (const listener of this.statusListeners) listener(status)
  }

  onDiagnostics(callback: (uri: string, diagnostics: LspDiagnostic[]) => void): () => void {
    this.diagListeners.add(callback)
    return () => this.diagListeners.delete(callback)
  }

  private emitDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void {
    for (const listener of this.diagListeners) listener(uri, diagnostics)
  }

  onServerLog(callback: (type: number, message: string) => void): () => void {
    this.serverLogListeners.add(callback)
    return () => { this.serverLogListeners.delete(callback) }
  }

  /** Register a document with the server (didOpen). Idempotent per path. */
  openDocument(path: string, text: string): void {
    const existing = this.docs.get(path)
    if (existing !== undefined) {
      existing.text = text
      return
    }
    const uri = pathToUri(this.options.root, path)
    this.docs.set(path, { uri, version: 1, text, opened: false, path })
    if (this.initialized && this.isOpen) this.sendOpen(this.docs.get(path)!)
  }

  /** Push an edit (full text) to the server (didChange). */
  updateDocument(path: string, text: string): void {
    const doc = this.docs.get(path)
    if (doc === undefined) return
    if (doc.text === text) return
    doc.text = text
    doc.version += 1
    if (this.initialized && this.isOpen) this.sendChange(doc)
  }

  /** Release a document (didClose). */
  closeDocument(path: string): void {
    const doc = this.docs.get(path)
    if (doc === undefined) return
    this.docs.delete(path)
    if (doc.opened && this.initialized && this.isOpen) {
      this.notify('textDocument/didClose', { textDocument: { uri: doc.uri } })
    }
  }

  /** Request textDocument/completion for a position; null when closed. */
  async completion(path: string, position: LspPosition): Promise<LspCompletionItem[] | null> {
    const doc = this.docs.get(path)
    if (doc === undefined || !this.initialized || !this.isOpen) return null
    let result: unknown
    try {
      result = await this.request('textDocument/completion', {
        textDocument: { uri: doc.uri },
        position,
        context: { triggerKind: 1 },
      })
    } catch {
      return null
    }
    if (result === null) return null
    if (Array.isArray(result)) return result as LspCompletionItem[]
    const list = result as { items?: LspCompletionItem[] }
    return list.items ?? null
  }

  /** Request the active function signature for a position. */
  async signatureHelp(path: string, position: LspPosition): Promise<LspSignatureHelp | null> {
    const doc = this.docs.get(path)
    if (doc === undefined || !this.initialized || !this.isOpen) return null
    try {
      const result = await this.request('textDocument/signatureHelp', {
        textDocument: { uri: doc.uri },
        position,
        context: { triggerKind: 1 },
      })
      if (result === null || typeof result !== 'object') return null
      return result as LspSignatureHelp
    } catch {
      return null
    }
  }

  /** LSP hover result. */
  async hover(path: string, position: LspPosition): Promise<LspHover | null> {
    const doc = this.docs.get(path)
    if (doc === undefined || !this.initialized || !this.isOpen) return null
    const result = await this.request('textDocument/hover', {
      textDocument: { uri: doc.uri },
      position,
    })
    if (result === null || typeof result !== 'object') return null
    return result as LspHover
  }

  /** Request textDocument/definition for a position; empty array when none. */
  async definition(path: string, position: LspPosition): Promise<LspLocation[]> {
    const doc = this.docs.get(path)
    if (doc === undefined || !this.initialized || !this.isOpen) return []
    const result = await this.request('textDocument/definition', {
      textDocument: { uri: doc.uri },
      position,
    })
    if (result === null) return []
    if (Array.isArray(result)) return result as LspLocation[]
    return [result as LspLocation]
  }

  /** Request textDocument/rename → WorkspaceEdit (null when no-op). */
  async rename(path: string, position: LspPosition, newName: string): Promise<LspWorkspaceEdit | null> {
    const doc = this.docs.get(path)
    if (doc === undefined || !this.initialized || !this.isOpen) return null
    const result = await this.request('textDocument/rename', {
      textDocument: { uri: doc.uri },
      position,
      newName,
    })
    if (result === null || typeof result !== 'object') return null
    return result as LspWorkspaceEdit
  }

  /** Request textDocument/formatting (full-document). Empty array when no-op. */
  async formatting(path: string): Promise<LspTextEdit[]> {
    const doc = this.docs.get(path)
    if (doc === undefined || !this.initialized || !this.isOpen) return []
    const result = await this.request('textDocument/formatting', {
      textDocument: { uri: doc.uri },
      options: { tabSize: 4, insertSpaces: true },
    })
    if (result === null) return []
    return result as LspTextEdit[]
  }

  /** Request textDocument/codeAction for a range; empty array when none. */
  async codeAction(path: string, range: LspRange): Promise<LspCodeAction[]> {
    const doc = this.docs.get(path)
    if (doc === undefined || !this.initialized || !this.isOpen) return []
    const result = await this.request('textDocument/codeAction', {
      textDocument: { uri: doc.uri },
      range,
      context: { diagnostics: [] },
    })
    if (result === null) return []
    return result as LspCodeAction[]
  }

  /** Register a notification handler (e.g. textDocument/publishDiagnostics). */
  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notifications.set(method, handler)
  }

  /** Fire a JSON-RPC notification (no response expected). */
  notify(method: string, params: unknown): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return
    const message: RpcMessage = { jsonrpc: '2.0', method, params }
    this.socket.send(JSON.stringify(message))
  }

  /** Fire a JSON-RPC request and await the result (10s timeout). */
  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('LSP socket not open'))
        return
      }
      const id = this.nextId++
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LSP request timed out: ${method}`))
      }, 10_000)
      this.pending.set(id, {
        resolve: (value) => { window.clearTimeout(timer); resolve(value) },
        reject: (error) => { window.clearTimeout(timer); reject(error) },
      })
      const message: RpcMessage = { jsonrpc: '2.0', id, method, params }
      this.socket.send(JSON.stringify(message))
    })
  }

  /** Start connecting (called once by the owner). */
  connect(): void {
    this.setStatus('connecting')
    this.attempts = 0
    this.openSocket()
  }

  /** Tear down forever (editor closed). */
  dispose(): void {
    this.closed = true
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer)
    this.socket?.close()
    this.socket = null
    for (const { reject } of this.pending.values()) reject(new Error('LSP session disposed'))
    this.pending.clear()
  }

  private openSocket(): void {
    if (this.closed) return
    // 浏览器有 location；Node 测试/非浏览器环境用占位 origin（连接仅在浏览器发起）。
    const base = typeof location !== 'undefined' ? location.origin : 'http://localhost'
    const url = new URL(this.options.wsUrl ?? '/dsh-lsp/ws', base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    // 保留 wsUrl 自带参数（阶段 1 双轨：/dsh-ide/ws/lsp?server=py），追加 root/language。
    const params = new URLSearchParams(url.search)
    params.set('root', this.options.root)
    params.set('language', this.options.languageId)
    url.search = params.toString()
    let socket: WebSocket
    try {
      socket = new WebSocket(url.toString())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      this.attempts = 0
      void this.initialize()
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      this.handleMessage(event.data)
    }
    socket.onclose = (event) => {
      this.initialized = false
      this.socket = null
      for (const { reject } of this.pending.values()) reject(new Error('LSP socket closed'))
      this.pending.clear()
      if (event.code === FATAL_CLOSE_CODE && event.reason !== '') {
        this.setStatus('error')
        this.options.onFatal?.(event.reason)
        return
      }
      if (this.closed) return
      this.setStatus('connecting')
      this.scheduleReconnect()
    }
    socket.onerror = () => {
      socket.close()
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer !== undefined) return
    this.attempts += 1
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.attempts - 1), RECONNECT_MAX_MS)
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined
      this.openSocket()
    }, delay)
  }

  private handleMessage(data: string): void {
    let message: RpcMessage
    try {
      message = JSON.parse(data) as RpcMessage
    } catch {
      return
    }
    if ('id' in message && message.id !== undefined && typeof message.id === 'number') {
      const entry = this.pending.get(message.id)
      if (entry !== undefined) {
        this.pending.delete(message.id)
        if ('error' in message && message.error !== undefined) {
          entry.reject(new Error(message.error.message))
        } else {
          entry.resolve('result' in message ? message.result : undefined)
        }
      } else if ('method' in message && message.method !== undefined) {
        // 服务器主动请求：workspace/configuration → 语言专属配置（config.workspaceConfiguration）；
        // 其余回空响应，避免服务器阻塞。
        if (message.method === 'workspace/configuration') {
          const params = message.params as { items?: Array<{ section?: string }> } | undefined
          const result = (params?.items ?? []).map((item) => this.options.config?.workspaceConfiguration?.(item.section ?? '') ?? null)
          this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
        } else {
          this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: null }))
        }
      }
      return
    }
    if ('method' in message && message.method !== undefined) {
      if (message.method === 'textDocument/publishDiagnostics') {
        const params = message.params as { uri?: string; diagnostics?: LspDiagnostic[] } | undefined
        if (params?.uri !== undefined) {
          this.emitDiagnostics(normalizeUri(params.uri), params.diagnostics ?? [])
        }
      }
      if (message.method === 'window/logMessage') {
        const params = message.params as { type?: number; message?: string } | undefined
        if (params?.message !== undefined) {
          this.options.onServerLog?.(params.type ?? 0, params.message)
          for (const listener of this.serverLogListeners) listener(params.type ?? 0, params.message)
        }
      }
      this.notifications.get(message.method)?.(message.params)
    }
  }

  private async initialize(): Promise<void> {
    try {
      await this.request('initialize', {
        processId: null,
        rootUri: this.options.rootUri,
        workspaceFolders: [{ uri: this.options.rootUri, name: this.options.root }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: false },
            completion: { completionItem: { snippetSupport: true } },
            publishDiagnostics: {},
          },
          workspace: { configuration: true },
        },
        initializationOptions: this.options.config?.initializationOptions,
      })
      this.notify('initialized', {})
      if (this.options.config?.didChangeConfiguration !== undefined) {
        this.notify('workspace/didChangeConfiguration', { settings: this.options.config.didChangeConfiguration })
      }
      this.initialized = true
      this.setStatus('ready')
      // Replay all registered documents (fresh server state after reconnect).
      for (const doc of this.docs.values()) {
        doc.version += 1
        this.sendOpen(doc)
      }
    } catch {
      // 初始化失败 → 主动关闭 socket（触发带退避的 onclose 重连），
      // 绝不保留「OPEN 但未初始化」的假连接。
      this.socket?.close()
      this.socket = null
    }
  }

  private sendOpen(doc: { uri: string; version: number; text: string; path?: string; opened: boolean }): void {
    doc.opened = true
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: doc.uri,
        languageId: this.options.languageId,
        version: doc.version,
        text: doc.text,
      },
    })
  }

  private sendChange(doc: { uri: string; version: number; text: string }): void {
    this.notify('textDocument/didChange', {
      textDocument: { uri: doc.uri, version: doc.version },
      contentChanges: [{ text: doc.text }],
    })
  }
}

/** 会话管理器：按 (root, languageId) 复用 LspSession。 */
export class LspSessionManagerImpl implements LspSessionManager {
  private readonly sessions = new Map<string, LspSession>()

  constructor(private readonly sessionFor: (root: string, languageId: string) => LspSession) {}

  acquire(root: string, languageId: string): LanguageCapability | null {
    const key = `${root}\u0000${languageId}`
    let session = this.sessions.get(key)
    if (session === undefined) {
      session = this.sessionFor(root, languageId)
      this.sessions.set(key, session)
      session.connect()
    }
    return session
  }

  disposeRoot(root: string): void {
    for (const [key, session] of this.sessions) {
      if (key.startsWith(`${root}\u0000`)) {
        session.dispose()
        this.sessions.delete(key)
      }
    }
  }
}
