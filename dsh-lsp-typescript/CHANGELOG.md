# Changelog

## [1.0.0] - 2026-08-22

首个里程碑版本（dsh-ide-suite monorepo）。

- client 注册 4 个 languageId（typescript[ts/mts/cts] / typescriptreact[tsx] / javascript[js/mjs/cjs] / javascriptreact[jsx]），sessionId 统一 'typescript'——tsserver 一条会话服务全部。
- host 注册 typescript-language-server（`--stdio`，依赖随包分发）。
- 不注册 syntax（CodeMirror 跨 bundle 双副本硬崩；高亮由 dsh-ide-layout 内置表提供）。
