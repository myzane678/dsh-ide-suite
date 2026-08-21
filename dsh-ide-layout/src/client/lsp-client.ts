/**
 * LSP 编辑器适配的工具函数与类型 re-export（旧 LspClient 已随阶段 2 删除——
 * 会话由 dsh-lsp-core 的 lspCapabilities/LspSession 统一管理，本文件仅保留
 * EditorPane 使用的 URI/补全/签名/位置换算工具；阶段 3 语言无关化后并入
 * dsh-lsp-core 编辑器适配层）。
 */

import type {
  LspCompletionItem, LspPosition, LspSignatureHelp,
} from 'dsh-lsp-core/client'

// LSP 消息类型统一以 dsh-lsp-core 为单一来源（本文件为旧客户端，保留 re-export
// 使 EditorPane 等既有 import 路径不变；阶段 3 语言无关化后随旧客户端一起移除）。
export type {
  LspPosition,
  LspRange,
  LspTextDocumentIdentifier,
  LspVersionedTextDocumentIdentifier,
  LspCompletionItem,
  LspSignatureParameter,
  LspSignatureInformation,
  LspSignatureHelp,
  LspDiagnostic,
  LspHoverContents,
  LspHover,
  LspLocation,
  LspTextEdit,
  LspTextDocumentEdit,
  LspWorkspaceEdit,
  LspCodeAction,
} from 'dsh-lsp-core/client'

export function signatureParameterRange(help: LspSignatureHelp): { label: string; activeFrom: number; activeTo: number } | null {
  const signature = help.signatures[help.activeSignature ?? 0]
  if (signature === undefined) return null
  const active = help.activeParameter ?? signature.activeParameter ?? 0
  const parameter = signature.parameters?.[active]
  if (parameter === undefined) return { label: signature.label, activeFrom: -1, activeTo: -1 }
  if (Array.isArray(parameter.label)) return { label: signature.label, activeFrom: parameter.label[0], activeTo: parameter.label[1] }
  const start = signature.label.indexOf(parameter.label)
  return { label: signature.label, activeFrom: start, activeTo: start >= 0 ? start + parameter.label.length : -1 }
}

/** Diagnostic severities (LSP: 1=Error, 2=Warning, 3=Information, 4=Hint). */
export const LSP_SEVERITY = { Error: 1, Warning: 2, Information: 3, Hint: 4 } as const

/** Path → file:// URI (Windows paths backslash-normalised).
 *  特殊字符（空格、#、%、非 ASCII 等）按 UTF-8 百分号编码，Windows 盘符冒号保留。 */
export function pathToUri(root: string, path: string): string {
  const joined = `${root.replaceAll('\\', '/')}/${path.replaceAll('\\', '/')}`
  const encoded = joined.split('/').map((segment, index) => {
    // 首段若为 Windows 盘符（E:）原样保留；其余段做百分号编码。
    if (index === 0 && /^[a-zA-Z]:$/.test(segment)) return segment
    return encodeURIComponent(segment)
  }).join('/')
  return `file:///${encoded}`
}

/** 归一化 URI 用于匹配（Windows：盘符大小写 + 百分号编码冒号）。 */
export function normalizeUri(uri: string): string {
  let decoded = uri
  try {
    decoded = decodeURIComponent(uri)
  } catch {
    // Keep as-is on malformed escapes.
  }
  // 浏览器侧无 process.platform；DSH 桌面端在 Windows 上运行，盘符大小写不敏感。
  const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent)
  return isWindows ? decoded.toLowerCase() : decoded
}

/** Completion kinds (LSP) → CodeMirror completion type icons. */
const KIND_TO_TYPE: Record<number, string> = {
  1: 'text', 2: 'method', 3: 'function', 4: 'constructor', 5: 'field',
  6: 'variable', 7: 'class', 8: 'interface', 9: 'module', 10: 'property',
  11: 'unit', 12: 'value', 13: 'enum', 14: 'keyword', 15: 'snippet',
  16: 'color', 17: 'file', 18: 'reference', 19: 'folder', 20: 'enumMember',
  21: 'constant', 22: 'struct', 23: 'event', 24: 'operator', 25: 'typeParameter',
}

/** Completion kind number → CodeMirror type string. */
export function completionType(kind?: number): string {
  return kind !== undefined ? (KIND_TO_TYPE[kind] ?? 'text') : 'text'
}

/** Extract a plain-string documentation value from an LSP doc entry. */
export function completionInfo(documentation?: string | { kind: string; value: string }): string | undefined {
  if (documentation === undefined) return undefined
  return typeof documentation === 'string' ? documentation : documentation.value
}

/** Convert an LSP UTF-16 position to a JavaScript string offset. */
export function lspPositionToOffset(text: string, position: LspPosition): number {
  const lines = text.split('\n')
  if (position.line < 0 || position.line >= lines.length) return text.length
  let offset = 0
  for (let index = 0; index < position.line; index++) offset += lines[index]!.length + 1
  return offset + Math.min(Math.max(position.character, 0), lines[position.line]!.length)
}

/** Prefer the range supplied by LSP, falling back to the editor's word range. */
export function completionTextRange(
  item: LspCompletionItem,
  text: string,
  fallback: { from: number; to: number },
): { from: number; to: number } {
  const range = item.textEdit?.range
  if (range === undefined) return fallback
  return {
    from: lspPositionToOffset(text, range.start),
    to: lspPositionToOffset(text, range.end),
  }
}
