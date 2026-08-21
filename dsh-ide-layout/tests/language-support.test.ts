/** LSP 编辑器适配工具回归（语言路由已由各语言插件的 apply 测试 +
 *  lsp-core 的 languageFor/registry 测试覆盖；languageIdForPath 已随
 *  阶段 3 删除——编辑器语言知识全部收敛到注册表）。 */
import { describe, expect, it } from 'vitest'
import { completionTextRange, lspPositionToOffset, pathToUri, signatureParameterRange, type LspCompletionItem, type LspSignatureHelp } from '../src/client/lsp-client.ts'

describe('LSP 编辑器适配', () => {
  it('按 LSP textEdit.range 计算导入补全的替换范围', () => {
    const item: LspCompletionItem = {
      label: 'RandomForestClassifier',
      textEdit: { range: { start: { line: 0, character: 28 }, end: { line: 0, character: 28 } }, newText: 'RandomForestClassifier' },
    }
    expect(completionTextRange(item, 'from sklearn.ensemble import ', { from: 28, to: 28 })).toEqual({ from: 28, to: 28 })
  })

  it('保留多行文本中的 LSP 位置偏移', () => {
    expect(lspPositionToOffset('第一行\nfrom sklearn import ', { line: 1, character: 20 })).toBe(24)
  })

  it('提取签名提示当前参数范围', () => {
    const help: LspSignatureHelp = {
      signatures: [{ label: 'fit(X, y, sample_weight=None)', parameters: [{ label: 'X' }, { label: 'y' }, { label: 'sample_weight=None' }] }],
      activeParameter: 1,
    }
    expect(signatureParameterRange(help)).toEqual({ label: 'fit(X, y, sample_weight=None)', activeFrom: 7, activeTo: 8 })
  })

  it('pathToUri 对空格/#/%/非 ASCII 路径做百分号编码，保留盘符冒号', () => {
    expect(pathToUri('E:/work dir', 'a b#c%.py')).toBe('file:///E:/work%20dir/a%20b%23c%25.py')
    expect(pathToUri('E:/work dir', '中文.py')).toContain('%E4%B8%AD%E6%96%87.py')
  })

  it('lspPositionToOffset 按 UTF-16 计算（emoji 占两个码元）', () => {
    expect(lspPositionToOffset('x😀y\nz', { line: 0, character: 4 })).toBe(4)
    expect(lspPositionToOffset('x😀y\nz', { line: 1, character: 1 })).toBe(6)
  })
})
