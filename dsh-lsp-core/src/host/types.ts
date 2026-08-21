/**
 * host 侧共享类型：语言服务器注册表（LspServerConfig / LspServerRegistryService）。
 * 语言插件 host half 注册服务器启动配置；dsh-lsp-core 的 LSP 桥按 languageId
 * 查询并 spawn。类型经主入口 `dsh-lsp-core` 导出（Node 环境消费方）。
 */

/** 一种语言服务器的启动配置（由语言插件 host half 注册）。 */
export interface LspServerConfig {
  /** 与 client 侧 LanguageDescriptor.id 对应：'python' / 'java' … */
  languageId: string
  /** 静态启动命令（含参数）：['pyright-langserver', '--stdio']；与 commandFor 至少其一。 */
  command?: readonly string[]
  /**
   * 动态命令构造（优先于 command）：JDTLS 等 root 相关命令用它
   * （`-data <tmpdir>/dsh-ide-jdtls/<sha1(root)>` 依赖 root）。
   */
  commandFor?: (root: string) => readonly string[]
  /** 服务器发现（如 JDTLS 复用本机扩展）：返回 null 表示不可用，编辑器降级纯高亮。 */
  discover?: () => Promise<readonly string[] | null>
  initializationOptions?: unknown
}

/** host 语言服务器注册表（dsh-lsp-core host half 提供，ctx.lspServerRegistry）。 */
export interface LspServerRegistryService {
  register(config: LspServerConfig): () => void
  match(languageId: string): LspServerConfig | undefined
}

/** 服务访问（同 client 侧约定：不依赖 Context augmentation）。 */
export const lspServerRegistryKey = 'lspServerRegistry'

export function getLspServerRegistry(ctx: unknown): LspServerRegistryService | undefined {
  if (typeof ctx !== 'object' || ctx === null) return undefined
  return (ctx as Record<string, unknown>)[lspServerRegistryKey] as LspServerRegistryService | undefined
}
