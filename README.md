# dsh-lsp monorepo

DSH（DeepSeek Harness）Web GUI 的 LSP 插件拆分工程（monorepo，pnpm workspace）。

## 包结构

| 包 | 职责 | 版本 |
|---|---|---|
| `dsh-ide-layout` | 外壳：文件树 / 编辑器（语言无关化进行中）/ 终端 / Git / 问题面板 / 状态栏 | 0.3.x |
| `dsh-lsp-core` | LSP 基础设施：client 语言注册表（`ctx.lspRegistry`）+ 能力工厂（`ctx.lspCapabilities`）+ LanguageCapability 接口；host 语言服务器注册表（`ctx.lspServerRegistry`） | 0.1.0 |
| `dsh-lsp-python` | Python 语言插件：语法包 + pyright 服务器配置（useLibraryCodeForTypes:false 防误报） | 0.1.0 |

## 常用命令（monorepo 根）

```powershell
pnpm install            # 一次安装全部包
pnpm -r --filter "./*" run build    # 全量构建
pnpm -r --filter "./*" test         # 全量测试（93 项）
pnpm --filter dsh-lsp-core run build   # 单包构建
```

## 设计文档

拆分工程的设计与分阶段计划：`docs/lsp-split-design.md`（阶段 0 机制验证 / 阶段 1 Python 垂直切片 / 阶段 2 host 桥迁移与其余语言插件化 / 阶段 3 语言无关化收尾）。

## 跨插件协作约定（重要）

- **浏览器纯度门**：client bundle 禁止 value-import 其他插件；跨插件交互只能经 `ctx` 属性（dsh-lsp-core 提供 `lspRegistry` / `lspCapabilities`），类型经 `import type` 自由共享。
- **服务访问**：用「类型模板」断言（`LspRegistryAccessor` / `LspCapabilitiesAccessor`），避免依赖 cordis Context augmentation（`@deepseek-ai/cordis` 的 .d.ts 引用 .ts 无法解析）。
- **生命周期**：语言插件的注册必须包在 `ctx.effect(() => registry.register(d), label)` 里，disposer 由 fiber 卸载自动调用（HMR-safe）。
