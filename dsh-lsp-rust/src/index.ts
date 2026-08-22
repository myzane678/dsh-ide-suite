/**
 * dsh-lsp-rust host half：向 ctx.lspServerRegistry 注册本机 rust-analyzer。
 * rust-analyzer 是原生二进制（rustup / 系统包管理器安装），不随 npm 包分发——
 * discover 探测 DSH_RUST_LS_HOME（可执行所在目录）→ ~/.cargo/bin → PATH，
 * 未找到返回 null → 桥 close 1011 → 编辑器降级纯高亮（与 dsh-lsp-java 的
 * JDTLS 本机发现模式一致）。rust-analyzer 零配置起步且无 per-root 参数，
 * 不需要 commandFor。
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { getLspServerRegistry } from 'dsh-lsp-core'
import type { LspServerConfig } from 'dsh-lsp-core'

/** 扫描候选目录找 rust-analyzer（结果模块级缓存，discover 每连接共用）。 */
let cached: string | null | undefined

function findRustAnalyzer(): string | null {
  if (cached !== undefined) return cached
  const exe = process.platform === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer'
  const candidates: string[] = []
  const configured = process.env.DSH_RUST_LS_HOME
  if (configured !== undefined && configured !== '') candidates.push(configured)
  candidates.push(join(homedir(), '.cargo', 'bin', exe))
  const separator = process.platform === 'win32' ? ';' : ':'
  for (const dir of (process.env.PATH ?? '').split(separator)) {
    if (dir !== '') candidates.push(join(dir, exe))
  }
  cached = candidates.find((candidate) => existsSync(candidate)) ?? null
  return cached
}

export const inject = ['lspServerRegistry']

export function apply(ctx: Context): void {
  const registry = getLspServerRegistry(ctx)
  if (registry === undefined) return
  const config: LspServerConfig = {
    languageId: 'rust',
    // 探测可用性（null = 本机无 rust-analyzer → 桥 close 1011 → 纯高亮降级）。
    discover: async () => {
      const bin = findRustAnalyzer()
      return bin === null ? null : [bin]
    },
  }
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => registry.register(config), 'dsh-lsp-rust: register rust-analyzer server')
}
