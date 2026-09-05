/**
 * dsh-question-pin build: node half (lib/index.js, no-op loader entry) plus
 * the browser half (lib/client.js, closure-factory artifact consumed by the
 * web GUI's __ModuleLoader__). Same shape as dsh-ide-layout's config, minus
 * the heavy externals — the client bundle only requires the react family.
 */

/** Externals answered by the loader module table (+ the runtime exemption). */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
] as const

export default [
  // --- node half ---
  {
    name: 'dsh-question-pin',
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  // --- browser half ---
  {
    name: 'dsh-question-pin/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    // Everything outside the loader module table inlines into the bundle.
    noExternal: (id: string) => ((CLIENT_EXTERNALS as readonly string[]).includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-question-pin", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
