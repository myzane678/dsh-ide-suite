/**
 * edit/write 工具行增强（大都督需求 2026-09-06）：
 * 收起行在文件路径后追加 +N/-N 变更统计（绿增红删，数字滚动动画；参数流式
 * 到达期间 callView.diffs 逐步更新，统计随 React 重渲染实时跳动）；diff 明细
 * 默认直接展开——行级 LCS 对齐（借鉴 ZCode：上下文行保留、红绿只标真正变化
 * 的行）+ 统一行号列 + 行内 word 高亮 + 超长头尾折叠（选 b），点击行可收起；
 * 文件路径前带文件类型小图标（{} / ⇅ / ⓘ），窄列时目录段响应式隐藏。
 *
 * 注入方式：keyed 插槽 `tool.call.toolview` 上以 key:'str_replace_editor'（内置
 * agent 的文件编辑工具名）/'edit'/'write'（Code Mode 呈现名）、priority:-1
 * shadow 内置行——slots 官方语义「同 key 不同 priority 即 shadow，lowest
 * renders」（dsh-genui 注册自定义工具行同款先例）。首版只注册了 'edit'/'write'，
 * 实测 native 工具名下 keyed 派发（entryKey=工具名）从不命中，全走
 * GenericToolCard fallback——key 必须用 wire 工具名。
 * 标题写死中文「编辑/读取/写入」（与大都督界面语言一致；宿主 locale 无新增
 * key 通道）。
 *
 * 版本依赖点：`tool.call.toolview` 键的声明形状取自宿主 ToolCallTree 的
 * children 表（{kind:'keyed', scope:'session'}）；wire diff 视图形状见
 * tool-diff-model.ts。宿主升级若变更这些契约需同步。
 */

import { useMemo, useState, type JSX } from 'react'
import {
  DisclosureRow,
  IconBrowseOutline16,
  IconEditOutline16,
  IconInspectOutline12,
  StateDot,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  buildDiffRows,
  describePath,
  diffHunksOf,
  displayPathOf,
  fileBadgeFor,
  firstResultLine,
  isReadCall,
  stateOf,
  type DiffCounts,
  type DiffRow,
  type DiffRowsModel,
  type ToolBlockLike,
} from './tool-diff-model.ts'

// 本地 SDK（rc.8）的 SlotMap 尚未声明宿主 ToolCallTree 提供的这个子插槽键，
// 按官方 declaration merging 机制补上（keyed、会话作用域）。
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'tool.call.toolview': { kind: 'keyed'; scope: 'session' }
  }
}

/** 工具行组件收到的 props（宿主 FileMutationRow 的解构面，运行时契约）。 */
interface ToolviewProps {
  toolName: string
  block: ToolBlockLike
  cwd?: string
  home?: string
  openFile?: (path: string) => void
  inspect?: () => void
}

/** 逐字符滚动数字（借鉴 ZCode 的 VW）：每一位在 0-9 竖轮上滚动过渡；
 *  prefers-reduced-motion 时由 CSS 关闭过渡。位数增减靠 key 索引自然增删位。 */
function RollingNumber({ value }: { value: string }): JSX.Element {
  return (
    <span className="ide-diffstat-roll" role="text" aria-label={value}>
      {Array.from(value).map((digit, i) => (
        <span key={i} className="ide-diffstat-digit" aria-hidden>
          <span
            className="ide-diffstat-digit-col"
            style={{ transform: `translateY(-${Number(digit)}em)` }}
          >
            {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <span key={d} className="ide-diffstat-digit-cell">{d}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}

/** +N/-N 统计徽章：added/removed 为 0 的方向不显示（图一「+6」无「-0」）。 */
function DiffStatBadge({ counts }: { counts: DiffCounts | null }): JSX.Element | null {
  if (counts === null || (counts.added === 0 && counts.removed === 0)) return null
  return (
    <span className="ide-diffstat-badge">
      {counts.added > 0 && (
        <span className="ide-diffstat-add" title={`+${counts.added}`}>
          +<RollingNumber value={String(counts.added)} />
        </span>
      )}
      {counts.removed > 0 && (
        <span className="ide-diffstat-del" title={`-${counts.removed}`}>
          -<RollingNumber value={String(counts.removed)} />
        </span>
      )}
    </span>
  )
}

/** 行内 word 高亮渲染：把变化区间拆成普通段 + 高亮段。 */
function renderRowWords(row: DiffRow): JSX.Element {
  if (row.words === undefined || row.words.length === 0) return <>{row.text}</>
  const parts: JSX.Element[] = []
  let cursor = 0
  row.words.forEach((range, i) => {
    if (range.start > cursor) parts.push(<span key={`p${i}`}>{row.text.slice(cursor, range.start)}</span>)
    parts.push(<span key={`w${i}`} className="ide-diffrows-word">{row.text.slice(range.start, range.end)}</span>)
    cursor = range.end
  })
  if (cursor < row.text.length) parts.push(<span key="tail">{row.text.slice(cursor)}</span>)
  return <>{parts}</>
}

/** 单行：行号 + 内容（path/gap 行不显示行号但占序号）。 */
function DiffRowLine({ row, no }: { row: DiffRow; no: number }): JSX.Element {
  const numbered = row.kind === 'ctx' || row.kind === 'del' || row.kind === 'add'
  return (
    <div className={`ide-diffrows-line ide-diffrows-${row.kind}`}>
      <span className="ide-diffrows-no" aria-hidden>{numbered ? no : ''}</span>
      <span className="ide-diffrows-text">{renderRowWords(row)}</span>
    </div>
  )
}

/** 展平行渲染上限（与宿主 DiffBlock 同款头尾折叠：头 8 行 + 展开按钮 + 尾 8 行）。 */
const DIFFROWS_MAX = 16
const DIFFROWS_CAP = 8

/** 行级对齐 diff 卡（借鉴 ZCode：上下文行保留、行号列、行内 word 高亮；
 *  超长头尾折叠，配色走宿主语义变量，亮暗主题/皮肤自动跟随）。 */
function DiffRows({ model }: { model: DiffRowsModel }): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  if (model.rows.length === 0) return null
  const hidden = model.rows.length - DIFFROWS_MAX
  const capped = hidden > 0 && !expanded
  const head = capped ? model.rows.slice(0, DIFFROWS_CAP) : model.rows
  const tail = capped ? model.rows.slice(model.rows.length - DIFFROWS_CAP) : []
  const onCopy = (): void => {
    if (copied) return
    const text = model.rows
      .map((row) => (row.kind === 'del' ? `- ${row.text}` : row.kind === 'add' ? `+ ${row.text}` : row.text))
      .join('\n')
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1000)
    })
  }
  return (
    <div className="ide-diffrows" data-diff="">
      <button type="button" className="ide-diffrows-copy" onClick={onCopy}>{copied ? '复制成功' : '复制'}</button>
      <div className="ide-diffrows-body">
        {head.map((row, index) => <DiffRowLine key={index} row={row} no={index + 1} />)}
        {hidden > 0 && (
          <button
            type="button"
            className="ide-diffrows-expand"
            aria-expanded={expanded}
            aria-label={expanded ? '收起差异' : `展开其余 ${hidden} 行差异`}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : `… 其余 ${hidden} 行`}
          </button>
        )}
        {tail.map((row, index) => (
          <DiffRowLine key={`t${index}`} row={row} no={model.rows.length - tail.length + index + 1} />
        ))}
      </div>
      <div className="ide-diffrows-footer">└ +{model.added} -{model.removed} · {model.files} file{model.files === 1 ? '' : 's'}</div>
    </div>
  )
}

/** 「文件图标 + 文件名 + 目录 + 徽章」摘要行：收起态与展开态头部共用。 */
function FileSummary(props: {
  glyph: string
  color: string
  name: string
  dir: string
  displayPath: string
  openFile?: (path: string) => void
  counts: DiffCounts | null
}): JSX.Element {
  const { glyph, color, name, dir, displayPath, openFile, counts } = props
  return (
    <>
      <span className="ide-diffstat-glyph" style={{ color }} aria-hidden>
        {glyph}
      </span>
      {openFile !== undefined ? (
        <button
          type="button"
          className="ide-diffstat-filelink"
          onClick={(event) => {
            event.stopPropagation()
            openFile(displayPath)
          }}
          onKeyDown={(event) => {
            // 方向键/空格留在行内，避免触发行折叠。
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          }}
        >
          {name}
        </button>
      ) : (
        <span className="ide-diffstat-filelink">{name}</span>
      )}
      {dir !== '' && <span className="ide-diffstat-dir">{dir}</span>}
      <DiffStatBadge counts={counts} />
    </>
  )
}

/** edit/write 工具行（shadow 内置 FileMutationRow / GenericToolCard fallback）。 */
function DiffStatRow(props: ToolviewProps): JSX.Element {
  const { toolName, block, cwd, home, openFile, inspect } = props
  // 选 b：默认直接展开 diff（大都督「不用点进去就能看」），点击行可收起。
  const [expanded, setExpanded] = useState(true)

  const read = isReadCall(block)
  // 对齐 diff 一次算好：行渲染（DiffRows）与统计徽章共用；block 引用稳定
  // （ToolCall 的 owner useMemo），作为 memo 依赖——参数流式期间 block 逐步
  // 更新，统计与 diff 实时重算。
  const diff = useMemo(() => {
    if (read) return null
    const hunks = diffHunksOf(block)
    return hunks === null ? null : buildDiffRows(hunks)
  }, [read, block])
  const state = stateOf(block)
  const displayPath = displayPathOf(block, diff === null ? null : diffHunksOf(block))
  const label = describePath(displayPath, cwd, home)
  const badge = fileBadgeFor(label.name !== '' ? label.name : displayPath)
  const errorLine = state === 'error' ? firstResultLine(block) : null
  const expandable = diff !== null || errorLine !== null
  const counts: DiffCounts | null = diff === null ? null : { added: diff.added, removed: diff.removed }

  // 行头图标：error/interrupted 用状态点替换（对齐内置 leadingFor）；
  // 读取调用用浏览图标，其余 ✏️。
  const leading =
    state === 'error' ? (
      <StateDot state="error" />
    ) : state === 'stopped' ? (
      <StateDot state="warning" />
    ) : read ? (
      <IconBrowseOutline16 size={14} />
    ) : (
      <IconEditOutline16 size={14} />
    )
  // 标题写死中文（宿主 locale 无插件加词条通道），三态对齐 ZCode：
  // 进行中「正在编辑/正在写入」→ 完成「编辑/写入」；读命令「读取」。
  const title = read
    ? '读取'
    : state === 'running'
      ? (toolName === 'write' ? '正在写入' : '正在编辑')
      : (toolName === 'write' ? '写入' : '编辑')
  const summary = (
    <FileSummary
      glyph={badge.glyph}
      color={badge.color}
      name={label.name}
      dir={label.dir}
      displayPath={displayPath}
      openFile={openFile}
      counts={counts}
    />
  )

  return (
    <div data-ide-diffstat="" data-tool={toolName} data-state={state}>
      <DisclosureRow
        icon={leading}
        title={title}
        open={expandable && expanded}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setExpanded((v) => !v)}
        collapsedContent={
          <span className="ide-diffstat-collapsed">{summary}</span>
        }
      >
        <div className="ide-diffstat-body">
          <div className="ide-diffstat-head">{summary}</div>
          {errorLine !== null && <div className="ide-diffstat-error">{errorLine}</div>}
          {diff !== null && <DiffRows model={diff} />}
          {inspect !== undefined && (
            <div>
              <button
                type="button"
                className="ide-diffstat-filelink ide-diffstat-inspect"
                onClick={(event) => {
                  event.stopPropagation()
                  inspect()
                }}
              >
                <IconInspectOutline12 /> Inspect
              </button>
            </div>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}

/** 行样式（幂等注入一次）：徽章配色亮暗两套（暗色挂 body[data-ds-dark-theme]，mount.tsx 同款选择器）。 */
const DIFFSTAT_STYLE_ID = 'dsh-ide-layout-diffstat'
function injectDiffStatStyle(): void {
  if (document.getElementById(DIFFSTAT_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = DIFFSTAT_STYLE_ID
  style.textContent = [
    '.ide-diffstat-collapsed{display:inline-flex;align-items:center;gap:6px;min-width:0;}',
    '.ide-diffstat-glyph{flex-shrink:0;font-size:12px;font-weight:600;font-family:ui-monospace,monospace;}',
    '.ide-diffstat-filelink{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;text-decoration:none;}',
    '.ide-diffstat-filelink:hover{text-decoration:underline;}',
    '.ide-diffstat-dir{color:var(--dsw-alias-label-secondary, #8a8f98);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.ide-diffstat-badge{display:inline-flex;gap:6px;font-size:12px;font-variant-numeric:tabular-nums;flex-shrink:0;}',
    '.ide-diffstat-badge .ide-diffstat-add{color:var(--ide-diffstat-add, #1a7f37);}',
    '.ide-diffstat-badge .ide-diffstat-del{color:var(--ide-diffstat-del, #cf222e);}',
    'body[data-ds-dark-theme] .ide-diffstat-badge .ide-diffstat-add{color:var(--ide-diffstat-add, #3fb950);}',
    'body[data-ds-dark-theme] .ide-diffstat-badge .ide-diffstat-del{color:var(--ide-diffstat-del, #f85149);}',
    '.ide-diffstat-body{display:flex;flex-direction:column;gap:6px;padding:4px 0 6px;}',
    '.ide-diffstat-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
    '.ide-diffstat-error{color:var(--dsw-alias-label-danger, #d0333c);font-size:12px;white-space:pre-wrap;word-break:break-all;}',
    '.ide-diffstat-inspect{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary, #8a8f98);}',
    // 目录响应式（借鉴 ZCode）：聊天列窄于 420px 时隐藏目录段，只留文件名。
    // 用 div 前缀精确命中行容器——html 上同名自证属性（data-ide-diffstat 注册
    // 诊断）不能被卷进来当 container。
    'div[data-ide-diffstat]{container-type:inline-size;}',
    '@container (max-width: 420px){.ide-diffstat-dir{display:none;}}',
    // 滚动数字（借鉴 ZCode VW）：竖轮 + 过渡；减少动态效果时直接关掉。
    '.ide-diffstat-roll{display:inline-flex;overflow:hidden;}',
    '.ide-diffstat-digit{display:inline-block;height:1em;line-height:1em;overflow:hidden;}',
    '.ide-diffstat-digit-col{display:inline-flex;flex-direction:column;transition:transform .35s cubic-bezier(.4,0,.2,1);}',
    '.ide-diffstat-digit-cell{height:1em;line-height:1em;}',
    '@media (prefers-reduced-motion: reduce){.ide-diffstat-digit-col{transition:none;}}',
    // 行级对齐 diff 卡（配色语义与宿主 DiffBlock 同源：error=删、success=增，
    // 行底色用 color-mix 淡化叠加——不支持时退化为纯彩字，渐进增强）。
    '.ide-diffrows{position:relative;margin:2px 0;color:var(--dsw-alias-label-primary, #1a1a1a);background:var(--dsw-alias-markdown-code-block, #f6f8fa);border-radius:12px;overflow:hidden;}',
    '.ide-diffrows-copy{position:absolute;top:8px;right:12px;z-index:1;background:transparent;border:0;padding:0;color:var(--dsw-alias-label-secondary, #8a8f98);cursor:pointer;font:inherit;font-size:12px;}',
    // 字号消费官方 token（与 markdown 围栏代码块同源，主题/字号插件缩放时自动跟随）；
    // 官方 token 缺失时回退旧写死值。
    '.ide-diffrows-body{padding:10px 12px;font:var(--dsw-font-markdown-code-block, 12px/22px var(--ds-font-family-code, ui-monospace, monospace));}',
    // 行内容随 agent 区宽度自然折行（对话区文本式）：pre-wrap 保缩进、
    // anywhere 兜底超长 token；底色铺满整行宽（flex:1 撑满，不再横向滚动）。
    '.ide-diffrows-line{display:flex;align-items:flex-start;min-height:22px;white-space:pre-wrap;overflow-wrap:anywhere;}',
    '.ide-diffrows-no{flex-shrink:0;min-width:3ch;margin-right:10px;text-align:right;color:var(--dsw-alias-label-tertiary, #b0b4bc);user-select:none;}',
    '.ide-diffrows-text{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;}',
    '.ide-diffrows-path{font-weight:600;padding-right:56px;}',
    '.ide-diffrows-gap{color:var(--dsw-alias-label-tertiary, #b0b4bc);}',
    '.ide-diffrows-ctx{color:var(--dsw-alias-label-primary, #1a1a1a);}',
    '.ide-diffrows-del{color:var(--dsw-alias-state-error-primary, #cf222e);background:color-mix(in srgb, var(--dsw-alias-state-error-primary, #cf222e) 10%, transparent);}',
    '.ide-diffrows-add{color:var(--dsw-alias-state-success-primary, #1a7f37);background:color-mix(in srgb, var(--dsw-alias-state-success-primary, #1a7f37) 10%, transparent);}',
    '.ide-diffrows-word{border-radius:3px;background:color-mix(in srgb, currentColor 25%, transparent);}',
    '.ide-diffrows-expand{display:block;width:100%;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary, #b0b4bc);cursor:pointer;font:inherit;text-align:left;}',
    '.ide-diffrows-expand:hover{color:var(--dsw-alias-label-secondary, #8a8f98);}',
    '.ide-diffrows-footer{padding:0 12px 10px;font-family:var(--ds-font-family-code, ui-monospace, monospace);font-size:12px;color:var(--dsw-alias-label-tertiary, #b0b4bc);}',
  ].join('')
  document.head.appendChild(style)
}

/**
 * shadow 注册：DSH 内置 agent 的文件编辑工具是 `str_replace_editor`（command:
 * view/create/str_replace/insert），'edit'/'write' 是 Code Mode 呈现下的工具名
 * ——三把 key 全注册（priority:-1 < 内置 0，lowest renders）。
 *
 * 注册策略（防御式，2026-09-06 二次修复）：不走 slots.inject 等待，改为
 * 「探测 + 直接 register + 指数退避重试」——boot 时序上 ToolCallTree（插槽声明
 * 方）晚于本插件时 register 会 throw「not declared」，重试覆盖；每次尝试的
 * 结果写 console 与 <html data-ide-diffstat>（自证信号：F12 elements 一眼可查
 * 注册是否入列，不依赖 DevTools console）。注册生命周期挂 caller fiber。
 * 组件按运行时契约声明 props，与 SDK 泛型推导面（ComposedProps）在此断言桥接。
 * @returns 每把 key 一个 disposer，由调用方并入插件 disposers。
 */
const TOOLVIEW_KEYS = ['str_replace_editor', 'edit', 'write'] as const
const REGISTER_MAX_ATTEMPTS = 12

/** 注册状态自证（每把 key 一条，拼到 <html data-ide-diffstat>，F12 elements 可查）。 */
const toolviewState = new Map<string, string>()
function setToolviewState(key: string, state: string): void {
  toolviewState.set(key, state)
  document.documentElement.dataset.ideDiffstat = [...toolviewState].map(([k, v]) => `${k}=${v}`).join(' ')
}

function registerToolviewKey(ctx: ClientContext, key: (typeof TOOLVIEW_KEYS)[number]): () => void {
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const tryRegister = (): void => {
    if (disposed) return
    attempt++
    try {
      const dispose = ctx.slots.register(
        { name: 'tool.call.toolview', key, priority: -1 },
        DiffStatRow as unknown as never,
      )
      if (disposed) { dispose(); return }
      // 自证：entry 真正入列才算成功（slots.entries 透传 core 台账）。
      const inLedger = ctx.slots.entries('tool.call.toolview').some((entry) => entry.options.key === key)
      console.info(`[dsh-ide-layout] toolview '${key}' registered, inLedger=${inLedger}, attempt=${attempt}`)
      setToolviewState(key, inLedger ? 'ok' : 'pending')
    } catch (error) {
      if (attempt >= REGISTER_MAX_ATTEMPTS) {
        console.error(`[dsh-ide-layout] toolview '${key}' register failed after ${attempt} attempts:`, error)
        setToolviewState(key, `failed:${String(error).slice(0, 120)}`)
        return
      }
      // 未声明（声明方 ToolCallTree 尚未注册）→ 退避重试；其他错误同样重试
      // 至上限（同 key 同 priority 冲突等最终会在日志里现形）。
      timer = setTimeout(tryRegister, Math.min(30000, 250 * 2 ** Math.min(attempt - 1, 7)))
    }
  }
  tryRegister()
  return () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function registerToolDiffRow(ctx: ClientContext): Array<() => void> {
  injectDiffStatStyle()
  return TOOLVIEW_KEYS.map((key) => registerToolviewKey(ctx, key))
}
