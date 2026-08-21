/**
 * dsh-lsp-python host half：向 ctx.lspServerRegistry 注册 pyright 服务器。
 * pyright 的 CLI 入口经 createRequire 解析（tsdown 不打包语言服务器二进制，
 * 保持 node_modules 原始布局，与 dsh-ide-layout 现状一致）。
 */

import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import { getLspServerRegistry } from 'dsh-lsp-core'
import type { LspServerConfig } from 'dsh-lsp-core'

/** 解析 pyright-langserver 的可执行入口（包 bin 指向 langserver.index.js；CLI 的 index.js 不是 LSP 入口）。 */
function resolvePyrightBin(): string | null {
  try {
    const require = createRequire(import.meta.url)
    return require.resolve('pyright/langserver.index.js')
  } catch {
    return null
  }
}

export const inject = ['lspServerRegistry']

export function apply(ctx: Context): void {
  const registry = getLspServerRegistry(ctx)
  if (registry === undefined) return
  const config: LspServerConfig = {
    languageId: 'python',
    command: [process.execPath, resolvePyrightBin() ?? 'pyright-langserver', '--stdio'],
    initializationOptions: {
      useLibraryCodeForTypes: false,
      autoImportCompletions: true,
    },
  }
  ctx.effect(() => registry.register(config), 'dsh-lsp-python: register pyright server')
}
