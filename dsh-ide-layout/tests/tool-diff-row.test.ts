/**
 * edit/write 工具行增强（tool-diff-model）单测：diff hunks 提取与收窄、
 * +N/-N 统计、状态派生、路径展示、文件类型图标。
 */
import { describe, expect, it } from 'vitest'
import {
  alignDiff,
  buildDiffRows,
  describePath,
  diffHunksOf,
  displayPathOf,
  fileBadgeFor,
  firstResultLine,
  isReadCall,
  narrowDiffs,
  stateOf,
  type ToolBlockLike,
} from '../src/client/tool-diff-model.ts'

describe('narrowDiffs 收窄', () => {
  it('结构完整的 hunks 原样通过', () => {
    const out = narrowDiffs([{ path: 'a.md', oldText: 'x\n', newText: 'y\n' }])
    expect(out).toEqual([{ path: 'a.md', oldText: 'x\n', newText: 'y\n' }])
  })

  it('非数组 / 空数组 / 成员畸形 → null（走通用行，不崩渲染）', () => {
    expect(narrowDiffs(undefined)).toBeNull()
    expect(narrowDiffs([])).toBeNull()
    expect(narrowDiffs(['bad'])).toBeNull()
    expect(narrowDiffs([{ path: 1, oldText: null, newText: '' }])).toBeNull()
    expect(narrowDiffs([{ path: 'a', oldText: 3, newText: '' }])).toBeNull()
    expect(narrowDiffs([{ path: 'a', oldText: null, newText: 5 }])).toBeNull()
  })

  it('新建文件 oldText 为 null 合法', () => {
    expect(narrowDiffs([{ path: 'new.ts', oldText: null, newText: 'a\n' }])).not.toBeNull()
  })
})

describe('diffHunksOf 提取', () => {
  const diffs = [{ path: 'p', oldText: null, newText: 'a\n' }]

  it('运行中（无 kind）读 callView', () => {
    const block: ToolBlockLike = { callId: 'c1', callView: { card: 'diff', diffs } }
    expect(diffHunksOf(block)).toEqual(diffs)
  })

  it('完成态优先 resultView，无 diff 卡时回落 callView（str_replace_editor 无 presentResult）', () => {
    const settled: ToolBlockLike = {
      kind: 'result',
      callView: { card: 'diff', diffs },
      resultView: { card: 'generic' },
    }
    expect(diffHunksOf(settled)).toEqual(diffs)
  })

  it('完成态 resultView 为显式 null（edit 工具实况，曾致 abdicate 崩溃）→ 回落 callView 不炸', () => {
    const block: ToolBlockLike = {
      kind: 'result',
      callView: { card: 'diff', diffs },
      resultView: null,
    }
    expect(diffHunksOf(block)).toEqual(diffs)
    // 两侧皆 null → args 兜底
    expect(diffHunksOf({ kind: 'r', callView: null, resultView: null, argsRaw: '{"path":"p","old_str":"a","new_str":"b"}' }))
      .toEqual([{ path: 'p', oldText: 'a', newText: 'b' }])
  })

  it('完成态两侧都无 diff 卡 → 从 argsRaw 重建 hunk（insert/new_str、create/file_text、丢失场景）', () => {
    expect(diffHunksOf({ kind: 'r', argsRaw: '{"command":"insert","path":"a.py","insert_line":2,"new_str":"x\\n"}' }))
      .toEqual([{ path: 'a.py', oldText: null, newText: 'x\n' }])
    expect(diffHunksOf({ kind: 'r', argsRaw: '{"command":"create","path":"b.md","file_text":"# hi\\n"}' }))
      .toEqual([{ path: 'b.md', oldText: null, newText: '# hi\n' }])
    expect(diffHunksOf({ kind: 'r', argsRaw: '{"command":"str_replace","path":"c.ts","old_str":"old","new_str":"new"}' }))
      .toEqual([{ path: 'c.ts', oldText: 'old', newText: 'new' }])
  })

  it('view 命令（读文件）无 old_str/new_str/file_text → null', () => {
    expect(diffHunksOf({ callId: 'c', argsRaw: '{"command":"view","path":"d.md"}' })).toBeNull()
    expect(diffHunksOf({ callId: 'c', argsRaw: '{"comma' })).toBeNull()
  })

  it('无 diff 卡 / 卡畸形 → null（args 也无来源时）', () => {
    expect(diffHunksOf({ callView: { card: 'read' } })).toBeNull()
    expect(diffHunksOf({ resultView: { card: 'diff', diffs: [] } })).toBeNull()
    expect(diffHunksOf({})).toBeNull()
  })
})

describe('isReadCall 读取调用判定', () => {
  it('call 视图 kind:read（view 命令）→ true；编辑调用 → false', () => {
    expect(isReadCall({ callId: 'c', callView: { card: 'generic', kind: 'read' } })).toBe(true)
    expect(isReadCall({ kind: 'r', resultView: { card: 'generic', kind: 'read' } })).toBe(true)
    expect(isReadCall({ callId: 'c', callView: { card: 'diff' } })).toBe(false)
    expect(isReadCall({})).toBe(false)
  })
})

describe('alignDiff 行级对齐（借鉴 ZCode：ctx 保留、红绿只标变化行）', () => {
  it('多行替换中相同行保留为 ctx，统计只计真实变化行（对齐图一「+1 -1」语义）', () => {
    const old = 'const a = 1\nconst b = 2\nconst c = 3\n'
    const now = 'const a = 1\nconst b = 20\nconst c = 3\n'
    const out = alignDiff(old, now)
    expect(out.aligned).toBe(true)
    expect(out.added).toBe(1)
    expect(out.removed).toBe(1)
    const kinds = out.rows.map((r) => r.kind)
    // 结构：ctx(del 前) / del+add 配对 / ctx
    expect(kinds).toEqual(['ctx', 'del', 'add', 'ctx'])
    expect(out.rows[1].text).toBe('const b = 2')
    expect(out.rows[2].text).toBe('const b = 20')
  })

  it('配对修改行带 word 级变化区间（只标变动词）', () => {
    const out = alignDiff('hello world\n', 'hello there\n')
    const del = out.rows.find((r) => r.kind === 'del')
    const add = out.rows.find((r) => r.kind === 'add')
    expect(del?.words).toEqual([{ start: 6, end: 11 }])
    expect(add?.words).toEqual([{ start: 6, end: 11 }])
  })

  it('纯新增（oldText null）与纯删除（newText 空）', () => {
    const created = alignDiff(null, 'a\nb\n')
    expect(created.rows.every((r) => r.kind === 'add')).toBe(true)
    expect(created).toMatchObject({ added: 2, removed: 0 })
    const deleted = alignDiff('a\nb\n', '')
    expect(deleted.rows.every((r) => r.kind === 'del')).toBe(true)
    expect(deleted).toMatchObject({ added: 0, removed: 2 })
  })

  it('完全无公共行 → 不配对 word（避免整行再叠 word 噪声）', () => {
    const out = alignDiff('alpha\nbeta\n', 'gamma\ndelta\n')
    expect(out.rows.find((r) => r.kind === 'del')?.words).toBeUndefined()
  })

  it('超过 1500 行退化为整块红绿（aligned=false，防 DP 爆内存）', () => {
    const big = Array.from({ length: 1501 }, (_, i) => `line ${i}`).join('\n')
    const out = alignDiff(big, big.replace('line 0', 'line 0!'))
    expect(out.aligned).toBe(false)
    expect(out.removed).toBe(1501)
  })
})

describe('buildDiffRows 组装', () => {
  it('多 hunk：不同文件出 path 头行、同文件出 ⋯ 分隔；统计与文件数累加', () => {
    const out = buildDiffRows([
      { path: 'a.md', oldText: 'x\n', newText: 'y\n' },
      { path: 'a.md', oldText: 'p\n', newText: 'q\n' },
      { path: 'b.md', oldText: null, newText: 'n\n' },
    ])
    expect(out.rows.filter((r) => r.kind === 'path').map((r) => r.text)).toEqual(['a.md', 'b.md'])
    expect(out.rows.filter((r) => r.kind === 'gap')).toHaveLength(1)
    expect(out.files).toBe(2)
    expect(out.added).toBe(3)
    expect(out.removed).toBe(2)
  })
})

describe('stateOf 状态派生（对齐宿主 toolRowModel）', () => {
  it('无 kind → running；interrupted → stopped；isError → error；否则 ok', () => {
    expect(stateOf({ callId: 'c' })).toBe('running')
    expect(stateOf({ kind: 'r', error: { code: 'interrupted' } })).toBe('stopped')
    expect(stateOf({ kind: 'r', isError: true, content: [{ type: 'text', text: 'boom' }] })).toBe('error')
    expect(stateOf({ kind: 'r' })).toBe('ok')
  })
})

describe('describePath 路径展示', () => {
  it('剥离 cwd 前缀（Windows 反斜杠归一）', () => {
    expect(describePath('E:\\dsh-plugins\\monorepo\\dsh-ide-layout\\README.md', 'E:\\dsh-plugins\\monorepo', undefined))
      .toEqual({ name: 'README.md', dir: 'dsh-ide-layout/' })
  })

  it('home 前缀缩写为 ~', () => {
    expect(describePath('/home/u/.dsh/profiles/web/package.json', undefined, '/home/u'))
      .toEqual({ name: 'package.json', dir: '~/.dsh/profiles/web/' })
  })

  it('顶层文件无目录部分', () => {
    expect(describePath('package.json')).toEqual({ name: 'package.json', dir: '' })
  })
})

describe('displayPathOf 展示路径', () => {
  it('hunks 存在时优先 diff 视图的 path', () => {
    const block: ToolBlockLike = { callId: 'c1', argsRaw: '{"path":"from-args"}' }
    expect(displayPathOf(block, [{ path: 'from-diff', oldText: null, newText: '' }])).toBe('from-diff')
  })

  it('无 hunks 时兜底 argsRaw JSON 的 path，解析失败再兜底 callId', () => {
    expect(displayPathOf({ callId: 'c1', argsRaw: '{"path":"from-args"}' }, null)).toBe('from-args')
    expect(displayPathOf({ callId: 'c2', argsRaw: '{"path"' }, null)).toBe('c2')
  })
})

describe('fileBadgeFor 文件类型图标（图一样式）', () => {
  it('json → {}（琥珀）；md → ⇅（蓝）；README 优先于 .md → ⓘ（蓝）；其他 → ⓘ（灰）', () => {
    expect(fileBadgeFor('package.json').glyph).toBe('{}')
    expect(fileBadgeFor('CHANGELOG.md').glyph).toBe('⇅')
    expect(fileBadgeFor('README.md').glyph).toBe('ⓘ')
    expect(fileBadgeFor('main.py').glyph).toBe('ⓘ')
    expect(fileBadgeFor('package.json').color).not.toBe(fileBadgeFor('main.py').color)
  })
})

describe('firstResultLine 错误摘要', () => {
  it('取首条非空行；无文本 → null', () => {
    expect(firstResultLine({ kind: 'r', content: [{ type: 'text', text: '\nboom: bad\n' }] })).toBe('boom: bad')
    expect(firstResultLine({ kind: 'r', content: [] })).toBeNull()
  })
})
