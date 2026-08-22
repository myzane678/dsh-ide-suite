/**
 * FsService.search 递归搜索回归（真实临时目录 + mock gate）：
 * 名称子串命中（大小写不敏感）、目录命中、跳过 node_modules/.git、
 * 结果上限截断（truncated）、gate 拒绝、空 query。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FsService, SEARCH_MAX_RESULTS } from '../src/host/fs-service.ts'

let dir: string
const gateOk = async (root: string): Promise<{ ok: true; canonical: string }> => ({ ok: true, canonical: root })
const fs = new FsService(gateOk)

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-search-'))
  await mkdir(join(dir, 'src', 'app'), { recursive: true })
  await mkdir(join(dir, 'docs'), { recursive: true })
  await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(join(dir, '.git'), { recursive: true })
  await writeFile(join(dir, 'src', 'app', 'main.rs'), 'fn main() {}')
  await writeFile(join(dir, 'src', 'lib_util.rs'), '')
  await mkdir(join(dir, 'src', 'lib'), { recursive: true })
  await writeFile(join(dir, 'src', 'lib', 'util.rs'), '')
  await writeFile(join(dir, 'docs', '笔记.md'), '')
  // 这两处命中也不该出现在结果里（搜索永不进入的目录）。
  await writeFile(join(dir, 'node_modules', 'pkg', 'main.rs'), '')
  await writeFile(join(dir, '.git', 'config.rs'), '')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('FsService.search（文件树搜索）', () => {
  it('名称子串命中（递归、大小写不敏感），文件与目录都返回', async () => {
    const result = await fs.search(dir, 'rs')
    expect('entries' in result).toBe(true)
    if (!('entries' in result)) return
    const paths = result.entries.map((entry) => entry.path.replaceAll('\\', '/'))
    expect(paths).toContain('src/app/main.rs')
    expect(paths).toContain('src/lib_util.rs')
    expect(paths).toContain('src/lib/util.rs')
    // 大写同样命中。
    const upper = await fs.search(dir, 'MAIN.RS')
    expect('entries' in upper && upper.entries.some((entry) => entry.name === 'main.rs')).toBe(true)
    // 目录名命中返回 isDir。
    const dirHit = await fs.search(dir, 'docs')
    expect('entries' in dirHit && dirHit.entries.some((entry) => entry.path === 'docs' && entry.isDir)).toBe(true)
  })

  it('跳过 node_modules 与 .git（命中文件不出现）', async () => {
    const result = await fs.search(dir, 'main.rs')
    expect('entries' in result).toBe(true)
    if (!('entries' in result)) return
    const paths = result.entries.map((entry) => entry.path.replaceAll('\\', '/'))
    expect(paths.filter((p) => p.includes('main.rs'))).toEqual(['src/app/main.rs'])
  })

  it('空 query 返回空结果', async () => {
    const result = await fs.search(dir, '   ')
    expect('entries' in result && result.entries).toEqual([])
  })

  it('gate 拒绝时返回 error（不越权遍历）', async () => {
    const gated = new FsService(async () => ({ ok: false, error: { code: 'forbidden', message: 'not a workspace' } }))
    const result = await gated.search(dir, 'x')
    expect('entries' in result).toBe(false)
    expect((result as { code?: string }).code).toBe('forbidden')
  })

  it('结果达上限截断并标记 truncated', async () => {
    const flood = await mkdtemp(join(tmpdir(), 'dsh-flood-'))
    try {
      const total = SEARCH_MAX_RESULTS + 5
      const writes: Array<Promise<void>> = []
      for (let i = 0; i < total; i += 1) {
        writes.push(writeFile(join(flood, `hit-${String(i).padStart(4, '0')}.txt`), ''))
      }
      await Promise.all(writes)
      const result = await fs.search(flood, 'hit-')
      expect('entries' in result).toBe(true)
      if (!('entries' in result)) return
      expect(result.entries.length).toBe(SEARCH_MAX_RESULTS)
      expect(result.truncated).toBe(true)
    } finally {
      await rm(flood, { recursive: true, force: true })
    }
  })
})
