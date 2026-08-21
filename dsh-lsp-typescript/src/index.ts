/**
 * dsh-lsp-typescript host half：向 ctx.lspServerRegistry 注册
 * typescript-language-server（ts/tsx/js/jsx 四个 languageId 共用同一命令）。
 * 入口经 createRequire 解析（tsdown 不打包语言服务器，保持 node_modules
 * 原始布局，与 dsh-ide-layout 旧桥一致）。
 */

import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import { getLspServerRegistry } from 'dsh-lsp-core'
import type { LspServerConfig } from 'dsh-lsp-core'

/** 解析 typescript-language-server 的 CLI 入口。 */
function resolveTsServer(): string | null {
  try {
    const require = createRequire(import.meta.url)
    return require.resolve('typescript-language-server/lib/cli.mjs')
  } catch {
    return null
  }
}

export const inject = ['lspServerRegistry']

export function apply(ctx: Context): void {
  const registry = getLspServerRegistry(ctx)
  if (registry === undefined) return
  const command = [process.execPath, resolveTsServer() ?? 'typescript-language-server', '--stdio']
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => {
    for (const languageId of ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']) {
      registry.register({ languageId, command } satisfies LspServerConfig)
    }
  }, 'dsh-lsp-typescript: register ts servers')
}
