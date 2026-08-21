/**
 * LSP client 工具函数（从 dsh-ide-layout 的 lsp-client.ts 迁移）：
 * URI 转换 / 归一化 / 补全类型与文档提取 / 位置换算。编辑器集成与
 * LanguageCapability 实现共用。
 */

import type { LspPosition, LspRange } from './types.ts'

/** 路径 → file:// URI（Windows 路径反斜杠归一化；特殊字符百分号编码，盘符冒号保留）。 */
export function pathToUri(root: string, path: string): string {
  const joined = `${root.replaceAll('\\', '/')}/${path.replaceAll('\\', '/')}`
  const encoded = joined.split('/').map((segment, index) => {
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
  item: { textEdit?: { range: LspRange; newText: string } },
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
