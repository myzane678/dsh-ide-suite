/**
 * host 语言服务器注册表实现：languageId → LspServerConfig 的同步 Map。
 * 重复注册同 languageId 抛错（防插件二次激活）。
 */

import type { LspServerConfig, LspServerRegistryService } from './types.ts'

export function createLspServerRegistry(): LspServerRegistryService {
  const configs = new Map<string, LspServerConfig>()

  return {
    register(config) {
      if (configs.has(config.languageId)) {
        throw new Error(`[dsh-lsp-core] language server "${config.languageId}" already registered`)
      }
      configs.set(config.languageId, config)
      return () => {
        if (configs.get(config.languageId) === config) configs.delete(config.languageId)
      }
    },
    match(languageId) {
      return configs.get(languageId)
    },
  }
}
