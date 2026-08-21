# Changelog

## [1.0.0] - 2026-08-22

首个里程碑版本（dsh-ide-suite monorepo）。

- client 注册 powershell（ps1/psm1/psd1），无语言专属配置（PSES workspace/configuration 回 null 即可）。
- host 注册 PowerShell Editor Services：`pwsh` 跑 vendor 内 Start-EditorServices.ps1（-Stdio，参数与拆分前旧桥一致）。
- **vendor/（PSES + PSScriptAnalyzer，约 298MB）不入 git**——git 仓库只含源码；安装方式见 monorepo README（本地 link / Release tgz 资产）。
- 不注册 syntax（CodeMirror 跨 bundle 双副本硬崩；高亮由 dsh-ide-layout 内置表 legacy-modes 提供）。
