/**
 * host 语言服务器注册表单测（server-registry.ts）。
 */
import { describe, expect, it } from 'vitest'
import { createLspServerRegistry } from '../src/host/server-registry.ts'

describe('createLspServerRegistry', () => {
  it('register 后 match 命中', () => {
    const registry = createLspServerRegistry()
    registry.register({ languageId: 'python', command: ['pyright', '--stdio'] })
    expect(registry.match('python')?.command[0]).toBe('pyright')
    expect(registry.match('java')).toBeUndefined()
  })

  it('重复注册抛错', () => {
    const registry = createLspServerRegistry()
    registry.register({ languageId: 'python', command: ['pyright'] })
    expect(() => registry.register({ languageId: 'python', command: ['other'] })).toThrow(/already registered/)
  })

  it('disposer 撤销后 match 落空', () => {
    const registry = createLspServerRegistry()
    const dispose = registry.register({ languageId: 'python', command: ['pyright'] })
    dispose()
    expect(registry.match('python')).toBeUndefined()
  })

  it('command 可选：commandFor 动态命令（JDTLS 场景）', () => {
    const registry = createLspServerRegistry()
    const javaConfig = {
      languageId: 'java',
      commandFor: (root: string) => ['java', '-jar', 'launcher.jar', '-data', `tmp/${root}`],
    }
    registry.register(javaConfig)
    const config = registry.match('java')
    expect(config?.commandFor?.('C:/ws')).toEqual(['java', '-jar', 'launcher.jar', '-data', 'tmp/C:/ws'])
    expect(config?.command).toBeUndefined()
  })
})
