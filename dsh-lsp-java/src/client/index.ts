/**
 * dsh-lsp-java client half：向 ctx.lspRegistry 注册 java 语言。
 * JDTLS 无语言专属 initializationOptions（旧 LspClient initialize 统一
 * capabilities，java 分支无特殊配置）。不注册 syntax：CodeMirror 扩展对象
 * 跨 bundle 会因 @codemirror/state 双副本抛 "Unrecognized extension value"
 * ——语法高亮由 dsh-ide-layout 内置表构造。
 */

import type { LanguageDescriptor, LspRegistryAccessor } from 'dsh-lsp-core/client'

export const inject = ['lspRegistry']

export function apply(ctx: unknown): void {
  const registry = (ctx as unknown as LspRegistryAccessor).lspRegistry
  if (registry === undefined) return
  const descriptor: LanguageDescriptor = {
    id: 'java',
    displayName: 'Java',
    extensions: ['java'],
    server: {},
  }
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => registry.register(descriptor), 'dsh-lsp-java: register language')
}
