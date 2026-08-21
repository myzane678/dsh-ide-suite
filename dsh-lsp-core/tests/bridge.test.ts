/**
 * host 桥单测（bridge.ts）：分帧读取 / URI 门禁 / 路径前缀编码 /
 * 启动命令解析（commandFor > command > discover 兜底）。
 */
import { describe, expect, it } from 'vitest'
import { FrameReader, resolveServerCommand, uriPrefixFor, uriWithinRoot } from '../src/host/bridge.ts'
import type { LspServerConfig } from '../src/host/types.ts'

describe('FrameReader', () => {
  it('按 Content-Length 分帧解析多条消息（含跨块边界）', () => {
    const reader = new FrameReader()
    const messages: unknown[] = []
    const a = Buffer.from('Content-Length: 2\r\n\r\n{}')
    const b = Buffer.from('Content-Length: 14\r\n\r\n{"method":"x"}')
    expect(reader.push(a.subarray(0, 5), (m) => messages.push(m))).toBe(true)
    expect(reader.push(Buffer.concat([a.subarray(5), b]), (m) => messages.push(m))).toBe(true)
    expect(messages).toEqual([{}, { method: 'x' }])
  })

  it('单帧超过上限返回 false（协议违规，调用方应断开）', () => {
    const reader = new FrameReader(8)
    expect(reader.push(Buffer.from('Content-Length: 16\r\n\r\n{"aaaaaaaaaaaa"}'), () => {})).toBe(false)
  })

  it('畸形 JSON 体跳过不抛错', () => {
    const reader = new FrameReader()
    const messages: unknown[] = []
    expect(reader.push(Buffer.from('Content-Length: 4\r\n\r\nbad!'), (m) => messages.push(m))).toBe(true)
    expect(messages).toEqual([])
  })
})

describe('uriWithinRoot（LSP URI 门禁）', () => {
  const prefix = uriPrefixFor('C:\\projects\\my app')

  it('根自身与子目录放行；要求目录段边界', () => {
    expect(uriWithinRoot('file:///C:/projects/my%20app', prefix)).toBe(true)
    expect(uriWithinRoot('file:///C:/projects/my%20app/lib/mod.ts', prefix)).toBe(true)
    expect(uriWithinRoot('file:///C:/projects/my%20app2', prefix)).toBe(false)
    expect(uriWithinRoot('file:///C:/other', prefix)).toBe(false)
  })

  it('大小写不敏感（Windows）+ 客户端编码规则的前缀', () => {
    expect(uriWithinRoot('file:///C:/PROJECTS/MY%20APP/x.ts', prefix)).toBe(true)
  })

  it('uriPrefixFor：盘符保留、其余段百分号编码、尾斜杠去除', () => {
    expect(uriPrefixFor('C:\\a b\\c\\')).toBe('file:///C:/a%20b/c')
  })
})

describe('resolveServerCommand（注册表命令解析）', () => {
  it('commandFor(root) 优先于静态 command（JDTLS -data 依赖 root）', async () => {
    const config: LspServerConfig = {
      languageId: 'java',
      command: ['fallback'],
      commandFor: (root) => ['java', '-jar', 'l.jar', '-data', `tmp/${root}`],
    }
    await expect(resolveServerCommand(config, 'C:/ws')).resolves.toEqual(['java', '-jar', 'l.jar', '-data', 'tmp/C:/ws'])
  })

  it('无 commandFor 时用静态 command', async () => {
    const config: LspServerConfig = { languageId: 'python', command: ['pyright', '--stdio'] }
    await expect(resolveServerCommand(config, 'C:/ws')).resolves.toEqual(['pyright', '--stdio'])
  })

  it('discover 返回 null → 不可用（编辑器降级纯高亮）', async () => {
    const config: LspServerConfig = { languageId: 'java', discover: async () => null }
    await expect(resolveServerCommand(config, 'C:/ws')).resolves.toBeNull()
  })

  it('discover 结果作为命令兜底；commandFor 存在时 discover 仅探测可用性', async () => {
    const discovered: LspServerConfig = { languageId: 'java', discover: async () => ['java', '-jar', 'found.jar'] }
    await expect(resolveServerCommand(discovered, 'C:/ws')).resolves.toEqual(['java', '-jar', 'found.jar'])
    const both: LspServerConfig = {
      languageId: 'java',
      commandFor: () => ['java', '-data', 'tmp'],
      discover: async () => null, // 不可用 → null 优先返回，不采用 commandFor
    }
    await expect(resolveServerCommand(both, 'C:/ws')).resolves.toBeNull()
  })

  it('三者皆无 → null（调用方 close 1011）', async () => {
    await expect(resolveServerCommand({ languageId: 'x' }, 'C:/ws')).resolves.toBeNull()
  })
})
