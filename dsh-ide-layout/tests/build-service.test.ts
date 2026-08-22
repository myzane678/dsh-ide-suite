/**
 * build-service 回归：项目识别（Maven/Gradle/wrapper/深度/跳过产物目录）、
 * 主类探测、构建计划、Maven 运行三步命令序列（编译 → 类路径 → java）。
 * 全部经注入原语（listDir/readFile/exec），不 spawn 真实子进程。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectJavaProject, findMainClasses, planBuild, runProject } from '../src/host/build-service.ts'
import type { BuildStep, Exec, JavaProject } from '../src/host/build-service.ts'

let dir: string
const listDir = (abs: string) => readdirSync(abs, { withFileTypes: true }).map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
const readFile = (abs: string) => readFileSync(abs, 'utf8')

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-build-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('detectJavaProject（项目识别）', () => {
  it('root 有 pom.xml → maven，无 wrapper', async () => {
    const projectDir = join(dir, 'mvn-root')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'pom.xml'), '<project/>')
    const project = detectJavaProject(projectDir, listDir)
    expect(project).not.toBeNull()
    expect(project?.type).toBe('maven')
    expect(project?.wrapper).toBe(false)
    expect(project?.buildFile).toBe(join(projectDir, 'pom.xml'))
  })

  it('mvnw.cmd 存在 → wrapper true', async () => {
    const projectDir = join(dir, 'mvn-wrapper')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'pom.xml'), '<project/>')
    await writeFile(join(projectDir, 'mvnw.cmd'), '@echo off')
    expect(detectJavaProject(projectDir, listDir)?.wrapper).toBe(true)
  })

  it('嵌套 2 层找到子项目（多模块工作区）', async () => {
    const root = join(dir, 'nested')
    const projectDir = join(root, 'level1', 'level2')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'pom.xml'), '<project/>')
    const project = detectJavaProject(root, listDir)
    expect(project).not.toBeNull()
    expect(project?.projectDir).toBe(projectDir)
  })

  it('超过 4 层不识别（防御病态目录树）', async () => {
    const root = join(dir, 'deep')
    const projectDir = join(root, 'a', 'b', 'c', 'd', 'e')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'pom.xml'), '<project/>')
    expect(detectJavaProject(root, listDir)).toBeNull()
  })

  it('build.gradle → gradle', async () => {
    const projectDir = join(dir, 'gradle-root')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'build.gradle'), 'plugins {}')
    const project = detectJavaProject(projectDir, listDir)
    expect(project?.type).toBe('gradle')
  })

  it('settings.gradle + gradlew.bat → gradle wrapper', async () => {
    const projectDir = join(dir, 'gradle-wrapper')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'settings.gradle'), '')
    await writeFile(join(projectDir, 'gradlew.bat'), '@echo off')
    const project = detectJavaProject(projectDir, listDir)
    expect(project?.type).toBe('gradle')
    expect(project?.wrapper).toBe(true)
  })

  it('跳过 target/node_modules（其中的 pom.xml 不算项目）', async () => {
    const root = join(dir, 'skips')
    await mkdir(join(root, 'target'), { recursive: true })
    await mkdir(join(root, 'node_modules', 'fake'), { recursive: true })
    await writeFile(join(root, 'target', 'pom.xml'), '<project/>')
    await writeFile(join(root, 'node_modules', 'fake', 'pom.xml'), '<project/>')
    expect(detectJavaProject(root, listDir)).toBeNull()
  })

  it('无任何构建文件 → null', async () => {
    const root = join(dir, 'plain')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'readme.txt'), '')
    expect(detectJavaProject(root, listDir)).toBeNull()
  })
})

describe('findMainClasses（主类探测）', () => {
  it('单个 main → 完整限定类名', async () => {
    const projectDir = join(dir, 'mc-single')
    await mkdir(join(projectDir, 'src', 'main', 'java', 'com', 'example'), { recursive: true })
    await writeFile(join(projectDir, 'src', 'main', 'java', 'com', 'example', 'App.java'),
      'package com.example;\npublic class App { public static void main(String[] args) {} }\n')
    expect(findMainClasses(projectDir, listDir, readFile)).toEqual(['com.example.App'])
  })

  it('多个 main → 按名排序', async () => {
    const projectDir = join(dir, 'mc-multi')
    await mkdir(join(projectDir, 'src', 'main', 'java', 'org', 'b'), { recursive: true })
    await mkdir(join(projectDir, 'src', 'main', 'java', 'com', 'a'), { recursive: true })
    await writeFile(join(projectDir, 'src', 'main', 'java', 'com', 'a', 'Zeta.java'), 'public class Zeta { public static void main(String[] args) {} }')
    await writeFile(join(projectDir, 'src', 'main', 'java', 'org', 'b', 'Alpha.java'), 'public class Alpha { public static void main(String[] args) {} }')
    expect(findMainClasses(projectDir, listDir, readFile)).toEqual(['com.a.Zeta', 'org.b.Alpha'])
  })

  it('无 main 方法 → 空数组', async () => {
    const projectDir = join(dir, 'mc-none')
    await mkdir(join(projectDir, 'src', 'main', 'java', 'util'), { recursive: true })
    await writeFile(join(projectDir, 'src', 'main', 'java', 'util', 'Helper.java'), 'public class Helper { public int add(int a, int b) { return a + b; } }')
    expect(findMainClasses(projectDir, listDir, readFile)).toEqual([])
  })

  it('没有 src/main/java → 空数组', async () => {
    const projectDir = join(dir, 'mc-nosrc')
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, 'pom.xml'), '<project/>')
    expect(findMainClasses(projectDir, listDir, readFile)).toEqual([])
  })

  it('跳过 target 里的 main', async () => {
    const projectDir = join(dir, 'mc-skip')
    await mkdir(join(projectDir, 'target', 'classes', 'x'), { recursive: true })
    await writeFile(join(projectDir, 'target', 'classes', 'x', 'Stale.java'), 'public class Stale { public static void main(String[] args) {} }')
    expect(findMainClasses(projectDir, listDir, readFile)).toEqual([])
  })
})

describe('planBuild（构建计划）', () => {
  it('maven compile → -f <pom> compile', () => {
    const project: JavaProject = { type: 'maven', buildFile: join(dir, 'pom.xml'), projectDir: dir, wrapper: false }
    expect(planBuild(project, 'compile').args).toEqual(['-f', join(dir, 'pom.xml'), 'compile'])
  })

  it('gradle test → -p <dir> test', () => {
    const project: JavaProject = { type: 'gradle', buildFile: join(dir, 'build.gradle'), projectDir: dir, wrapper: false }
    expect(planBuild(project, 'test').args).toEqual(['-p', dir, 'test'])
  })
})

describe('runProject（Maven 三步执行序列）', () => {
  it('编译 → dependency:build-classpath → java -cp target/classes;<deps> 主类', async () => {
    const projectDir = join(dir, 'run-mvn')
    await mkdir(projectDir, { recursive: true })
    const project: JavaProject = { type: 'maven', buildFile: join(projectDir, 'pom.xml'), projectDir, wrapper: false }
    const steps: BuildStep[] = []
    const exec: Exec = async (step) => {
      steps.push(step)
      return { exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '' }
    }
    const outcome = await runProject(project, 'com.example.App', exec, () => 'lib/dep.jar')
    expect(outcome.exitCode).toBe(0)
    expect(steps).toHaveLength(3)
    // ① 编译
    expect(steps[0].args).toEqual(['-f', join(projectDir, 'pom.xml'), 'compile'])
    // ② 依赖类路径（-q 安静 + mdep.outputFile 指向临时文件）
    expect(steps[1].args.join(' ')).toContain('dependency:build-classpath')
    expect(steps[1].args.join(' ')).toContain('-Dmdep.outputFile=')
    // ③ java：-cp 含 target/classes 与依赖，主类为最后一个参数
    expect(steps[2].command).toMatch(/^java/)
    const cpIndex = steps[2].args.indexOf('-cp')
    expect(cpIndex).toBeGreaterThan(-1)
    expect(steps[2].args[cpIndex + 1]).toContain(join(projectDir, 'target', 'classes'))
    expect(steps[2].args[cpIndex + 1]).toContain('lib/dep.jar')
    expect(steps[2].args[steps[2].args.length - 1]).toBe('com.example.App')
  })

  it('编译失败短路返回（不再执行类路径与 java）', async () => {
    const projectDir = join(dir, 'run-fail')
    await mkdir(projectDir, { recursive: true })
    const project: JavaProject = { type: 'maven', buildFile: join(projectDir, 'pom.xml'), projectDir, wrapper: false }
    const steps: BuildStep[] = []
    const exec: Exec = async (step) => {
      steps.push(step)
      return { exitCode: 1, signal: null, timedOut: false, stdout: '', stderr: 'BUILD FAILURE' }
    }
    const outcome = await runProject(project, 'com.example.App', exec, () => '')
    expect(outcome.exitCode).toBe(1)
    expect(outcome.stderr).toContain('BUILD FAILURE')
    expect(steps).toHaveLength(1)
  })
})
