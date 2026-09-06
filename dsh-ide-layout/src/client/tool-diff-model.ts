/**
 * edit/write 工具行增强的数据模型（大都督需求 2026-09-06）：
 * 从 wire 工具事件 block 上提取 diff hunks（运行中读 callView、完成读
 * resultView 的 `card:'diff'` 视图），派生 +N/-N 行数统计、文件展示路径与
 * 文件类型小图标。纯函数、零 React 依赖，便于单测。
 *
 * 逻辑对齐宿主 dsh-client-ui-tool 的 diffCardModel/narrowDiffs 与 primitives
 * DiffBlock 的 contentLines/buildRows（版本依赖点：wire 形状变更需同步）。
 */

/** 一个 diff hunk（wire `card:'diff'` 视图 diffs 数组的成员）。 */
export interface DiffHunk {
  path: string
  /** 删除侧全文；新建文件为 null（无删除行）。 */
  oldText: string | null
  /** 新增侧全文。 */
  newText: string
}

/** 运行中 / 完成两种工具 block 的最小形状（只声明本模块用到的字段；
 *  wire 上视图字段可能显式为 null，故带 | null）。 */
export interface ToolBlockLike {
  /** 完成态标记：settled block 携带 kind（宿主 toolRowModel 的 done 判定）。 */
  kind?: string
  callId?: string
  argsRaw?: string
  callView?: { card?: string; kind?: string; diffs?: unknown } | null
  resultView?: { card?: string; kind?: string; diffs?: unknown } | null
  error?: { code?: string }
  isError?: boolean
  content?: Array<{ type?: string; text?: string }>
}

/** 行运行状态（对齐宿主 toolRowModel 的 state 派生）。 */
export type ToolState = 'running' | 'ok' | 'error' | 'stopped'

/**
 * 行状态：运行中 → running；interrupted → stopped；错误结果 → error；
 * 其余完成态 → ok。
 */
export function stateOf(block: ToolBlockLike): ToolState {
  if (block.kind === undefined) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError === true ? 'error' : 'ok'
}

/** 把 wire diffs 数组收窄为结构完整的 hunks，任何成员畸形 → null（走通用行）。 */
export function narrowDiffs(diffs: unknown): DiffHunk[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const out: DiffHunk[] = []
  for (const item of diffs) {
    if (typeof item !== 'object' || item === null) return null
    const { path, oldText, newText } = item as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    out.push({ path, oldText, newText })
  }
  return out
}

/** 从 block 提取 diff hunks：完成态先 resultView 再 callView（str_replace_editor
 *  无 presentResult，完成态 resultView 可能不带 diff 卡，callView 兜底）；
 *  仍无卡时从 argsRaw 重建 hunk（insert 命令的视图是 generic 无 diffs、以及
 *  完成态视图丢失的场景）：oldText=old_str、newText=new_str/file_text。
 *  view 字段可能为 null（wire 显式序列化，如 edit 工具完成态 resultView:null），
 *  必须用 truthy 判空——只查 !== undefined 会在这里炸掉整行（abdicate）。
 *  view 命令（读文件）无 old_str/new_str/file_text → 自然返回 null。 */
export function diffHunksOf(block: ToolBlockLike): DiffHunk[] | null {
  const views = block.kind !== undefined ? [block.resultView, block.callView] : [block.callView]
  for (const view of views) {
    if (view != null && view.card === 'diff') {
      const hunks = narrowDiffs(view.diffs)
      if (hunks !== null) return hunks
    }
  }
  const args = parseArgs(block)
  if (args === null) return null
  const newText = typeof args.new_str === 'string' ? args.new_str : typeof args.file_text === 'string' ? args.file_text : null
  if (typeof args.path !== 'string' || args.path === '' || (newText === null && typeof args.old_str !== 'string')) return null
  return [{ path: args.path, oldText: typeof args.old_str === 'string' ? args.old_str : null, newText: newText ?? '' }]
}

/** 解析 argsRaw JSON；未到齐/非完整 JSON → null。 */
function parseArgs(block: ToolBlockLike): Record<string, unknown> | null {
  if (typeof block.argsRaw !== 'string' || block.argsRaw === '') return null
  try {
    const args = JSON.parse(block.argsRaw) as unknown
    return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 是否「读取文件」调用：str_replace_editor 的 view 命令在 call 视图上标
 *  kind:'read'（card 是 generic）；两侧视图任一标注即读取形态。 */
export function isReadCall(block: ToolBlockLike): boolean {
  return block.callView?.kind === 'read' || block.resultView?.kind === 'read'
}

/** 文本 → 内容行：空文本 0 行，单个尾换行是行终止符而非空行（对齐 DiffBlock contentLines）。 */
function contentLines(text: string): number {
  if (text === '') return 0
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n').length
}

export interface DiffCounts {
  added: number
  removed: number
}

// ─── 行级对齐 diff（借鉴 ZCode：上下文行保留，红绿只标真正变化的行）───

/** 单个渲染行：path/gap = 文件头/分隔；ctx = 两侧相同；del/add = 删/增（配对修改行带 word 区间）。 */
export interface DiffRow {
  kind: 'path' | 'gap' | 'ctx' | 'del' | 'add'
  text: string
  /** 行内 word 级变化区间（字符下标，左闭右开；仅配对的 del/add 行有）。 */
  words?: DiffWordRange[]
}

export interface DiffWordRange {
  start: number
  end: number
}

export interface AlignedDiff {
  rows: DiffRow[]
  /** 真实变化统计：add 行数 / del 行数（对齐后，比整块计数更准）。 */
  added: number
  removed: number
  /** 是否做了行级对齐（false = 行数超限退化成整块红绿）。 */
  aligned: boolean
}

/** LCS 对齐的行数上限：超出则退化整块渲染（DP 表 O(n·m)，防大文件爆内存）。 */
const ALIGN_MAX_LINES = 1500

/** 文本 → 行数组（口径与 DiffBlock contentLines 一致：尾换行不算空行）。 */
function splitLines(text: string): string[] {
  if (text === '') return []
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
}

/**
 * 行级 LCS 对齐：把 oldText/newText 编织成 ctx/del/add 行序列。手写 DP
 * （old_str/new_str 规模小；行数超 ALIGN_MAX_LINES 时退化为整块）。
 * 统计 = del/add 行数（真实变化，与图一「+1 -1」语义一致）。
 */
export function alignDiff(oldText: string | null, newText: string): AlignedDiff {
  const oldLines = oldText === null ? [] : splitLines(oldText)
  const newLines = splitLines(newText)
  const added = newLines.length
  const removed = oldLines.length
  const unaligned: AlignedDiff = {
    rows: [
      ...oldLines.map((text) => ({ kind: 'del', text }) as DiffRow),
      ...newLines.map((text) => ({ kind: 'add', text }) as DiffRow),
    ],
    added,
    removed,
    aligned: false,
  }
  if (oldLines.length > ALIGN_MAX_LINES || newLines.length > ALIGN_MAX_LINES) return unaligned

  // 后缀式 LCS DP：dp[i*(m+1)+j] = a[i..] 与 b[j..] 的最长公共子序列长度。
  const n = oldLines.length
  const m = newLines.length
  const dp = new Uint16Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = oldLines[i] === newLines[j]
        ? (dp[at(i + 1, j + 1)] + 1) & 0xffff
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  // 回溯产出 op 序列，随后把相邻的连续 del 块与 add 块按位置配对做 word 高亮。
  const ops: Array<{ op: 'ctx' | 'del' | 'add'; ai?: number; bi?: number }> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ op: 'ctx', ai: i, bi: j })
      i++
      j++
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      ops.push({ op: 'del', ai: i })
      i++
    } else {
      ops.push({ op: 'add', bi: j })
      j++
    }
  }
  while (i < n) { ops.push({ op: 'del', ai: i }); i++ }
  while (j < m) { ops.push({ op: 'add', bi: j }); j++ }

  const rows: DiffRow[] = []
  let added2 = 0
  let removed2 = 0
  let k = 0
  while (k < ops.length) {
    const op = ops[k]
    if (op.op === 'ctx') {
      rows.push({ kind: 'ctx', text: oldLines[op.ai ?? 0] })
      k++
      continue
    }
    // 收集紧随的连续 del 块与 add 块（同一段落里的替换）。
    const dels: number[] = []
    const adds: number[] = []
    while (k < ops.length && ops[k].op === 'del') { dels.push(ops[k].ai ?? 0); k++ }
    while (k < ops.length && ops[k].op === 'add') { adds.push(ops[k].bi ?? 0); k++ }
    const pairs = Math.min(dels.length, adds.length)
    for (let p = 0; p < pairs; p++) {
      const delText = oldLines[dels[p]]
      const addText = newLines[adds[p]]
      const words = wordDiff(delText, addText)
      const delRow: DiffRow = { kind: 'del', text: delText }
      const addRow: DiffRow = { kind: 'add', text: addText }
      if (words !== null) {
        if (words.del.length > 0) delRow.words = words.del
        if (words.add.length > 0) addRow.words = words.add
      }
      rows.push(delRow, addRow)
      removed2++
      added2++
    }
    for (let p = pairs; p < dels.length; p++) { rows.push({ kind: 'del', text: oldLines[dels[p]] }); removed2++ }
    for (let p = pairs; p < adds.length; p++) { rows.push({ kind: 'add', text: newLines[adds[p]] }); added2++ }
  }
  return { rows, added: added2, removed: removed2, aligned: true }
}

/** 行内 word 级对齐：非空白 token 做 LCS，未匹配 token 的字符区间即变化位置。 */
function wordDiff(a: string, b: string): { del: DiffWordRange[]; add: DiffWordRange[] } | null {
  const ta = wordTokens(a)
  const tb = wordTokens(b)
  // DP on token 值（token 数少，直接 O(n·m)）。
  const n = ta.length
  const m = tb.length
  const matchedA = new Uint8Array(n)
  const matchedB = new Uint8Array(m)
  const dp = new Uint16Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = ta[i].text === tb[j].text
        ? (dp[at(i + 1, j + 1)] + 1) & 0xffff
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (ta[i].text === tb[j].text) { matchedA[i] = 1; matchedB[j] = 1; i++; j++ }
    else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) i++
    else j++
  }
  const del = mergeRanges(matchedA, ta)
  const add = mergeRanges(matchedB, tb)
  // 完全无公共 token → 不做 word 层（整行已红/绿，避免视觉噪声）。
  let matchedCount = 0
  for (const v of matchedA) matchedCount += v
  if (matchedCount === 0) return null
  return { del, add }
}

interface WordToken {
  text: string
  start: number
  end: number
  blank: boolean
}

/** 按空白切词并保留字符下标（空白 token 仅作分隔，不参与匹配）。 */
function wordTokens(text: string): WordToken[] {
  const out: WordToken[] = []
  const re = /\S+|\s+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    out.push({ text: match[0], start: match.index, end: match.index + match[0].length, blank: /^\s/.test(match[0]) })
  }
  return out
}

/** 未匹配 token 的字符区间（相邻合并；空白 token 不标）。 */
function mergeRanges(matched: Uint8Array, tokens: WordToken[]): DiffWordRange[] {
  const ranges: DiffWordRange[] = []
  let start = -1
  let end = -1
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k]
    if (matched[k] === 0 && !token.blank) {
      if (start === -1) { start = token.start; end = token.end }
      else end = token.end
    } else if (start !== -1) {
      ranges.push({ start, end })
      start = -1
    }
  }
  if (start !== -1) ranges.push({ start, end })
  return ranges
}

export interface DiffRowsModel {
  rows: DiffRow[]
  /** 真实变化统计（对齐后）：add 行数 / del 行数。 */
  added: number
  removed: number
  /** 涉及文件数。 */
  files: number
}

/** 把 diff hunks 展平为渲染行：文件头 path 行（同文件后续 hunk 用 ⋯ 分隔，与
 *  DiffBlock buildRows 的 path/gap 规则一致）+ 每 hunk 的行级对齐结果。 */
export function buildDiffRows(hunks: readonly DiffHunk[]): DiffRowsModel {
  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  let prevPath: string | undefined
  for (const hunk of hunks) {
    if (hunk.path !== prevPath) rows.push({ kind: 'path', text: hunk.path })
    else rows.push({ kind: 'gap', text: '⋯' })
    prevPath = hunk.path
    const aligned = alignDiff(hunk.oldText, hunk.newText)
    added += aligned.added
    removed += aligned.removed
    rows.push(...aligned.rows)
  }
  return { rows, added, removed, files: new Set(hunks.map((h) => h.path)).size }
}

export interface FileLabel {
  /** 文件名（basename）。 */
  name: string
  /** 目录部分（含尾斜杠；顶层文件为空串）。 */
  dir: string
}

/** 派生「文件名 + 目录」显示：相对 cwd（Windows 反斜杠归一），其次 ~ 缩写，再拆 basename。 */
export function describePath(path: string, cwd?: string, home?: string): FileLabel {
  let p = path.replace(/\\/g, '/')
  if (cwd !== undefined && cwd !== '') {
    const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    if (p.startsWith(root + '/')) p = p.slice(root.length + 1)
  }
  if (home !== undefined && home !== '') {
    const h = home.replace(/\\/g, '/').replace(/\/+$/, '')
    if (p.startsWith(h + '/')) p = '~/' + p.slice(h.length + 1)
  }
  const cut = p.lastIndexOf('/')
  return { name: cut === -1 ? p : p.slice(cut + 1), dir: cut === -1 ? '' : p.slice(0, cut + 1) }
}

/** 展示路径：优先 diff 视图的 path，兜底从 argsRaw JSON 取 path，再兜底 callId。 */
export function displayPathOf(block: ToolBlockLike, hunks: readonly DiffHunk[] | null): string {
  if (hunks !== null) return hunks[0].path
  try {
    const args = JSON.parse(block.argsRaw ?? '') as Record<string, unknown>
    if (typeof args.path === 'string' && args.path !== '') return args.path
  } catch {
    // 参数未到齐 / 非完整 JSON（流式中间态）→ 走 callId 兜底。
  }
  return block.callId ?? ''
}

export interface FileBadge {
  /** 图标字形（文本渲染）。 */
  glyph: string
  /** 图标颜色（CSS 值；暗色主题由注入样式覆盖变量）。 */
  color: string
}

/**
 * 文件类型小图标（图一样式）：package.json 的 {}（琥珀）、markdown 的 ⇅（蓝）、
 * README 的 ⓘ（蓝）、其余 ⓘ（灰）。README 判定须在 .md 之前（README.md → ⓘ）。
 */
export function fileBadgeFor(path: string): FileBadge {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const lower = base.toLowerCase()
  if (lower.endsWith('.json') || lower.endsWith('.jsonc') || lower.endsWith('.json5')) {
    return { glyph: '{}', color: 'var(--ide-diffstat-json, #b45309)' }
  }
  if (lower.startsWith('readme')) return { glyph: 'ⓘ', color: 'var(--ide-diffstat-icon, #3b82f6)' }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { glyph: '⇅', color: 'var(--ide-diffstat-icon, #3b82f6)' }
  }
  return { glyph: 'ⓘ', color: 'var(--ide-diffstat-icon-muted, #9ca3af)' }
}

/** 完成态结果文本（text 块拼接）的首条非空行；无文本 → null。 */
export function firstResultLine(block: ToolBlockLike): string | null {
  const text = (block.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
  const first = text.split('\n').find((line) => line.trim() !== '')
  return first ?? null
}
