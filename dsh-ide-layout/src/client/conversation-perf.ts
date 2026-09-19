/**
 * 会话长列表的逐帧重排治理（仅拖动分栏期间启用）：
 * 侧栏/聊天区分栏拖动时，聊天列宽度每帧变化，几百条消息行整棵重排 + 重绘
 * （实测单帧 ~85ms → 全程 ~12fps，拖动抖动）。content-visibility:auto 让
 * 视口外的消息行跳过排版与绘制（Chromium 对该属性有完善的滚动锚定与尺寸
 * 记忆），逐帧排版成本坍缩到视口内可见行。
 *
 * 不能常驻：向上快速滚动时，上方「从未渲染过」的行只能按 contain-intrinsic-size
 * 的 120px 估算占位，滚到跟前逐行变回真实高度（消息行普遍 200~800px），列表
 * 总高度不断跳变、滚动锚定反复校正 scrollTop——快滑惯性下的校正滞后，视觉上
 * 就是「冲过头再弹回来」的回弹抖动。故只在拖动帧启用，滚动路径保持原生。
 *
 * 启用/停用瞬间列表总高度各跳一次（视口外行的 120px 占位 ↔ 真实高度差）：
 * 以滚动视口顶缘第一个可见消息行为锚点（它始终真实渲染，位移纯粹来自上下方
 * 行的占位差），开关后把 scrollTop 按锚点视口位移补回，切换无感。
 */

const PERF_STYLE_ID = 'dsh-ide-layout-conversation-perf'
const PERF_CSS = '[data-conversation-scroll] [data-chat-anchor-key]'
  + '{content-visibility:auto;contain-intrinsic-size:auto 120px;}'

/** 启用（true，拖动优化）/停用（false，还原原生滚动）视口外跳过渲染。 */
export function setConversationPerf(enabled: boolean): void {
  const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]')
  let anchor: HTMLElement | null = null
  let anchorTop = Number.NaN
  if (scroller !== null) {
    const scrollerTop = scroller.getBoundingClientRect().top
    for (const row of scroller.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
      const rect = row.getBoundingClientRect()
      if (rect.bottom > scrollerTop) {
        anchor = row
        anchorTop = rect.top
        break
      }
    }
  }

  if (enabled) {
    let tag = document.getElementById(PERF_STYLE_ID)
    if (tag === null) {
      tag = document.createElement('style')
      tag.id = PERF_STYLE_ID
      document.head.appendChild(tag)
    }
    tag.textContent = PERF_CSS
  } else {
    document.getElementById(PERF_STYLE_ID)?.remove()
  }

  // getBoundingClientRect 会强制同步布局，此处读到的是开关后的新几何；
  // 锚点视口位移 = 视口外行占位差造成的整体内容位移，补回 scrollTop 即可
  //（锚点非空时 scroller 必非空）。
  if (scroller !== null && anchor !== null && Number.isFinite(anchorTop)) {
    const delta = anchor.getBoundingClientRect().top - anchorTop
    if (delta !== 0) scroller.scrollTop += delta
  }
}
