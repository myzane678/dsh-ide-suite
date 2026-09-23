export const MIN_CHAT_PX = 440
export const EDITOR_MIN_PX = 300

export type DragMode = 'none' | 'sidebar' | 'chat'

export function clampChatWidth(total: number, requested: number): number {
  const maxChat = Math.max(MIN_CHAT_PX, total - EDITOR_MIN_PX)
  return Math.min(Math.max(MIN_CHAT_PX, requested), maxChat)
}

export function chatWidthFromDrag(
  total: number,
  startWidth: number,
  startX: number,
  currentX: number,
): number {
  return clampChatWidth(total, startWidth + (startX - currentX))
}

export function canStartDrag(mode: DragMode, isPrimary: boolean, button: number): boolean {
  return mode === 'none' && isPrimary && button === 0
}

export function shouldSyncSidebarImmediately(
  mode: DragMode,
  previousRight: number,
  nextRight: number,
): boolean {
  return mode === 'sidebar'
    && Number.isFinite(nextRight)
    && nextRight > 0
    && Math.abs(nextRight - previousRight) >= 0.5
}

export function canFinishDrag(
  mode: DragMode,
  activePointerId: number | null,
  eventPointerId: number,
): boolean {
  return mode === 'sidebar' && activePointerId === eventPointerId
}

/** 对话内容列（白色会话区）宽度：常量与宿主持有者（app.asar 2.0.9 的
 *  ConversationRoot.js）同源——最小 640、上限 = 列宽 − 176（每侧 88px 手柄
 *  安全区，防止手柄把自己挤出列外拖不回来）、双手柄对称缩放（外拖一格宽涨两格）、
 *  localStorage 记忆。宿主持有者在本环境下不产出可见输出，改由 layout.ts 自建手柄
 *  接管；常量与键名保持一致，两个入口写同一个值。 */
export const CONTENT_MIN_PX = 640
export const CONTENT_EDGE_BUDGET = 176
/** 会话区宽度硬上限：宿主持有者的自适应默认只到 920px，但持久化偏好可以顶着
 *  「可用宽 − 176」一路涨到 1300+（都督全屏实测约 1380px），会把两侧女仆整只
 *  盖住、且宽度随窗口飘。这里给一个可预期的天花板；要更宽只改这一个数字。 */
export const CONTENT_MAX_PX = 1200
export const CONTENT_WIDTH_KEY = 'dsh.conversation.contentWidth'

/** 钳制到 [CONTENT_MIN_PX, min(硬上限, availableWidth − CONTENT_EDGE_BUDGET)]；
 *  availableWidth 传列的真实可用宽（宿主会话根宽度），安全区在函数内扣。 */
export function clampContentWidth(availableWidth: number, requested: number): number {
  const upper = Math.min(CONTENT_MAX_PX, Math.max(CONTENT_MIN_PX, availableWidth - CONTENT_EDGE_BUDGET))
  return Math.min(Math.max(CONTENT_MIN_PX, requested), upper)
}

/** 对称缩放：拖任一侧边缘，两缘等量外扩/内收——宽度按 2×指针位移变化，
 *  竖向中心线因此恒定不动（与宿主持有者的 outwardWidth 同算式）。 */
export function contentWidthFromDrag(
  startWidth: number,
  dx: number,
  side: 'left' | 'right',
): number {
  const outward = side === 'right' ? dx : -dx
  return startWidth + outward * 2
}

/** 持久化宽度偏好：沿用宿主的 localStorage 键，下次会话宿主与插件同读一个值。 */
export function saveContentWidthPreference(px: number): void {
  try {
    localStorage.setItem(CONTENT_WIDTH_KEY, String(Math.round(px)))
  } catch {
    // localStorage 不可用时忽略
  }
}
