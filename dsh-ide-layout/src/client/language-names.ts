/** 轻量语法注册表：扩展名 → 状态栏语言展示名。
 *  覆盖 EditorPane 内置语法表（languageFor 的 switch）全部扩展名，与该表
 *  同步维护——加新语言高亮时同时补展示名。LSP 语言（ts/py/ps1/java）优先
 *  走 lspCapabilities.languageFor 的 displayName，本表只在注册表未命中或
 *  lsp-core 未注入时兜底。状态栏 fallback 链：注册表 → 本表 → plaintext。 */

const LANGUAGE_NAMES: Partial<Record<string, string>> = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', tsx: 'TypeScript',
  json: 'JSON', jsonc: 'JSON', map: 'JSON',
  md: 'Markdown', markdown: 'Markdown',
  py: 'Python', pyw: 'Python',
  html: 'HTML', htm: 'HTML',
  css: 'CSS',
  yaml: 'YAML', yml: 'YAML',
  xml: 'XML', svg: 'XML', xsl: 'XML', plist: 'XML',
  sql: 'SQL', mysql: 'SQL', pgsql: 'SQL',
  java: 'Java',
  c: 'C++', h: 'C++', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
  rs: 'Rust',
  go: 'Go',
  php: 'PHP',
  vue: 'Vue',
  scss: 'SCSS',
  less: 'Less',
  toml: 'TOML',
  cmd: 'Batch', bat: 'Batch',
  ps1: 'PowerShell', psm1: 'PowerShell', psd1: 'PowerShell',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
}

/** 扩展名 → 展示名；未收录返回 undefined（调用方回退 plaintext）。 */
export function languageNameFor(path: string): string | undefined {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  return LANGUAGE_NAMES[ext]
}
