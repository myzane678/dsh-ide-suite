/**
 * 构建任务服务（host 侧，纯逻辑可测）：Java 项目识别 + 构建/运行命令构造与执行。
 *
 * 与 /dsh-ide/run 的单文件运行互补——本项目级「构建/运行」：
 *  - Maven 项目：mvnw/mvn 编译；运行 = 编译 + dependency:build-classpath 取依赖
 *    类路径 + java 启动（主类自动探测 src/main/java）。
 *  - Gradle 项目：gradlew/gradle 编译；运行 = gradlew run（要求 application 插件，
 *    mainClass 由 Gradle 自身解析，不做主类探测）。
 *  - 文件系统访问全部经注入原语（listDir/readFile/exec），单测不碰真实子进程。
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type JavaProjectType = 'maven' | 'gradle'
export type BuildTask = 'compile' | 'test' | 'run'

export interface DirEntry {
  name: string
  isDir: boolean
}
export type ListDir = (absDir: string) => DirEntry[]
export type ReadFile = (absFile: string) => string

export interface JavaProject {
  type: JavaProjectType
  /** 构建文件绝对路径（pom.xml / settings.gradle / build.gradle）。 */
  buildFile: string
  /** 项目目录（构建文件所在目录，也是构建进程 cwd）。 */
  projectDir: string
  /** 是否存在 wrapper（mvnw / gradlew），存在时优先于系统命令。 */
  wrapper: boolean
}

export interface BuildStep {
  command: string
  args: string[]
  cwd: string
}

export interface ExecOutcome {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
}

export type Exec = (step: BuildStep) => Promise<ExecOutcome>

/** 构建超时（mvn/gradle 冷启动与依赖下载远超单文件运行的 60s）。 */
export const BUILD_TIMEOUT_MS = 120_000
/** 构建输出上限（mvn 依赖下载日志可很大）。 */
export const BUILD_OUTPUT_CAP = 8 * 1024 * 1024
/** 项目识别向下扫描的最大目录深度（root 自身为 0）。 */
export const PROJECT_SCAN_DEPTH = 4

const isWin = process.platform === 'win32'
/** 类路径分隔符（java -cp）。 */
const CP_SEP = isWin ? ';' : ':'
const MAIN_SCAN_DIR = 'src/main/java'
const MAIN_METHOD_RE = /\bpublic\s+static\s+void\s+main\s*\(/

/** 构建产物/依赖目录——扫描项目时永不进入。 */
function isSkipDir(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'node_modules' || lower === '.git' || lower === 'target' || lower === 'build' || lower === 'dist' || lower === 'out'
}

/** 工具命令名（走 PATH）：Windows 下 .cmd 由执行层 shell 包装。 */
function toolCommand(name: 'mvn' | 'gradle'): string {
  return isWin ? `${name}.cmd` : name
}

function mavenCommand(project: JavaProject): string {
  if (project.wrapper) return join(project.projectDir, isWin ? 'mvnw.cmd' : 'mvnw')
  return toolCommand('mvn')
}

function gradleCommand(project: JavaProject): string {
  if (project.wrapper) return join(project.projectDir, isWin ? 'gradlew.bat' : 'gradlew')
  return toolCommand('gradle')
}

/**
 * 在工作区 root 下识别 Java 项目（BFS 下探 PROJECT_SCAN_DEPTH 层）：
 * pom.xml → Maven；settings.gradle / build.gradle → Gradle；同目录 Maven 优先。
 * 找不到返回 null。跳过构建产物目录，避免把 target/build 里的样本当项目。
 */
export function detectJavaProject(root: string, listDir: ListDir): JavaProject | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (queue.length > 0) {
    const head = queue.shift()
    if (head === undefined) break
    const { dir, depth } = head
    if (depth > PROJECT_SCAN_DEPTH) continue
    let entries: DirEntry[]
    try {
      entries = listDir(dir)
    } catch {
      continue
    }
    const lower = new Set(entries.map((entry) => entry.name.toLowerCase()))
    if (lower.has('pom.xml')) {
      return {
        type: 'maven',
        buildFile: join(dir, 'pom.xml'),
        projectDir: dir,
        wrapper: lower.has('mvnw.cmd') || lower.has('mvnw'),
      }
    }
    if (lower.has('settings.gradle') || lower.has('build.gradle')) {
      return {
        type: 'gradle',
        buildFile: join(dir, lower.has('settings.gradle') ? 'settings.gradle' : 'build.gradle'),
        projectDir: dir,
        wrapper: lower.has('gradlew.bat') || lower.has('gradlew'),
      }
    }
    for (const entry of entries) {
      if (entry.isDir && !isSkipDir(entry.name)) {
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 })
      }
    }
  }
  return null
}

/**
 * 递归扫描 <projectDir>/src/main/java 找含 main 方法的类（标准 Maven 布局）。
 * 返回完整限定类名（相对 src/main/java 的目录推断 package），按名排序。
 */
export function findMainClasses(projectDir: string, listDir: ListDir, readFile: ReadFile): string[] {
  const result: string[] = []
  const walk = (absDir: string, relDir: string): void => {
    let entries: DirEntry[]
    try {
      entries = listDir(absDir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDir) {
        if (!isSkipDir(entry.name)) walk(join(absDir, entry.name), relDir === '' ? entry.name : `${relDir}/${entry.name}`)
      } else if (entry.name.endsWith('.java')) {
        const source = readFile(join(absDir, entry.name))
        if (MAIN_METHOD_RE.test(source)) {
          const className = entry.name.slice(0, -'.java'.length)
          result.push(relDir === '' ? className : `${relDir.replaceAll('/', '.')}.${className}`)
        }
      }
    }
  }
  walk(join(projectDir, MAIN_SCAN_DIR), '')
  return result.sort()
}

/** 编译/测试任务 → 单步构建计划（纯构造，无副作用）。 */
export function planBuild(project: JavaProject, task: 'compile' | 'test'): BuildStep {
  if (project.type === 'maven') {
    return { command: mavenCommand(project), args: ['-f', project.buildFile, task], cwd: project.projectDir }
  }
  return {
    command: gradleCommand(project),
    args: ['-p', project.projectDir, task === 'compile' ? 'compileJava' : 'test'],
    cwd: project.projectDir,
  }
}

/** 运行单步并返回（构建专用超时/输出上限由 exec 实现决定）。 */
async function runStep(step: BuildStep, exec: Exec): Promise<ExecOutcome> {
  return exec(step)
}

/**
 * 运行项目：
 *  - Gradle：gradlew run（要求 application 插件，类路径由 Gradle 处理）。
 *  - Maven：mvn compile → mvn dependency:build-classpath（临时文件）→
 *    java -cp target/classes;<依赖> <mainClass>。
 * 任一步骤失败即返回该步输出（含编译错误/退出码），前端原样展示。
 */
export async function runProject(
  project: JavaProject,
  mainClass: string,
  exec: Exec,
  readFile: ReadFile = (file) => readFileSync(file, 'utf8'),
): Promise<ExecOutcome> {
  if (project.type === 'gradle') {
    return runStep({ command: gradleCommand(project), args: ['-p', project.projectDir, 'run'], cwd: project.projectDir }, exec)
  }
  const compile = await runStep(planBuild(project, 'compile'), exec)
  if (compile.exitCode !== 0) return compile
  const cpFile = join(tmpdir(), `dsh-ide-java-cp-${randomBytes(8).toString('hex')}.txt`)
  try {
    const classpathStep = await runStep({
      command: mavenCommand(project),
      args: ['-f', project.buildFile, '-q', 'dependency:build-classpath', `-Dmdep.outputFile=${cpFile}`],
      cwd: project.projectDir,
    }, exec)
    if (classpathStep.exitCode !== 0) return classpathStep
    let classpath: string
    try {
      classpath = readFile(cpFile).trim().replace(/^"|"$/g, '')
    } catch {
      return { exitCode: 1, signal: null, timedOut: false, stdout: '', stderr: '无法读取依赖类路径输出文件' }
    }
    const classesDir = join(project.projectDir, 'target', 'classes')
    return runStep({
      command: isWin ? 'java.exe' : 'java',
      args: [
        '-Dfile.encoding=UTF-8',
        '-Dsun.stdout.encoding=UTF-8',
        '-Dsun.stderr.encoding=UTF-8',
        '-cp', `${classesDir}${CP_SEP}${classpath}`,
        mainClass,
      ],
      cwd: project.projectDir,
    }, exec)
  } finally {
    try {
      rmSync(cpFile, { force: true })
    } catch {
      // 临时文件清理失败不影响结果。
    }
  }
}
