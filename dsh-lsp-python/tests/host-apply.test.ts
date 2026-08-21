/**
 * host 侧跨插件注册链路冒烟（模拟 cordis ctx，不依赖 DSH）：
 * lsp-core host apply（提供 ctx.lspServerRegistry）→ lsp-python host apply
 * （注册 pyright）→ 注册表可查到 python 服务器配置，命令可解析。
 */
import { describe, expect, it } from 'vitest'
import { apply as applyLspCoreHost } from 'dsh-lsp-core'
import { getLspServerRegistry } from 'dsh-lsp-core'
import { apply as applyPythonHost } from '../src/index.ts'

/** 最小 cordis ctx：provide 同时挂为 ctx 属性（与 cordis 行为一致），effect 手动执行。 */
function makeCtx(): {
  provide(name: string, value: unknown): void
  effect(fn: () => unknown, label?: string): void
  services: Map<string, unknown>
  runEffects(): void
} & Record<string, unknown> {
  const services = new Map<string, unknown>()
  const effects: Array<() => unknown> = []
  const ctx: { provide(n: string, v: unknown): void; effect(f: () => unknown, l?: string): void; services: Map<string, unknown>; runEffects(): void } & Record<string, unknown> = {
    provide(name, value) { services.set(name, value); ctx[name] = value },
    effect(fn) { effects.push(fn) },
    services,
    runEffects() { for (const fn of effects) fn() },
    // lsp-core host apply 挂载 /dsh-lsp/ws upgrade——注册桩即可（不真正监听）。
    webServer: { registerUpgrade: () => () => {} },
  }
  return ctx
}

describe('host 跨插件注册链路（lsp-core → lsp-python）', () => {
  it('apply 后 lspServerRegistry 可查到 python（pyright）配置', () => {
    const ctx = makeCtx()
    applyLspCoreHost(ctx as never)
    expect(ctx.services.has('lspServerRegistry')).toBe(true)

    applyPythonHost(ctx as never)
    ctx.runEffects()

    const registry = getLspServerRegistry(ctx)
    expect(registry).toBeDefined()
    const config = registry!.match('python')
    expect(config).toBeDefined()
    expect(config!.languageId).toBe('python')
    expect(config!.command.length).toBeGreaterThanOrEqual(1)
  })

  it('pyright 命令可解析（依赖已安装）', () => {
    const ctx = makeCtx()
    applyLspCoreHost(ctx as never)
    applyPythonHost(ctx as never)
    ctx.runEffects()
    const config = getLspServerRegistry(ctx)!.match('python')!
    expect(config.command[1]).toMatch(/pyright/i)
  })
})
