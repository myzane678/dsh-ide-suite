/**
 * lspCapabilities.languageFor 回归：注册表驱动的语言路由（阶段 3——
 * 编辑器的语言知识全部收敛到此查询，不再有本地 languageIdForPath）。
 */
import { describe, expect, it } from 'vitest'
import { apply as applyLspCoreClient } from '../src/client/index.ts'

function makeCtx(): { provide(name: string, value: unknown): void; services: Map<string, unknown> } & Record<string, unknown> {
  const services = new Map<string, unknown>()
  const ctx = { provide(n: string, v: unknown) { services.set(n, v); ctx[n] = v }, services } as ReturnType<typeof makeCtx>
  return ctx
}

function setup() {
  const ctx = makeCtx()
  applyLspCoreClient(ctx as never)
  const registry = ctx.services.get('lspRegistry') as {
    register(d: { id: string; sessionId?: string; displayName: string; extensions: readonly string[]; server?: unknown }): () => void
  }
  // 模拟 dsh-lsp-typescript（sessionId 归一）+ dsh-lsp-python 的注册面。
  registry.register({ id: 'typescript', sessionId: 'typescript', displayName: 'TypeScript', extensions: ['ts'], server: {} })
  registry.register({ id: 'javascript', sessionId: 'typescript', displayName: 'JavaScript', extensions: ['js'], server: {} })
  registry.register({ id: 'python', displayName: 'Python', extensions: ['py'], server: {} })
  const caps = ctx.services.get('lspCapabilities') as {
    languageFor(path: string): { id: string; displayName: string; sessionId: string } | null
  }
  return caps
}

describe('lspCapabilities.languageFor（注册表语言路由）', () => {
  it('按扩展名命中并返回会话组摘要', () => {
    const caps = setup()
    expect(caps.languageFor('src/app.ts')).toEqual({ id: 'typescript', displayName: 'TypeScript', sessionId: 'typescript' })
    expect(caps.languageFor('src/app.js')?.sessionId).toBe('typescript')
    expect(caps.languageFor('train.py')).toEqual({ id: 'python', displayName: 'Python', sessionId: 'python' })
  })

  it('未注册语言返回 null（编辑器纯高亮，无语言知识残留）', () => {
    const caps = setup()
    expect(caps.languageFor('style.css')).toBeNull()
    expect(caps.languageFor('README.md')).toBeNull()
  })
})
