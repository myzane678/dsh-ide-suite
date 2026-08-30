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
  // —— 与 EditorPane languageFor 扩展覆盖同步（配置/工程文件 + 更多编程语言）——
  makefile: 'Makefile', mk: 'Makefile',
  dockerfile: 'Dockerfile',
  gitignore: 'Git Ignore', gitattributes: 'Git Attributes', dockerignore: 'Docker Ignore',
  editorconfig: 'EditorConfig', npmrc: 'NPM Config', env: 'Env',
  ini: 'INI', cfg: 'Config', conf: 'Config', properties: 'Properties',
  jenkinsfile: 'Jenkins', gradle: 'Gradle', groovy: 'Groovy',
  cs: 'C#', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', m: 'Objective-C', mm: 'Objective-C',
  rb: 'Ruby', lua: 'Lua', swift: 'Swift', r: 'R', pl: 'Perl', pm: 'Perl',
  hs: 'Haskell', clj: 'Clojure', cljs: 'Clojure', cljc: 'Clojure', edn: 'Clojure',
  erl: 'Erlang', hrl: 'Erlang', cmake: 'CMake',
  diff: 'Diff', patch: 'Diff', proto: 'Protobuf', vb: 'VB',
  ml: 'OCaml', mli: 'OCaml', fs: 'F#', fsi: 'F#', fsx: 'F#',
  coffee: 'CoffeeScript', jl: 'Julia', tex: 'LaTeX', latex: 'LaTeX',
  http: 'HTTP', tcl: 'Tcl', scm: 'Scheme', ss: 'Scheme',
  asm: 'Assembly', s: 'Assembly', feature: 'Gherkin', pug: 'Pug', jade: 'Pug',
}

/** 扩展名 → 展示名；未收录返回 undefined（调用方回退 plaintext）。 */
export function languageNameFor(path: string): string | undefined {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  return LANGUAGE_NAMES[ext]
}
