# Changelog

## [1.0.0] - 2026-08-22

首个里程碑版本（dsh-ide-suite monorepo）。

- client 注册 java（.java），无语言专属 initializationOptions。
- host `discover`：复用本机 Eclipse JDTLS（`DSH_JAVA_LS_HOME` → VS Code redhat.java 扩展扫描；Java 可执行按 DSH_JAVA_HOME → 扩展内嵌 JRE → JAVA_HOME → PATH）；`commandFor(root)` 构造完整命令（含 per-workspace `-data <tmpdir>/dsh-ide-jdtls/<sha1(root)>`）。
- 本机无 JDTLS 时 discover 返回 null → 桥 close 1011 → 编辑器降级纯高亮（不报错）。
- 不注册 syntax（CodeMirror 跨 bundle 双副本硬崩；高亮由 dsh-ide-layout 内置表提供）。
