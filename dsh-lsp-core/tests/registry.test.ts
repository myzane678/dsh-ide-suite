/**
 * client 语言注册表单测（registry.ts）：register/match/get/list/subscribe/disposer。
 */
import { describe, expect, it } from 'vitest'
import { createLspRegistry } from '../src/client/registry.ts'
import type { LanguageDescriptor } from '../src/client/types.ts'

const pythonDescriptor: LanguageDescriptor = {
  id: 'python',
  displayName: 'Python',
  extensions: ['py', 'pyw'],
  syntax: () => [],
  server: { initializationOptions: { useLibraryCodeForTypes: false } },
}

describe('createLspRegistry', () => {
  it('register 后 get/match/list 可见', () => {
    const registry = createLspRegistry()
    registry.register(pythonDescriptor)
    expect(registry.get('python')?.displayName).toBe('Python')
    expect(registry.match('a/b/main.py')?.id).toBe('python')
    expect(registry.match('a/b/main.PYW')?.id).toBe('python')
    expect(registry.match('a/b/main.js')).toBeUndefined()
    expect(registry.list().map((d) => d.id)).toEqual(['python'])
  })

  it('重复注册同 id 抛错（防插件二次激活）', () => {
    const registry = createLspRegistry()
    registry.register(pythonDescriptor)
    expect(() => registry.register(pythonDescriptor)).toThrow(/already registered/)
  })

  it('disposer 撤销注册', () => {
    const registry = createLspRegistry()
    const dispose = registry.register(pythonDescriptor)
    dispose()
    expect(registry.get('python')).toBeUndefined()
    // 撤销后可重新注册
    expect(() => registry.register(pythonDescriptor)).not.toThrow()
  })

  it('subscribe 在注册/撤销时触发', () => {
    const registry = createLspRegistry()
    let calls = 0
    const off = registry.subscribe(() => { calls += 1 })
    const dispose = registry.register(pythonDescriptor)
    expect(calls).toBe(1)
    dispose()
    expect(calls).toBe(2)
    off()
    registry.register(pythonDescriptor)
    expect(calls).toBe(2)
  })

  it('扩展名大小写不敏感（match 用小写）', () => {
    const registry = createLspRegistry()
    registry.register(pythonDescriptor)
    expect(registry.match('Script.Py')).toBeDefined()
  })
})
