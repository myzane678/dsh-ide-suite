# dsh-ide-suite

DSH（DeepSeek Harness）Web GUI 的 IDE 插件套件（monorepo，pnpm workspace）：编辑器外壳 + LSP 基础设施 + 四语言插件。v1.0.0——LSP 拆分工程完成，编辑器语言无关化（新增语言插件零改编辑器）。

## 包结构（v1.0.0 全家桶）

| 包 | 职责 |
|---|---|
| `dsh-ide-layout` | 编辑器外壳：文件树 / 多 tab 编辑器（CodeMirror 6）/ 终端 / Git blame / 问题面板 / 状态栏——零语言知识，LSP 全部经 `lspCapabilities` |
| `dsh-lsp-core` | LSP 基础设施：client 语言注册表 + 能力工厂（acquire / languageFor）+ LanguageCapability；host 语言服务器注册表 + `/dsh-lsp/ws` 桥（注册表驱动 spawn，commandFor/discover） |
| `dsh-lsp-python` | Python：pyright（宽松配置防第三方库误报） |
| `dsh-lsp-typescript` | TypeScript/JavaScript：typescript-language-server（ts/tsx/js/jsx 一条会话） |
| `dsh-lsp-powershell` | PowerShell：PowerShell Editor Services（vendor 随 Release 资产分发） |
| `dsh-lsp-java` | Java：复用本机 Eclipse JDTLS（discover + per-root `-data`；无 JDTLS 自动降级纯高亮） |

## 安装（DSH 插件）

各包为独立 DSH 插件（dual-face：host 半区 + 浏览器半区）。在 DSH profile 的 `package.json` 加依赖并列入 `dsh.profile.bundles`：

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-ide-layout": "github:myzane678/dsh-ide-suite#v1.0.0",
    "dsh-lsp-core": "github:myzane678/dsh-ide-suite#v1.0.0",
    "dsh-lsp-python": "github:myzane678/dsh-ide-suite#v1.0.0"
    // 其余语言插件按需；PowerShell 需 Release 的 tgz 资产（vendor 不在 git 内）
  },
  "dsh": { "profile": { "bundles": ["dsh-ide-layout", "dsh-lsp-core", "dsh-lsp-python"] } }
}
```

注意：`dsh-lsp-powershell` 的 PSES vendor（约 298MB）不入 git——用 GitHub Release 的 tgz 资产安装，或本仓库 clone 后 `pnpm install && pnpm -r --filter "./*" run build` 再 link。

## 常用命令（monorepo 根）

```powershell
pnpm install                        # 一次安装全部包
pnpm -r --filter "./*" run build    # 全量构建（dual-face：host esm + browser cjs）
pnpm -r --filter "./*" test         # 全量测试（112 项）
pnpm --filter dsh-lsp-core test     # 单包测试
```

改 src 后必须 rebuild 才生效（加载的是 `lib/` 构建产物）；host 侧改动需完全退出 DSH 重启，client 侧刷新页面即可。

## 设计文档

LSP 拆分工程的设计与分阶段记录：[docs/lsp-split-design.md](docs/lsp-split-design.md)（阶段 0 机制验证 / 阶段 1 Python 垂直切片 / 阶段 2 host 桥迁移与语言插件化 / 阶段 3 语言无关化收尾——含宿主能力验证结论）。

## 跨插件协作约定（重要）

- **浏览器纯度门**：client bundle 禁止 value-import 其他插件；跨插件交互只能经 `ctx` 属性（lsp-core 提供），类型经 `import type` 自由共享；工具函数各包留副本（纯函数双副本无害）。
- **CodeMirror 扩展禁止跨 bundle**：`@codemirror/*` 无法注入浏览器（宿主 seed 模块表硬编码），语法高亮固定由 `dsh-ide-layout` 内置表单副本构造，语言插件不注册 syntax。
- **LSP 会话按 sessionId 分组**：同组语言共享一条会话/一个服务器进程（tsserver 一条服务 ts/tsx/js/jsx）。
- **host 入口 `inject` 必须显式导出**：未导出会被 tsdown 摇掉 → DSH 启动即崩（`cannot get property … without inject`）。
- **服务访问**：用「类型模板」断言（`LspRegistryAccessor` 等），不依赖 cordis Context augmentation。
- **生命周期**：语言插件的注册必须包在 `ctx.effect(() => registry.register(d), label)` 里（HMR-safe）。
