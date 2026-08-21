/**
 * dsh-lsp-java 注册链路冒烟（模拟 cordis ctx）。JDTLS 的本机发现
 * （redhat.java 扩展扫描）不在单测范围——discover/commandFor 的组合语义
 * 由 dsh-lsp-core 的 resolveServerCommand 测试覆盖；这里验证注册面。
 */
import { describe, expect, it } from 'vitest'
import { apply as applyLspCoreHost } from '../../dsh-lsp-core/src/host/index.ts'
import { apply as applyLspCoreClient } from '../../dsh-lsp-core/src/client/index.ts'
import { apply as applyJavaHost } from '../src/index.ts'
import { apply as applyJavaClient } from '../src/client/index.ts'
import { resolveServerCommand } from '../../dsh-lsp-core/src/host/bridge.ts'

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
  applyJavaHost(ctx as never)
  applyJavaClient(ctx as never)
  ctx.runEffects()
  return ctx
}

describe('dsh-lsp-java', () => {
  it('client：.java 命中 java，无语法工厂，server 存在', () => {
    const ctx = setup()
    const registry = ctx.services.get('lspRegistry') as { match(path: string): { id: string; syntax?: () => unknown; server?: unknown } | undefined }
    expect(registry.match('src/App.java')?.id).toBe('java')
    expect(registry.match('a.py')).toBeUndefined()
    expect(registry.match('a.java')?.syntax).toBeUndefined()
    expect(registry.match('a.java')?.server).toEqual({})
  })

  it('host：注册含 discover + commandFor（commandFor 构造的命令带 per-root -data）', async () => {
    const ctx = setup()
    const servers = ctx.services.get('lspServerRegistry') as { match(languageId: string): { discover?: () => Promise<readonly string[] | null>; commandFor?: (root: string) => readonly string[] } | undefined }
    const config = servers.match('java')
    expect(config?.discover).toBeDefined()
    expect(config?.commandFor).toBeDefined()
    // discover 与 commandFor 的组合语义（本机有 JDTLS 时）：命令以 java 开头、以 -data <tmpdir> 结尾。
    const available = await config!.discover!()
    const command = config!.commandFor!('C:\\ws\\project')
    if (available !== null) {
      expect(command[0]).toBeTruthy()
      expect(command[command.length - 2]).toBe('-data')
      expect(command[command.length - 1]).toContain('dsh-ide-jdtls')
    } else {
      // 本机无 JDTLS：discover null（桥 close 1011 降级），commandFor 返回占位命令。
      expect(available).toBeNull()
      expect(command).toEqual(['java'])
    }
  })

  it('与 lsp-core resolveServerCommand 组合：无 JDTLS 的机器上解析为 null（降级）', async () => {
    const ctx = setup()
    const servers = ctx.services.get('lspServerRegistry') as { match(languageId: string): Parameters<typeof resolveServerCommand>[0] | undefined }
    const resolved = await resolveServerCommand(servers.match('java')!, 'C:/ws')
    const discovered = await servers.match('java')!.discover!()
    // resolveServerCommand 的结果与 discover 的可用性一致（null = 纯高亮降级）。
    expect(resolved === null).toBe(discovered === null)
  })
})
