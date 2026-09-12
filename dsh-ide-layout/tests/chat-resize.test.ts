import { describe, expect, it } from 'vitest'
import {
  canFinishDrag,
  canStartDrag,
  chatWidthFromDrag,
  clampChatWidth,
  EDITOR_MIN_PX,
  MIN_CHAT_PX,
  shouldSyncSidebarImmediately,
} from '../src/client/chat-resize.ts'

describe('聊天区拖拽宽度', () => {
  it('保持聊天区最小宽度', () => {
    expect(clampChatWidth(1600, 0)).toBe(MIN_CHAT_PX)
  })

  it('始终为编辑区保留最小宽度', () => {
    const total = 1200
    expect(clampChatWidth(total, 2000)).toBe(total - EDITOR_MIN_PX)
  })

  it('左拖增大聊天区、右拖缩小聊天区', () => {
    expect(chatWidthFromDrag(1600, 520, 800, 700)).toBe(620)
    expect(chatWidthFromDrag(1600, 520, 800, 900)).toBe(MIN_CHAT_PX)
  })

  it('窄窗口仍返回可用的聊天区最小值', () => {
    expect(clampChatWidth(MIN_CHAT_PX + EDITOR_MIN_PX - 1, 9999)).toBe(MIN_CHAT_PX)
  })
})

describe('侧栏实时拖拽状态', () => {
  it('只允许空闲状态的主指针左键开始拖拽', () => {
    expect(canStartDrag('none', true, 0)).toBe(true)
    expect(canStartDrag('chat', true, 0)).toBe(false)
    expect(canStartDrag('sidebar', true, 0)).toBe(false)
    expect(canStartDrag('none', false, 0)).toBe(false)
    expect(canStartDrag('none', true, 2)).toBe(false)
  })

  it('侧栏拖动中只对有效且有像素变化的真实右缘即时同步', () => {
    expect(shouldSyncSidebarImmediately('sidebar', 300, 300.4)).toBe(false)
    expect(shouldSyncSidebarImmediately('sidebar', 300, 300.5)).toBe(true)
    expect(shouldSyncSidebarImmediately('chat', 300, 320)).toBe(false)
    expect(shouldSyncSidebarImmediately('sidebar', 300, 0)).toBe(false)
    expect(shouldSyncSidebarImmediately('sidebar', 300, Number.NaN)).toBe(false)
  })

  it('只有活动指针可以结束侧栏拖拽', () => {
    expect(canFinishDrag('sidebar', 7, 7)).toBe(true)
    expect(canFinishDrag('sidebar', 7, 8)).toBe(false)
    expect(canFinishDrag('chat', 7, 7)).toBe(false)
    expect(canFinishDrag('sidebar', null, 7)).toBe(false)
  })
})
