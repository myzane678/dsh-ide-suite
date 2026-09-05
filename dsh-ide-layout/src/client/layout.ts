/**
 * DOM layout controller v11: sidebar-embedded file tree + fixed editor
 * workbench + chat squeeze, chat manually resizable.
 *
 * Learned from dsh-better-sidebar (MIT): never rewrite the AppFrame grid.
 *  1. The file tree is injected INTO the shell sidebar, right after the
 *     workspace/session region (regionArea), so "工作区和文件树在同一栏".
 *     v11 injects WITHOUT touching the sidebar's display/flex layout and
 *     gives the tree host a fixed height (clamp) — v9's flex-based embed
 *     collapsed the host to zero height and v10's separate workbench column
 *     made four visual sections instead of three.
 *  2. The editor workbench is a fixed-position portal between the shell
 *     sidebar and the chat column (proven render path since v10).
 *  3. The center (chat) column is squeezed right with margin-left; the vacated
 *     strip hosts the workbench. A chat drag handle resizes the chat; the
 *     workbench absorbs the rest. Sidebar width follows the native drag.
 *
 * Target: [sidebar: workspaces/sessions | tree] [editor] [chat] [details]
 */

import type { IdeState, LayoutState, ListenerStore } from './store.ts'

/** The editor portal host (mount.tsx renders the EditorPane into it). */
let workbenchHost: HTMLDivElement | null = null
/** The sidebar file-tree host (mount.tsx renders the FileTree into it). */
let sidebarTreeHost: HTMLDivElement | null = null

export function getWorkbenchHost(): HTMLDivElement | null {
  return workbenchHost
}

export function getSidebarTreeHost(): HTMLDivElement | null {
  return sidebarTreeHost
}

/** 精确找真正的 sidebar 容器：`[class*="sidebarCol"]` 是 contains 匹配，可能误命中
 *  类名含 "sidebarCol" 的无关元素（踩过坑）。真正的 sidebar 一定包含 footArea
 *  （左下角设置区）和 regionArea（工作区/会话列表）。 */
function findSidebar(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>('[class*="sidebarCol"]')
  for (const el of candidates) {
    if (el.querySelector('[class*="footArea"]') !== null || el.querySelector('[class*="regionArea"]') !== null) {
      return el
    }
  }
  // 兜底：第一个候选
  return candidates[0] ?? null
}

/** Locate the frame grid element (sidebar's parent in the AppFrame grid). */
function findFrame(): HTMLElement | null {
  const sidebar = findSidebar()
  if (sidebar !== null && sidebar.parentElement !== null) return sidebar.parentElement
  return null
}

/** 在给定容器内精确找 sidebar（含 footArea/regionArea 的候选）。 */
function findSidebarIn(container: HTMLElement): HTMLElement | null {
  const candidates = container.querySelectorAll<HTMLElement>('[class*="sidebarCol"]')
  for (const el of candidates) {
    if (el.querySelector('[class*="footArea"]') !== null || el.querySelector('[class*="regionArea"]') !== null) {
      return el
    }
  }
  return candidates[0] ?? null
}

/** WCO（桌面无边框窗口的 Window Controls Overlay）最小类型：本项目 lib.dom
 *  未收录该 API，浏览器/普通网页环境不支持时为 undefined。 */
interface WindowControlsOverlayLike {
  isVisible: boolean
  getTitlebarAreaRect(): DOMRect | null
  addEventListener(type: 'geometrychange', listener: () => void): void
  removeEventListener(type: 'geometrychange', listener: () => void): void
}

/** 安全取 WCO 对象（不支持的环境返回 undefined）。 */
function wco(): WindowControlsOverlayLike | undefined {
  return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay
}

/** 皮肤顶部装饰带（maid-atelier 的蕾丝帘，`data-skin-chrome='top-trim'`，fixed
 *  z-20、pointer-events:none）的下缘：按皮肤设计它浮在主内容之上——编辑器从它
 *  下方开始，标签栏/工具栏才不会被盖住。无皮肤（元素不存在）时返回 0。 */
function skinTopTrimInset(): number {
  const trim = document.querySelector<HTMLElement>('[data-skin-chrome="top-trim"]')
  if (trim === null) return 0
  const rect = trim.getBoundingClientRect()
  if (rect.height <= 0 || rect.bottom <= 0 || rect.bottom >= window.innerHeight) return 0
  return Math.round(rect.bottom)
}

/** 宿主设置面板是否打开：设置触发按钮（sidebar.settings slot）的 aria-expanded
 *  （与皮肤检测设置的信号相同）。设置模态（VOzbGW_overlay，fixed z-1000）挂在
 *  侧边栏子树内而非 body portal，z-1000 被受限层叠上下文困在 body 层编辑器之下
 *  ——打开期间编辑器外壳只能整体让位（display:none，状态保留）。 */
function settingsOpen(): boolean {
  return document.querySelector("[data-slot='sidebar.settings'] [aria-expanded='true']") !== null
}

/** 编辑区/聊天手柄的顶部偏移：原生标题栏下缘与皮肤顶部装饰带下缘取较大值。
 *  原生标题栏（无边框窗口的自绘标题栏行，如「DSH Desktop v2.0.3」）四级探测，
 *  全不中返回 0（= 顶到窗口顶部，浏览器模式原行为）：
 *  ① WCO API（桌面无边框窗口的权威值，皮肤同款测量）；
 *  ② DOM 标题栏元素（i 忽略大小写——CSS 属性选择器区分大小写，驼峰类名
 *     如 titleBar 用小写匹配会落空）；
 *  ③ 探针：在 workbench 顶部取一点，elementsFromPoint 返回被盖住的下层元素
 *     堆栈，跳过 workbench 自身后遇到的第一个条带状元素即原生标题栏（完全不
 *     依赖类名特征；pointer-events:none 的装饰带不参与命中，由 skinTopTrimInset 单独算）；
 *  ④ sidebar 元素顶部兜底（与 workbench 同属 frame 内容行，必然在标题栏下方）。 */
function nativeTopInset(probeX: number): number {
  let inset = 0
  const overlay = wco()
  if (overlay !== undefined && overlay.isVisible) {
    const rect = overlay.getTitlebarAreaRect()
    if (rect !== null && rect.height > 0 && rect.bottom > 0 && rect.bottom < window.innerHeight) {
      inset = Math.round(rect.bottom)
    }
  }
  if (inset === 0) {
    const titlebar = document.querySelector<HTMLElement>('[class*="titlebar" i]')
    if (titlebar !== null) {
      const rect = titlebar.getBoundingClientRect()
      if (rect.height > 0 && rect.bottom > 0 && rect.bottom < window.innerHeight) inset = Math.round(rect.bottom)
    }
  }
  if (inset === 0) {
    for (const el of document.elementsFromPoint(probeX, 6)) {
      if (workbenchHost !== null && (el === workbenchHost || workbenchHost.contains(el))) continue
      if (el.tagName === 'HTML' || el.tagName === 'BODY') continue
      const rect = el.getBoundingClientRect()
      // 条带状：有明显高度（>8px）但远不满屏（≤200px），且位于窗口上半部
      if (rect.height >= 8 && rect.height <= 200 && rect.bottom > 0 && rect.bottom < window.innerHeight / 2) {
        inset = Math.round(rect.bottom)
        break
      }
    }
  }
  // 探测④（读侧栏/中栏顶部兜底）已删除：任何「读带 margin 的宿主列」的探测
  // 都会形成 margin↔inset 正反馈发散（踩过两次）；①WCO ②titlebar DOM ③探针
  // 已足够，全不中时 inset=0（顶到窗顶，浏览器模式的合理回退）。
  return inset
}

const MIN_CHAT_PX = 440
const EDITOR_MIN = 300
/** 分区卡片之间的缝隙（px）：VS Code 式——文件树/编辑区/agent 区互不贴死，
 *  中间留小缝透出底色，配合圆角+描边做卡片分隔感。 */
const CARD_GAP = 6
/** 工作台底色（canvas/气隙垫条/agent 轮廓描边共用一色）：亮暖沙色，与深蓝
 *  侧栏对比最强、与浅色立绘靠色相+宽度区分；呼应皮肤金饰。换主题色改这一处。 */
const CARD_RADIUS = 16
/** 工作台底色（canvas/气隙垫条/agent 轮廓描边共用一色）：中饱和翠绿——
 *  亮度居中、色相与周围的深蓝/白/浅米全部拉开，对比度一眼可辨。
 *  换主题色改这一处。 */
const WORKBENCH_CANVAS_COLOR = '#2e9e5b'

/** The layout controller: embed tree, place workbench, squeeze chat. */
export class IdeLayoutController {
  private frame: HTMLElement | null = null
  private chatHandle: HTMLDivElement | null = null
  /** 立绘镜像窗（z:-1）：画与 body 背景同源的大图（fixed 视口坐标平移进
   *  卡盒），圆角裁切——agent 卡的内圆角由它呈现，立绘像素完全清晰。 */
  private canvasHost: HTMLDivElement | null = null
  /** agent 卡轮廓兼气隙框：外扩 GAP 的粗边框浮层（一体式，替代垫条+补块）。 */
  private chatFrameHost: HTMLDivElement | null = null
  /** 侧栏气隙框：填「窗缘↔侧栏」左缝与「侧栏↔窗底」底缝——chatFrame 只管
   *  侧栏右缘之外的缝，侧栏左/底两向的 margin 缝此前露 body 底色没填绿。 */
  private sidebarFrameHost: HTMLDivElement | null = null

  private sidebarObserver: ResizeObserver | null = null
  private frameObserver: ResizeObserver | null = null
  private detailsObserver: ResizeObserver | null = null
  private footObserver: ResizeObserver | null = null
  private waitObserver: MutationObserver | null = null
  private titlebarObserver: ResizeObserver | null = null
  private titlebarObserved: HTMLElement | null = null
  private wcoGeometryHandler: (() => void) | null = null
  private settingsObserver: MutationObserver | null = null
  private settingsObserved: Element | null = null
  private sidebarInjected = false
  /** 侧栏右缘的绝对 x（原为宽度；侧栏卡片化带 margin 后改测右缘防错位）。 */
  private sidebarWidth = 280
  private frameWidth = 0
  private detailsWidth = 0
  private disposers: Array<() => void> = []

  constructor(
    private readonly layout: ListenerStore<LayoutState>,
    private readonly ide: ListenerStore<IdeState>,
  ) {}

  mount(): void {
    const tryAttach = (): void => {
      if (this.frame === null) {
        const frame = findFrame()
        if (frame === null) return
        this.frame = frame
        this.frameWidth = frame.getBoundingClientRect().width
        this.frameObserver = new ResizeObserver(() => {
          if (this.frame !== null) this.frameWidth = this.frame.getBoundingClientRect().width
          this.apply()
        })
        this.frameObserver.observe(frame)
        this.embedWorkbench()
        this.bindDetails()
      }
      // Retry the sidebar tree embed until the sidebar column renders.
      if (!this.sidebarInjected) {
        const sidebar = this.frame !== null ? findSidebarIn(this.frame) : findSidebar()
        if (sidebar !== null) this.embedSidebarTree(sidebar)
      }
      this.bindTitlebar()
      this.bindSettingsTrigger()
      this.apply()
    }
    this.waitObserver = new MutationObserver(() => { tryAttach() })
    this.waitObserver.observe(document.body, { childList: true, subtree: true })
    tryAttach()
  }

  /** 跟踪原生标题栏高度变化（窗口控制区叠加 geometrychange / 皮肤调整都会改它
   *  的高度）：高度变化 → apply() 重测 topInset。标题栏元素被宿主重建时重新绑定。 */
  private bindTitlebar(): void {
    if (this.titlebarObserver === null) {
      this.titlebarObserver = new ResizeObserver(() => this.apply())
    }
    const titlebar = document.querySelector<HTMLElement>('[class*="titlebar" i]')
    if (titlebar === null || titlebar === this.titlebarObserved) return
    if (this.titlebarObserved !== null) this.titlebarObserver.unobserve(this.titlebarObserved)
    this.titlebarObserver.observe(titlebar)
    this.titlebarObserved = titlebar
  }

  /** 跟踪设置触发按钮的 aria-expanded（设置面板开/关）：变化 → apply() 让位/恢复。
   *  按钮被宿主重建时自动重绑。选择器与皮肤检测设置的信号一致。 */
  private bindSettingsTrigger(): void {
    if (this.settingsObserver === null) {
      this.settingsObserver = new MutationObserver(() => this.apply())
    }
    const trigger = document.querySelector("[data-slot='sidebar.settings'] > :is(button, [role='button'])")
    if (trigger === null || trigger === this.settingsObserved) return
    if (this.settingsObserved !== null) this.settingsObserver.disconnect()
    this.settingsObserver.observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] })
    this.settingsObserved = trigger
  }

  /** Create the fixed editor workbench portal host + chat handle. */
  private embedWorkbench(): void {
    if (workbenchHost !== null) return
    const host = document.createElement('div')
    host.dataset.ideWorkbench = ''
    // z-index:10 = 主内容层（高于主栏内容 auto / 皮肤低层装饰 1~2，低于宿主
    // overlayLayer 的 z-20——设置页等宿主浮动内容渲染在那层，编辑器必须让位，
    // 否则同层 20 且 DOM 靠后会盖住设置页）。
    // 卡片化（VS Code 式分区）：圆角 + 细描边 + 极淡阴影；border-box 让
    // apply() 设置的 width 含边框；top/bottom 由 apply() 设置——卡片四周
    // （左右上下）都让出 CARD_GAP 缝隙，悬浮在页面之上。
    host.style.cssText = 'position:fixed;z-index:10;display:flex;flex-direction:row;overflow:hidden;'
      + 'background:var(--dsw-alias-bg-base,#ffffff);'
      + 'box-sizing:border-box;border-radius:' + CARD_RADIUS + 'px;'
      + 'border:1px solid var(--ide-border,#e5e6eb);'
      + 'box-shadow:0 1px 6px rgba(0,0,0,0.06);'
    document.body.appendChild(host)
    workbenchHost = host

    // 立绘镜像窗（治本终版）：body 的大图/立绘画在**窗口背景**上（任何层都
    // 裁不到它）——agent 卡若透明，立绘必以直角透出。镜像窗 = 一个与 agent 卡
    // 同尺寸同位置的圆角层，**画与 body 背景同源同参的大图**（视口坐标平移进
    // 卡盒，像素级对齐）——agent 卡内的立绘以圆角呈现、像素清晰；卡外区域由
    // 各卡与绿色气隙覆盖。背景图从 body computed style 现场读（自动跟随主题
    // 亮暗切换），零跨包依赖。几何每次 apply 同步。
    const canvas = document.createElement('div')
    canvas.dataset.ideCanvas = ''
    canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:-1;display:none;overflow:hidden;'
      + 'border-radius:' + CARD_RADIUS + 'px;'
    document.body.appendChild(canvas)
    this.canvasHost = canvas

    // agent 区气隙框（窗缘锚定版）：一个 **border = GAP 的实心边框盒**，盒的
    // 右/下缘**直接锚定窗口边缘**——不依赖 centerCol 的右/下位置（margin-right/
    // bottom 在宿主布局下无效、其右/底贴窗缘，任何以外扩/outline 依赖它的方案
    // 都会把填充推出窗外，踩过多轮）。border 带从 agent 卡左/上缘外一直铺到
    // 窗缘：顶、左、右、底四向气隙全部被边框带无条件覆盖；圆角连续（外缘 =
    // 卡圆角 + GAP）。z:9 压过皮肤背景层；pointer-events 全透；四角月牙由
    // corner 补块（radial-gradient，z:10）负责。几何每次 apply 实时同步。
    // 右/下缘**直接锚定窗口边缘**（window.innerWidth/innerHeight——绝对可靠，
    // 不依赖 centerCol 的右/下位置——margin-right/bottom 在宿主布局下无效，
    // agent 卡右/底贴窗缘时 outline/外扩算术全部失效（踩过多轮））。border
    // 带从 agent 卡左/上缘外侧一直铺到窗缘：右缝、底缝被无条件填满；左/顶边
    // 贴 agent 卡左/上缘，与 canvas/seam 衔接。圆角连续（外缘 = 卡圆角+GAP）。
    // z:9 压过皮肤背景层；pointer-events 全透；几何每次 apply 实时同步。
    const frame = document.createElement('div')
    frame.dataset.ideChatFrame = ''
    // 方角（不加 border-radius）：卡片自身圆角（内部裁切呈现），气隙**方角铺满**
    // ——与左侧 canvas 的填充模式一致，四角直角无死角（圆弧补块方案已废弃）。
    // 边框是**唯一的气隙填充机制**（z9、important——皮肤全局透明规则压不到它，
    // 已验证显示）：左缝由 border-left-width 动态加宽覆盖（apply 里实测设置）。
    frame.style.cssText = 'position:fixed;z-index:9;pointer-events:none;display:none;box-sizing:border-box;'
    frame.style.setProperty('border-style', 'solid', 'important')
    frame.style.setProperty('border-color', WORKBENCH_CANVAS_COLOR, 'important')
    document.body.appendChild(frame)
    this.chatFrameHost = frame

    // 侧栏气隙框：与 chatFrame 同构的方角 border 带，z8（低于 chatFrame z9，
    // 两者在侧栏右缘处相邻衔接，互不重叠）。左带填「窗缘↔侧栏左缘」竖缝、
    // 底带填「侧栏底缘↔窗底」横缝，宽度全部 apply 实测；顶部不出带——侧栏
    // margin-top 是禁区（皮肤测侧栏顶边写 --maid-titlebar-height，动了飘带
    // 坠），顶部气隙维持「borderTop 透明露底」现状。不用 box-shadow：spread
    // 阴影全向、顶带会画进标题栏区，且会覆盖皮肤侧栏的三重 shadow（金线）。
    const sidebarFrame = document.createElement('div')
    sidebarFrame.dataset.ideSidebarFrame = ''
    sidebarFrame.style.cssText = 'position:fixed;z-index:8;pointer-events:none;display:none;box-sizing:border-box;'
    sidebarFrame.style.setProperty('border-style', 'solid', 'important')
    sidebarFrame.style.setProperty('border-color', WORKBENCH_CANVAS_COLOR, 'important')
    // 四角反圆角补块（治侧栏自身四角的月牙）：侧栏背景沿 16px 盒弧裁切、角部
    // 弧外露 body 底色。在 z8 垫层的 content 区四角铺 radial-gradient：弧内
    // 透明（透侧栏深蓝）、弧外填绿；**四角半径统一 R=16**（背景已是 border-box
    // 统一圆角——旧版顶部 10px 会咬掉深蓝弧一圈，都督验收发现后修正）；渐变
    // 末色标外延使弧外全绿。与 border 重叠区被后画的 border 绿覆盖，无缝痕；
    // important 反制皮肤全局透明规则。
    const cornerGradient = (center: string): string =>
      `radial-gradient(${CARD_RADIUS}px at ${center}, transparent ${CARD_RADIUS - 1}px, ${WORKBENCH_CANVAS_COLOR} ${CARD_RADIUS}px)`
    sidebarFrame.style.setProperty('background-image', [
      cornerGradient('100% 100%'),
      cornerGradient('0% 100%'),
      cornerGradient('100% 0%'),
      cornerGradient('0% 0%'),
    ].join(', '), 'important')
    sidebarFrame.style.setProperty('background-position', 'left top, right top, left bottom, right bottom', 'important')
    sidebarFrame.style.setProperty('background-size', `${CARD_RADIUS}px ${CARD_RADIUS}px`, 'important')
    sidebarFrame.style.setProperty('background-repeat', 'no-repeat', 'important')
    document.body.appendChild(sidebarFrame)
    this.sidebarFrameHost = sidebarFrame


    // Track the sidebar's RIGHT EDGE (absolute x) to place the workbench portal.
    // 侧栏整列卡片化后有 margin-left 悬浮，「元素宽度」不再等于「左缘到右缘的
    // 绝对位置」——统一改用右缘 rect.right，下游 left/width 算术自动对齐。
    this.sidebarObserver = new ResizeObserver(() => {
      const sidebar = this.frame !== null ? findSidebarIn(this.frame) : findSidebar()
      if (sidebar !== null) this.sidebarWidth = sidebar.getBoundingClientRect().right
      this.apply()
    })
    const sidebar = this.frame !== null ? findSidebarIn(this.frame) : findSidebar()
    if (sidebar !== null) this.sidebarObserver.observe(sidebar)

    this.chatHandle = this.createChatHandle()
    // WCO（桌面无边框窗口）标题栏几何变化 → 重测 fixed 元素的 top 偏移。
    const overlay = wco()
    if (overlay !== undefined && this.wcoGeometryHandler === null) {
      this.wcoGeometryHandler = () => this.apply()
      overlay.addEventListener('geometrychange', this.wcoGeometryHandler)
    }
    this.disposers.push(this.layout.subscribe(() => this.apply()))
    // 编辑区显隐（editorVisible）变化时同步布局
    this.disposers.push(this.ide.subscribe(() => this.apply()))
  }

  /** Track the details column (affects the width budget). */
  private bindDetails(): void {
    this.detailsObserver = new ResizeObserver(() => {
      const details = this.frame?.querySelector<HTMLElement>('[class*="detailsCol"]') ?? null
      this.detailsWidth = details === null ? 0 : details.getBoundingClientRect().width
      this.apply()
    })
    const details = this.frame?.querySelector<HTMLElement>('[class*="detailsCol"]') ?? null
    this.detailsWidth = details === null ? 0 : details.getBoundingClientRect().width
    if (details !== null) this.detailsObserver.observe(details)
  }

  /** 文件树高度（px），可拖拽调整，持久化到 localStorage。 */
  private treeHeight = 0
  /** 被加了 paddingBottom 的滚动元素 + 其原始值（dispose 时恢复）。 */
  private paddedScrollEl: HTMLElement | null = null
  private paddedScrollOriginal = ''
  /** sidebar 自身与 root 容器的 padding 记录（dispose 恢复）。 */
  private sidebarPadEl: HTMLElement | null = null
  private sidebarPadOriginal = ''
  /** 列表滚动容器（强制设置高度，dispose 恢复）。 */
  private listEl: HTMLElement | undefined
  private listOriginalHeight = ''
  private listOriginalMaxHeight = ''

  /**
   * Inject the sidebar file-tree host into the sidebar's flex flow.
   * v16（终版方案）：不再 absolute 覆盖。root（hHd-Xa_root）是 flex column 容器
   * （logoRow → newSession → regionArea(flex:1) → footArea），把文件树作为
   * **flex 子元素**插入 regionArea 之后、footArea 之前：
   *   - regionArea（flex:1）自动收缩到文件树上方 → 列表永不与文件树重叠
   *   - footArea（设置按钮）保持在底部不动
   *   - 不碰任何 padding / 不依赖滚动元素定位，任何 shell 结构都成立
   * 之前 v12~v15.6 的 absolute+padding 方案全部作废（列表被中间层推走/设置被顶起）。
   */
  private embedSidebarTree(sidebar: HTMLElement): void {
    const rootEl = sidebar.querySelector<HTMLElement>('[class*="root"]')
    if (rootEl === null) {
      // root 延迟渲染：不置 injected，让外层 MutationObserver 重试
      return
    }
    this.sidebarInjected = true
    const host = document.createElement('div')
    host.dataset.ideSidebarTree = ''
    // 卡片化（VS Code 式分区）：整圈细描边 + 圆角，四周 4px 离侧栏邻居
    // （上：会话列表；下：设置按钮；左右：侧栏边缘），悬浮卡片观感。
    host.style.cssText = 'flex:none;height:clamp(200px, 46vh, 720px);'
      + 'overflow:hidden;display:flex;flex-direction:column;'
      + 'background:var(--dsw-alias-bg-base,#ffffff);min-height:120px;'
      + 'margin:4px;border-radius:' + CARD_RADIUS + 'px;'
      + 'border:1px solid var(--ide-border,#e5e6eb);'
      + 'box-shadow:0 1px 6px rgba(0,0,0,0.06);'
    // 插入 regionArea 之后、footArea 之前
    const regionEl = rootEl.querySelector<HTMLElement>('[class*="regionArea"]')
    const footEl = rootEl.querySelector<HTMLElement>('[class*="footArea"]')
    if (regionEl !== null && regionEl.nextSibling !== null) {
      rootEl.insertBefore(host, regionEl.nextSibling)
    } else if (footEl !== null) {
      rootEl.insertBefore(host, footEl)
    } else {
      rootEl.appendChild(host)
    }
    sidebarTreeHost = host

    // 文件树高度：默认 clamp(200px,46vh,720px)，可从顶部手柄拖拽（min 120 / max 85vh）
    this.treeHeight = this.loadTreeHeight()
    if (this.treeHeight > 0) {
      host.style.height = `${this.treeHeight}px`
    }
    const handle = document.createElement('div')
    handle.dataset.ideTreeHandle = ''
    handle.style.cssText = 'position:absolute;top:-4px;left:0;right:0;height:8px;cursor:row-resize;z-index:6;'
      + 'background:transparent;'
    handle.title = '拖拽调整文件树高度'
    handle.addEventListener('mouseenter', () => { handle.style.background = 'rgba(127,127,127,0.35)' })
    handle.addEventListener('mouseleave', () => { handle.style.background = 'transparent' })
    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = host.getBoundingClientRect().height
      const maxH = window.innerHeight * 0.85
      const onMove = (moveEvent: PointerEvent): void => {
        const next = Math.max(120, Math.min(startHeight + (startY - moveEvent.clientY), maxH))
        host.style.height = `${next}px`
        this.saveTreeHeight(next)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    })
    host.appendChild(handle)
    // 文件树容器需要 position:relative 才能定位手柄
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  }

  /** 文件树高度持久化：localStorage（会话级布局偏好）。 */
  private loadTreeHeight(): number {
    try {
      const raw = localStorage.getItem('dsh-ide-tree-height')
      const value = raw === null ? 0 : Number.parseInt(raw, 10)
      return Number.isFinite(value) && value > 0 ? value : 0
    } catch {
      return 0
    }
  }

  private saveTreeHeight(px: number): void {
    try {
      localStorage.setItem('dsh-ide-tree-height', String(Math.round(px)))
    } catch {
      // localStorage 不可用时忽略
    }
  }

  private applyRegionBottom: () => void = () => {}

  private createChatHandle(): HTMLDivElement {
    const el = document.createElement('div')
    el.className = 'ide-chat-handle'
    // 挂在 body 上（fixed），不放在 workbench 内——workbench 有 overflow:hidden，
    // 手柄压在右边界会被裁剪一半，只剩 4px 命中区导致拖不动。
    // z-index 与 workbench 同层（10，主内容层）：宿主浮层（设置页，z-20）打开时
    // 手柄在其下不抢点击；与 workbench 同 z 靠 DOM 顺序保持在其上方可拖拽。
    el.style.cssText = 'position:fixed;top:0;bottom:0;z-index:10;cursor:col-resize;width:8px;margin-left:-4px;'
      + 'background:transparent;'
    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(127,127,127,0.35)' })
    el.addEventListener('mouseleave', () => { el.style.background = 'transparent' })
    el.addEventListener('pointerdown', (event: PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = this.layout.getSnapshot().chatWidth
      const onMove = (moveEvent: PointerEvent): void => {
        // 手柄左移（clientX 减小）= 聊天区左边界左移 = 聊天区变宽，所以取反
        const width = Math.max(MIN_CHAT_PX, startWidth + (startX - moveEvent.clientX))
        this.layout.update((prev) => ({ ...prev, chatWidth: width }))
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    })
    document.body.appendChild(el)
    return el
  }

  /** Squeeze the chat column and place the workbench portal + chat handle.
   *  中栏按需显隐：编辑区（editorVisible）与终端面板（termVisible）都关闭时
   *  回到原生两栏（工作区 sidebar | agent chat）；任一打开即显示中栏——
   *  终端独立于编辑区（不开编辑区也能开终端，VS Code 底部面板行为）。 */
  private apply(): void {
    // 皮肤装饰带（顶部飘带 + 底部饰带）**整体隐藏**：
    // top-trim：纯装饰（蕾丝布纹，无任何功能内容），却占据标题栏与 agent 卡
    // 之间的整个顶部条带——会话头部半透明地叠在它上面，导致顶部永远无法做
    // 成干净的「标题栏 → 气隙 → agent 卡」三段式（装饰卡叠内容卡的怪异观感）。
    // 隐藏后：所有以飘带为参照的尺寸自动回落（skinTopTrimInset 有 rect 保护
    // 返回 0），卸载时完整恢复。
    // bottom-trim：窗底 60px 金线饰带（z19，从侧栏右缘铺到窗右）——**仅在欢
    // 迎页停驻**（会话激活时皮肤把它 translateY(100%) 滑出窗外，此前历次验收
    // 因此从未见过它），欢迎页却盖住 chatFrame 底带（z9）、绿环底段与卡底缘
    // 圆角，agent 区下方气隙消失。同为纯装饰（pointer-events:none + aria-hidden
    // 花边贴图），与 top-trim 同款理由隐藏；隐藏后欢迎页底部呈现「卡底缘 +
    // 绿气隙 + 窗底」三段式，会话页无感。皮肤自身的平移逻辑保留不动。
    for (const selector of ['[data-skin-chrome="top-trim"]', '[data-skin-chrome="bottom-trim"]']) {
      const trim = document.querySelector<HTMLElement>(selector)
      if (trim !== null && trim.style.display !== 'none') trim.style.display = 'none'
    }
    const state = this.layout.getSnapshot()
    const ideSnapshot = this.ide.getSnapshot()
    const panelVisible = ideSnapshot.editorVisible || ideSnapshot.termVisible
    const frameW = this.frameWidth > 0 ? this.frameWidth : window.innerWidth
    const total = Math.max(0, frameW - this.sidebarWidth - this.detailsWidth)

    // Workbench = total - chat; chat clamps so the workbench keeps its floor.
    const maxChat = Math.max(MIN_CHAT_PX, total - EDITOR_MIN)
    const chat = Math.min(Math.max(MIN_CHAT_PX, state.chatWidth), maxChat)
    const work = panelVisible ? Math.max(EDITOR_MIN, total - chat) : 0

    const centerCol = this.frame?.querySelector<HTMLElement>('[class*="centerCol"]') ?? null
    if (centerCol !== null) {
      // 中栏左缘：中栏打开时贴编辑区卡片右缘；原生两栏（编辑区+终端都关）时
      // 让出 CARD_GAP，形成 文件树卡片 ↔ agent 区 之间的缝隙。
      // **对 agent 区只敢动这些 margin**：它是原生半透明列（皮肤立绘透出），
      // 内部布局对盒模型干预极敏感（早期头部消失的真凶是飘带层级 + 探测循环，
      // 均已根治；皮肤运行时只测量**侧栏**顶边，不读 agent 区，margin 安全）。
      // 右/下 4px = agent 卡与窗口边缘的气隙；上气隙（依赖 nativeInset）在
      // 下方统一设置。
      centerCol.style.marginLeft = panelVisible ? `${work}px` : `${CARD_GAP}px`
      centerCol.style.minWidth = panelVisible ? '0' : ''
      centerCol.style.marginRight = `${CARD_GAP}px`
      centerCol.style.marginBottom = `${CARD_GAP}px`
      centerCol.style.borderRadius = CARD_RADIUS + 'px'
      centerCol.style.overflow = 'hidden'
      // 显式宽高（治本）：宿主布局对 centerCol 的宽高是显式接管式的——
      // margin-left/top（推位置）生效，但 margin-right/bottom（需收缩宽高）
      // 无效 → agent 卡右/底贴死窗缘，右侧和底部根本没有气隙（outline 画在
      // 窗外被裁）。宽高的**精确公式在下方 nativeInset 之后统一设置**
      // （只用「实测 rect + 窗口尺寸」两个可靠量，零间接测量）。
      // 裁切窗口外扩 GAP、圆角 R+GAP：盒内等效弧 = 22−6 = 16px，与原来
      // inset(0 round 16) 逐点一致（内容圆角裁切不变），但放行了画在盒外
      // GAP 的绿环——clip-path 裁掉元素全部绘制输出（含自身 box-shadow），
      // inset(0) 时绿环整个落在裁切区外被裁没（本场踩过：四角月牙依旧露底）。
      centerCol.style.clipPath = `inset(-${CARD_GAP}px round ${CARD_RADIUS + CARD_GAP}px)`
      // agent 卡实体面（**圆角的载体**）：透明卡呈现不出圆角——面必须近乎不
      // 透明，圆角裁切才有可见形状。97% 浅色近实底、无 blur（不糊）；立绘被
      // 卡面覆盖（圆角卡的必然代价），嫌闷调低 alpha 即可。
      // **必须以 important 写入**：皮肤样式表对中栏背景有强制透明规则（立绘
      // 透出的前提），普通内联会被 !important 压制（踩过：底色画不上、圆角
      // 无从呈现）——内联 !important 优先级高于样式表 !important。
      centerCol.style.setProperty('background-color', 'rgba(248, 249, 252, 0.18)', 'important')
      // 四角月牙补绿（终版）：方角 border 带（chatFrame）只覆盖卡矩形**外**，
      // 卡面被 clipPath round 裁成圆角——「矩形内、圆角弧外」的四块月牙无主，
      // 透出 body 宫殿浅色。扩散阴影沿圆角盒外扩 GAP：内缘自动贴合卡弧（月牙
      // 一次填满）、外缘自动 CARD_RADIUS+GAP 圆角绿环，与 border 带同色无痕，
      // 顺带把卡圆角轮廓衬出来。important 写入防皮肤透明规则，dispose 还原。
      centerCol.style.setProperty('box-shadow', `0 0 0 ${CARD_GAP}px ${WORKBENCH_CANVAS_COLOR}`, 'important')
    }
    // 会话头部文字染深（治「看不清」）：皮肤把头部文字染米白 #f8f3e8 + 深色
    // text-shadow，前提是深蓝飘带（navy band）在背后衬托（皮肤 CSS 注释自述
    // 「The trim backs the conversation header」）——本场飘带整体隐藏后衬底
    // 消失，米白字叠在白纱洗浅的卡面上对比崩。内联染深即无需 important（皮肤
    // 这些规则未带 important，内联天然覆盖）；只染 header 本身、靠皮肤的
    // color:inherit 链传导，按钮不单独设色 → 皮肤 hover 金色效果保留。
    // querySelector 取文档序第一个匹配（会话头部在卡顶，工具卡的同名片段
    // 类在其后，不会误中）。
    const chatHeader = centerCol !== null
      ? centerCol.querySelector<HTMLElement>('header[class*="header"]')
      : null
    if (chatHeader !== null) {
      chatHeader.style.color = '#1f2c55'
      chatHeader.style.textShadow = 'none'
      // 次级读数（计数/说明/meta）被皮肤独立规则钉了浅蓝灰（不吃 inherit），逐个内联压回。
      for (const el of chatHeader.querySelectorAll<HTMLElement>('[class*="counter"], [class*="caption"], [class*="meta"]')) {
        el.style.color = '#5b6b96'
      }
    }
    // fixed 元素从原生标题栏下方开始（无标题栏 → 0，原行为）。探针 x 取
    // workbench 内左侧一点（编辑区最少 300px 宽，+40 必在 workbench 范围内）。
    // 两个顶部参照拆开：nativeInset = 原生标题栏下缘（fixed 层的安全顶界）；
    // topInset = 再与皮肤飘带下缘取大（卡片顶界）。缝隙底色层用 nativeInset——
    // 缝从标题栏下就开始存在（飘带 z-1 垫底后那段竖缝无内容遮挡），若从飘带
    // 下缘才开始铺，最上一段会露出透图底（踩过）。
    const nativeInset = nativeTopInset(this.sidebarWidth + 40)
    const topInset = Math.max(nativeInset, skinTopTrimInset())
    // 设置面板打开期间整个编辑器外壳让位（display:none，DOM/状态保留，关面板
    // 后恢复）——设置模态困在侧边栏的受限层叠上下文里，z-index 无解，唯有不渲染。
    const settings = settingsOpen()
    const shown = panelVisible && !settings
    if (workbenchHost !== null) {
      // 卡片不贴邻区：左右（文件树/侧栏 ↔ 编辑区 ↔ agent 区）、上下（标题栏/
      // 皮肤装饰带 ↔ 编辑区 ↔ 窗口底）四周各让出 CARD_GAP，透出缝隙底色层。
      workbenchHost.style.top = `${topInset + CARD_GAP}px`
      workbenchHost.style.bottom = `${CARD_GAP}px`
      workbenchHost.style.left = `${this.sidebarWidth + CARD_GAP}px`
      workbenchHost.style.width = `${Math.max(0, work - CARD_GAP * 2)}px`
      workbenchHost.style.pointerEvents = shown && work > 0 ? 'auto' : 'none'
      workbenchHost.style.display = shown ? 'flex' : 'none'
    }
    if (this.chatHandle !== null) {
      // 手柄挂在 body（fixed），用视口绝对坐标：居中于 编辑区 ↔ agent 区 的缝隙
      this.chatHandle.style.top = `${topInset}px`
      this.chatHandle.style.left = `${this.sidebarWidth + work - CARD_GAP}px`
      this.chatHandle.style.display = shown ? 'block' : 'none'
    }
    if (this.canvasHost !== null) {
      // 立绘镜像窗：几何 = centerCol 实际盒子；背景 = 与 body 同源同参的大图
      // （image 从 body computed style 现场读，size = 视口、position = 负偏移
      // 把视口坐标平移进卡盒）→ 与 body 背景像素级对齐；圆角由 border-radius
      // + overflow 裁切 → agent 卡内立绘以圆角清晰呈现。settings 打开时让位。
      const chatRect = centerCol?.getBoundingClientRect()
      if (chatRect !== undefined && chatRect.width > 0 && chatRect.height > 0) {
        this.canvasHost.style.display = 'block'
        this.canvasHost.style.left = `${chatRect.left}px`
        this.canvasHost.style.top = `${chatRect.top}px`
        this.canvasHost.style.width = `${Math.ceil(chatRect.width)}px`
        this.canvasHost.style.height = `${Math.ceil(chatRect.height)}px`
        const bodyStyle = getComputedStyle(document.body)
        this.canvasHost.style.setProperty('background-image', bodyStyle.backgroundImage, 'important')
        this.canvasHost.style.setProperty('background-size', `${window.innerWidth}px ${window.innerHeight}px`, 'important')
        this.canvasHost.style.setProperty('background-position', `${-chatRect.left}px ${-chatRect.top}px`, 'important')
        this.canvasHost.style.setProperty('background-repeat', 'no-repeat', 'important')
        this.canvasHost.style.setProperty('border-radius', CARD_RADIUS + 'px', 'important')
      } else {
        this.canvasHost.style.display = 'none'
      }
    }
    if (this.chatFrameHost !== null) {
      // agent 区气隙框（窗缘锚定）：盒 = [侧栏右缘, 窗右] × [卡顶-GAP, 窗底]，
      // border 带内缘精确贴合 agent 卡可见区（左/顶）、外缘直达窗缘（右/底）——
      // **四向气隙全部由这一条边框带填充**（z9+important，皮肤透明规则压不到，
      // 已验证显示）。左缝宽度 = agent 左缘到侧栏右缘的实测差值（动态，把两缘
      // 间夹着的宿主间隔一并覆盖）；右/底 = 窗缘实测差值 + GAP。agent 区不存
      // 在时整体隐藏。
      const chatRect = centerCol?.getBoundingClientRect()
      if (chatRect !== undefined && chatRect.width > 0 && chatRect.height > 0) {
        this.chatFrameHost.style.display = 'block'
        this.chatFrameHost.style.left = `${this.sidebarWidth}px`
        this.chatFrameHost.style.top = `${chatRect.top - CARD_GAP}px`
        this.chatFrameHost.style.width = `${Math.ceil(window.innerWidth - this.sidebarWidth)}px`
        this.chatFrameHost.style.height = `${Math.ceil(window.innerHeight - chatRect.top + CARD_GAP)}px`
        // 四边宽度全部 = **实测差值、零预设补偿**：border 带内缘精确贴合
        // agent 卡可见区（左/顶 = 卡缘，右/底 = 窗缘减去卡的外伸）、外缘直达
        // 窗缘/侧栏缘——每条带覆盖的气隙 = 它的实际宽度（上一版右/底多加
        // GAP 造成双重补偿、卡与带之间漏出 6px 空隙，踩过）。
        const gapTop = CARD_GAP
        const gapRight = Math.max(CARD_GAP, Math.ceil(window.innerWidth - chatRect.right))
        const gapBottom = Math.max(CARD_GAP, Math.ceil(window.innerHeight - chatRect.bottom))
        // 左带宽 = 实测差值：带内缘精确落在卡左缘（与绿环内缘、镜像窗对齐）。
        // 旧的 +4px 重叠保险已撤：直角绿条伸进卡内会切掉卡的左右圆角弧一小
        // 条，且它防的「侧栏装饰框未知偏移」场景现在由卡四周的 box-shadow
        // 绿环兜底（缝多宽带就多宽，覆盖性不受损）。
        const gapLeft = Math.max(CARD_GAP, Math.ceil(chatRect.left - this.sidebarWidth))
        this.chatFrameHost.style.setProperty('border-width', `${gapTop}px ${gapRight}px ${gapBottom}px ${gapLeft}px`, 'important')
      } else {
        this.chatFrameHost.style.display = 'none'
        this.chatFrameHost.style.setProperty('border-width', '0', 'important')
      }
      // 立绘舞台裁切（治本终版）：character-stage 是铺满全窗的 fixed 立绘层，
      // 挂在 agent 卡**之外**——卡片的圆角/雾面/裁切对它全部无效（多轮「四角
      // 直角/向里的圆」的总根因）。直接对舞台施加动态 clip-path：立绘只在
      // agent 卡的圆角矩形内显示（几何裁切、像素完全清晰），卡外区域被各卡
      // 与气隙覆盖、无损失。幂等设置；卸载时移除还原。
      const stage = document.querySelector<HTMLElement>('[data-skin-chrome="character-stage"]')
      if (stage !== null && chatRect !== undefined && chatRect.width > 0) {
        stage.style.clipPath = `inset(${chatRect.top}px ${window.innerWidth - chatRect.right}px ${window.innerHeight - chatRect.bottom}px ${chatRect.left}px round ${CARD_RADIUS}px)`
      }
    }
    // 侧栏整列卡片化：圆角 + 内容裁切 + 左/下悬浮 margin（4px）+ **顶部气隙**。
    // **margin-top 是绝对禁区**：maid-atelier 皮肤运行时会测量侧栏渲染顶边写入
    // --maid-titlebar-height，飘带 top 直接用它——侧栏 margin-top 一动，飘带跟
    // 着坠、全局连锁崩坏（踩过）。
    // 顶部气隙 = **6px 绿色顶边**：盒子位置一毫米不变（皮肤测量/飘带/设置弹窗
    // 全无感）。**不设 background-clip（保持默认 border-box）**——padding-box
    // 会把顶部背景圆角压成 R−GAP=10px，深蓝面板「上角 10px、下角 16px」圆角
    // 不一致（都督验收发现）；border-box 后背景四角统一 16px，顶部 6px 由后画
    // 的 border 绿覆盖，气隙仍是绿色。
    const sidebarEl = this.frame !== null ? findSidebarIn(this.frame) : findSidebar()
    if (sidebarEl !== null) {
      sidebarEl.style.borderRadius = CARD_RADIUS + 'px'
      sidebarEl.style.overflow = 'hidden'
      sidebarEl.style.borderTop = `${CARD_GAP}px solid ${WORKBENCH_CANVAS_COLOR}`
      sidebarEl.style.marginLeft = `${CARD_GAP}px`
      sidebarEl.style.marginBottom = `${CARD_GAP}px`
    }
    if (this.sidebarFrameHost !== null) {
      // 侧栏气隙框几何：盒 = [0, 侧栏右缘] × [侧栏顶, 窗底]（方角），左带 =
      // 实测 margin-left 缝宽、底带 = 实测 margin-bottom 缝宽；顶/右不出带
      // （顶部气隙维持现状，右侧缝由 chatFrame 的 border-left 衔接）。带只
      // 画在侧栏盒外的缝区（content 区透明），不遮侧栏内容与皮肤金线投影。
      const sidebarRect = sidebarEl !== null ? sidebarEl.getBoundingClientRect() : null
      if (sidebarRect !== null && sidebarRect.width > 0 && sidebarRect.height > 0) {
        this.sidebarFrameHost.style.display = 'block'
        this.sidebarFrameHost.style.left = '0px'
        this.sidebarFrameHost.style.top = `${sidebarRect.top}px`
        this.sidebarFrameHost.style.width = `${Math.ceil(sidebarRect.right)}px`
        this.sidebarFrameHost.style.height = `${Math.ceil(window.innerHeight - sidebarRect.top)}px`
        const sideGapLeft = Math.max(CARD_GAP, Math.ceil(sidebarRect.left))
        const sideGapBottom = Math.max(CARD_GAP, Math.ceil(window.innerHeight - sidebarRect.bottom))
        this.sidebarFrameHost.style.setProperty('border-width', `0px 0px ${sideGapBottom}px ${sideGapLeft}px`, 'important')
      } else {
        this.sidebarFrameHost.style.display = 'none'
        this.sidebarFrameHost.style.setProperty('border-width', '0', 'important')
      }
    }
    // agent 卡顶部气隙：**只留气隙本身的宽度**。centerCol 是 grid 内元素，其
    // 自然起点已在标题栏下方（~40px，与侧栏同排）——margin 若再叠加 nativeInset
    // 会双重补偿，气隙膨胀到 ~60px（踩过）。
    // 显式宽高（治本终版）：**只用两个最可靠的量**——实测 rect.left/top（margin
    // 左/上生效，多轮验证稳定）+ 窗口尺寸——零间接测量（total/sidebarWidth 的
    // 测量偏差曾让右缝差 ~10px，踩过）。width/height 显式接管后：
    // 右缘 = 窗右 - GAP、底缘 = 窗底 - GAP，右/底气隙真实存在。
    if (centerCol !== null) {
      centerCol.style.marginTop = `${CARD_GAP}px`
      const rect = centerCol.getBoundingClientRect()
      centerCol.style.width = `${Math.max(0, window.innerWidth - rect.left - CARD_GAP)}px`
      centerCol.style.height = `${Math.max(0, window.innerHeight - rect.top - CARD_GAP)}px`
    }
    // 布局应用完成信号：供悬浮元素（如 TermFab 跟随 Session log）等外部监听
    // 者做几何重测——事件驱动，避免轮询。
    window.dispatchEvent(new CustomEvent('dsh-ide-layout-applied'))
  }

  /** Detach everything (plugin unload). */
  dispose(): void {
    this.waitObserver?.disconnect()
    this.sidebarObserver?.disconnect()
    this.frameObserver?.disconnect()
    this.detailsObserver?.disconnect()
    this.footObserver?.disconnect()
    this.titlebarObserver?.disconnect()
    this.titlebarObserved = null
    this.settingsObserver?.disconnect()
    this.settingsObserved = null
    if (this.wcoGeometryHandler !== null) {
      wco()?.removeEventListener('geometrychange', this.wcoGeometryHandler)
      this.wcoGeometryHandler = null
    }
    for (const dispose of this.disposers) dispose()
    // 恢复被压低的皮肤飘带层级（apply 里写了内联 z-index:-1）。
    document.querySelector<HTMLElement>('[data-skin-chrome="top-trim"]')?.style.removeProperty('z-index')
    // 卸载时恢复被隐藏/内联整饰的皮肤元素（顶部飘带、底部饰带、立绘舞台）。
    for (const prop of ['display', 'z-index', 'left', 'right', 'top', 'border-radius', 'clip-path']) {
      document.querySelector<HTMLElement>('[data-skin-chrome="top-trim"]')?.style.removeProperty(prop)
      document.querySelector<HTMLElement>('[data-skin-chrome="bottom-trim"]')?.style.removeProperty(prop)
      document.querySelector<HTMLElement>('[data-skin-chrome="character-stage"]')?.style.removeProperty(prop)
    }
    // 恢复被改过 padding-bottom 的元素（sidebar 自身 + root 容器）
    const restorePadding = (el: HTMLElement | null, original: string): void => {
      if (el === null) return
      if (original !== '') el.style.paddingBottom = original
      else el.style.removeProperty('padding-bottom')
    }
    restorePadding(this.paddedScrollEl, this.paddedScrollOriginal)
    restorePadding(this.sidebarPadEl, this.sidebarPadOriginal)
    // 恢复列表容器的原始高度
    if (this.listEl !== undefined) {
      if (this.listOriginalHeight !== '') this.listEl.style.height = this.listOriginalHeight
      else this.listEl.style.removeProperty('height')
      if (this.listOriginalMaxHeight !== '') this.listEl.style.maxHeight = this.listOriginalMaxHeight
      else this.listEl.style.removeProperty('max-height')
    }
    this.paddedScrollEl = null
    this.paddedScrollOriginal = ''
    this.sidebarPadEl = null
    this.sidebarPadOriginal = ''
    this.listEl = undefined
    this.listOriginalHeight = ''
    this.listOriginalMaxHeight = ''
    this.chatHandle?.remove()
    this.canvasHost?.remove()
    this.canvasHost = null
    this.chatFrameHost?.remove()
    this.chatFrameHost = null
    this.sidebarFrameHost?.remove()
    this.sidebarFrameHost = null

    const centerCol = this.frame?.querySelector<HTMLElement>('[class*="centerCol"]') ?? null
    // apply() 写入宿主中栏的内联样式，卸载时恢复。
    for (const prop of ['margin-left', 'min-width', 'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'border-radius', 'overflow', 'clip-path', 'background-color', 'box-shadow', 'backdrop-filter']) {
      centerCol?.style.removeProperty(prop)
    }
    // 会话头部染深的内联样式，卸载时恢复（皮肤米白文字/阴影回到原样）。
    const chatHeader = centerCol !== null ? centerCol.querySelector<HTMLElement>('header[class*="header"]') : null
    if (chatHeader !== null) {
      chatHeader.style.removeProperty('color')
      chatHeader.style.removeProperty('text-shadow')
      for (const el of chatHeader.querySelectorAll<HTMLElement>('[class*="counter"], [class*="caption"], [class*="meta"]')) {
        el.style.removeProperty('color')
      }
    }
    // 侧栏整列卡片化写入的样式，卸载时恢复。
    const sidebarEl = this.frame !== null ? findSidebarIn(this.frame) : findSidebar()
    for (const prop of ['border-radius', 'overflow', 'border-top', 'background-clip', 'margin-left', 'margin-bottom']) {
      sidebarEl?.style.removeProperty(prop)
    }
    if (workbenchHost !== null) {
      workbenchHost.remove()
      workbenchHost = null
    }
    if (sidebarTreeHost !== null) {
      sidebarTreeHost.remove()
      sidebarTreeHost = null
    }
    this.frame = null
    this.sidebarInjected = false
  }
}
