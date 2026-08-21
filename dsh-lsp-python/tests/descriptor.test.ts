/**
 * dsh-lsp-python descriptor 结构守护：注册的语言描述与服务器配置
 * 保持与旧 dsh-ide-layout 行为一致（pyright 宽松配置，防误报回归）。
 */
import { describe, expect, it } from 'vitest'
// 直接引用源码（bundle 产物含浏览器代码，Node 测试环境不可加载）。
import { getLspRegistry } from '../../dsh-lsp-core/src/client/types.ts'

// 直接构造与 src/client/index.ts 相同的 descriptor（避免依赖运行时 ctx）。
function makeDescriptor() {
  return {
    id: 'python',
    displayName: 'Python',
    extensions: ['py', 'pyw'],
    server: {
      initializationOptions: { useLibraryCodeForTypes: false, autoImportCompletions: true },
      didChangeConfiguration: {
        settings: {
          pyright: { strict: false, useLibraryCodeForTypes: false, autoImportCompletions: true },
          python: { analysis: { typeCheckingMode: 'basic', useLibraryCodeForTypes: false, autoImportCompletions: true } },
        },
      },
      workspaceConfiguration: (section: string) => {
        if (section === 'pyright') return { strict: false, useLibraryCodeForTypes: false, autoImportCompletions: true }
        if (section === 'python') return { analysis: { typeCheckingMode: 'basic', useLibraryCodeForTypes: false, autoImportCompletions: true } }
        return null
      },
    },
  }
}

describe('dsh-lsp-python descriptor', () => {
  it('扩展名覆盖 py/pyw（含大小写）', () => {
    const descriptor = makeDescriptor()
    expect(descriptor.extensions).toEqual(['py', 'pyw'])
    expect(descriptor.extensions.includes('py')).toBe(true)
    expect(descriptor.extensions.includes('PY')).toBe(false) // match 层做小写化
  })

  it('不携带语法工厂（CodeMirror 扩展必须由消费者单副本构造，跨 bundle 双副本会硬崩）', () => {
    const descriptor = makeDescriptor()
    expect(descriptor.syntax).toBeUndefined()
  })

  it('服务器配置保留误报抑制项（useLibraryCodeForTypes:false）', () => {
    const descriptor = makeDescriptor()
    expect(descriptor.server?.initializationOptions).toMatchObject({ useLibraryCodeForTypes: false })
    const pyright = descriptor.server?.workspaceConfiguration?.('pyright')
    expect(pyright).toMatchObject({ useLibraryCodeForTypes: false, autoImportCompletions: true })
    expect(descriptor.server?.workspaceConfiguration?.('unknown')).toBeNull()
  })

  it('未提供 ctx 时 getLspRegistry 返回 undefined（优雅降级）', () => {
    expect(getLspRegistry(null)).toBeUndefined()
    expect(getLspRegistry('nope')).toBeUndefined()
    expect(getLspRegistry({})).toBeUndefined()
  })
})
