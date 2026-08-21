/**
 * dsh-lsp-powershell host half：向 ctx.lspServerRegistry 注册 PowerShell
 * Editor Services（PSES 不是 Node 程序：用 pwsh 跑 vendor/ 中的启动脚本，
 * 与 dsh-ide-layout 旧桥一致）。vendor（PSES + PSScriptAnalyzer）随包分发。
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { getLspServerRegistry } from 'dsh-lsp-core'
import type { LspServerConfig } from 'dsh-lsp-core'

/** vendor 目录（bundle 的 lib/index.js 相对引用 → 包根/vendor）。 */
function vendorDir(): string {
  return fileURLToPath(new URL('../vendor', import.meta.url))
}

export const inject = ['lspServerRegistry']

export function apply(ctx: Context): void {
  const registry = getLspServerRegistry(ctx)
  if (registry === undefined) return
  const bundle = vendorDir()
  const config: LspServerConfig = {
    languageId: 'powershell',
    command: [
      'pwsh', '-NoLogo', '-NoProfile', '-Command',
      `& '${bundle}/PowerShellEditorServices/Start-EditorServices.ps1' -Stdio -HostName 'DSH IDE' -HostProfileId 'dsh-ide' -HostVersion '1.0.0' -BundledModulesPath '${bundle}' -LogLevel Error`,
    ],
  }
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => registry.register(config), 'dsh-lsp-powershell: register PSES server')
}
