/**
 * dsh-lsp-rust 注册链路冒烟（模拟 cordis ctx）。rust-analyzer 的本机发现
 * （DSH_RUST_LS_HOME / ~/.cargo/bin / PATH）不在单测范围——discover 与
 * resolveServerCommand 的组合语义由 dsh-lsp-core 的 bridge 测试覆盖；
 * 这里验证注册面（与 dsh-lsp-java 的 apply 测试同模式）。
 */
import { describe, expect, it } from 'vitest'
import { apply as applyLspCoreHost } from '../../dsh-lsp-core/src/host/index.ts'
import { apply as applyLspCoreClient } from '../../dsh-lsp-core/src/client/index.ts'
import { apply as applyRustHost } from '../src/index.ts'
import { apply as applyRustClient } from '../src/client/index.ts'
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
  applyRustHost(ctx as never)
  applyRustClient(ctx as never)
  ctx.runEffects()
  return ctx
}

describe('dsh-lsp-rust', () => {
  it('client：.rs 命中 rust，无语法工厂，server 存在', () => {
    const ctx = setup()
    const registry = ctx.services.get('lspRegistry') as { match(path: string): { id: string; syntax?: () => unknown; server?: unknown } | undefined }
    expect(registry.match('src/main.rs')?.id).toBe('rust')
    expect(registry.match('a.py')).toBeUndefined()
    expect(registry.match('a.rs')?.syntax).toBeUndefined()
    expect(registry.match('a.rs')?.server).toEqual({})
  })

  it('host：注册含 discover（找到时命令为单元素可执行路径）', async () => {
    const ctx = setup()
    const servers = ctx.services.get('lspServerRegistry') as { match(languageId: string): { discover?: () => Promise<readonly string[] | null> } | undefined }
    const config = servers.match('rust')
    expect(config?.discover).toBeDefined()
    const discovered = await config!.discover!()
    if (discovered !== null) {
      expect(discovered.length).toBe(1)
      expect(discovered[0].length).toBeGreaterThan(0)
    } else {
      // 本机无 rust-analyzer：discover null（桥 close 1011 降级纯高亮）。
      expect(discovered).toBeNull()
    }
  })

  it('与 lsp-core resolveServerCommand 组合：无 rust-analyzer 的机器上解析为 null（降级）', async () => {
    const ctx = setup()
    const servers = ctx.services.get('lspServerRegistry') as { match(languageId: string): Parameters<typeof resolveServerCommand>[0] | undefined }
    const resolved = await resolveServerCommand(servers.match('rust')!, 'C:/ws')
    const discovered = await servers.match('rust')!.discover!()
    // resolveServerCommand 的结果与 discover 的可用性一致（null = 纯高亮降级）。
    expect(resolved === null).toBe(discovered === null)
  })
})
