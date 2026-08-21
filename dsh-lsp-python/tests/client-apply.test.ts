/**
 * client 侧跨插件注册链路冒烟（模拟 cordis ctx，不依赖浏览器）：
 * lsp-core client apply（提供 ctx.lspRegistry/lspCapabilities）→ lsp-python
 * client apply（注册 python 语言）→ 注册表按扩展名命中、语法工厂可用。
 * 经源码导入（bundle 产物含浏览器代码，Node 测试不可加载）。
 */
import { describe, expect, it } from 'vitest'
import { apply as applyLspCoreClient } from '../../dsh-lsp-core/src/client/index.ts'
import { apply as applyPythonClient } from '../src/client/index.ts'

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
  }
  return ctx
}

describe('client 跨插件注册链路（lsp-core → lsp-python）', () => {
  it('apply 后 lspRegistry 可按扩展名命中 python', () => {
    const ctx = makeCtx()
    applyLspCoreClient(ctx as never)
    expect(ctx.services.has('lspRegistry')).toBe(true)
    expect(ctx.services.has('lspCapabilities')).toBe(true)

    applyPythonClient(ctx as never)
    ctx.runEffects()

    const registry = ctx.services.get('lspRegistry') as {
      match(path: string): { id: string; displayName: string } | undefined
    }
    const hit = registry.match('scripts/train.py')
    expect(hit?.id).toBe('python')
    expect(hit?.displayName).toBe('Python')
    expect(hit?.match?.length).toBeUndefined()
  })

  it('descriptor 不携带语法工厂（跨 bundle CodeMirror 扩展会双副本硬崩）', () => {
    const ctx = makeCtx()
    applyLspCoreClient(ctx as never)
    applyPythonClient(ctx as never)
    ctx.runEffects()
    const registry = ctx.services.get('lspRegistry') as { match(p: string): { syntax?: () => unknown } | undefined }
    expect(registry.match('a.py')?.syntax).toBeUndefined()
  })

  it('lspCapabilities 工厂存在且未注册服务器配置的语言返回 null 能力', () => {
    const ctx = makeCtx()
    applyLspCoreClient(ctx as never)
    applyPythonClient(ctx as never)
    ctx.runEffects()
    const capabilities = ctx.services.get('lspCapabilities') as {
      acquire(root: string, languageId: string): unknown
    }
    // python 已注册 server 配置，可 acquire（Node 环境不真正连接；拿到会话后立即释放，
    // 避免重连定时器挂住测试进程）。
    const session = capabilities.acquire('C:/ws', 'python') as { dispose(): void } | null
    expect(session).not.toBeNull()
    session!.dispose()
    // 未注册语言（如 java）→ null 能力（纯高亮）。
    expect(capabilities.acquire('C:/ws', 'java')).toBeNull()
  })
})
