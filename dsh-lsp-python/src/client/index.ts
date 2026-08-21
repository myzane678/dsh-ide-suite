/**
 * dsh-lsp-python client half：向 ctx.lspRegistry 注册 Python 语言
 * （服务器配置与旧 dsh-ide-layout 的 LspClient.configFor 保持一致——
 * useLibraryCodeForTypes:false 消除 mne/scipy 误报，autoImportCompletions 保持）。
 * 不注册 syntax：CodeMirror 扩展对象跨 bundle 会因 @codemirror/state 双副本
 * 抛 "Unrecognized extension value"（编辑器崩、文件打不开）——语法高亮由
 * dsh-ide-layout 内置表单副本构造；注册表 syntax 待阶段 2 codemirror 单来源后回归。
 */

import type { LanguageDescriptor, LspRegistryAccessor } from 'dsh-lsp-core/client'

export const inject = ['lspRegistry']

export function apply(ctx: unknown): void {
  const registry = (ctx as unknown as LspRegistryAccessor).lspRegistry
  if (registry === undefined) return
  const descriptor: LanguageDescriptor = {
    id: 'python',
    displayName: 'Python',
    extensions: ['py', 'pyw'],
    server: {
      initializationOptions: {
        useLibraryCodeForTypes: false,
        autoImportCompletions: true,
      },
      didChangeConfiguration: {
        settings: {
          pyright: { strict: false, useLibraryCodeForTypes: false, autoImportCompletions: true },
          python: { analysis: { typeCheckingMode: 'basic', useLibraryCodeForTypes: false, autoImportCompletions: true } },
        },
      },
      workspaceConfiguration: (section) => {
        if (section === 'pyright') {
          return { strict: false, useLibraryCodeForTypes: false, autoImportCompletions: true }
        }
        if (section === 'python') {
          return { analysis: { typeCheckingMode: 'basic', useLibraryCodeForTypes: false, autoImportCompletions: true } }
        }
        return null
      },
    },
  }
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => registry.register(descriptor), 'dsh-lsp-python: register language')
}
