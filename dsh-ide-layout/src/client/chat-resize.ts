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
