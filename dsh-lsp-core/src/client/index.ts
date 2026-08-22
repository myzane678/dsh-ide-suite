/**
 * client half：发布 ctx.lspRegistry 服务（语言注册表）。
 * 编辑器（dsh-ide-layout）inject ['lspRegistry'] 消费；语言插件
 * （dsh-lsp-python 等）inject ['lspRegistry'] 注册语言。
 * LanguageCapability 会话管理（LspSessionManager）在阶段 1 从
 * dsh-ide-layout 的 lsp-client.ts 迁移后接入。
 */

import type {} from './types.ts'
import { createLspRegistry } from './registry.ts'
import { LspSession } from './capability.ts'
import type { LspCapabilityService, LanguageCapability } from './types.ts'
import { pathToUri } from './utils.ts'

// 类型面（含 ctx 类型合并 augmentation）：消费方 `import type { … } from 'dsh-lsp-core/client'`。
export type {
  LanguageDescriptor,
  LspRegistryService,
  LspPosition,
  LspRange,
  LspTextEdit,
  LspTextDocumentIdentifier,
  LspVersionedTextDocumentIdentifier,
  LspCompletionItem,
  LspSignatureParameter,
  LspSignatureInformation,
  LspSignatureHelp,
  LspDiagnostic,
  LspHoverContents,
  LspHover,
  LspLocation,
  LspTextDocumentEdit,
  LspWorkspaceEdit,
  LspCodeAction,
  LanguageCapability,
  LspSessionManager,
  LspSessionConfig,
  LspRegistryAccessor,
  LspCapabilityService,
  LanguageSummary,
  LspCapabilitiesAccessor,
} from './types.ts'
export type { LspSessionOptions } from './capability.ts'

// 实现面（语言插件/编辑器经服务方法交互，一般无需直接引用）。
export { LspSession }
export { pathToUri, normalizeUri, completionType, completionInfo, lspPositionToOffset, completionTextRange } from './utils.ts'
export { lspRegistryKey, getLspRegistry } from './types.ts'
/** 无需其他插件服务；注册表自足。 */
export const inject: string[] = []

/**
 * 最小上下文面：client 运行时（DSH 浏览器侧）提供 provide；完整类型由
 * `declare module '@deepseek-ai/cordis'` augmentation 对消费方生效
 * （lspRegistry 服务成员），本文件不依赖 ClientContext 的完整声明。
 */
interface ClientContextLike {
  provide(name: string, value: unknown): void
}

export function apply(ctx: ClientContextLike): void {
  const registry = createLspRegistry()
  // 在 apply 开头提供，保证消费方 inject 激活时已就绪。
  ctx.provide('lspRegistry', registry)

  // 能力工厂：编辑器按 (root, languageId) 获取会话；语言插件经 registry 注册
  // 的 descriptor（含 server 配置）驱动。未注册服务器配置的语言返回 null（纯高亮）。
  const sessions = new Map<string, LspSession>()
  const capabilities: LspCapabilityService = {
    acquire(root, languageId, opts) {
      const descriptor = registry.get(languageId)
      if (descriptor === undefined || descriptor.server === undefined) return null
      // 会话按 sessionId 分组复用（tsserver 一进程服务 ts/tsx/js/jsx）。
      const key = `${root}\u0000${descriptor.sessionId ?? descriptor.id}`
      let session = sessions.get(key)
      if (session === undefined) {
        session = new LspSession({
          root,
          rootUri: pathToUri(root, ''),
          // didOpen/URL 参数用文件真实 languageId；会话复用由上面的 key 归一。
          languageId,
          wsUrl: opts?.wsUrl,
          config: descriptor.server,
          onServerLog: (type, message) => {
            if (type === 3) console.error(`[dsh-lsp:${languageId}] ${message}`)
          },
          onFatal: (reason) => {
            console.error(`[dsh-lsp:${languageId}] fatal: ${reason}`)
          },
        })
        sessions.set(key, session)
        session.connect()
      }
      return session
    },
    disposeRoot(root) {
      for (const [key, session] of sessions) {
        if (key.startsWith(`${root}\u0000`)) {
          session.dispose()
          sessions.delete(key)
        }
      }
    },
    languageFor(path) {
      const descriptor = registry.match(path)
      if (descriptor === undefined) return null
      return { id: descriptor.id, displayName: descriptor.displayName, sessionId: descriptor.sessionId ?? descriptor.id }
    },
    sessionLanguages() {
      // 注册表派生 + 按 sessionId 去重（组内取第一个 descriptor 的 id 供 acquire）。
      const seen = new Set<string>()
      const out: Array<{ id: string; sessionId: string }> = []
      for (const descriptor of registry.list()) {
        const sessionId = descriptor.sessionId ?? descriptor.id
        if (seen.has(sessionId)) continue
        seen.add(sessionId)
        out.push({ id: descriptor.id, sessionId })
      }
      return out
    },
  }
  ctx.provide('lspCapabilities', capabilities)
  console.log('[dsh-lsp-core] client half loaded')
}
