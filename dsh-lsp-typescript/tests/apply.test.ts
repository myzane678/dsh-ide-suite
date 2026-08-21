/**
 * dsh-lsp-typescript 注册链路冒烟（模拟 cordis ctx，不依赖浏览器/宿主）：
 * lsp-core host/client apply → 本插件 host/client apply → 注册表命中。
 * 经源码导入（bundle 产物含浏览器代码，Node 测试不可加载）。
 */
import { describe, expect, it } from 'vitest'
import { apply as applyLspCoreHost } from '../../dsh-lsp-core/src/host/index.ts'
import { apply as applyLspCoreClient } from '../../dsh-lsp-core/src/client/index.ts'
import { apply as applyTsHost } from '../src/index.ts'
import { apply as applyTsClient } from '../src/client/index.ts'

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
  applyTsHost(ctx as never)
  applyTsClient(ctx as never)
  ctx.runEffects()
  return ctx
}

describe('dsh-lsp-typescript client（语言注册）', () => {
  it('四个 languageId 按扩展名命中', () => {
    const ctx = setup()
    const registry = ctx.services.get('lspRegistry') as { match(path: string): { id: string } | undefined }
    expect(registry.match('src/app.ts')?.id).toBe('typescript')
    expect(registry.match('src/app.tsx')?.id).toBe('typescriptreact')
    expect(registry.match('src/app.js')?.id).toBe('javascript')
    expect(registry.match('src/app.jsx')?.id).toBe('javascriptreact')
    expect(registry.match('src/style.css')).toBeUndefined()
  })

  it('不携带语法工厂（CodeMirror 扩展必须由消费者单副本构造）', () => {
    const ctx = setup()
    const registry = ctx.services.get('lspRegistry') as { match(path: string): { syntax?: () => unknown } | undefined }
    expect(registry.match('a.ts')?.syntax).toBeUndefined()
  })

  it('server 配置存在（空对象 = 启用 LSP，acquire 不返回 null）', () => {
    const ctx = setup()
    const registry = ctx.services.get('lspRegistry') as { match(path: string): { server?: unknown } | undefined }
    expect(registry.match('a.ts')?.server).toEqual({})
  })
})

describe('dsh-lsp-typescript host（服务器注册）', () => {
  it('四个 languageId 命中同一命令，入口可解析', () => {
    const ctx = setup()
    const servers = ctx.services.get('lspServerRegistry') as { match(languageId: string): { command?: readonly string[] } | undefined }
    for (const languageId of ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']) {
      const config = servers.match(languageId)
      expect(config?.command?.[1]).toContain('typescript-language-server')
      expect(config?.command?.[2]).toBe('--stdio')
    }
    expect(servers.match('python')).toBeUndefined()
  })
})
