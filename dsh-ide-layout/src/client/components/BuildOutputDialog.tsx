/**
 * 构建输出对话框（portal 模态）：展示 /dsh-ide/build 的进行中/完成状态与输出。
 * 样式变量与 FileTree 确认浮层一致（皮肤透明化 --dsw-alias-bg-base，浮层必须
 * 用 overlay 自足背景）。Maven 多主类时切换为「选择要运行的主类」列表。
 */

import { createPortal } from 'react-dom'
import type { BuildResult } from '../api.ts'

export interface BuildOutputDialogProps {
  title: string
  phase: 'running' | 'done'
  result?: BuildResult
  error?: string
  needMain?: boolean
  candidates?: string[]
  onClose: () => void
  onPickMain: (mainClass: string) => void
}

/** 关闭按钮（浮层通用样式）。 */
function closeButtonStyle(): React.CSSProperties {
  return {
    padding: '1px 8px', fontSize: 12, cursor: 'pointer', color: '#9ca3af',
    background: 'transparent', border: '1px solid var(--ide-border,#e5e6eb)',
    borderRadius: 4, fontFamily: 'inherit',
  }
}

export function BuildOutputDialog({ title, phase, result, error, needMain, candidates, onClose, onPickMain }: BuildOutputDialogProps): JSX.Element {
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.35)',
      }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        width: 'min(860px, 90vw)',
        height: 'min(70vh, 640px)',
        background: 'var(--dsw-alias-bg-overlay, rgba(248,250,255,0.96))',
        color: 'var(--dsw-alias-label-primary, #1a1a1a)',
        border: '1px solid var(--ide-border,#e5e6eb)',
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 600,
          borderBottom: '1px solid var(--ide-border,#e5e6eb)',
          flexShrink: 0,
        }}>
          <span>{title}</span>
          {phase === 'running' && <span style={{ color: '#9ca3af', fontWeight: 400, fontSize: 12 }}>运行中…</span>}
          {phase === 'done' && needMain !== true && (
            <span style={{ color: result?.exitCode === 0 ? '#16a34a' : '#dc2626', fontWeight: 400, fontSize: 12 }}>
              {result?.exitCode === 0 ? '✓ 成功' : result?.exitCode === null ? '✗ 失败' : `✗ 退出码 ${result?.exitCode ?? '?'}`}
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>
            <button type="button" onClick={onClose} title="关闭" style={closeButtonStyle()}>✕</button>
          </span>
        </div>

        {needMain === true && candidates !== undefined ? (
          <div style={{ padding: 16, overflow: 'auto' }}>
            <div style={{ fontSize: 13, marginBottom: 10 }}>检测到多个包含 main 方法的类，选择要运行的入口：</div>
            {candidates.map((main) => (
              <button
                key={main}
                type="button"
                onClick={() => onPickMain(main)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  marginBottom: 6,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  color: 'inherit',
                  background: 'var(--ide-hover, rgba(127,127,127,0.08))',
                  border: '1px solid var(--ide-border,#e5e6eb)',
                  borderRadius: 4,
                }}
              >
                ▶ {main}
              </button>
            ))}
          </div>
        ) : (
          <pre style={{
            flex: 1,
            overflow: 'auto',
            margin: 0,
            padding: 10,
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: 'inherit',
          }}>
            {phase === 'running' && <span style={{ color: '#9ca3af' }}>执行中，请稍候…（Maven/Gradle 冷启动可能较慢）</span>}
            {phase === 'done' && error !== undefined && <span style={{ color: '#dc2626' }}>{error}</span>}
            {phase === 'done' && result !== undefined && result.error !== undefined && (
              <span style={{ color: '#dc2626' }}>无法启动构建工具: {result.error}</span>
            )}
            {phase === 'done' && result?.stdout}
            {phase === 'done' && result?.stderr !== undefined && result.stderr !== '' && (
              <span style={{ color: '#dc2626' }}>{result.stderr}</span>
            )}
            {phase === 'done' && result !== undefined && (
              `\n\n[进程退出码 ${result.exitCode ?? '?'}${result.timedOut ? '（超时已终止）' : ''} · 耗时 ${result.durationMs}ms]`
            )}
          </pre>
        )}

        {phase === 'done' && needMain !== true && result !== undefined && (result.stdoutTruncated || result.stderrTruncated) && (
          <div style={{ padding: '4px 12px', fontSize: 12, color: '#b45309', borderTop: '1px dashed var(--ide-border,#e5e6eb)', flexShrink: 0 }}>
            输出过长已截断
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
