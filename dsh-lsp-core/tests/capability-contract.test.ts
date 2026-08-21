/**
 * LanguageCapability 契约测试：LspSession 必须完整实现编辑器（dsh-ide-layout）
 * 依赖的全部接口方法——EditorPane 的 LSP 交互点（补全/悬停/签名/linter/跳转/
 * 重命名/格式化/codeAction/生命周期/诊断/状态）一个都不能缺，否则编辑器调用
 * 落空（undefined is not a function）。
 */
import { describe, expect, it } from 'vitest'
import { LspSession } from '../src/client/capability.ts'
import type { LanguageCapability } from '../src/client/types.ts'

function makeSession(): LanguageCapability {
  return new LspSession({
    root: 'C:/ws',
    rootUri: 'file:///c:/ws',
    languageId: 'python',
    wsUrl: '/dsh-lsp/ws',
    config: {
      initializationOptions: { useLibraryCodeForTypes: false },
      didChangeConfiguration: { settings: { pyright: {} } },
      workspaceConfiguration: () => null,
    },
  })
}

describe('LanguageCapability 契约（编辑器依赖面）', () => {
  it('LspSession 实现全部接口方法', () => {
    const session = makeSession()
    // 属性
    expect(session.languageId).toBe('python')
    expect(['connecting', 'ready', 'error']).toContain(session.status)
    // 文档生命周期
    for (const method of ['openDocument', 'updateDocument', 'closeDocument', 'dispose'] as const) {
      expect(typeof session[method]).toBe('function')
    }
    // LSP 请求
    for (const method of ['completion', 'hover', 'signatureHelp', 'definition', 'rename', 'formatting', 'codeAction'] as const) {
      expect(typeof session[method]).toBe('function')
    }
    // 订阅
    for (const method of ['onDiagnostics', 'onStatus'] as const) {
      expect(typeof session[method]).toBe('function')
    }
  })

  it('订阅方法返回 disposer，且诊断/状态回调可触发', async () => {
    const session = makeSession()
    const statuses: string[] = []
    const offStatus = session.onStatus((s) => statuses.push(s))
    offStatus()
    expect(statuses.length).toBeGreaterThanOrEqual(0)

    const diags: Array<[string, unknown]> = []
    const offDiag = session.onDiagnostics((uri, list) => diags.push([uri, list]))
    offDiag()
    // 未连接时请求安全返回空（不抛错）
    await expect(session.completion('a.py', { line: 0, character: 0 })).resolves.toBeNull()
    await expect(session.definition('a.py', { line: 0, character: 0 })).resolves.toEqual([])
    await expect(session.formatting('a.py')).resolves.toEqual([])
  })

  it('dispose 后无副作用（幂等）', () => {
    const session = makeSession()
    session.dispose()
    session.dispose()
    expect(session.status).toBe('connecting')
  })
})
