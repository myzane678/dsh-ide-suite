/**
 * LSP bridge（阶段 2A 自 dsh-ide-layout lsp-service.ts 迁移）：一条 WebSocket
 * 连接对应一个语言服务器子进程（stdio JSON-RPC，Content-Length 分帧），以门禁
 * 后的工作区根为 cwd 启动。浏览器半区经 /dsh-lsp/ws?root=&language= 走完整
 * LSP 协议；本桥是纯传输层：WS 文本帧进 → 分帧 JSON-RPC 写子进程 stdin，
 * 应答原路推回 socket。
 *
 * 与旧桥的差异（注册表驱动）：启动命令不再内置——URL 参数 `language`
 * （languageId）查 ctx.lspServerRegistry（语言插件 host half 注册）取
 * LspServerConfig：commandFor(root) 动态构造优先，静态 command 次之，
 * discover() 的返回值兜底（返回 null = 服务器不可用，如本机无 JDTLS，
 * close 1011 → 浏览器侧按 onFatal 降级纯高亮）。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { type IncomingMessage } from 'node:http'
import { WebSocket } from 'ws'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { getLspServerRegistry, type LspServerConfig } from './types.ts'

/** P1-03：LSP 子进程并发上限 + 单帧大小上限（防资源耗尽）。 */
const LSP_MAX_CONNECTIONS = 8
const LSP_MAX_FRAME_BYTES = 4 * 1024 * 1024
let lspActiveCount = 0

/**
 * 安全的 WebSocket 关闭（dsh-ide-layout ws-safe.ts 副本）。
 * ws close reason 有 123 字节协议上限：超长时 ws 库抛 RangeError，而关闭调用
 * 常发生在子进程事件回调里（无 try/catch 兜底），会变成 uncaughtException。
 */
function closeWs(ws: WebSocket, code: number, reason: string): void {
  let safe = reason
  while (Buffer.byteLength(safe, 'utf8') > 121) safe = safe.slice(0, -1)
  ws.close(code, safe)
}

/** Accumulate stdin chunks and split on Content-Length framing.
 *  push 返回 false 表示单帧超过上限（协议违规），调用方应断开连接。 */
export class FrameReader {
  private buffer = Buffer.alloc(0)
  private contentLength: number | null = null
  private readonly maxFrameBytes: number

  constructor(maxFrameBytes = LSP_MAX_FRAME_BYTES) {
    this.maxFrameBytes = maxFrameBytes
  }

  push(chunk: Buffer, onMessage: (message: unknown) => void): boolean {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.contentLength === null) {
        const headEnd = this.buffer.indexOf('\r\n\r\n')
        if (headEnd === -1) return true
        const header = this.buffer.subarray(0, headEnd).toString('utf8')
        const match = /Content-Length:\s*(\d+)/i.exec(header)
        if (match === null) {
          // Malformed header: drop everything up to the next headEnd.
          this.buffer = this.buffer.subarray(headEnd + 4)
          continue
        }
        this.contentLength = Number.parseInt(match[1], 10)
        if (this.contentLength > this.maxFrameBytes) return false
        this.buffer = this.buffer.subarray(headEnd + 4)
      }
      if (this.buffer.length < this.contentLength) return true
      const body = this.buffer.subarray(0, this.contentLength).toString('utf8')
      this.buffer = this.buffer.subarray(this.contentLength)
      this.contentLength = null
      try {
        onMessage(JSON.parse(body) as unknown)
      } catch {
        // Malformed JSON body: skip.
      }
    }
  }
}

/** One live bridge: child process + its socket. */
interface Bridge {
  child: ChildProcess
  reader: FrameReader
  socket: WebSocket
  exited: boolean
  /** stderr tail for error reporting (bounded). */
  stderrTail: string
}

/** 校验 URI 是否位于授权工作区内：URI 与前缀都先做百分号解码（客户端 pathToUri
 *  会编码空格/#/%/非 ASCII），再做大小写不敏感比较；要求目录段边界（/project
 *  不能匹配 /project2），根自身（/project）放行。 */
export function uriWithinRoot(uri: string, rootUriPrefix: string): boolean {
  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  const norm = decode(uri).toLowerCase()
  const prefix = decode(rootUriPrefix).toLowerCase()
  return norm === prefix || norm.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
}

export function uriPrefixFor(root: string): string {
  // 与客户端 pathToUri 保持同一编码规则：盘符保留，其余段百分号编码。
  const encoded = root
    .replaceAll('\\', '/')
    .split('/')
    .map((segment, index) => (index === 0 && /^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
    .replace(/\/+$/, '')
  return 'file:///' + encoded
}

/** Normalize a path for prefix comparison (Windows case-insensitive)。
 *  （dsh-ide-layout host index.ts 副本——lsp-core 不依赖 layout。） */
function normalizeForPrefix(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** The canonical prefix check: child must live inside (or equal) the root. */
function isPathInside(root: string, child: string): boolean {
  if (root === '' || child === '') return false
  const normRoot = normalizeForPrefix(root)
  const normChild = normalizeForPrefix(child)
  if (normChild === normRoot) return true
  return normChild.startsWith(`${normRoot}/`)
}

export type WorkspaceGate = (root: string) => Promise<{ ok: true; canonical: string } | { ok: false; error: { message: string } }>

/**
 * Production gate（dsh-ide-layout 副本）：canonicalize 请求的 root 并要求它
 * 是已注册工作区路径（或其子目录）。LSP 子进程以它为 cwd，URI 门禁也以它为前缀。
 */
export function createWorkspaceGate(ctx: unknown): WorkspaceGate {
  return async (root) => {
    if (typeof root !== 'string' || root === '') {
      return { ok: false, error: { message: 'empty project root' } }
    }
    let canonical: string
    try {
      canonical = await realpath(root)
    } catch {
      return { ok: false, error: { message: 'path does not resolve on disk' } }
    }
    const workspaces = (ctx as { workspaceRegistry?: { list(): Array<{ path: string }> } }).workspaceRegistry?.list() ?? []
    for (const workspace of workspaces) {
      if (isPathInside(workspace.path, canonical)) {
        return { ok: true, canonical }
      }
    }
    return { ok: false, error: { message: 'path is not inside a registered workspace' } }
  }
}

/**
 * 解析启动命令：commandFor(root)（JDTLS 的 -data 依赖 root）优先于静态
 * command；两者皆无时用 discover() 的返回值兜底。discover 存在时总是先探测
 * 可用性（返回 null → null 命令，调用方 close 1011 让编辑器降级纯高亮）。
 */
export async function resolveServerCommand(config: LspServerConfig, root: string): Promise<readonly string[] | null> {
  let discovered: readonly string[] | null | undefined
  if (config.discover !== undefined) {
    discovered = await config.discover()
    if (discovered === null) return null
  }
  if (config.commandFor !== undefined) return config.commandFor(root)
  if (config.command !== undefined) return config.command
  return discovered ?? null
}

/**
 * Spawn the language server for a root and wire it to the socket.
 * @param ctx - context carrying lspServerRegistry + workspaceRegistry.
 * @param ws - the WebSocket carrying LSP JSON-RPC frames from the browser.
 */
export function attachLspSocket(ctx: unknown, req: IncomingMessage, ws: WebSocket): void {
  void (async () => {
    try {
      const registry = getLspServerRegistry(ctx)
      if (registry === undefined) {
        console.error('[dsh-lsp] close 1011: lsp server registry unavailable（host 侧 lsp-core 注册表缺失）')
        closeWs(ws, 1011, 'lsp server registry unavailable')
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.internal')
      const root = url.searchParams.get('root')
      if (root === null || root === '') {
        closeWs(ws, 1008, '?root= is required')
        return
      }
      const language = url.searchParams.get('language')
      if (language === null || language === '') {
        closeWs(ws, 1008, '?language= is required')
        return
      }
      const config = registry.match(language)
      if (config === undefined) {
        console.error(`[dsh-lsp] close 1008: unsupported language "${language}"（host 侧语言插件未注册——查插件是否加载）`)
        closeWs(ws, 1008, `unsupported language: ${language}`)
        return
      }
      const gated = await createWorkspaceGate(ctx)(root)
      if (!gated.ok) {
        console.error(`[dsh-lsp] close 1011: workspace gate rejected root="${root}" language="${language}": ${gated.error.message}`)
        closeWs(ws, 1011, gated.error.message)
        return
      }
      // P1-03：连接数上限——异常/恶意客户端不能批量拉起 LSP 子进程。
      if (lspActiveCount >= LSP_MAX_CONNECTIONS) {
        console.error(`[dsh-lsp] close 1013: too many LSP connections (${LSP_MAX_CONNECTIONS}) language="${language}"`)
        closeWs(ws, 1013, `too many LSP connections (${LSP_MAX_CONNECTIONS})`)
        return
      }
      const command = await resolveServerCommand(config, gated.canonical)
      if (command === undefined || command === null || command.length === 0) {
        console.error(`[dsh-lsp] close 1011: language server unavailable: ${language}（discover 返回 null——服务器未安装/未找到，降级纯高亮）`)
        closeWs(ws, 1011, `language server unavailable: ${language}`)
        return
      }
      lspActiveCount += 1
      const bridge: Bridge = {
        child: spawn(command[0], command.slice(1), {
          cwd: gated.canonical,
          // DSH Desktop 是 Electron 宿主：process.execPath 指向 DSH Desktop.exe，
          // 不设 ELECTRON_RUN_AS_NODE 会以 Electron GUI 模式启动脚本 → 立即退出。
          // 该变量让 exe 以 Node 模式跑语言服务器（对普通 Node 宿主无害）。
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
        reader: new FrameReader(),
        socket: ws,
        exited: false,
        stderrTail: '',
      }
      if (bridge.child.stdin === null || bridge.child.stdout === null || bridge.child.stderr === null) {
        closeWs(ws, 1011, 'server spawn failed: missing stdio')
        return
      }
      bridge.child.stderr.on('data', (chunk: Buffer) => {
        bridge.stderrTail = (bridge.stderrTail + chunk.toString('utf8')).slice(-4096)
      })
      bridge.child.on('error', (error) => {
        bridge.exited = true
        console.error(`[dsh-lsp] close 1011: spawn error language="${language}" command="${command[0]}": ${error.message}`)
        if (ws.readyState === WebSocket.OPEN) closeWs(ws, 1011, `language server error: ${error.message}`)
      })
      bridge.child.on('exit', (code, signal) => {
        bridge.exited = true
        // 无论 stderr 是否为空都留一行宿主日志（stderr 空的静默退出最可疑）。
        console.error(`[dsh-lsp] ${language} exited (${signal ?? `code ${code ?? '?'}`})`)
        // 完整 stderr（去 ANSI 转义）进宿主日志——不截断，排查服务器启动失败
        // 时能看到完整错误（ws reason 只有 123 字节装不下，靠这里留痕）。
        if (bridge.stderrTail !== '') {
          const clean = bridge.stderrTail.replace(/\u001b\[[0-9;]*m/g, '')
          console.error(`[dsh-lsp] ${language} exited (${signal ?? `code ${code ?? '?'}`}): ${clean}`)
          // 把完整 stderr 经 WS 发给客户端（window/logMessage type 3），界面
          // 悬停状态栏即可看到全文——close reason 的 123 字节截断只留一行。
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              jsonrpc: '2.0',
              method: 'window/logMessage',
              params: { type: 3, message: `[${language}] language server exited: ${clean}` },
            }))
          }
        }
        if (ws.readyState === WebSocket.OPEN) {
          closeWs(ws, 1011, `language server exited (${signal ?? `code ${code ?? '?'}`})${bridge.stderrTail !== '' ? `: ${bridge.stderrTail.trim().split('\n').pop() ?? ''}` : ''}`)
        }
      })
      bridge.child.stdout.on('data', (chunk: Buffer) => {
        const ok = bridge.reader.push(chunk, (message) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
        })
        if (!ok && ws.readyState === WebSocket.OPEN) {
          // 服务器回传帧超过上限：视为协议违规，断开连接并终止子进程。
          closeWs(ws, 1009, 'server frame too large')
          bridge.exited = true
          try { bridge.child.kill() } catch { /* Already gone. */ }
        }
      })
      // P1-03：URI 门禁——LSP 请求中的文件 URI 必须位于授权工作区内，
      // 防止语言服务器读取/索引工作区外的文件（Windows 大小写不敏感）。
      const rootUriPrefix = uriPrefixFor(gated.canonical)
      const uriAllowed = (uri: unknown): boolean => {
        if (typeof uri !== 'string') return true
        return uriWithinRoot(uri, rootUriPrefix)
      }
      ws.on('message', (data) => {
        if (bridge.exited || bridge.child.stdin === null) return
        // P1-03：单帧大小上限（data 可能是 Buffer / ArrayBuffer / Buffer[]）。
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
        if (frame.length > LSP_MAX_FRAME_BYTES) {
          closeWs(ws, 1009, 'message too large')
          return
        }
        // P1-03：校验消息内引用的文件 URI（textDocument.uri / uri）。
        try {
          const message = JSON.parse(frame.toString('utf8')) as {
            params?: { textDocument?: { uri?: unknown }; uri?: unknown }
          }
          const params = message.params
          if (params !== undefined && typeof params === 'object') {
            const candidate = params.textDocument?.uri ?? params.uri
            if (candidate !== undefined && !uriAllowed(candidate)) {
              closeWs(ws, 1008, 'uri outside workspace')
              return
            }
          }
        } catch {
          // 非 JSON（keep-alive 等）放行；JSON 解析失败由下游处理。
        }
        bridge.child.stdin.write(`Content-Length: ${frame.length}\r\n\r\n`)
        bridge.child.stdin.write(frame)
      })
      ws.on('close', () => {
        lspActiveCount = Math.max(0, lspActiveCount - 1)
        if (!bridge.exited) {
          try {
            bridge.child.kill()
          } catch {
            // Already gone.
          }
        }
      })
    } catch (error) {
      closeWs(ws, 1011, error instanceof Error ? error.message : String(error))
    }
  })()
}
