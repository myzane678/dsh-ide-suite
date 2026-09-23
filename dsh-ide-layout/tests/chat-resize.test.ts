import { describe, expect, it } from 'vitest'
import {
  canFinishDrag,
  canStartDrag,
  chatWidthFromDrag,
  clampChatWidth,
  clampContentWidth,
  CONTENT_EDGE_BUDGET,
  CONTENT_MAX_PX,
  CONTENT_MIN_PX,
  contentWidthFromDrag,
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

describe('会话区（白色内容列）拖拽宽度', () => {
  it('钳制在 [最小值, min(硬上限, 可用宽 − 安全区)]', () => {
    expect(clampContentWidth(2000, 0)).toBe(CONTENT_MIN_PX)
    // 可用宽很宽也被硬上限压住（治全屏时列宽飘到 1380）
    expect(clampContentWidth(2000, 9999)).toBe(CONTENT_MAX_PX)
    // 窄列时上限让给「可用宽 − 安全区」
    expect(clampContentWidth(1000, 9999)).toBe(1000 - CONTENT_EDGE_BUDGET)
    // 区间内的请求值原样返回
    expect(clampContentWidth(2000, 1000)).toBe(1000)
  })

  it('上限不小于最小值（窄列也不塌到 0）', () => {
    expect(clampContentWidth(CONTENT_MIN_PX - 400, 9999)).toBe(CONTENT_MIN_PX)
  })

  it('左右手柄同为对称缩放：外拖一格宽涨两格', () => {
    // 左手柄向左拖 50px、右手柄向右拖 50px，都应变宽 100px
    expect(contentWidthFromDrag(1018, -50, 'left')).toBe(1118)
    expect(contentWidthFromDrag(1018, 50, 'right')).toBe(1118)
    // 反向内拖则等量收窄
    expect(contentWidthFromDrag(1018, 50, 'left')).toBe(918)
    expect(contentWidthFromDrag(1018, -50, 'right')).toBe(918)
    // 指针不动宽度不变
    expect(contentWidthFromDrag(1018, 0, 'left')).toBe(1018)
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
