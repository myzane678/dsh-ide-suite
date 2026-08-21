# Changelog

## [1.0.0] - 2026-08-22

首个里程碑版本（dsh-ide-suite monorepo）。

- client 注册 python（py/pyw）：pyright 宽松配置防第三方库误报（`useLibraryCodeForTypes:false` + `autoImportCompletions:true`，initializationOptions / didChangeConfiguration / workspaceConfiguration 三处同步，与拆分前 LspClient 行为一致）。
- host 注册 pyright（`pyright/langserver.index.js` 入口，ELECTRON_RUN_AS_NODE 以 Node 模式跑）。
- 不注册 syntax（CodeMirror 跨 bundle 双副本硬崩；高亮由 dsh-ide-layout 内置表提供）。
