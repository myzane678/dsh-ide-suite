/**
 * MessageNav — 并入 dsh-ide-layout 的对话导航条。
 *
 * 交互复刻 DeepSeek 网页版 ScrollNav：折叠态为右缘细竖轨（每条用户消息一个
 * 短横线节点），光标悬停导航条时「放大」展开为带消息文字的面板（宽度过渡 +
 * 文字渐显），移出收回；激活节点品牌蓝跟随阅读位置，点击平滑跳转 + 目标行闪烁。
 *
 * 数据源：已加载会话节点（snapshot.chat.nodes 中 kind === "user" 的节点），
 * 点击尚未入窗的旧消息时按需 loadOlder 拉到目标再跳转 —— 不注册 host 投影，
 * 保持精简（长会话的「全量即时入串」留待需要时再升级）。
 *
 * 定位：ResizeObserver 测量 [data-conversation-scroll] 聊天滚动区右缘，节点条
 * fixed 跟随 —— 与 ide-layout 的 centerCol margin 挤压天然兼容：编辑器打开时
 * 聊天区被挤到中间，节点条自动贴在聊天区右缘，绝不盖住编辑器/details。
 *
 * 样式风格与项目一致：inline style + CSS 变量（--ide-* / --dsw-alias-*），
 * 深色主题跟随 DSH 的 [data-theme='dark'] / body[data-ds-dark-theme] 标记。
 */

import { createElement, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** 预览文本上限：与 chat-timeline 一致，保持数据小巧。 */
const MAX_TEXT_CHARS = 80
/** 阅读位置采样线：滚动区高度 40% 处（与官网/chat-timeline 一致）。 */
const ACTIVE_LINE_RATIO = 0.4
/** loadOlder 最大翻页数（每页 50 条，与 chat-timeline 一致）。 */
const MAX_PAGES = 120

/** 一条用户消息的导航记录。 */
interface MsgEntry {
  seq: number
  time: number
  text: string
  key: string
}

/** useSyncExternalStore 的空占位 store（会话未就绪时）。 */
const NOOP_STORE = { getSnapshot: () => void 0, subscribe: () => () => {} }

/** 拼接 ContentBlock 中的文本块（与 host 侧一致）。 */
function userTextOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string') {
      out += (block as { text: string }).text
    }
  }
  return out.trim().slice(0, MAX_TEXT_CHARS)
}

/** 从已加载会话节点枚举用户消息。 */
function collectFromNodes(snapshot: unknown): MsgEntry[] {
  const out: MsgEntry[] = []
  const nodes = (snapshot as { chat?: { nodes?: Map<string, unknown> } })?.chat?.nodes
  if (nodes === undefined) return out
  for (const node of nodes.values()) {
    if (node === null || typeof node !== 'object') continue
    const n = node as { kind?: unknown; key?: unknown; anchorSeq?: unknown; data?: { time?: unknown; content?: unknown } }
    if (n.kind !== 'user') continue
    const data = n.data
    if (data === undefined || typeof data.time !== 'number' || !Array.isArray(data.content)) continue
    const key = typeof n.key === 'string' ? n.key : undefined
    if (key === undefined) continue
    out.push({ seq: typeof n.anchorSeq === 'number' ? n.anchorSeq : 0, time: data.time, text: userTextOf(data.content), key })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 目标行闪烁高亮（1.2s 品牌蓝淡出），完成后还原内联样式。 */
function flashRow(row: Element): void {
  const el = row as HTMLElement
  const prevTransition = el.style.transition
  const prevBackground = el.style.backgroundColor
  el.style.transition = 'background-color 1.2s ease'
  el.style.backgroundColor = 'rgba(77,107,254,0.16)'
  window.setTimeout(() => {
    el.style.transition = prevTransition
    el.style.backgroundColor = prevBackground
  }, 1200)
}

/**
 * 确保目标消息已加载进窗口，然后平滑滚动到其行并闪烁。
 * 返回是否成功（目标不存在于历史中时为 false）。
 */
async function jumpToMessage(sessions: ClientContext['sessions'], sessionId: SessionId, key: string): Promise<boolean> {
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) return false
  let guard = 0
  while (guard++ < MAX_PAGES) {
    const snapshot = session.getSnapshot()
    if (snapshot?.chat?.nodes?.get(key) !== undefined) break
    if (snapshot?.hasMore !== true) return false
    if (snapshot.loadingOlder === true) { await delay(50); continue }
    await session.loadOlder()
  }
  const scrollport = typeof document !== 'undefined' ? document.querySelector('[data-conversation-scroll]') : null
  const row = scrollport === null ? null : scrollport.querySelector(`[data-chat-anchor-key="${CSS.escape(key)}"]`)
  if (row === null) return false
  const reducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  row.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' })
  flashRow(row)
  return true
}

/** 导航条本体：portal 到 body，fixed 跟随聊天区右缘。 */
function MessageNav({ sessions }: { sessions: ClientContext['sessions'] }): JSX.Element {
  // 当前会话 id：订阅 sessions.list
  const listSnap = useSyncExternalStore(
    (cb) => sessions.list.subscribe(cb),
    () => sessions.list.getSnapshot(),
  )
  const sessionId = (listSnap as { current?: SessionId }).current

  // 会话快照：订阅 session 本体（未就绪时用 NOOP_STORE）
  const session = sessionId === undefined ? undefined : sessions.binding(sessionId)?.session
  const fallbackStore = session === undefined ? NOOP_STORE : session
  const snapshot = useSyncExternalStore(
    (cb) => fallbackStore.subscribe(cb),
    () => fallbackStore.getSnapshot(),
  )

  const messages = collectFromNodes(snapshot)

  // 聊天滚动区右缘：ResizeObserver 跟随（编辑器开合/窗口变化自动更新）
  const [rightOffset, setRightOffset] = useState(12)
  // 阅读位置对应节点索引
  const [activeIndex, setActiveIndex] = useState(-1)
  // 悬停展开：true = 导航条放大为消息面板（复刻官网 ScrollNav）
  const [expanded, setExpanded] = useState(false)
  // 聊天滚动区是否存在（非对话视图时隐藏）
  const [hasScrollport, setHasScrollport] = useState(false)
  const pageRef = useRef<HTMLDivElement | null>(null)

  // —— 定位：测量 [data-conversation-scroll] 右缘 ——
  useEffect(() => {
    let raf = 0
    const measure = (): void => {
      raf = 0
      const sp = document.querySelector('[data-conversation-scroll]')
      if (sp === null) { setHasScrollport(false); return }
      setHasScrollport(true)
      const rect = sp.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const next = Math.max(8, Math.round(window.innerWidth - rect.right + 12))
      setRightOffset((prev) => (Math.abs(prev - next) > 0.5 ? next : prev))
    }
    const schedule = (): void => {
      if (raf !== 0) return
      raf = window.requestAnimationFrame(measure)
    }
    const sp = document.querySelector('[data-conversation-scroll]')
    const ro = typeof ResizeObserver === 'function' && sp !== null ? new ResizeObserver(schedule) : null
    if (ro !== null && sp !== null) ro.observe(sp)
    // 编辑器开合（ide-layout 改 margin-left）会触发滚动区尺寸变化 → ResizeObserver 已覆盖；
    // MutationObserver 兜底宿主重建滚动区节点的情况。
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null
    if (mo !== null) mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      if (ro !== null) ro.disconnect()
      if (mo !== null) mo.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])

  // —— 阅读位置跟踪：滚动区 40% 采样线找最近用户消息行 ——
  useEffect(() => {
    if (messages.length === 0) return
    const indexByKey = new Map<string, number>()
    for (let i = 0; i < messages.length; i++) indexByKey.set(messages[i].key, i)
    const updateActive = (): void => {
      const sp = document.querySelector('[data-conversation-scroll]')
      if (sp === null) return
      const rect = sp.getBoundingClientRect()
      if (rect.height === 0) return
      const line = rect.top + rect.height * ACTIVE_LINE_RATIO
      const rows = sp.querySelectorAll('[data-chat-anchor-key^="13:input-message"]')
      let best = -1
      let bestDist = Infinity
      for (const row of rows) {
        const key = row.getAttribute('data-chat-anchor-key')
        if (key === null) continue
        const idx = indexByKey.get(key) ?? -1
        if (idx === -1) continue
        const r = row.getBoundingClientRect()
        const dist = Math.abs(r.top + r.height / 2 - line)
        if (dist < bestDist) { bestDist = dist; best = idx }
      }
      setActiveIndex((prev) => (prev === best ? prev : best))
    }
    updateActive()
    const el = document.querySelector('[data-conversation-scroll]')
    let scrollTimer: number | null = null
    const onScroll = (): void => {
      if (scrollTimer !== null) return
      scrollTimer = window.setTimeout(() => { scrollTimer = null; updateActive() }, 60)
    }
    el?.addEventListener('scroll', onScroll, { passive: true })
    const timer = window.setInterval(updateActive, 2000)
    return () => {
      if (scrollTimer !== null) clearTimeout(scrollTimer)
      el?.removeEventListener('scroll', onScroll)
      clearInterval(timer)
    }
  }, [sessionId, messages.length])

  // 高亮项变化后，让节点条自身滚动到可见（长会话节点条可滚动）
  useEffect(() => {
    const page = pageRef.current
    if (page === null || activeIndex < 0) return
    const items = page.querySelectorAll('[data-msg-nav-item]')
    const item = items[activeIndex]
    if (item === undefined) return
    const pageRect = page.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    if (itemRect.top < pageRect.top) page.scrollTop -= pageRect.top - itemRect.top
    else if (itemRect.bottom > pageRect.bottom) page.scrollTop += itemRect.bottom - pageRect.bottom
  }, [activeIndex, messages.length])

  // 隐藏条件：<2 条用户消息 / 非对话视图（无滚动区）
  if (sessionId === undefined || !hasScrollport || messages.length < 2) return <></>

  const darkSelector = 'body[data-ds-dark-theme], [data-theme="dark"], .dark'
  // 官网 ScrollNav 规格：折叠态 34px 细竖轨，悬停展开 ≤240px 面板。
  // 面板背景足够实（浅色 0.96 白 / 深色 0.96 黑），保证消息文字清晰可读，
  // 不被下方聊天内容透出干扰。
  const railStyle: CSSProperties = {
    position: 'fixed',
    right: `${rightOffset}px`,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 60,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    width: expanded ? 240 : 34,
    maxHeight: '70vh',
    borderRadius: 16,
    background: expanded ? 'rgba(255,255,255,0.96)' : 'rgba(127,127,127,0.06)',
    backdropFilter: expanded ? 'blur(16px)' : 'blur(5px)',
    boxShadow: expanded ? '0 10px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)' : 'none',
    border: expanded ? '1px solid rgba(0,0,0,0.12)' : '1px solid transparent',
    overflow: 'hidden',
    userSelect: 'none',
    pointerEvents: 'auto',
    transition: 'width .22s cubic-bezier(.4,0,.2,1), background .2s ease, box-shadow .2s ease, border-color .2s ease',
  }

  return createPortal(
    <div
      data-msg-nav-rail=""
      style={railStyle}
      role="navigation"
      aria-label="消息导航"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* 滚动区：官网 padding 15px 0 15px 24px，max-height 250px */}
      <div ref={pageRef} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
        width: '100%', maxHeight: 250, overflowY: 'auto', overflowX: 'hidden',
        padding: '15px 0 15px 24px', boxSizing: 'border-box',
        scrollbarWidth: 'thin',
      }}>
        {messages.map((m, i) => {
          const active = i === activeIndex
          return (
            <button
              key={m.key}
              type="button"
              data-msg-nav-item=""
              data-active={active ? '' : undefined}
              onClick={() => { void jumpToMessage(sessions, sessionId, m.key) }}
              title={m.text === '' ? '（无文本内容）' : m.text}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                height: 30, minHeight: 30, width: 'calc(100% - 6px)', marginRight: 8,
                padding: 0, border: 'none', background: 'none', cursor: 'pointer',
                font: 'inherit', color: 'inherit', textAlign: 'right', boxSizing: 'border-box',
                flexShrink: 0,
              }}
            >
              {/* 消息文字：折叠时压缩到 0 + opacity 渐隐，展开时渐显 */}
              <span
                data-msg-nav-text=""
                data-active={active ? '' : undefined}
                style={{
                  fontSize: 13, lineHeight: 20, textAlign: 'right', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0,
                  marginRight: 12, opacity: expanded ? 1 : 0,
                  color: active ? 'var(--dsw-alias-state-business-primary, #4d6bfe)' : 'rgba(0,0,0,0.65)',
                  fontWeight: active ? 500 : 400,
                  transition: 'opacity .12s ease, color .15s ease',
                }}
              >
                {m.text === '' ? '（无文本内容）' : m.text}
              </span>
              {/* 指示线：8×2px，激活 scale(1.5) 品牌蓝；悬停展开时非激活线加深（官网规格） */}
              <span style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 20,
              }}>
                <span
                  data-msg-nav-line=""
                  data-active={active ? '' : undefined}
                  style={{
                    width: 8, height: 2, borderRadius: 4,
                    background: active
                      ? 'var(--dsw-alias-state-business-primary, #4d6bfe)'
                      : expanded ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.16)',
                    transform: active ? 'scale(1.5)' : 'scale(1)',
                    transformOrigin: '50%',
                    transition: 'background-color .2s ease, transform .2s ease',
                  }}
                />
              </span>
            </button>
          )
        })}
      </div>
      <style>{`
        /* 行悬停：底色 + 文字/横线加深（浅色；!important 覆盖 inline 值） */
        [data-msg-nav-item]:hover { background: rgba(0,0,0,0.06); border-radius: 8px; }
        [data-msg-nav-item]:hover [data-msg-nav-text]:not([data-active]) { color: rgba(0,0,0,0.95) !important; }
        [data-msg-nav-item]:hover [data-msg-nav-line]:not([data-active]) { background-color: rgba(0,0,0,0.85) !important; }
        /* 深色主题（!important 覆盖 inline 值） */
        ${darkSelector} [data-msg-nav-rail] { background: rgba(28,28,32,0.96) !important; border-color: rgba(255,255,255,0.08) !important; }
        ${darkSelector} [data-msg-nav-item] { background: transparent; }
        ${darkSelector} [data-msg-nav-text]:not([data-active]) { color: rgba(255,255,255,0.65) !important; }
        ${darkSelector} [data-msg-nav-line]:not([data-active]) { background-color: rgba(255,255,255,0.2) !important; }
        ${darkSelector} [data-msg-nav-rail][data-expanded] [data-msg-nav-line]:not([data-active]) { background-color: rgba(255,255,255,0.45) !important; }
        ${darkSelector} [data-msg-nav-item]:hover { background: rgba(255,255,255,0.08); }
        ${darkSelector} [data-msg-nav-item]:hover [data-msg-nav-text]:not([data-active]) { color: rgba(255,255,255,0.95) !important; }
        ${darkSelector} [data-msg-nav-item]:hover [data-msg-nav-line]:not([data-active]) { background-color: rgba(255,255,255,0.9) !important; }
        @media (prefers-reduced-motion: reduce) {
          [data-msg-nav-item] span { transition: none !important; }
        }
      `}</style>
    </div>,
    document.body,
  )
}

/**
 * 挂载 MessageNav：创建 fixed 透明宿主容器（pointer-events none），
 * React root 渲染组件（portal 到 body 的导航条自身 pointer-events auto）。
 * 返回 disposer，宿主 DOM 重建时由外层 MutationObserver 流程重挂。
 */
export function mountMessageNav(ctx: ClientContext): () => void {
  const host = document.createElement('div')
  host.setAttribute('data-ide-message-nav', '')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:59;'
  document.body.appendChild(host)

  let root: Root | undefined
  let unmounted = false
  const render = (): void => {
    if (unmounted) return
    if (root === undefined) root = createRoot(host)
    root.render(createElement(MessageNav, { sessions: ctx.sessions }))
  }

  // 宿主 DOM 重建：host 被移除后重新挂载（与 mount.tsx 的 waitForElement 同一策略）
  const observer = new MutationObserver(() => {
    if (!host.isConnected && !unmounted) {
      root?.unmount()
      root = undefined
      document.body.appendChild(host)
      render()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  render()

  return () => {
    unmounted = true
    observer.disconnect()
    root?.unmount()
    root = undefined
    host.remove()
  }
}
