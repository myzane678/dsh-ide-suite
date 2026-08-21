/** 状态栏语言展示名兜底表回归（LSP 语言优先 lspCapabilities.languageFor，
 *  本表覆盖内置语法表全部扩展名；未收录返回 undefined → 状态栏 plaintext）。 */
import { describe, expect, it } from 'vitest'
import { languageNameFor } from '../src/client/language-names.ts'

describe('轻量语法注册表（状态栏展示名）', () => {
  it('非 LSP 语言返回展示名', () => {
    expect(languageNameFor('package.json')).toBe('JSON')
    expect(languageNameFor('README.md')).toBe('Markdown')
    expect(languageNameFor('docker-compose.yml')).toBe('YAML')
    expect(languageNameFor('index.html')).toBe('HTML')
    expect(languageNameFor('style.scss')).toBe('SCSS')
    expect(languageNameFor('Dockerfile.bat')).toBe('Batch')
  })

  it('LSP 语言也有兜底名（lsp-core 未注入或注册表未命中时）', () => {
    expect(languageNameFor('main.ts')).toBe('TypeScript')
    expect(languageNameFor('app.py')).toBe('Python')
    expect(languageNameFor('run.ps1')).toBe('PowerShell')
  })

  it('扩展名大小写归一', () => {
    expect(languageNameFor('NOTE.MD')).toBe('Markdown')
    expect(languageNameFor('Config.YAML')).toBe('YAML')
  })

  it('未收录扩展名返回 undefined（状态栏回退 plaintext）', () => {
    expect(languageNameFor('data.bin')).toBeUndefined()
    expect(languageNameFor('Makefile')).toBeUndefined()
  })
})
