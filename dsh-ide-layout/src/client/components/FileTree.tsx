/** Left column: workspace file tree (dirs + files, lazy expand, click opens).
 *  v13: VS Code 风格右键菜单（在资源管理器中显示 / 复制路径 / 复制相对路径 /
 *  新建文件 / 新建文件夹 / 重命名 / 删除）+ 行内改名与新建输入 + 删除确认浮层。
 *  v14: 资源管理器式搜索——标题栏下搜索框，输入即过滤（防抖 250ms），
 *  host 递归遍历返回名称匹配项（跳过 node_modules/.git，上限 500 条）；
 *  结果中文件点击打开、目录点击退出搜索并在树中展开定位；清空恢复树。
 *  目录数据由本组件缓存（LevelData map，参考 better-sidebar ExplorerView 模式），
 *  操作成功或收到 fs 变更（外层 SSE 重挂载）后重载。 */

import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { apiCreateDir, apiList, apiRemove, apiRename, apiReveal, apiSearch, apiWrite } from '../api.ts'
import type { FsEntry } from '../../core/types.ts'

interface FileTreeProps {
  root: string
  /** 外部 fs 变更计数器：变化时轻量重载（保留展开），不重挂载组件。 */
  treeTick?: number
  onOpenFile: (path: string) => void
  /** 右键「🔨 构建项目」（目标为项目标记文件或根时显示）。 */
  onBuildProject?: (relPath: string) => void
  /** 右键「▶ 运行项目」（目标为项目标记文件或根时显示）。 */
  onRunProject?: (relPath: string) => void
}

const FILE_ICON_COLOR = '#6b7280'
const DIR_ICON_COLOR = '#d4a72c'

/** One directory level: entries or a load error. */
interface LevelData {
  entries?: FsEntry[]
  error?: string
}

/** Inline editing state: creating inside a dir, or renaming an existing row. */
type EditState =
  | { mode: 'new-file' | 'new-dir'; parent: string }
  | { mode: 'rename'; path: string; name: string }
  | null

/** The shared context menu: target row + cursor position. */
interface MenuState {
  path: string
  isDir: boolean
  x: number
  y: number
}

/** 搜索结果视图状态：null = 非搜索模式（输入为空，显示完整树）。 */
interface SearchState {
  loading: boolean
  entries: FsEntry[]
  truncated: boolean
  error?: string
}

/** 名称命中子串高亮（资源管理器式：命中片段加背景）。 */
function HighlightedName({ name, query }: { name: string; query: string }): JSX.Element {
  const q = query.trim()
  if (q === '') return <span>{name}</span>
  const index = name.toLowerCase().indexOf(q.toLowerCase())
  if (index === -1) return <span>{name}</span>
  return (
    <span>
      {name.slice(0, index)}
      <span style={{ background: 'rgba(250,204,21,0.5)', borderRadius: 2 }}>{name.slice(index, index + q.length)}</span>
      {name.slice(index + q.length)}
    </span>
  )
}

type MenuItem = { id: string; label: string; danger?: boolean } | 'sep'

/** Copy text to the clipboard (with a legacy execCommand fallback). */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Absolute path (Windows backslash) for copy / reveal in explorer. */
function absolutePath(root: string, rel: string): string {
  if (rel === '') return root
  return root.replace(/[\\/]+$/, '') + '\\' + rel.replaceAll('/', '\\')
}

/** Split a relative path into dir + basename. */
function splitRel(rel: string): { dir: string; name: string } {
  const index = rel.lastIndexOf('/')
  return index === -1 ? { dir: '', name: rel } : { dir: rel.slice(0, index), name: rel.slice(index + 1) }
}

function rowStyle(depth: number, extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    padding: '2px 4px',
    paddingLeft: 8 + depth * 14,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: 13,
    lineHeight: '22px',
    userSelect: 'none',
    ...extra,
  }
}

function hoverHandlers(background = 'var(--ide-hover, rgba(127,127,127,0.1))'): {
  onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void
  onMouseLeave: (event: React.MouseEvent<HTMLElement>) => void
} {
  return {
    onMouseEnter: (event) => { (event.currentTarget as HTMLElement).style.background = background },
    onMouseLeave: (event) => { (event.currentTarget as HTMLElement).style.background = 'transparent' },
  }
}

function FileIcon({ entry }: { entry: FsEntry }): JSX.Element {
  return (
    <span style={{ color: entry.isDir ? DIR_ICON_COLOR : FILE_ICON_COLOR, marginRight: 6, fontSize: 12, width: 16, display: 'inline-block', textAlign: 'center' }}>
      {entry.isDir ? '📁' : '📄'}
    </span>
  )
}

/** Inline input row used for both "new file/dir" and "rename". */
function EditRow({
  depth,
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  depth: number
  initial: string
  placeholder: string
  onCommit: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <div style={{ paddingLeft: 8 + depth * 14, paddingRight: 8, paddingTop: 1, paddingBottom: 1 }}>
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit(value)
          else if (event.key === 'Escape') onCancel()
        }}
        onBlur={onCancel}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: 13,
          padding: '1px 6px',
          background: 'var(--dsw-alias-bg-base,#ffffff)',
          color: 'inherit',
          border: '1px solid var(--ide-accent,#4f8cff)',
          borderRadius: 3,
          outline: 'none',
        }}
      />
    </div>
  )
}

interface RenderOpts {
  dir: string
  depth: number
  data: Record<string, LevelData>
  expanded: Set<string>
  editing: EditState
  copied: string | null
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
  onContextMenu: (event: React.MouseEvent, path: string, isDir: boolean) => void
  onCommitEdit: (value: string) => void
  onCancelEdit: () => void
}

/** Recursively render one directory level (children of `dir`). */
function renderChildren(opts: RenderOpts): ReactNode {
  const { dir, depth, data, expanded, editing, copied } = opts
  const level = data[dir]
  if (level === undefined) {
    return <div style={{ ...rowStyle(depth + 1), color: '#9ca3af', cursor: 'default' }}>加载中…</div>
  }
  if (level.error !== undefined) {
    return <div style={{ ...rowStyle(depth + 1), color: '#dc2626', cursor: 'default' }}>⚠ {level.error}</div>
  }
  const children = level.entries ?? []
  const showingNew = editing !== null && editing.mode !== 'rename' && editing.parent === dir
  if (children.length === 0 && !showingNew) {
    return <div style={{ ...rowStyle(depth + 1), color: '#9ca3af', fontStyle: 'italic', cursor: 'default' }}>（空目录）</div>
  }
  const rows: ReactNode[] = children.map((child) => {
    if (editing?.mode === 'rename' && editing.path === child.path) {
      return (
        <EditRow
          key={child.path}
          depth={depth + 1}
          initial={editing.name}
          placeholder="新名称"
          onCommit={opts.onCommitEdit}
          onCancel={opts.onCancelEdit}
        />
      )
    }
    const isDir = child.isDir
    const isExpanded = isDir && expanded.has(child.path)
    return (
      <div key={child.path}>
        <div
          style={rowStyle(depth + 1)}
          onClick={() => { if (isDir) opts.onToggle(child.path); else opts.onOpenFile(child.path) }}
          onContextMenu={(event) => opts.onContextMenu(event, child.path, isDir)}
          {...hoverHandlers()}
          title={child.path}
        >
          <span style={{ width: 14, display: 'inline-block', textAlign: 'center', fontSize: 10, marginRight: 2 }}>
            {isDir ? (isExpanded ? '▾' : '▸') : ''}
          </span>
          <FileIcon entry={child} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{child.name}</span>
          {copied === child.path
            ? <span style={{ marginLeft: 'auto', color: '#16a34a', fontSize: 11 }}>已复制</span>
            : (!isDir && child.size > 0
                ? <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 11 }}>{child.size}</span>
                : null)}
        </div>
        {isExpanded && renderChildren({ ...opts, dir: child.path, depth: depth + 1 })}
      </div>
    )
  })
  if (showingNew) {
    rows.push(
      <EditRow
        key="__new__"
        depth={depth + 1}
        initial=""
        placeholder={editing.mode === 'new-file' ? '文件名' : '文件夹名'}
        onCommit={opts.onCommitEdit}
        onCancel={opts.onCancelEdit}
      />,
    )
  }
  return <div>{rows}</div>
}

/** 目标是否为 Java 项目标记（pom.xml / build.gradle / settings.gradle）或工作区根。 */
function isProjectTarget(menu: MenuState): boolean {
  if (menu.path === '') return true
  const name = menu.path.split('/').pop() ?? ''
  return name === 'pom.xml' || name === 'build.gradle' || name === 'settings.gradle'
}

function menuItemsFor(menu: MenuState): MenuItem[] {
  const createItems: MenuItem[] = menu.isDir
    ? [{ id: 'new-file', label: '新建文件' }, { id: 'new-dir', label: '新建文件夹' }]
    : []
  const projectItems: MenuItem[] = isProjectTarget(menu)
    ? [{ id: 'build-project', label: '🔨 构建项目' }, { id: 'run-project', label: '▶ 运行项目' }, 'sep']
    : []
  return [
    ...projectItems,
    { id: 'reveal', label: '在资源管理器中显示' },
    { id: 'copy-abs', label: '复制路径' },
    { id: 'copy-rel', label: '复制相对路径' },
    'sep',
    ...createItems,
    'sep',
    { id: 'rename', label: '重命名' },
    { id: 'delete', label: '删除', danger: true },
  ]
}

export function FileTree({ root, treeTick = 0, onOpenFile, onBuildProject, onRunProject }: FileTreeProps): JSX.Element {
  const [data, setData] = useState<Record<string, LevelData>>({})
  const dataRef = useRef(data)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const expandedRef = useRef(expanded)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editing, setEditing] = useState<EditState>(null)
  const [confirm, setConfirm] = useState<{ path: string; name: string; isDir: boolean } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchState, setSearchState] = useState<SearchState | null>(null)
  const lastRoot = useRef('')
  /** P2-03：root 代际标记——切 root 后旧请求响应直接丢弃，防串树。 */
  const rootGen = useRef(0)
  /** 搜索请求代际——输入再变或退出搜索时旧响应作废（与 rootGen 同模式）。 */
  const searchGen = useRef(0)

  const storeLevel = useCallback((path: string, level: LevelData): void => {
    dataRef.current = { ...dataRef.current, [path]: level }
    setData(dataRef.current)
  }, [])

  const loadDir = useCallback((dir: string, force = false): void => {
    // 防重：已加载的目录不重复拉取（force 时强制重拉）
    if (!force && dataRef.current[dir] !== undefined) return
    // 非 force（首次展开）显示「加载中」；force（刷新）**保留旧数据**直到新数据到达——
    // 这是文件树不闪的关键：刷新时若清空再异步填充，列表会闪空白
    if (!force) storeLevel(dir, {})
    const gen = rootGen.current
    void apiList(root, dir).then((result) => {
      // P2-03：代际校验——切换 root 后旧响应作废。
      if (gen !== rootGen.current) return
      if (result.ok) storeLevel(dir, { entries: result.value.entries })
      else storeLevel(dir, { error: result.error.message })
    }).catch((cause: unknown) => {
      if (gen !== rootGen.current) return
      storeLevel(dir, { error: cause instanceof Error ? cause.message : String(cause) })
    })
  }, [root, storeLevel])

  /** 轻量刷新：force 重拉 root 与所有展开目录，**不清空缓存**（旧数据保持显示，
   *  新数据到达后逐目录替换 → 无空白闪烁）。VS Code Explorer 同款思路（模型保留 + 局部更新）。 */
  const refresh = useCallback((): void => {
    if (root === '') return
    loadDir('', true)
    for (const dir of expandedRef.current) loadDir(dir, true)
  }, [root, loadDir])

  // Root change (or external refresh tick) rebuilds the cache.
  // treeTick 变化 = 外部 fs 变更：保留展开状态，force 重拉（不清空 → 不闪）；
  // root 变化 = 换工作区：清空缓存与展开（换根理应整体替换）。
  useEffect(() => {
    if (root === '') {
      expandedRef.current = new Set()
      setExpanded(new Set())
      return
    }
    if (lastRoot.current !== root) {
      lastRoot.current = root
      rootGen.current += 1
      searchGen.current += 1
      dataRef.current = {}
      setData({})
      expandedRef.current = new Set()
      setExpanded(new Set())
      // 换工作区：旧搜索词无意义，退出搜索模式。
      setQuery('')
      setSearchState(null)
      loadDir('')
      return
    }
    refresh()
  }, [root, refresh, treeTick, loadDir])

  // 防抖搜索：输入停 250ms 后发起；清空即回树视图。请求期间保留旧结果
  // （loading 只覆盖首行提示，不打断浏览）。
  useEffect(() => {
    const q = query.trim()
    if (q === '') {
      searchGen.current += 1
      setSearchState(null)
      return
    }
    setSearchState((prev) => ({ loading: true, entries: prev?.entries ?? [], truncated: false }))
    const gen = ++searchGen.current
    const timer = window.setTimeout(() => {
      void apiSearch(root, q).then((result) => {
        if (gen !== searchGen.current) return
        if (result.ok) {
          setSearchState({ loading: false, entries: result.value.entries, truncated: result.value.truncated === true })
        } else {
          setSearchState({ loading: false, entries: [], truncated: false, error: result.error.message })
        }
      }).catch((cause: unknown) => {
        if (gen !== searchGen.current) return
        setSearchState({ loading: false, entries: [], truncated: false, error: cause instanceof Error ? cause.message : String(cause) })
      })
    }, 250)
    return () => { window.clearTimeout(timer) }
  }, [query, root])

  const toggle = useCallback((path: string): void => {
    if (dataRef.current[path] === undefined) loadDir(path)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      expandedRef.current = next
      return next
    })
  }, [loadDir])

  /** 搜索结果点目录：退出搜索，在树中展开定位（逐层 loadDir + 展开祖先链）。 */
  const revealDir = useCallback((rel: string): void => {
    setQuery('')
    const chain: string[] = []
    let acc = ''
    for (const part of rel.split('/')) {
      acc = acc === '' ? part : `${acc}/${part}`
      chain.push(acc)
    }
    for (const dir of chain) loadDir(dir)
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const dir of chain) next.add(dir)
      expandedRef.current = next
      return next
    })
  }, [loadDir])

  const openMenu = useCallback((event: React.MouseEvent, path: string, isDir: boolean): void => {
    event.preventDefault()
    event.stopPropagation()
    setEditing(null)
    setMenu({ path, isDir, x: event.clientX, y: event.clientY })
  }, [])

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (menu === null) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target !== null && target.closest('[data-ide-tree-menu]') !== null) return
      setMenu(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const runMenuAction = (id: string): void => {
    if (menu === null) return
    const target = menu
    setMenu(null)
    if (id === 'reveal') {
      void apiReveal(root, target.path)
    } else if (id === 'build-project') {
      onBuildProject?.(target.path)
    } else if (id === 'run-project') {
      onRunProject?.(target.path)
    } else if (id === 'copy-abs' || id === 'copy-rel') {
      const text = id === 'copy-abs' ? absolutePath(root, target.path) : target.path
      void writeClipboard(text).then((ok) => {
        if (ok) {
          setCopied(target.path)
          window.setTimeout(() => setCopied((current) => current === target.path ? null : current), 1200)
        }
      })
    } else if (id === 'new-file' || id === 'new-dir') {
      setEditing({ mode: id === 'new-file' ? 'new-file' : 'new-dir', parent: target.path })
    } else if (id === 'rename') {
      setEditing({ mode: 'rename', path: target.path, name: splitRel(target.path).name })
    } else if (id === 'delete') {
      setConfirm({ path: target.path, name: splitRel(target.path).name, isDir: target.isDir })
    }
  }

  const commitEdit = (value: string): void => {
    if (editing === null) return
    const name = value.trim()
    if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      setEditing(null)
      return
    }
    if (editing.mode !== 'rename') {
      const parent = editing.parent
      const target = parent === '' ? name : `${parent}/${name}`
      if (editing.mode === 'new-file') {
        void apiWrite(root, target, '').then((result) => {
          if (result.ok) {
            onOpenFile(target)
            refresh()
          }
        })
      } else {
        void apiCreateDir(root, target).then(() => refresh())
      }
    } else {
      const { dir } = splitRel(editing.path)
      const target = dir === '' ? name : `${dir}/${name}`
      void apiRename(root, editing.path, target).then(() => refresh())
    }
    setEditing(null)
  }

  const doRemove = (): void => {
    if (confirm === null) return
    const target = confirm
    setConfirm(null)
    void apiRemove(root, target.path).then(() => refresh())
  }

  const rootLevel = data['']
  const rootName = root === '' ? '' : root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const menuTop = menu === null ? 0 : Math.max(4, Math.min(menu.y, window.innerHeight - 300))
  const menuLeft = menu === null ? 0 : Math.max(4, Math.min(menu.x, window.innerWidth - 210))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        padding: '8px 10px',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--ide-muted, #6b7280)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        borderBottom: '1px solid var(--ide-border, #e5e6eb)',
        flexShrink: 0,
      }}>
        {root === '' ? '工作区' : rootName}
      </div>
      {/* 资源管理器式搜索框：输入即过滤（防抖），Esc / × 清空回树。 */}
      {root !== '' && (
        <div style={{
          padding: '6px 8px',
          flexShrink: 0,
          borderBottom: '1px solid var(--ide-border, #e5e6eb)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <input
            value={query}
            placeholder="搜索文件…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              padding: '3px 6px',
              background: 'var(--dsw-alias-bg-base,#ffffff)',
              color: 'inherit',
              border: '1px solid var(--ide-border,#e5e6eb)',
              borderRadius: 3,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          {query !== '' && (
            <button
              type="button"
              title="清除搜索"
              onClick={() => setQuery('')}
              style={{ border: 'none', background: 'transparent', color: 'var(--ide-muted,#6b7280)', cursor: 'pointer', fontSize: 13, padding: '0 4px', fontFamily: 'inherit', lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {root === '' ? (
          <div style={{ padding: 12, color: '#9ca3af', fontSize: 13 }}>请先打开一个工作区会话</div>
        ) : searchState !== null ? (
          <div>
            {searchState.loading && (
              <div style={{ ...rowStyle(0), color: '#9ca3af', cursor: 'default' }}>搜索中…</div>
            )}
            {!searchState.loading && searchState.error !== undefined && (
              <div style={{ ...rowStyle(0), color: '#dc2626', cursor: 'default' }}>⚠ {searchState.error}</div>
            )}
            {!searchState.loading && searchState.error === undefined && searchState.entries.length === 0 && (
              <div style={{ ...rowStyle(0), color: '#9ca3af', fontStyle: 'italic', cursor: 'default' }}>无匹配「{query.trim()}」</div>
            )}
            {searchState.entries.map((entry) => {
              const { dir: parentDir } = splitRel(entry.path)
              return (
                <div
                  key={entry.path}
                  style={rowStyle(0)}
                  onClick={() => { if (entry.isDir) revealDir(entry.path); else onOpenFile(entry.path) }}
                  onContextMenu={(event) => openMenu(event, entry.path, entry.isDir)}
                  {...hoverHandlers()}
                  title={entry.path}
                >
                  <span style={{ width: 14, display: 'inline-block' }} />
                  <FileIcon entry={entry} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}><HighlightedName name={entry.name} query={query} /></span>
                  {parentDir !== '' && (
                    <span style={{ marginLeft: 'auto', paddingLeft: 8, color: '#9ca3af', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>{parentDir}</span>
                  )}
                </div>
              )
            })}
            {!searchState.loading && searchState.error === undefined && searchState.truncated && (
              <div style={{ ...rowStyle(0), color: '#9ca3af', fontStyle: 'italic', cursor: 'default' }}>结果过多，仅显示前 {searchState.entries.length} 条</div>
            )}
          </div>
        ) : (
          <>
            <div
              style={rowStyle(0, { fontWeight: 600 })}
              onClick={() => { /* 根行点击：无操作（VS Code 根不可折叠） */ }}
              onContextMenu={(event) => openMenu(event, '', true)}
              {...hoverHandlers()}
              title={root}
            >
              <span style={{ width: 14, display: 'inline-block', textAlign: 'center', fontSize: 10, marginRight: 2 }}>▾</span>
              <FileIcon entry={{ name: '', path: '', isDir: true, size: 0, mtime: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{rootName}</span>
              {copied === '' && <span style={{ marginLeft: 'auto', color: '#16a34a', fontSize: 11 }}>已复制</span>}
            </div>
            {/* 根目录的新建输入框由 renderChildren 统一渲染（dir='' 时 showingNew 分支），
                这里不再单独渲染，避免与 renderChildren 重复挂载两个 EditRow——
                第二个 focus 触发第一个 onBlur 取消，导致根目录无法新建文件/文件夹。 */}
            {renderChildren({
              dir: '',
              depth: 0,
              data,
              expanded,
              editing,
              copied,
              onToggle: toggle,
              onOpenFile,
              onContextMenu: openMenu,
              onCommitEdit: commitEdit,
              onCancelEdit: () => setEditing(null),
            })}
          </>
        )}
      </div>

      {/* 右键菜单（portal 到 body，避免树容器 overflow 裁剪）。
          皮肤把 --dsw-alias-bg-base 全局透明化，浮层必须自足背景：
          overlay 是皮肤专为浮层准备的近不透明层变量（暗色深蓝 / 亮色近白），
          label-primary 提供对应文字色（暗色浅字，可读性要求）。 */}
      {menu !== null && createPortal(
        <div
          data-ide-tree-menu=""
          style={{
            position: 'fixed',
            left: menuLeft,
            top: menuTop,
            zIndex: 2147483000,
            minWidth: 190,
            padding: '4px 0',
            background: 'var(--dsw-alias-bg-overlay, rgba(248,250,255,0.96))',
            color: 'var(--dsw-alias-label-primary, #1a1a1a)',
            border: '1px solid var(--ide-border,#e5e6eb)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            fontSize: 13,
            fontFamily: 'inherit',
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menuItemsFor(menu).map((item, index) => {
            if (item === 'sep') {
              return <div key={`sep${index}`} style={{ height: 1, margin: '4px 0', background: 'var(--ide-border,#e5e6eb)' }} />
            }
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => runMenuAction(item.id)}
                {...hoverHandlers('var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))')}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '5px 14px',
                  border: 'none',
                  background: 'transparent',
                  color: item.danger === true ? '#dc2626' : 'inherit',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>,
        document.body,
      )}

      {/* 删除确认浮层 */}
      {confirm !== null && createPortal(
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
          onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirm(null) }}
        >
          <div style={{
            background: 'var(--dsw-alias-bg-overlay, rgba(248,250,255,0.96))',
            color: 'var(--dsw-alias-label-primary, #1a1a1a)',
            border: '1px solid var(--ide-border,#e5e6eb)',
            borderRadius: 8,
            padding: 16,
            width: 320,
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>确认删除</div>
            <div style={{ fontSize: 13, color: 'var(--ide-muted,#6b7280)', marginBottom: 14, wordBreak: 'break-all' }}>
              {confirm.name}
              {confirm.isDir ? '（目录，将递归删除）' : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                style={{
                  padding: '4px 14px',
                  border: '1px solid var(--ide-border,#e5e6eb)',
                  borderRadius: 4,
                  background: 'transparent',
                  color: 'inherit',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={doRemove}
                style={{
                  padding: '4px 14px',
                  border: 'none',
                  borderRadius: 4,
                  background: '#dc2626',
                  color: '#ffffff',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
