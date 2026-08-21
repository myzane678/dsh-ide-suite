# Changelog

## [1.0.0] - 2026-08-22

LSP 拆分工程阶段 0-3 完成，dsh-ide-suite monorepo 首个里程碑版本。

### 新增

- **client 服务**：`ctx.lspRegistry`（语言注册表：register/match/list/subscribe）+ `ctx.lspCapabilities`（能力工厂：acquire 按 (root, sessionId) 复用 LspSession；`languageFor(path)` 返回 LanguageSummary 供编辑器语言路由）。
- **LanguageCapability**：补全/悬停/签名/跳转/重命名/格式化/codeAction + 诊断/状态/服务器日志三订阅；LspSession 含 WS 重连退避与文档生命周期（didOpen/didChange 重放）。
- **host 桥 `/dsh-lsp/ws`**：注册表驱动（`?root=&language=` 查 lspServerRegistry），`resolveServerCommand` 支持 `commandFor(root)` > `command` > `discover()` 兜底（JDTLS 场景 per-root `-data`；discover null → 1011 纯高亮降级）；连接上限 8 / 单帧 4MB / URI 门禁 / workspace 门禁 / 严格来源校验 / ELECTRON_RUN_AS_NODE / stderr 全文日志全保留。
- `LanguageDescriptor.sessionId`（会话分组：tsserver 单会话服务 ts/tsx/js/jsx）；`LspServerConfig.commandFor/discover`。
- 测试 25 项（registry / server-registry / capability-contract / bridge / language-for）。

### 约定（跨插件）

浏览器纯度门（client bundle 禁 value-import 其他插件）；CodeMirror 扩展禁止跨 bundle（双副本硬崩——语言插件不注册 syntax，`@codemirror/*` 无法注入浏览器，宿主 seed 表硬编码）；host 入口 `inject` 必须显式导出（tsdown 会摇掉未导出的）。
