/**
 * 交付卡片「在侧边栏打开/预览」桥接（方案 A：点击拦截）。
 *
 * 主程序内置 deliverables 插件的交付文件卡片，其「打开」按钮与下拉菜单项的
 * aria-label / 文案形如：
 *   zh:「在侧边栏打开 {path}」/「在侧边栏预览 {path}」
 *   en:「Open {path} in sidebar」/「Preview {path} in sidebar」
 * 点击后走 ctx.sidebarRight.openResource 弹出右侧预览 tab。
 *
 * 本模块在 window 捕获阶段拦截该点击（deliverables 是另一个 bundle，无官方
 * 接缝；手法与 dsh-drop-in 图片接管一致），从文案中提取文件路径，改调
 * openFileInTabs 直接打进本插件的编辑区。
 *
 * 拦截边界（三条都满足才拦截，否则放行给默认侧边栏预览）：
 *  1. 文案能提取出路径；
 *  2. 路径能换算到当前编辑区 root 之内（跨工作区的文件编辑区打不开）；
 *  3. 不是二进制产物（exe/zip 等编辑区只会显示乱码文本 tab）。
 */

/** 二进制产物扩展名（小写）：编辑区打开只会得到乱码文本，保持默认侧边栏行为。 */
const BINARY_SKIP = new Set([
  'exe', 'dll', 'msi', 'bin', 'pdb', 'so', 'dylib', 'class', 'jar', 'wasm',
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso',
])

/**
 * 从「在侧边栏打开/预览 …」类文案中提取文件路径。
 * 纯函数，供点击拦截与单测共用。路径可能含空格，故捕获其余全部文本。
 * @returns 提取出的路径；不是该类文案时返回 null。
 */
export function extractSidebarPreviewPath(label: string): string | null {
  const text = label.trim()
  if (text === '') return null
  // zh:「在侧边栏打开 E:\a\b.md」/「在侧边栏预览 E:\a\b.md」
  const zh = /^在侧边栏(?:打开|预览)\s+(.+)$/.exec(text)
  if (zh !== null) return zh[1]
  // en:「Open E:\a\b.md in sidebar」/「Preview E:\a\b.md in sidebar」
  const en = /^(?:Open|Preview)\s+(.+?)\s+in\s+sidebar$/.exec(text)
  if (en !== null) return en[1]
  return null
}

/**
 * 把卡片上的路径换算为相对编辑区 root 的路径。
 * root 内相对路径原样返回；root 内绝对路径（大小写不敏感，Windows 盘符）
 * 剥掉 root 前缀；root 外返回 null（调用方放行给默认行为）。
 */
export function relativeToRoot(root: string, path: string): string | null {
  const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = normalize(root)
  const p = path.replace(/\\/g, '/')
  if (r === '') return null
  // 本就是相对路径 → 直接可用。
  if (!/^[A-Za-z]:\//.test(p) && !p.startsWith('/')) return p
  const prefix = `${r}/`
  if (`${p.toLowerCase()}/`.startsWith(prefix.toLowerCase())) {
    return p.slice(prefix.length)
  }
  return null
}

/** 是否为编辑区打不开的二进制产物（按扩展名）。导出仅供单测。 */
export function isBinaryArtifact(path: string): boolean {
  const m = /\.([A-Za-z0-9]+)$/.exec(path)
  return m !== null && BINARY_SKIP.has(m[1].toLowerCase())
}

/**
 * 安装交付卡片点击拦截。openFile 收到的是相对 root 的路径。
 * @returns 注销函数（ctx.effect 清理用）。
 */
export function installDeliverableBridge(options: {
  getRoot: () => string
  openFile: (relPath: string) => void
}): () => void {
  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented) return
    const target = event.target
    if (!(target instanceof Element)) return
    // 主按钮是 <button>；下拉菜单项渲染在 portal，用 role 兜底，事件仍冒泡到 window。
    const el = target.closest('button, [role="menuitem"], [role="menuitemradio"]')
    if (el === null) return
    const label = el.getAttribute('aria-label') ?? el.textContent ?? ''
    const path = extractSidebarPreviewPath(label)
    if (path === null) return
    const rel = relativeToRoot(options.getRoot(), path)
    if (rel === null || isBinaryArtifact(rel)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    options.openFile(rel)
  }
  window.addEventListener('click', onClick, { capture: true })
  return () => window.removeEventListener('click', onClick, { capture: true })
}
