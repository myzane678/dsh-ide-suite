/**
 * dsh-lsp-typescript client half：向 ctx.lspRegistry 注册 ts/tsx/js/jsx 四个
 * languageId（共享同一 LSP 服务器：typescript-language-server 无语言专属
 * 配置——旧 LspClient.configFor 对非 py 语言一律返回 null）。
 * 不注册 syntax：CodeMirror 扩展对象跨 bundle 会因 @codemirror/state 双副本
 * 抛 "Unrecognized extension value"——语法高亮由 dsh-ide-layout 内置表构造。
 */

import type { LanguageDescriptor, LspRegistryAccessor } from 'dsh-lsp-core/client'

export const inject = ['lspRegistry']

/** 四个 descriptor 共享：server 给空对象（= 启用 LSP，无专属配置）；
 *  sessionId 统一 'typescript'——tsserver 一条会话服务全部 ts/tsx/js/jsx。 */
const server = {}

const DESCRIPTORS: readonly LanguageDescriptor[] = [
  { id: 'typescript', sessionId: 'typescript', displayName: 'TypeScript', extensions: ['ts', 'mts', 'cts'], server },
  { id: 'typescriptreact', sessionId: 'typescript', displayName: 'TypeScript JSX', extensions: ['tsx'], server },
  { id: 'javascript', sessionId: 'typescript', displayName: 'JavaScript', extensions: ['js', 'mjs', 'cjs'], server },
  { id: 'javascriptreact', sessionId: 'typescript', displayName: 'JavaScript JSX', extensions: ['jsx'], server },
]

export function apply(ctx: unknown): void {
  const registry = (ctx as unknown as LspRegistryAccessor).lspRegistry
  if (registry === undefined) return
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => {
    for (const descriptor of DESCRIPTORS) registry.register(descriptor)
  }, 'dsh-lsp-typescript: register languages')
}
