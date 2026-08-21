/**
 * dsh-lsp-powershell 注册链路冒烟（模拟 cordis ctx）。
 * vendor/（PSES）的启动脚本存在性不在单测范围（随包分发，GUI 实测覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { apply as applyLspCoreHost } from '../../dsh-lsp-core/src/host/index.ts'
import { apply as applyLspCoreClient } from '../../dsh-lsp-core/src/client/index.ts'
import { apply as applyPsHost } from '../src/index.ts'
import { apply as applyPsClient } from '../src/client/index.ts'

function makeCtx(): { provide(name: string, value: unknown): void; effect(fn: () => unknown, label?: string): void; services: Map<string, unknown>; runEffects(): void } & Record<string, unknown> {
  const services = new Map<string, unknown>()
  const effects: Array<() => unknown> = []
  const ctx = {
    provide(name: string, value: unknown) { services.set(name, value); ctx[name] = value },
    effect(fn: () => unknown) { effects.push(fn) },
    services,
    runEffects() { for (const fn of effects) fn() },
    // lsp-core host apply 挂载 /dsh-lsp/ws upgrade——注册桩即可（不真正监听）。
    webServer: { registerUpgrade: () => () => {} },
  } as ReturnType<typeof makeCtx>
  return ctx
}

function setup() {
  const ctx = makeCtx()
  applyLspCoreHost(ctx as never)
  applyLspCoreClient(ctx as never)
  applyPsHost(ctx as never)
  applyPsClient(ctx as never)
  ctx.runEffects()
  return ctx
}

describe('dsh-lsp-powershell', () => {
  it('client：ps1/psm1/psd1 命中 powershell，无语法工厂', () => {
    const ctx = setup()
    const registry = ctx.services.get('lspRegistry') as { match(path: string): { id: string; syntax?: () => unknown; server?: unknown } | undefined }
    expect(registry.match('scripts/build.ps1')?.id).toBe('powershell')
    expect(registry.match('mod.psm1')?.id).toBe('powershell')
    expect(registry.match('conf.psd1')?.id).toBe('powershell')
    expect(registry.match('a.ts')).toBeUndefined()
    expect(registry.match('a.ps1')?.syntax).toBeUndefined()
    expect(registry.match('a.ps1')?.server).toEqual({})
  })

  it('host：命令用 pwsh 跑 vendor 的 Start-EditorServices.ps1', () => {
    const ctx = setup()
    const servers = ctx.services.get('lspServerRegistry') as { match(languageId: string): { command?: readonly string[] } | undefined }
    const command = servers.match('powershell')?.command
    expect(command?.[0]).toBe('pwsh')
    expect(command?.[4]).toContain('Start-EditorServices.ps1')
    expect(command?.[4]).toContain('-Stdio')
    expect(command?.[4]).toContain('-BundledModulesPath')
  })
})
