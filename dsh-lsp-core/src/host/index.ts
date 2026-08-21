/**
 * host half：发布 ctx.lspServerRegistry 服务 + 挂载 LSP 桥
 * （/dsh-lsp/ws upgrade：语言插件经注册表提供启动命令，桥按
 * ?root=&language= 查表 spawn，stdio↔WS 透传 + URI 门禁，见 bridge.ts）。
 */

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createLspServerRegistry } from './server-registry.ts'
import { attachLspSocket } from './bridge.ts'
import { isLoopbackRequest, rejectUpgrade } from './security.ts'
import { lspServerRegistryKey } from './types.ts'

export { lspServerRegistryKey, getLspServerRegistry, type LspServerConfig, type LspServerRegistryService } from './types.ts'
export { attachLspSocket, FrameReader, uriWithinRoot, uriPrefixFor, resolveServerCommand, createWorkspaceGate } from './bridge.ts'

/** Required services: webServer 注册 upgrade；workspaceRegistry 做 root 门禁。 */
export const inject = ['webServer', 'workspaceRegistry']

export function apply(ctx: Context): void {
  const registry = createLspServerRegistry()
  ctx.provide(lspServerRegistryKey, registry)

  // LSP WebSocket：一个 upgrade 端点，?root= 定位工作区根（语言服务器进程以
  // 该目录为 cwd 启动），?language= 查注册表取启动命令。浏览器半区经此连接
  // 走完整 LSP 协议（补全/诊断/签名）。
  ctx.effect(() => {
    const wss = new WebSocketServer({ noServer: true })
    const dispose = ctx.webServer.registerUpgrade({
      path: '/dsh-lsp/ws',
      handler: (req, socket, head) => {
        // P0-01：与 dsh-ide-layout 终端 WS 同款严格来源校验（缺失 Origin 拒绝）。
        if (!isLoopbackRequest(req as IncomingMessage, true)) {
          rejectUpgrade(socket as Duplex)
          return
        }
        // `ws` 需要真实的 Node 类型；此处为宿主 webserver 的结构化面（结构兼容）做边界转换。
        wss.handleUpgrade(req as IncomingMessage, socket as Duplex, head as Buffer, (ws) => {
          attachLspSocket(ctx, req as IncomingMessage, ws)
        })
      },
    })
    return () => {
      dispose()
      wss.close()
    }
  }, 'dsh-lsp-core: LSP WebSocket')
  console.log('[dsh-lsp-core] host half loaded')
}
