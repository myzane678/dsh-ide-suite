/** DOM mounting: FileTree into the sidebar host, EditorPane into the workbench.
 *  v11: the file tree renders inside the shell sidebar (below the workspace
 *  region) so sidebar and tree form one left column; the workbench portal
 *  hosts only the editor. */

import { useEffect, useRef, useState, createElement, type JSX, type CSSProperties } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createPortal } from 'react-dom'
import type { LspCapabilityService } from 'dsh-lsp-core/client'
import type { IdeState, ListenerStore } from './store.ts'
import { FileTree } from './components/FileTree.tsx'
import { EditorPane, beginDragResize, resizeHandleStyle, Icons } from './components/EditorPane.tsx'
import { TerminalPane } from './components/TerminalPane.tsx'
import { GitPanel } from './components/GitPanel.tsx'
import { ProblemsPanel } from './components/ProblemsPanel.tsx'
import { BuildOutputDialog } from './components/BuildOutputDialog.tsx'
import { apiBuild, apiGitRepos, apiGitStatus } from './api.ts'
import type { BuildResult, BuildTaskName } from './api.ts'

const WORKBENCH_SELECTOR = '[data-ide-workbench]'
const SIDEBAR_TREE_SELECTOR = '[data-ide-sidebar-tree]'

/** 暗色主题下的高亮变量默认组（VS Code Dark+ 官方色值）。亮色默认值内嵌在
 *  EditorPane 高亮样式的 var() 回退里；暗色没有独立样式表，挂载时注入一次。
 *  选择器与皮肤（maid-atelier）同形：皮肤覆盖的 10 个变量与本组 Dark+ 值一致，
 *  先后顺序不影响结果；皮肤未覆盖的变量（base/heading/regexp 等暗色值）由本组
 *  兜底——否则会掉回亮色回退值（深灰运算符压深背景，对比度差）。静态样式
 *  不随 unmount 移除（幂等注入，重挂载零成本）。 */
let darkHighlightStyleInjected = false
function injectDarkHighlightStyle(): void {
  if (darkHighlightStyleInjected) return
  darkHighlightStyleInjected = true
  const style = document.createElement('style')
  style.id = 'dsh-ide-layout-vscode-dark'
  style.textContent = [
    'body[data-ds-dark-theme] [data-ide-workbench]{',
    '--ide-hl-keyword:#569cd6;--ide-hl-control:#c586c0;--ide-hl-comment:#6a9955;',
    '--ide-hl-string:#ce9178;--ide-hl-regexp:#d16969;--ide-hl-escape:#d7ba7d;',
    '--ide-hl-number:#b5cea8;--ide-hl-bool:#569cd6;--ide-hl-function:#dcdcaa;',
    '--ide-hl-class:#4ec9b0;--ide-hl-property:#9cdcfe;--ide-hl-variable:#9cdcfe;',
    '--ide-hl-base:#d4d4d4;--ide-hl-heading:#569cd6;--ide-hl-strong:#569cd6;',
    '--ide-hl-tag:#569cd6;--ide-hl-attribute:#9cdcfe;--ide-hl-raw:#ce9178;--ide-hl-list:#6796e6;',
    '}',
  ].join('')
  document.head.appendChild(style)
}

/**
 * 统计工作区未提交变更总数（Git 按钮角标）：
 * root 本身是仓库 → 直接用 status；否则汇总所有发现的嵌套仓库（多仓库工作区
 * 如 E:\dsh-plugins 下各插件仓库），任一仓库有改动角标都能反映。失败返回 0。
 */
async function countGitChanges(root: string): Promise<number> {
  const statusResult = await apiGitStatus(root)
  if (statusResult.ok && statusResult.value.isRepo) return statusResult.value.entries.length
  const reposResult = await apiGitRepos(root)
  if (!reposResult.ok) return 0
  const counts = await Promise.all(reposResult.value.map(async (repo) => {
    const result = await apiGitStatus(repo.path)
    return result.ok && result.value.isRepo ? result.value.entries.length : 0
  }))
  return counts.reduce((total, count) => total + count, 0)
}

/**
 * Wait for one selector (the shell/frame mounts after boot settlement), then
 * keep watching: if the matched host element is later removed (DSH shell
 * rebuilds its DOM), wait again and re-invoke onFound so the panels remount
 * (P2-02: survives host DOM replacement instead of mounting once and dying).
 */
function waitForElement(selector: string, onFound: (el: HTMLElement) => void): () => void {
  let disposed = false
  let observer: MutationObserver | undefined
  let currentEl: HTMLElement | null = null
  const tryFind = (): void => {
    if (disposed || currentEl !== null) return
    const el = document.querySelector<HTMLElement>(selector)
    if (el !== null) {
      currentEl = el
      onFound(el)
    }
  }
  observer = new MutationObserver(() => {
    // 宿主重建：已挂载元素被移除 → 重置等待并重新挂载。
    if (currentEl !== null && !currentEl.isConnected) {
      currentEl = null
      tryFind()
      return
    }
    tryFind()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  tryFind()
  return () => {
    disposed = true
    currentEl = null
    observer?.disconnect()
  }
}

export interface IdeMountApi {
  ide: ListenerStore<IdeState>
  openFile: (path: string, line?: number) => void
  /** 右键「以预览方式打开」：VS Code 式预览 tab，点击 tab / 再点文件 / 编辑即固定。 */
  openFilePreview: (path: string) => void
  /** 把选中代码追加到聊天输入框（发送给内置 agent）。 */
  askAgent: (text: string, path: string) => void
  /** dsh-lsp-core 能力工厂（阶段 1：Python 新链路；未安装时为 undefined）。 */
  lspCapabilities?: LspCapabilityService
}

/** 构建输出对话框状态（见 SidebarTree）。 */
interface BuildDialogState {
  title: string
  phase: 'running' | 'done'
  result?: BuildResult
  error?: string
  needMain?: boolean
  candidates?: string[]
}

/** The sidebar file tree: follows the ide root (workspace/session).
 *  v13: 顶部「文件 | Git」视图切换；Git 面板复用同一块区域。
 *  v15: 加「问题」视图（LSP 诊断聚合）。
 *  v17: 改为文件树常驻主视图 + 右上角小图标切换 Git/问题（方案 B，大确定）：
 *  左侧标题显示当前视图名，点标题或激活图标回到文件树；问题图标带诊断计数角标。 */
function SidebarTree({ api }: { api: IdeMountApi }): JSX.Element {
  const [, force] = useState(0)
  useEffect(() => api.ide.subscribe(() => force((n) => n + 1)), [api.ide])
  const state = api.ide.getSnapshot()
  const [view, setView] = useState<'files' | 'git' | 'problems'>('files')
  const [build, setBuild] = useState<BuildDialogState | null>(null)
  /** 发起构建时的工作区根：响应回来若已切换工作区则丢弃（防串对话框）。 */
  const buildRootRef = useRef('')
  // 诊断计数角标：聚合所有打开文件的 LSP 诊断（错误+警告）。
  const problemCount = Object.values(state.diagnostics).reduce((total, list) => total + list.length, 0)
  // Git 未提交变更计数角标：fs 事件（gitTick）驱动，防抖后统计（任何视图下常驻，
  // 不依赖 Git 面板挂载）。600ms 防抖对齐文件树刷新节奏，避免保存风暴打爆 git status。
  const [gitCount, setGitCount] = useState(0)
  const gitCountTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 计数归属的工作区根：切换 root 后旧响应丢弃，防串角标。 */
  const gitCountRootRef = useRef('')
  useEffect(() => {
    if (state.root === '') return
    if (gitCountTimer.current !== undefined) clearTimeout(gitCountTimer.current)
    const root = state.root
    gitCountRootRef.current = root
    gitCountTimer.current = setTimeout(() => {
      gitCountTimer.current = undefined
      void countGitChanges(root).then((count) => {
        if (gitCountRootRef.current === root) setGitCount(count)
      })
    }, 600)
  }, [state.root, state.gitTick])
  useEffect(() => () => {
    if (gitCountTimer.current !== undefined) clearTimeout(gitCountTimer.current)
  }, [])
  const viewTitle = view === 'files' ? '资源管理器' : view === 'git' ? '源代码管理' : '问题'
  const toggle = (key: 'git' | 'problems'): void => setView((prev) => (prev === key ? 'files' : key))
  /** 带文字的紧凑切换按钮：比纯图标明显，又不回到三个等宽 tab。 */
  const viewButton = (active: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 3, height: 22, padding: '0 7px',
    border: `1px solid ${active ? 'var(--ide-accent,#4f8cff)' : 'var(--ide-border,#e5e6eb)'}`,
    background: active ? 'var(--ide-hover, rgba(127,127,127,0.12))' : 'transparent',
    color: active ? 'inherit' : 'var(--ide-muted,#6b7280)',
    borderRadius: 4, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
    whiteSpace: 'nowrap', position: 'relative',
  })
  /** 发起构建/测试/运行；Maven 多主类时响应切到「选择主类」态。 */
  const startBuild = (task: BuildTaskName): void => {
    const title = task === 'compile' ? '🔨 构建项目' : task === 'test' ? '🔨 测试项目' : '▶ 运行项目'
    buildRootRef.current = state.root
    setBuild({ title, phase: 'running' })
    void apiBuild(state.root, task).then((result) => {
      if (api.ide.getSnapshot().root !== buildRootRef.current) {
        setBuild(null)
        return
      }
      if (result.ok) {
        const value = result.value
        setBuild('needMain' in value
          ? { title, phase: 'done', needMain: true, candidates: value.candidates }
          : { title, phase: 'done', result: value })
      } else {
        setBuild({ title, phase: 'done', error: result.error.message })
      }
    })
  }

  /** 多主类选择后带 mainClass 重新发起运行。 */
  const pickMain = (mainClass: string): void => {
    if (build === null) return
    const title = build.title
    buildRootRef.current = state.root
    setBuild({ title, phase: 'running' })
    void apiBuild(state.root, 'run', mainClass).then((result) => {
      if (api.ide.getSnapshot().root !== buildRootRef.current) {
        setBuild(null)
        return
      }
      if (result.ok) {
        const value = result.value
        setBuild('needMain' in value
          ? { title, phase: 'done', needMain: true, candidates: value.candidates }
          : { title, phase: 'done', result: value })
      } else {
        setBuild({ title, phase: 'done', error: result.error.message })
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 标题行：当前视图名 + Git/问题 切换按钮 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', flexShrink: 0,
        borderBottom: '1px solid var(--ide-border,#e5e6eb)',
        background: 'var(--ide-tabbar, rgba(127,127,127,0.06))',
      }}>
        <span
          title="回到文件树"
          onClick={() => setView('files')}
          style={{
            flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            color: 'var(--ide-muted,#6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {viewTitle}
        </span>
        <button
          type="button"
          onClick={() => toggle('problems')}
          title={problemCount > 0 ? `问题面板（${problemCount} 项诊断）` : '问题面板'}
          style={viewButton(view === 'problems')}
        >
          ⚠️ 问题
          {problemCount > 0 && (
            <span style={{
              minWidth: 14, height: 14, padding: '0 3px',
              background: '#dc2626', color: '#fff', fontSize: 9, lineHeight: '14px', textAlign: 'center',
              borderRadius: 8, boxSizing: 'border-box',
            }}>
              {problemCount > 99 ? '99+' : problemCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => toggle('git')}
          title={gitCount > 0 ? `Git 面板（${gitCount} 个未提交变更）` : 'Git 面板'}
          style={viewButton(view === 'git')}
        >
          🛠 Git
          {gitCount > 0 && (
            <span style={{
              minWidth: 14, height: 14, padding: '0 3px',
              background: '#4f8cff', color: '#fff', fontSize: 9, lineHeight: '14px', textAlign: 'center',
              borderRadius: 8, boxSizing: 'border-box',
            }}>
              {gitCount > 99 ? '99+' : gitCount}
            </span>
          )}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {view === 'files' && (
          <FileTree
            root={state.root}
            treeTick={state.treeTick}
            onOpenFile={api.openFile}
            onOpenFilePreview={api.openFilePreview}
            onBuildProject={() => startBuild('compile')}
            onRunProject={() => startBuild('run')}
          />
        )}
        {view === 'git' && <GitPanel root={state.root} gitTick={state.gitTick} />}
        {view === 'problems' && (
          <ProblemsPanel root={state.root} diagnostics={state.diagnostics} onOpenFile={api.openFile} />
        )}
      </div>
      {build !== null && (
        <BuildOutputDialog
          title={build.title}
          phase={build.phase}
          result={build.result}
          error={build.error}
          needMain={build.needMain}
          candidates={build.candidates}
          onClose={() => setBuild(null)}
          onPickMain={pickMain}
        />
      )}
    </div>
  )
}

/** TermFab 探测不到 Session log 时的写死回退位（贴头部按钮行左侧）。 */
const TERM_FAB_FALLBACK = { top: 98, right: 178 }

/** 右上角悬浮终端按钮：编辑区与终端**都关闭**时才显示——此时 workbench 整体
 *  隐藏（原生两栏），tab 栏里的终端图标不可用，入口必须浮在布局之外才常驻。
 *  portal 到 body（fixed，不挤压布局，半透明 hover 加深）；编辑区打开或终端
 *  已开时自动隐藏（tab 栏图标 / 面板自带 ✕ 接管，避免重复入口）。
 *  位置动态对齐 Session log（写死 top/right 的教训：飘带隐藏后头部整体上移，
 *  写死值错位不再并排）——探测头部按钮行里文本含 Session log 的按钮，垂直
 *  居中于它、贴其左侧 12px；每次渲染（ide store 变化）+ 窗口 resize 时重测，
 *  找不到按钮回退写死位。 */
function TermFab({ api }: { api: IdeMountApi }): JSX.Element | null {
  const [, force] = useState(0)
  useEffect(() => api.ide.subscribe(() => force((n) => n + 1)), [api.ide])
  const state = api.ide.getSnapshot()
  const [pos, setPos] = useState(TERM_FAB_FALLBACK)
  useEffect(() => {
    // 跟随 Session log（**事件驱动，不轮询**）：位置变化的已知信号全接住——
    // ① 窗口 resize；② 布局插件 apply 完成（侧栏拖动/面板开合/装饰带处理，
    //    layout.ts 派发 dsh-ide-layout-applied）；③ DOM 变化（头部出现/重建/类
    //    切换；聊天流式更新也会触发观察，但探测幂等 + rAF 节流 + setPos 浅比
    //    较，无位置变化零渲染）；④ 字体加载完成。rAF 把同帧多次信号合并成一
    //    次探测。
    const probe = (): void => {
      let target: HTMLElement | null = null
      for (const button of document.querySelectorAll<HTMLElement>("header[class*='header'] :is(button, [role='button'], a)")) {
        if (/session\s*log/i.test(button.textContent ?? '')) { target = button; break }
      }
      if (target === null) { setPos(TERM_FAB_FALLBACK); return }
      const rect = target.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) { setPos(TERM_FAB_FALLBACK); return }
      const next = {
        top: Math.round(rect.top + rect.height / 2 - 16),
        right: Math.round(window.innerWidth - rect.left + 12),
      }
      setPos((prev) => (prev.top === next.top && prev.right === next.right ? prev : next))
    }
    let raf = 0
    const schedule = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => { raf = 0; probe() })
    }
    schedule()
    window.addEventListener('resize', schedule)
    window.addEventListener('dsh-ide-layout-applied', schedule)
    void document.fonts.ready.then(schedule)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    const header = document.querySelector("header[class*='header']")
    if (header !== null) observer.observe(header, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('dsh-ide-layout-applied', schedule)
      observer.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [])
  if (state.editorVisible || state.termVisible) return null
  return createPortal(
    <button
      type="button"
      title="打开终端"
      onClick={() => api.ide.update((prev) => ({ ...prev, termVisible: true }))}
      onMouseEnter={(event) => {
        const el = event.currentTarget as HTMLElement
        el.style.background = '#2a3a6e'
        el.style.borderColor = 'rgba(238, 210, 153, 0.9)'
      }}
      onMouseLeave={(event) => {
        const el = event.currentTarget as HTMLElement
        el.style.background = '#1f2c55'
        el.style.borderColor = 'rgba(225, 191, 124, 0.55)'
      }}
      style={{
        // 位置动态对齐 Session log（见组件注释）；回退位仅探测不到时使用。
        // 配色：深藏蓝实心 + 米白图标 + 金调描边（呼应皮肤深蓝金饰）——
        // 旧版 14% 透明灰底在浅色背景上几乎隐形（都督反馈「图标不明显」）。
        position: 'fixed', top: pos.top, right: pos.right, zIndex: 11,
        width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, border: '1px solid rgba(225, 191, 124, 0.55)', borderRadius: 8,
        background: '#1f2c55', color: '#f8f3e8',
        cursor: 'pointer', fontFamily: 'inherit',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    >
      {Icons.terminal}
    </button>,
    document.body,
  )
}

/** The editor pane (workbench) + independent terminal panel.
 *  终端面板独立于编辑区（editorVisible || termVisible 任一为真即显示，
 *  显隐由 layout.ts 联动）：不开编辑区也能开终端（VS Code 底部面板行为）。 */
function Workbench({ api }: { api: IdeMountApi }): JSX.Element {
  const [, force] = useState(0)
  useEffect(() => api.ide.subscribe(() => force((n) => n + 1)), [api.ide])
  const state = api.ide.getSnapshot()
  // 终端面板高度（px），顶部手柄可拖拽调整；「立即 fit」触发器：手柄松手时 +1，
  // TerminalPane 跳过防抖立即 fit+resize。
  const [termHeight, setTermHeight] = useState(240)
  const [termFitTick, setTermFitTick] = useState(0)
  const toggleTerm = (): void => api.ide.update((prev) => ({ ...prev, termVisible: !prev.termVisible }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {state.editorVisible && (
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', minHeight: 0 }}>
          <EditorPane
            root={state.root}
            tabs={state.tabs}
            activeTabId={state.activeTabId}
            lspCapabilities={api.lspCapabilities}
            termVisible={state.termVisible}
            onToggleTerm={toggleTerm}
            // 预览切换（编辑区顶部眼睛图标）：true = 只读预览（tab 斜体），
            // false = 源码编辑。preview: undefined 保持字段缺省形态。
            onSetPreview={(id, preview) => api.ide.update((prev) => ({
              ...prev,
              tabs: prev.tabs.map((tab) => tab.id === id ? { ...tab, preview: preview ? true : undefined } : tab),
            }))}
          // 点击 tab 激活；目标是预览 tab 时顺带固定为正式打开（点击一下 = 换成源文件格式打开）。
          onActivate={(id) => api.ide.update((prev) => ({
            ...prev,
            activeTabId: id,
            tabs: prev.tabs.map((tab) => tab.id === id && tab.preview === true ? { ...tab, preview: undefined } : tab),
          }))}
          onClose={(id) => api.ide.update((prev) => {
            const closing = prev.tabs.find((tab) => tab.id === id)
            // P1-05：dirty tab 关闭前确认，防止未保存内容静默丢弃。
            if (closing?.dirty === true && !window.confirm(`「${closing.title}」有未保存的修改，确定放弃并关闭？`)) {
              return prev
            }
            const index = prev.tabs.findIndex((tab) => tab.id === id)
            const nextTabs = prev.tabs.filter((tab) => tab.id !== id)
            // P2-01：先算 nextTabs，再按被关闭 tab 的旧索引选右侧仍存在的 tab，
            // 否则选左侧；避免指向已移除的 tab（旧逻辑取倒数第二项会再拿到 B）。
            let nextActive = prev.activeTabId
            if (prev.activeTabId === id) {
              nextActive = nextTabs[index]?.id ?? nextTabs[index - 1]?.id ?? null
            }
            // P2-05：文件关闭时清理其诊断（按文件路径匹配 file:// URI 后缀）。
            let diagnostics = prev.diagnostics
            if (closing !== undefined) {
              const needle = closing.path.replaceAll('\\', '/')
              const stale = Object.keys(diagnostics).filter((uri) => {
                const decoded = decodeURIComponent(uri).replace(/^file:\/\//, '').replace(/^\//, '').replaceAll('\\', '/')
                return decoded === needle || decoded.endsWith(`/${needle}`)
              })
              if (stale.length > 0) {
                diagnostics = { ...diagnostics }
                for (const key of stale) delete diagnostics[key]
              }
            }
            return { ...prev, tabs: nextTabs, activeTabId: nextActive, diagnostics }
          })}
          // 开始编辑即固定（VS Code 行为）：预览态下不会出现 dirty tab，
          // 也就永远不会被后续预览打开的单例替换误删。
          onContentChange={(id, content) => api.ide.update((prev) => ({
            ...prev,
            tabs: prev.tabs.map((tab) => tab.id === id ? { ...tab, content, dirty: true, preview: undefined } : tab),
          }))}
          onDirtySave={(tab) => api.ide.update((prev) => ({
            ...prev,
            tabs: prev.tabs.map((item) => item.id === tab.id ? { ...tab, dirty: false } : item),
          }))}
          onCloseEditor={() => api.ide.update((prev) => {
            // P1-05：整个编辑区含 dirty tab 时先确认。
            const dirty = prev.tabs.filter((tab) => tab.dirty)
            if (dirty.length > 0 && !window.confirm(`${dirty.length} 个文件有未保存的修改，确定放弃并关闭编辑区？`)) {
              return prev
            }
            return {
              ...prev,
              editorVisible: false,
              tabs: [],
              activeTabId: null,
            }
          })}
          onAskAgent={api.askAgent}
          onOpenFile={(path, line) => api.openFile(path, line)}
          onDiagnostics={(uri, diagnostics) => api.ide.update((prev) => ({
            ...prev,
            diagnostics: { ...prev.diagnostics, [uri]: diagnostics },
          }))}
          onReloadTab={(tab) => api.ide.update((prev) => ({
            ...prev,
            tabs: prev.tabs.map((item) => item.id === tab.id ? tab : item),
          }))}
          />
        </div>
      )}
      {/* 独立终端面板：编辑区开着 = 底部固定高度（手柄可拖）；编辑区关着 = 占满整栏 */}
      {state.termVisible && (
        <div style={{
          ...(state.editorVisible ? { height: termHeight, flexShrink: 0 } : { flex: 1, minHeight: 0 }),
          position: 'relative',
          borderTop: '1px solid var(--ide-border,#e5e6eb)',
          background: 'var(--dsw-alias-bg-base,#ffffff)',
        }}>
          {/* 拖拽手柄：上拉=终端变高，下拉=变矮（clamp 120px ~ 视口 70%）；
              拖拽中直改 DOM（无 React 重渲染 → 不抖），松手同步状态并触发立即 fit */}
          <div
            onPointerDown={(event) => beginDragResize(event, 120, window.innerHeight * 0.7, (px) => setTermHeight(px), () => setTermFitTick((t) => t + 1))}
            title="拖拽调整终端高度"
            style={resizeHandleStyle()}
            onMouseEnter={(event) => { (event.currentTarget as HTMLElement).style.background = 'rgba(127,127,127,0.35)' }}
            onMouseLeave={(event) => { (event.currentTarget as HTMLElement).style.background = 'transparent' }}
          />
          <TerminalPane root={state.root} fitTick={termFitTick} />
          <button
            type="button"
            onClick={toggleTerm}
            title="关闭终端"
            style={{
              position: 'absolute', top: 2, right: 6, zIndex: 5,
              width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, border: 'none', borderRadius: 4, cursor: 'pointer',
              background: 'transparent', color: '#9ca3af', fontFamily: 'inherit',
            }}
            onMouseEnter={(event) => {
              const el = event.currentTarget as HTMLElement
              el.style.background = 'rgba(127,127,127,0.16)'
              el.style.color = 'inherit'
            }}
            onMouseLeave={(event) => {
              const el = event.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.color = '#9ca3af'
            }}
          >
            {Icons.close}
          </button>
        </div>
      )}
      <TermFab api={api} />
    </div>
  )
}

/**
 * Mount both roots.
 * @returns a disposer unmounting both trees.
 */
export function mountPanels(api: IdeMountApi): () => void {
  injectDarkHighlightStyle()
  let sidebarRoot: Root | undefined
  let workbenchRoot: Root | undefined
  const disposers: Array<() => void> = []

  disposers.push(waitForElement(SIDEBAR_TREE_SELECTOR, (el) => {
    // P2-02：宿主重建（旧元素被移除、新元素出现）时先卸载旧 root 再挂载。
    sidebarRoot?.unmount()
    sidebarRoot = createRoot(el)
    sidebarRoot.render(createElement(SidebarTree, { api }))
  }))

  disposers.push(waitForElement(WORKBENCH_SELECTOR, (el) => {
    workbenchRoot?.unmount()
    workbenchRoot = createRoot(el)
    workbenchRoot.render(createElement(Workbench, { api }))
  }))

  return () => {
    for (const dispose of disposers) dispose()
    sidebarRoot?.unmount()
    workbenchRoot?.unmount()
  }
}
