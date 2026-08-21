/**
 * dsh-lsp-powershell client half：向 ctx.lspRegistry 注册 powershell 语言。
 * PSES 无语言专属配置（workspace/configuration 返回 null 即可）。
 * 不注册 syntax：CodeMirror 扩展对象跨 bundle 会因 @codemirror/state 双副本
 * 抛 "Unrecognized extension value"——语法高亮由 dsh-ide-layout 内置表构造。
 */

import type { LanguageDescriptor, LspRegistryAccessor } from 'dsh-lsp-core/client'

export const inject = ['lspRegistry']

export function apply(ctx: unknown): void {
  const registry = (ctx as unknown as LspRegistryAccessor).lspRegistry
  if (registry === undefined) return
  const descriptor: LanguageDescriptor = {
    id: 'powershell',
    displayName: 'PowerShell',
    extensions: ['ps1', 'psm1', 'psd1'],
    server: {},
  }
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => registry.register(descriptor), 'dsh-lsp-powershell: register language')
}
