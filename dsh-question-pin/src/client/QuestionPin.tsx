/**
 * QuestionPin —「这条回答对应哪条提问」置顶条（大都督的点子）。
 *
 * 原实现位于 dsh-ide-layout mount.tsx，2026-09 剥离为独立插件 dsh-question-pin：
 * 不再依赖 ide-layout 的 workbench 挂载点，web shell 启动即挂载，行为不变。
 *
 * 视口里第一条可见的消息行向前找最近一条用户提问——提问不在视口内时，
 * agent 区顶部（飘带下方）浮现胶囊条显示该提问文本；提问滚进视口则隐藏
 * （问题就在眼前）；新会话（无任何消息行 / 视口无可见行）时隐藏——基本常驻。
 * 纯外挂：portal 到 body、被动监听（scroll 捕获 + rAF 节流 + 消息流式更新的
 * MutationObserver），零宿主 DOM 改动，卸载全清理。
 *
 * 锚点体系（dsh-client-ui-conversation 的锚点，版本依赖点）：
 * 行容器 = [data-chat-anchor-key]，类型 = data-chat-flow-kind
 * （"user"/"assistant"/"steering"/"assistant-step"/…），
 * 滚动容器 = [data-conversation-scroll]。
 */

import { createElement, useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'

/** 会话消息行的 DOM 特征（dsh-client-ui-conversation 的锚点体系，版本依赖点）。 */
const ROW_SELECTOR = '[data-chat-anchor-key]'
const KIND_ATTR = 'data-chat-flow-kind'
const SCROLL_SELECTOR = '[data-conversation-scroll]'
const TOP_TRIM_SELECTOR = '[data-skin-chrome="top-trim"]'

/** 视口内第一条可见的消息行（顶部以飘带下缘为界，跳过被装饰带盖住的部分）。 */
function firstVisibleRow(topBound: number): HTMLElement | null {
  const rows = document.querySelectorAll<HTMLElement>(ROW_SELECTOR)
  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    if (rect.height <= 0) continue
    if (rect.bottom > topBound && rect.top < window.innerHeight) return row
  }
  return null
}

/** 行在视口内是否可见（顶部同样以飘带下缘为界）。 */
function rowVisible(row: HTMLElement, topBound: number): boolean {
  const rect = row.getBoundingClientRect()
  return rect.bottom > topBound && rect.top < window.innerHeight
}

/** 深蓝飘带下缘（无装饰带时 0）。 */
function topTrimBottom(): number {
  const trim = document.querySelector<HTMLElement>(TOP_TRIM_SELECTOR)
  const rect = trim?.getBoundingClientRect()
  return rect !== undefined && rect.bottom > 0 ? rect.bottom : 0
}

/**
 * 有弹出菜单打开（本置顶条需要让位）：
 * ① 宿主设置面板打开——sidebar.settings slot 触发按钮的 aria-expanded
 *   （与皮肤/ide-layout 检测设置开合的信号一致）。设置模态 z-1000 原地渲染在
 *   侧栏 DOM 子树内（受限层叠上下文，非 body portal），压不过 body 层 z-9 的
 *   本置顶条——设置打开期间组件不渲染让位（ide-layout v1.5.1 编辑器让位同款）。
 * ② 任意菜单型下拉打开——aria-haspopup='menu' 且 aria-expanded='true' 的触发
 *   按钮（open-in-app 的 VS Code/PyCharm/Git Bash 下拉等）。这些下拉走官方
 *   Menu 就地渲染（.list z100→皮肤已抬 1400），但黑条 portal 到 body 且 z9
 *   参与根层叠，实测仍盖在部分下拉之上（祖先链存在未定位的层叠上下文封顶
 *   下拉的对外层级）。与其再赌一次 z 比拼（v1 抬官方容器、v3 z4/z12 来回
 *   踩坑），不如复用设置让位模式：任何菜单打开期间黑条不渲染，关闭即回。
 * 统一用全局属性查询 + document 级 MutationObserver：aria-expanded 突变会
 * 冒泡到 attributes 记录，直接对 body 开 subtree 观察即可，无需对单个触发
 * 按钮换绑（官方会重建按钮节点，逐节点 observe 会漏）。
 */
function useMenuOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const probe = (): void => {
      setOpen(
        document.querySelector("[data-slot='sidebar.settings'] [aria-expanded='true']") !== null
          || document.querySelector("[aria-haspopup='menu'][aria-expanded='true']") !== null,
      )
    }
    // attributes 突变（aria-expanded 切换）+ childList（按钮重建）都要触发探测。
    const observer = new MutationObserver(probe)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-expanded', 'aria-haspopup'],
      childList: true,
      subtree: true,
    })
    probe()
    return () => observer.disconnect()
  }, [])
  return open
}

/**
 * 「这条回答是回答哪条提问的」置顶条（大都督的点子）：
 * 视口里第一条可见的消息行向前找最近一条用户提问——提问不在视口内时，
 * agent 区顶部（飘带下方）浮现胶囊条显示该提问文本；提问滚进视口则隐藏
 * （问题就在眼前）；新会话（无任何消息行 / 视口无可见行）时隐藏——基本常驻。
 * 纯外挂：portal 到 body、被动监听（scroll 捕获 + rAF 节流 + 消息流式更新的
 * MutationObserver），零宿主 DOM 改动，卸载全清理。
 */
function QuestionPin(): JSX.Element | null {
  const [pin, setPin] = useState<{ text: string; left: number; top: number; width: number } | null>(null)
  const rowRef = useRef<HTMLElement | null>(null)
  const rafRef = useRef(0)
  // 拖拽帧的定位直接写按钮 style（React state 提交晚一帧，会拖出可见拖尾）。
  const btnRef = useRef<HTMLButtonElement | null>(null)
  // 有弹出菜单打开（设置面板/任意下拉）→ 不渲染让位（见 useMenuOpen 注释）
  const menuOpen = useMenuOpen()

  // 几何计算 + 同帧直写（state 提交晚一帧，拖拽帧必须现在就位）。
  // scan 与拖拽帧的轻量跟随共用这一段。
  const applyGeometry = (): { left: number; top: number; width: number } => {
    const chat = document.querySelector<HTMLElement>('[class*="centerCol"]')
    const chatRect = chat?.getBoundingClientRect()
    const scroller = document.querySelector<HTMLElement>(SCROLL_SELECTOR)
    const scrollRect = scroller?.getBoundingClientRect()
    const width = Math.max(240, (chatRect !== undefined ? chatRect.width : 600) - 24)
    const left = (chatRect !== undefined ? chatRect.left : (window.innerWidth - width) / 2) + 12
    const top = (scrollRect !== undefined && scrollRect.height > 0 ? scrollRect.top : (chatRect !== undefined ? chatRect.top : 0)) + 8
    const btn = btnRef.current
    if (btn !== null) {
      btn.style.left = `${left}px`
      btn.style.top = `${top}px`
      btn.style.width = `${width}px`
    }
    return { left, top, width }
  }

  // 拖拽帧的轻量跟随：只重算几何直写。全量 scan 要遍历全部消息行定位第一条
  // 可见行（长会话几百次 rect 读），每帧跑会把帧时间顶爆——表现为拖动抖动。
  // 显隐与文案不随拖拽变化，由 scan 在滚动/内容变化/拖拽结束时负责。
  const reposition = (): void => {
    if (rowRef.current === null) return
    applyGeometry()
  }

  const scan = (): void => {
    const topBound = topTrimBottom()
    const row = firstVisibleRow(topBound)
    // 视口无可见行（新会话/空白）→ 隐藏。
    if (row === null) {
      rowRef.current = null
      setPin(null)
      return
    }
    // 视口第一条可见行若是提问本身 → 无需提示；否则向前找最近一条提问。
    let question: HTMLElement | null = null
    if (row.getAttribute(KIND_ATTR) === 'user') {
      question = row
    } else {
      for (let el = row.previousElementSibling; el !== null; el = el.previousElementSibling) {
        if (el instanceof HTMLElement && el.getAttribute(KIND_ATTR) === 'user') { question = el; break }
      }
      // 兄弟链找不到（行可能分散在不同容器）→ 全量行列表按 DOM 顺序兜底。
      if (question === null) {
        const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)]
        const index = rows.indexOf(row)
        for (let i = index - 1; i >= 0; i--) {
          const prev = rows[i]
          if (prev !== undefined && prev.getAttribute(KIND_ATTR) === 'user') { question = prev; break }
        }
      }
    }
    if (question === null) {
      rowRef.current = null
      setPin(null)
      return
    }
    if (rowVisible(question, topBound)) {
      // 提问就在眼前 → 隐藏。
      rowRef.current = null
      setPin(null)
      return
    }
    rowRef.current = question
    // 定位：随 agent 区（centerCol）实际盒子——宽度左右各留 12px 内边距。
    // 顶部锚「消息流滚动容器」上缘（= 会话头部底缘，不随内容滚动变化）：
    // pin 悬浮在头部之下，不再压住「对话/静默」tab、Session log 与 TermFab，
    // 也不会拦截头部整条的点击（此前锚卡顶 + 8 正好叠在头部上）。找不到
    // 滚动容器时回退卡顶 + 8（原行为）。
    const { left, top, width } = applyGeometry()
    const text = question.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    setPin((prev) => (
      prev?.text === text && prev.left === left && prev.top === top && prev.width === width
        ? prev
        : { text, left, top, width }
    ))
  }

  const scheduleScan = (): void => {
    if (rafRef.current !== 0) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      scan()
    })
  }

  useEffect(() => {
    // scroll 用捕获阶段：聊天滚动容器（data-conversation-scroll）内部的滚动
    // 事件会经过 window 的 capture 路径，无需对宿主容器直接挂监听。
    const onScroll = (): void => scheduleScan()
    const onResize = (): void => scheduleScan()
    // layout 已在当前拖拽帧写完 centerCol 几何：拖拽帧只做轻量几何直写（全量
    // 行扫描每帧跑会掉帧），拖拽结束/普通布局收敛才做全量扫描。
    const onLayoutApplied = (event: Event): void => {
      if ((event as CustomEvent).detail?.dragging === true) {
        reposition()
        return
      }
      scan()
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    window.addEventListener('dsh-ide-layout-applied', onLayoutApplied)
    // 消息流式更新（回答逐步长高/新消息插入）不触发滚动事件也要重扫：MutationObserver
    // 盯滚动容器子树，防抖 300ms。宿主容器重建（整树替换）后重新绑定观察目标。
    let mutationTimer: ReturnType<typeof setTimeout> | undefined
    let mutationTarget: HTMLElement | null = document.querySelector<HTMLElement>(SCROLL_SELECTOR)
    const observer = new MutationObserver(() => {
      if (mutationTimer !== undefined) clearTimeout(mutationTimer)
      mutationTimer = setTimeout(scheduleScan, 300)
    })
    if (mutationTarget !== null) observer.observe(mutationTarget, { childList: true, subtree: true })
    const rebinder = new MutationObserver(() => {
      const next = document.querySelector<HTMLElement>(SCROLL_SELECTOR)
      if (next !== null && next !== mutationTarget) {
        mutationTarget = next
        observer.disconnect()
        observer.observe(next, { childList: true, subtree: true })
      }
    })
    rebinder.observe(document.body, { childList: true, subtree: true })
    scheduleScan()
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
      window.removeEventListener('dsh-ide-layout-applied', onLayoutApplied)
      observer.disconnect()
      rebinder.disconnect()
      if (mutationTimer !== undefined) clearTimeout(mutationTimer)
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  if (pin === null || menuOpen) return null
  return createPortal(
    <button
      type="button"
      ref={btnRef}
      onClick={() => {
        const row = rowRef.current
        if (row !== null) row.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }}
      title="点击跳到这条提问"
      onMouseEnter={(event) => {
        const el = event.currentTarget as HTMLElement
        el.style.background = 'rgba(20,20,20,0.96)'
      }}
      onMouseLeave={(event) => {
        const el = event.currentTarget as HTMLElement
        el.style.background = 'rgba(20,20,20,0.88)'
      }}
      style={{
        position: 'fixed', left: pin.left, top: pin.top, width: pin.width, zIndex: 9,
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px',
        border: '1px solid rgba(127,127,127,0.3)', borderRadius: 10,
        background: 'rgba(20,20,20,0.88)', color: '#e5e7eb',
        fontSize: 14, lineHeight: '20px', fontFamily: 'inherit', cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.3)', textAlign: 'left',
      }}
    >
      <span style={{ flexShrink: 0, color: '#9ca3af' }}>↩ 这条回答对应：</span>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {pin.text}
      </span>
    </button>,
    document.body,
  )
}

/**
 * 挂载 QuestionPin：创建透明宿主容器，React root 渲染组件（组件自身 portal
 * 到 body）。返回 disposer，宿主 DOM 重建时由外层 MutationObserver 流程重挂
 * （与 dsh-ide-layout mountMessageNav 同一策略）。
 */
export function mountQuestionPin(): () => void {
  const host = document.createElement('div')
  host.setAttribute('data-dsh-question-pin', '')
  document.body.appendChild(host)

  let root: Root | undefined
  let unmounted = false
  const render = (): void => {
    if (unmounted) return
    if (root === undefined) root = createRoot(host)
    root.render(createElement(QuestionPin))
  }

  // 宿主 DOM 重建：host 被移除后重新挂载（与 ide-layout 的 waitForElement 同一策略）
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
