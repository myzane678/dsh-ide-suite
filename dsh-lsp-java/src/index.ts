/**
 * dsh-lsp-java host half：向 ctx.lspServerRegistry 注册本机 JDTLS。
 * 插件不把数百 MB 的 JDTLS 放进 npm 包——discover 复用本机已安装的
 * Red Hat VS Code Java 扩展（或 DSH_JAVA_LS_HOME）；commandFor 按 root 构造
 * 完整命令（-data 目录依赖 root，per-workspace 隔离）。未找到时 discover
 * 返回 null → 桥 close 1011 → 编辑器降级纯高亮。
 * （发现逻辑自 dsh-ide-layout lsp-service.ts 的 findJavaLauncher 迁移。）
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { getLspServerRegistry } from 'dsh-lsp-core'
import type { LspServerConfig } from 'dsh-lsp-core'

/** 一次发现的产物：java 可执行 + launcher jar + configuration 目录。 */
interface JavaServer { java: string; launcherJar: string; config: string }

/** Java 可执行文件：DSH_JAVA_HOME → 扩展内嵌 JRE → JAVA_HOME → PATH。 */
function javaExecutableFor(extensionRoot: string): string {
  const explicitHome = process.env.DSH_JAVA_HOME
  if (explicitHome !== undefined && explicitHome !== '') {
    return join(explicitHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  }
  const jreRoot = join(extensionRoot, 'jre')
  try {
    const bundled = readdirSync(jreRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(jreRoot, entry.name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
      .find((path) => existsSync(path))
    if (bundled !== undefined) return bundled
  } catch {
    // No embedded JRE; fall back to PATH below.
  }
  const pathHome = process.env.JAVA_HOME
  if (pathHome !== undefined && pathHome !== '') {
    const pathJava = join(pathHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    if (existsSync(pathJava)) return pathJava
  }
  return 'java'
}

/** 扫描候选目录找 equinox launcher（结果模块级缓存：discover/commandFor 共用）。 */
let cached: JavaServer | null | undefined

function findJavaServer(): JavaServer | null {
  if (cached !== undefined) return cached
  const candidates: string[] = []
  const configured = process.env.DSH_JAVA_LS_HOME
  if (configured !== undefined && configured !== '') candidates.push(configured)
  candidates.push(join(homedir(), '.vscode', 'extensions'))
  for (const candidate of candidates) {
    let roots: string[]
    try {
      roots = candidate.endsWith('extensions')
        ? readdirSync(candidate, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith('redhat.java-')).map((entry) => join(candidate, entry.name)).sort().reverse()
        : [candidate]
    } catch {
      continue
    }
    for (const extensionRoot of roots) {
      const directConfig = join(extensionRoot, 'config_win')
      const directPlugins = join(extensionRoot, 'plugins')
      const serverRoot = existsSync(directConfig) && existsSync(directPlugins)
        ? extensionRoot
        : extensionRoot.endsWith('server') ? extensionRoot : join(extensionRoot, 'server')
      const config = join(serverRoot, 'config_win')
      const plugins = join(serverRoot, 'plugins')
      if (!existsSync(config) || !existsSync(plugins)) continue
      let launcherEntries
      try {
        launcherEntries = readdirSync(plugins, { withFileTypes: true })
      } catch {
        continue
      }
      const launcher = launcherEntries
        .find((entry) => entry.isFile() && /^org\.eclipse\.equinox\.launcher_[^/]+\.jar$/.test(entry.name))
      if (launcher === undefined) continue
      cached = {
        java: javaExecutableFor(extensionRoot.endsWith('server') ? extensionRoot.slice(0, -'server'.length) : extensionRoot),
        launcherJar: join(serverRoot, 'plugins', launcher.name),
        config,
      }
      return cached
    }
  }
  cached = null
  return null
}

/** JVM 参数 + launcher（不含 -data：它依赖 root，由 commandFor 追加）。 */
function staticArgs(server: JavaServer): string[] {
  return [
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Dlog.protocol=true', '-Dlog.level=ERROR',
    '--add-modules=ALL-SYSTEM',
    '--add-opens', 'java.base/java.util=ALL-UNNAMED',
    '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '-Xms256m', '-jar', server.launcherJar,
    '-configuration', server.config,
  ]
}

/** -data 目录：per-workspace（sha1(root) 前缀），避免多工作区状态互踩。 */
function dataDirFor(root: string): string {
  return join(tmpdir(), 'dsh-ide-jdtls', createHash('sha1').update(root).digest('hex').slice(0, 16))
}

export const inject = ['lspServerRegistry']

export function apply(ctx: Context): void {
  const registry = getLspServerRegistry(ctx)
  if (registry === undefined) return
  const config: LspServerConfig = {
    languageId: 'java',
    // 探测可用性（null = 本机无 JDTLS → 桥 close 1011 → 纯高亮降级）。
    discover: async () => {
      const server = findJavaServer()
      return server === null ? null : [server.java, ...staticArgs(server)]
    },
    // 完整命令（优先于 discover 返回值）：staticArgs + per-root -data。
    commandFor: (root) => {
      const server = findJavaServer()
      if (server === null) return ['java']
      return [server.java, ...staticArgs(server), '-data', dataDirFor(root)]
    },
  }
  const effectCtx = ctx as { effect(fn: () => unknown, label?: string): void }
  effectCtx.effect(() => registry.register(config), 'dsh-lsp-java: register JDTLS server')
}
