/**
 * dsh-lsp-rust client half：向 ctx.lspRegistry 注册 Rust 语言。
 * 不注册 syntax：CodeMirror 扩展对象跨 bundle 会因 @codemirror/state 双副本
 * 抛 "Unrecognized extension value"（编辑器崩、文件打不开）——语法高亮由
 * dsh-ide-layout 内置表（@codemirror/lang-rust）构造，状态栏展示名由
 * language-names.ts 提供（rs: 'Rust'），本插件对编辑器零侵入。
 */

import type { LanguageDescriptor, LspRegistryAccessor } from 'dsh-lsp-core/client'

export const inject = ['lspRegistry']

export function apply(ctx: unknown): void {
  const registry = (ctx as unknown as LspRegistryAccessor).lspRegistry
  if (registry === undefined) return
  const descriptor: LanguageDescriptor = {
    id: 'rust',
    displayName: 'Rust',
    extensions: ['rs'],
    // rust-analyzer 零配置起步（默认行为已可用；需要收紧诊断等再追加
    // initializationOptions / didChangeConfiguration）。
    server: {},
  }
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => registry.register(descriptor), 'dsh-lsp-rust: register language')
}
