# Changelog

本项目版本与更新记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.0] - 2026-08-22

首个版本：Rust 语言插件（rust-analyzer）。

### 新增

- client 注册 rust 语言（`.rs`，server 零配置起步；不注册 syntax——语法高亮由 dsh-ide-layout 内置 @codemirror/lang-rust 提供，状态栏展示名由 language-names.ts 提供，编辑器零改动）。
- host 注册 rust-analyzer 服务器：discover 探测 `DSH_RUST_LS_HOME`（可执行所在目录）→ `~/.cargo/bin` → PATH，未找到返回 null（桥 close 1011 → 编辑器降级纯高亮）；探测结果模块级缓存。rust-analyzer 为本机二进制，不随 npm 包分发。
