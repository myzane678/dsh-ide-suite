/**
 * dsh-question-pin — browser half:「这条回答对应哪条提问」agent 区置顶条。
 * 从 dsh-ide-layout（mount.tsx 的 QuestionPin）剥离为独立插件，见
 * src/client/QuestionPin.tsx —— 纯 DOM 外挂，不订阅任何 client 服务。
 *
 * Failure policy: mount failures are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws.
 */

import type { Context } from '@deepseek-ai/cordis'
import { mountQuestionPin } from './QuestionPin.tsx'

/** Apply the browser half. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    try {
      return mountQuestionPin()
    } catch (error) {
      console.error('[dsh-question-pin] mount failed:', error)
      return () => {}
    }
  }, 'dsh-question-pin: wiring')
}
