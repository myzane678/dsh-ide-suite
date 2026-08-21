/** dsh-lsp-core host 入口（Node half；client half 走 ./client 子导出）。 */

// inject 必须显式 re-export：cordis 读插件导出的 inject 数组做服务注入，
// 不导出会被 tsdown 摇掉 → 运行时 "cannot get property ... without inject"。
export { apply, inject } from './host/index.ts'
export {
  lspServerRegistryKey,
  getLspServerRegistry,
} from './host/types.ts'
export type {
  LspServerConfig,
  LspServerRegistryService,
} from './host/types.ts'
