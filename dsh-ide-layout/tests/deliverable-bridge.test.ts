/**
 * 交付卡片桥接（deliverable-bridge）单测：文案路径提取、root 相对化、
 * 二进制产物判定。
 */
import { describe, expect, it } from 'vitest'
import {
  extractSidebarPreviewPath,
  isBinaryArtifact,
  relativeToRoot,
} from '../src/client/deliverable-bridge.ts'

describe('extractSidebarPreviewPath 文案路径提取', () => {
  it('提取中文主按钮 aria-label 的绝对路径', () => {
    expect(extractSidebarPreviewPath('在侧边栏打开 E:\\work\\workbuddy2api\\memory.md'))
      .toBe('E:\\work\\workbuddy2api\\memory.md')
  })

  it('提取中文「预览」文案', () => {
    expect(extractSidebarPreviewPath('在侧边栏预览 E:\\a\\b.md')).toBe('E:\\a\\b.md')
  })

  it('提取英文 Open 文案', () => {
    expect(extractSidebarPreviewPath('Open E:\\a\\b.md in sidebar')).toBe('E:\\a\\b.md')
  })

  it('提取英文 Preview 文案', () => {
    expect(extractSidebarPreviewPath('Preview E:\\a\\b.md in sidebar')).toBe('E:\\a\\b.md')
  })

  it('路径含空格也能完整提取', () => {
    expect(extractSidebarPreviewPath('在侧边栏打开 E:\\my work\\my file.md'))
      .toBe('E:\\my work\\my file.md')
  })

  it('普通按钮文案返回 null（不拦截）', () => {
    expect(extractSidebarPreviewPath('打开')).toBeNull()
    expect(extractSidebarPreviewPath('在文件资源管理器中显示')).toBeNull()
    expect(extractSidebarPreviewPath('用默认应用打开')).toBeNull()
    expect(extractSidebarPreviewPath('')).toBeNull()
  })
})

describe('relativeToRoot 路径相对化', () => {
  it('root 内绝对路径剥掉 root 前缀', () => {
    expect(relativeToRoot('E:\\work\\workbuddy2api', 'E:\\work\\workbuddy2api\\memory.md'))
      .toBe('memory.md')
  })

  it('root 内绝对路径大小写不敏感（Windows 盘符）', () => {
    expect(relativeToRoot('e:\\work\\WorkBuddy', 'E:\\work\\workbuddy\\a\\b.ts')).toBe('a/b.ts')
  })

  it('已是相对路径原样返回（反斜杠统一为正斜杠）', () => {
    expect(relativeToRoot('E:\\work', 'src\\main.rs')).toBe('src/main.rs')
  })

  it('root 外绝对路径返回 null（放行默认侧边栏预览）', () => {
    expect(relativeToRoot('E:\\work\\other', 'E:\\work\\workbuddy2api\\memory.md')).toBeNull()
  })

  it('空 root 返回 null', () => {
    expect(relativeToRoot('', 'E:\\a\\b.md')).toBeNull()
  })
})

describe('isBinaryArtifact 二进制产物判定', () => {
  it('可执行/压缩产物判为二进制', () => {
    expect(isBinaryArtifact('workbuddy-proxy-windows-amd64.exe')).toBe(true)
    expect(isBinaryArtifact('dist\\bundle.zip')).toBe(true)
  })

  it('文本/图片文件不为二进制', () => {
    expect(isBinaryArtifact('memory.md')).toBe(false)
    expect(isBinaryArtifact('src\\main.go')).toBe(false)
    expect(isBinaryArtifact('shot.png')).toBe(false)
  })
})
