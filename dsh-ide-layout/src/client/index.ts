/**
 * dsh-ide-layout — browser half: mounts the IDE layout (left file tree +
 * center editor) into the web shell's frame grid through the layout
 * controller, follows the active session's cwd as the project root, and
 * subscribes to the host fs change stream.
 *
 * Failure policy: every DOM/runtime wiring failure is logged, never thrown —
 * the web shell fails the whole boot when a plugin apply throws.
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// 仅类型 import（浏览器纯度门：不 value-import dsh-lsp-core）。
import type { LspCapabilitiesAccessor } from 'dsh-lsp-core/client'
import { IdeLayoutController } from './layout.ts'
import { createStore, IDE_DEFAULT, LAYOUT_DEFAULT, type EditorTab, type IdeState } from './store.ts'
import { mountPanels, type IdeMountApi } from './mount.tsx'
import { apiRead, subscribeChanges } from './api.ts'
import { openFileInTabs } from './components/EditorPane.tsx'
import { mountMessageNav } from './components/MessageNav.tsx'
import { registerToolDiffRow } from './tool-diff-row.tsx'
import { installDeliverableBridge } from './deliverable-bridge.ts'

/** Required services: sessions + workspaces for the project root; slots 用于
 *  edit/write 工具行 shadow 注册（cordis 规矩：ctx 上访问未 inject 声明的服务
 *  会 throw「cannot get property ... without inject」）。 */
export const inject = ['sessions', 'workspaces', 'lspCapabilities', 'slots']

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const ide = createStore<IdeState>(IDE_DEFAULT)
    const layout = createStore(LAYOUT_DEFAULT)
    const controller = new IdeLayoutController(layout, ide)
    const disposers: Array<() => void> = []
    let disposeEvents: (() => void) | undefined
    let disposePanels: (() => void) | undefined
    let currentRoot = ''
    /** fs 变更事件防抖：合并高频事件（如 agent 写会话文件），避免连续刷新。 */
    let treeRefreshTimer: ReturnType<typeof setTimeout> | undefined
    /** 打开 tab 的重读代际：丢弃迟到的旧响应，防旧内容覆盖新内容。 */
    let tabSyncGen = 0
    /** Force the FileTree to re-list (fs changed on disk).
     *  轻量方案：bump treeTick → FileTree 保留展开状态重载数据；
     *  不重挂载 panels（旧方案每次 fs 变更都重建文件树/编辑器/终端 → 闪烁）。
     *  同时 bump gitTick → GitPanel 防抖节流后自动刷新 status（事件驱动，对齐 VS Code）。 */
    const refreshTree = (): void => {
      if (treeRefreshTimer !== undefined) return
      treeRefreshTimer = setTimeout(() => {
        treeRefreshTimer = undefined
        ide.update((prev) => ({ ...prev, treeTick: prev.treeTick + 1, gitTick: prev.gitTick + 1 }))
        syncOpenTabs()
      }, 400)
    }
    /**
     * 打开 tab 的磁盘同步（agent 写盘后编辑器实时更新）：
     * 对打开着的、未 dirty 的文本 tab 并行重读盘，内容有变化才写回 store
     * （contentRevision +1 → CodeMirrorPane 以 Transaction.remote 注入新 doc，
     * 不置 dirty）。dirty tab 不动（绝不覆盖用户编辑中的内容）；文件被删等
     * 读取失败 → 跳过该 tab。generation token 防旧响应乱序覆盖。
     */
    const syncOpenTabs = (): void => {
      const gen = ++tabSyncGen
      const snapshot = ide.getSnapshot()
      const targets = snapshot.tabs.filter((tab) => !tab.dirty && tab.kind !== 'image' && tab.truncated !== true)
      if (targets.length === 0) return
      void Promise.all(
        targets.map(async (tab) => {
          const result = await apiRead(snapshot.root, tab.path, tab.encoding)
          // 内容与打开时一致 → 无需注入（保住光标与撤销栈）。
          if (!result.ok || gen !== tabSyncGen || result.value.content === tab.content) return null
          return { id: tab.id, content: result.value.content, mtime: result.value.mtime }
        }),
      ).then((updates) => {
        const hits = updates.filter((u) => u !== null)
        if (gen !== tabSyncGen || hits.length === 0) return
        ide.update((prev) => ({
          ...prev,
          tabs: prev.tabs.map((tab) => {
            const hit = hits.find((u) => u !== null && u.id === tab.id)
            // 写回时刻再校验 dirty：过滤后用户才开始编辑的场景不覆盖。
            if (hit === null || hit === undefined || tab.dirty) return tab
            return {
              ...tab,
              content: hit.content,
              savedMtime: hit.mtime,
              contentRevision: (tab.contentRevision ?? 0) + 1,
            }
          }),
        }))
      })
    }

    // dsh-lsp-core 服务（阶段 1：Python 走新链路；ts/ps/java 暂走旧 LspClient 双轨）。
    // 经类型模板断言访问 ctx 属性（浏览器纯度门：不 value-import dsh-lsp-core）。
    // 只取 lspCapabilities：语法高亮用本 bundle 内置表（跨 bundle CodeMirror 扩展会
    // 双副本硬崩），lspRegistry 仅供 lspCapabilities 内部查服务器配置。
    const lspCapabilities = (ctx as unknown as LspCapabilitiesAccessor).lspCapabilities

    // 打开文件共用落库：函数式 update，迟到的读取合并进最新 tabs，不覆盖并发
    // 打开的文件（P1-06），并确保编辑区可见。
    const updateTabs = (updater: (prev: { tabs: EditorTab[]; activeTabId: string | null }) => { tabs: EditorTab[]; activeTabId: string | null }): void => {
      ide.update((prev) => {
        const next = updater({ tabs: prev.tabs, activeTabId: prev.activeTabId })
        return { ...prev, tabs: next.tabs, activeTabId: next.activeTabId, editorVisible: true }
      })
    }

    const api: IdeMountApi = {
      ide,
      lspCapabilities,
      openFile: (path: string) => {
        void openFileInTabs(ide.getSnapshot().root, path, updateTabs)
      },
      // 右键「以预览方式打开」：VS Code 式预览 tab（斜体标题），点击 tab /
      // 再点文件树该文件 / 开始编辑 → 固定为正式打开（见 openFileInTabs）。
      openFilePreview: (path: string) => {
        void openFileInTabs(ide.getSnapshot().root, path, updateTabs, { preview: true })
      },
      // 选中代码 → 追加到当前会话的聊天输入框（draft），由用户确认后发送。
      // 参考 better-sidebar appendToDraft：经 ctx.get('conversation') 懒取服务，
      // 失败降级为日志，绝不崩溃。
      askAgent: (text: string, path: string) => {
        try {
          const sessionSnapshot = ctx.sessions.list.getSnapshot()
          const sessionId = sessionSnapshot.current as SessionId | undefined
          if (sessionId === undefined) return
          const actx = ctx.sessions.scope(sessionId)
          if (actx === undefined) return
          const conversation = (ctx as unknown as { get: (key: string) => unknown }).get('conversation') as
            | { input: { for(a: unknown): { state: { getSnapshot(): { draft: string } }; setDraft(t: string): void } } }
            | undefined
          if (conversation === undefined) return
          const input = conversation.input.for(actx)
          const draft = input.state.getSnapshot().draft
          const block = `请分析/修改这段代码（文件：${path}）：\n\n\`\`\`\n${text}\n\`\`\``
          input.setDraft(draft.trim() === '' ? block : `${draft}\n\n${block}`)
        } catch (error) {
          console.error('[dsh-ide-layout] askAgent failed:', error)
        }
      },
    }

    const remountPanels = (): void => {
      disposePanels?.()
      disposePanels = mountPanels(api)
    }

    // The project root follows the active session's cwd, falling back to the
    // most recent (then first) registered workspace so the tree shows files
    // even before any session is opened.
    const bindRoot = (): void => {
      try {
        const sessionSnapshot = ctx.sessions.list.getSnapshot()
        const sessionId = sessionSnapshot.current as SessionId | undefined
        const cwd = sessionId === undefined ? undefined : sessionSnapshot.byId[sessionId]?.cwd
        let root = typeof cwd === 'string' && cwd !== '' ? cwd : ''
        if (root === '') {
          const workspaceSnapshot = ctx.workspaces.list.getSnapshot()
          const recent = workspaceSnapshot.recentWorkspaceId
          const recentView = recent === undefined
            ? undefined
            : workspaceSnapshot.items.find((item) => item.workspaceId === recent)
          const first = workspaceSnapshot.items[0]
          const candidate = recentView?.path ?? first?.path
          root = typeof candidate === 'string' && candidate !== '' ? candidate : ''
        }
        if (root === currentRoot) return
        // P1-05：切换 session/工作区会清空编辑区，dirty tab 先确认，避免静默丢弃。
        const dirtyCount = ide.getSnapshot().tabs.filter((tab) => tab.dirty).length
        if (dirtyCount > 0 && !window.confirm(`切换工作区将关闭编辑区，${dirtyCount} 个文件有未保存的修改，确定继续？`)) {
          return
        }
        currentRoot = root
        // P2-05：切 root 清空诊断缓存（旧工作区 URI 的诊断不再显示）。
        ide.update((prev) => ({ ...prev, root, tabs: [], activeTabId: null, diagnostics: {} }))
        disposeEvents?.()
        disposeEvents = undefined
        if (root !== '') {
          disposeEvents = subscribeChanges(root, refreshTree)
        }
        remountPanels()
      } catch (error) {
        // A failing workspaces/sessions read must never take the layout down.
        console.error('[dsh-ide-layout] bindRoot failed:', error)
      }
    }

    disposers.push(ctx.sessions.list.subscribe(bindRoot))
    const workspacesMaybe = (ctx as unknown as { workspaces?: { list?: { subscribe?: unknown } } }).workspaces
    if (typeof workspacesMaybe === 'object' && workspacesMaybe !== null && typeof workspacesMaybe.list?.subscribe === 'function') {
      disposers.push((workspacesMaybe as { list: { subscribe: (fn: () => void) => () => void } }).list.subscribe(bindRoot))
    }
    bindRoot()

    try {
      controller.mount()
      remountPanels()
    } catch (error) {
      console.error('[dsh-ide-layout] mount failed:', error)
    }

    // 消息导航条（右缘节点条）：独立挂载，失败不影响 IDE 主布局。
    let disposeMessageNav: (() => void) | undefined
    try {
      disposeMessageNav = mountMessageNav(ctx)
    } catch (error) {
      console.error('[dsh-ide-layout] message-nav mount failed:', error)
    }

    // edit/write 工具行增强（+N/-N 统计 + diff 默认直接展开）：shadow 注册到
    // 宿主 keyed 插槽，注册失败只降级回内置行，不影响 IDE 主布局。
    try {
      disposers.push(...registerToolDiffRow(ctx))
    } catch (error) {
      console.error('[dsh-ide-layout] tool-diff-row register failed:', error)
    }

    // 交付卡片「在侧边栏打开/预览」改跳编辑区：window 捕获拦截，root 外或
    // 二进制产物放行默认侧边栏预览。失败只降级，不影响 IDE 主布局。
    try {
      disposers.push(installDeliverableBridge({
        getRoot: () => ide.getSnapshot().root,
        openFile: (relPath: string) => {
          void openFileInTabs(ide.getSnapshot().root, relPath, updateTabs)
        },
      }))
    } catch (error) {
      console.error('[dsh-ide-layout] deliverable-bridge install failed:', error)
    }

    return () => {
      if (treeRefreshTimer !== undefined) clearTimeout(treeRefreshTimer)
      disposeEvents?.()
      disposePanels?.()
      disposeMessageNav?.()
      for (const dispose of disposers) dispose()
      controller.dispose()
    }
  }, 'dsh-ide-layout: wiring')
}
