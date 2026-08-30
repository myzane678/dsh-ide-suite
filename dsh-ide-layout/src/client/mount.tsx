/** DOM mounting: FileTree into the sidebar host, EditorPane into the workbench.
 *  v11: the file tree renders inside the shell sidebar (below the workspace
 *  region) so sidebar and tree form one left column; the workbench portal
 *  hosts only the editor. */

import { useEffect, useRef, useState, createElement, type JSX, type CSSProperties } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { LspCapabilityService } from 'dsh-lsp-core/client'
import type { IdeState, ListenerStore } from './store.ts'
import { FileTree } from './components/FileTree.tsx'
import { EditorPane } from './components/EditorPane.tsx'
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

/** The editor pane (workbench). */
function Workbench({ api }: { api: IdeMountApi }): JSX.Element {
  const [, force] = useState(0)
  useEffect(() => api.ide.subscribe(() => force((n) => n + 1)), [api.ide])
  const state = api.ide.getSnapshot()
  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', height: '100%' }}>
        <EditorPane
          root={state.root}
          tabs={state.tabs}
          activeTabId={state.activeTabId}
          lspCapabilities={api.lspCapabilities}
          onActivate={(id) => api.ide.update((prev) => ({ ...prev, activeTabId: id }))}
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
          onContentChange={(id, content) => api.ide.update((prev) => ({
            ...prev,
            tabs: prev.tabs.map((tab) => tab.id === id ? { ...tab, content, dirty: true } : tab),
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
