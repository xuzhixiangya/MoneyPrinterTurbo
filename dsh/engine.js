/**
 * Local MoneyPrinterTurbo process.
 * The page talks to the desktop server. This module starts the API.
 */

import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import { parseSecret, renderConfig } from './config-file.js'
import { normalizeTask, parseTaskId } from './media.js'

const READY_TIMEOUT_MS = 45_000
const INSTALL_TIMEOUT_MS = 10 * 60_000
const PING_TIMEOUT_MS = 1_500
const API_TIMEOUT_MS = 20_000
const ENGINE_ORIGIN = 'http://127.0.0.1:8080'
const SUBJECT_MAX = 200

export class VideoPluginError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'VideoPluginError'
  }
}

/** @param {NodeJS.Platform} platform */
export function executableDirs(platform, pathValue = '') {
  const extras = platform === 'win32'
    ? [join(homedir(), '.local', 'bin')]
    : ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')]
  const dirs = []
  for (const dir of [...extras, ...pathValue.split(delimiter)]) {
    if (dir.length > 0 && !dirs.includes(dir)) dirs.push(dir)
  }
  return dirs
}

/**
 * @param {string} name
 * @param {{ platform: NodeJS.Platform, dirs: readonly string[], exists: (path: string) => boolean }} io
 */
export function findExecutable(name, io) {
  const extensions = io.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of io.dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`)
      if (io.exists(candidate)) return candidate
    }
  }
  return null
}

/** @param {NodeJS.Platform} platform */
export function venvPython(root, platform) {
  return join(root, platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
}

export function userDirectory() {
  return join(homedir(), '.dsh-moneyprinter')
}

/**
 * @param {{
 *   root: string,
 *   home: string,
 *   io: {
 *     exists: (path: string) => boolean,
 *     readFile: (path: string) => string,
 *     writeFile: (path: string, text: string) => void,
 *     mkdir: (path: string) => void,
 *     readSettings: () => { deepseekApiKey: string, pexelsApiKey: string },
 *     writeSettings: (settings: { deepseekApiKey: string, pexelsApiKey: string }) => void,
 *     find: (name: string) => string | null,
 *     spawn: (command: string, args: readonly string[], options: { cwd: string, env: NodeJS.ProcessEnv }) => {
 *       kill: () => void,
 *       onExit: (listener: (code: number | null) => void) => void,
 *       onError: (listener: (error: Error) => void) => void,
 *       readStderr: () => string,
 *     },
 *     fetch: (input: string, init?: RequestInit) => Promise<Response>,
 *     platform: NodeJS.Platform,
 *     env: NodeJS.ProcessEnv,
 *     now: () => number,
 *     sleep: (ms: number) => Promise<void>,
 *   },
 * }} options
 */
export class Engine {
  /** @param {ConstructorParameters<typeof Engine>[0] extends never ? never : any} options */
  constructor(options) {
    this.root = options.root
    this.home = options.home
    this.io = options.io
    this.settings = sanitizeSettings(options.io.readSettings())
    this.phase = 'stopped'
    this.detail = ''
    this.child = undefined
    this.pending = undefined
  }

  status() {
    return {
      phase: this.phase,
      detail: this.detail,
      hasModelKey: this.settings.deepseekApiKey.length > 0,
      hasPexelsKey: this.settings.pexelsApiKey.length > 0,
      storage: join(this.home, 'storage'),
    }
  }

  start() {
    this.pending ??= this.startOnce().finally(() => { this.pending = undefined })
    return this.pending
  }

  stop() {
    const child = this.child
    this.child = undefined
    child?.kill()
  }

  /**
   * @param {unknown} deepseekApiKey
   * @param {unknown} pexelsApiKey
   */
  async saveSettings(deepseekApiKey, pexelsApiKey) {
    const next = {
      deepseekApiKey: parseSecret(deepseekApiKey, 'DeepSeek API Key') || this.settings.deepseekApiKey,
      pexelsApiKey: parseSecret(pexelsApiKey, 'Pexels API Key') || this.settings.pexelsApiKey,
    }
    const changed = next.deepseekApiKey !== this.settings.deepseekApiKey || next.pexelsApiKey !== this.settings.pexelsApiKey
    this.settings = next
    this.io.writeSettings(next)
    if (changed) this.stop()
    if (next.deepseekApiKey.length === 0 || next.pexelsApiKey.length === 0) {
      this.phase = 'needs-keys'
      this.detail = '请先填写 DeepSeek 和 Pexels 的 API Key'
      return this.status()
    }
    return this.start()
  }

  /**
   * @param {unknown} subject
   * @param {unknown} aspect
   */
  async generate(subject, aspect) {
    const topic = parseSubject(subject)
    const ratio = parseAspect(aspect)
    const status = await this.start()
    if (status.phase !== 'ready') throw new VideoPluginError(status.detail || '视频引擎还没准备好')
    const data = await this.requestJson('/api/v1/videos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        video_subject: topic,
        video_aspect: ratio,
        video_source: 'pexels',
        voice_name: 'zh-CN-XiaoxiaoNeural-Female',
        bgm_type: 'random',
        subtitle_enabled: true,
        paragraph_number: 1,
        video_count: 1,
      }),
    })
    if (!isRecord(data) || typeof data.task_id !== 'string') throw new VideoPluginError('视频引擎没有返回任务编号')
    const taskId = parseTaskId(data.task_id)
    if (taskId === null) throw new VideoPluginError('任务编号无效')
    return { taskId, phase: 'running', progress: 0, detail: '', videos: [] }
  }

  /** @param {unknown} taskId */
  async task(taskId) {
    const id = parseTaskId(taskId)
    if (id === null) throw new VideoPluginError('任务编号无效')
    return normalizeTask(await this.requestJson(`/api/v1/tasks/${id}`))
  }

  async startOnce() {
    if (await this.ping()) {
      this.phase = 'ready'
      this.detail = ''
      return this.status()
    }
    if (this.settings.deepseekApiKey.length === 0 || this.settings.pexelsApiKey.length === 0) {
      this.phase = 'needs-keys'
      this.detail = '请先填写 DeepSeek 和 Pexels 的 API Key'
      return this.status()
    }
    if (this.io.find('ffmpeg') === null) {
      this.phase = 'needs-runtime'
      this.detail = '没有找到 ffmpeg。macOS 可以执行 brew install ffmpeg'
      return this.status()
    }
    const pythonPath = venvPython(this.root, this.io.platform)
    const hasPython = this.io.exists(pythonPath)
    if (!hasPython && this.io.find('uv') === null) {
      this.phase = 'needs-runtime'
      this.detail = '没有找到 uv。请先安装 https://docs.astral.sh/uv/ ，装好后点重试'
      return this.status()
    }
    try {
      this.writeConfig()
    } catch (cause) {
      this.phase = 'failed'
      this.detail = cause instanceof Error ? cause.message : '无法写入视频配置'
      return this.status()
    }
    if (!hasPython) {
      this.phase = 'installing'
      this.detail = '正在安装 Python 依赖，第一次可能要几分钟'
      const uv = this.io.find('uv')
      try {
        await this.run(uv, ['sync', '--frozen'], INSTALL_TIMEOUT_MS)
      } catch (cause) {
        this.phase = 'failed'
        this.detail = cause instanceof Error ? cause.message : '安装 Python 依赖失败'
        return this.status()
      }
      if (!this.io.exists(pythonPath)) {
        this.phase = 'failed'
        this.detail = '依赖安装结束了，但没有找到项目里的 Python'
        return this.status()
      }
    }
    if (this.child !== undefined) {
      try {
        await this.waitUntilReady(this.child)
      } catch (cause) {
        this.noteFailure(this.child, cause)
      }
      return this.status()
    }
    const child = this.io.spawn(pythonPath, ['main.py'], {
      cwd: this.root,
      env: this.childEnv(),
    })
    this.child = child
    this.phase = 'starting'
    this.detail = '正在启动视频引擎'
    this.watch(child)
    try {
      await this.waitUntilReady(child)
      this.phase = 'ready'
      this.detail = ''
    } catch (cause) {
      this.noteFailure(child, cause)
    }
    return this.status()
  }

  writeConfig() {
    const target = join(this.home, 'config.toml')
    const example = join(this.root, 'config.example.toml')
    if (!this.io.exists(example) && !this.io.exists(target)) throw new VideoPluginError('找不到视频项目')
    this.io.mkdir(this.home)
    this.io.mkdir(join(this.home, 'storage'))
    const current = this.io.exists(target) ? this.io.readFile(target) : this.io.readFile(example)
    const next = renderConfig(current, this.settings)
    if (!this.io.exists(target) || next !== current) this.io.writeFile(target, next)
  }

  /** @param {string | null} command @param {readonly string[]} args @param {number} timeoutMs */
  async run(command, args, timeoutMs) {
    if (command === null) throw new VideoPluginError('没有找到 uv')
    const child = this.io.spawn(command, args, { cwd: this.root, env: this.childEnv() })
    let settled = false
    const code = await new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      const timer = setTimeout(() => {
        child.kill()
        finish(reject, new VideoPluginError('安装 Python 依赖超时'))
      }, timeoutMs)
      child.onError((error) => { finish(reject, error) })
      child.onExit((exitCode) => { finish(resolve, exitCode) })
    })
    if (code !== 0) {
      const line = lastLine(child.readStderr())
      throw new VideoPluginError(line.length > 0 ? `安装 Python 依赖失败：${line}` : '安装 Python 依赖失败')
    }
  }

  /** @param {ReturnType<Engine['io']['spawn']>} child */
  watch(child) {
    child.onExit(() => {
      if (this.child !== child) return
      this.child = undefined
      if (this.phase === 'ready' || this.phase === 'starting') {
        const line = lastLine(child.readStderr())
        this.phase = 'failed'
        this.detail = line.length > 0 ? line : '视频引擎退出了'
      }
    })
    child.onError((error) => {
      if (this.child === child) this.child = undefined
      this.phase = 'failed'
      this.detail = error.message
    })
  }

  /** @param {ReturnType<Engine['io']['spawn']>} child @param {unknown} cause */
  noteFailure(child, cause) {
    const message = cause instanceof Error ? cause.message : '启动视频引擎失败'
    const line = lastLine(child.readStderr())
    this.detail = (line.length > 0 ? `${message}：${line}` : message).slice(0, 400)
    this.phase = 'failed'
    child.kill()
    if (this.child === child) this.child = undefined
  }

  /** @param {ReturnType<Engine['io']['spawn']>} child */
  async waitUntilReady(child) {
    const deadline = this.io.now() + READY_TIMEOUT_MS
    while (this.io.now() < deadline) {
      if (this.child !== child) {
        throw new VideoPluginError(this.detail || '视频引擎启动后马上退出了')
      }
      if (await this.ping()) return
      await this.io.sleep(400)
    }
    throw new VideoPluginError('视频引擎启动超时。请确认本机有 uv 和 ffmpeg')
  }

  async ping() {
    try {
      const response = await this.io.fetch(`${ENGINE_ORIGIN}/ping`, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) })
      if (!response.ok) return false
      const text = await response.text()
      return text.replaceAll('"', '').trim() === 'pong'
    } catch {
      return false
    }
  }

  /** @param {string} path @param {RequestInit} [init] */
  async requestJson(path, init) {
    let response
    try {
      response = await this.io.fetch(`${ENGINE_ORIGIN}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      })
    } catch {
      throw new VideoPluginError('视频引擎没有响应')
    }
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text.slice(0, 1_000_000))
    } catch {
      body = undefined
    }
    const message = isRecord(body) && typeof body.message === 'string' ? body.message : ''
    if (!response.ok || (isRecord(body) && typeof body.status === 'number' && body.status >= 400)) {
      throw new VideoPluginError(message || `视频引擎返回 ${response.status}`)
    }
    return isRecord(body) && 'data' in body ? body.data : body
  }

  childEnv() {
    const pathValue = this.io.platform === 'win32' ? this.io.env.Path ?? this.io.env.PATH ?? '' : this.io.env.PATH ?? ''
    const pathText = executableDirs(this.io.platform, pathValue).join(delimiter)
    return {
      ...this.io.env,
      PATH: pathText,
      Path: pathText,
      PYTHONUNBUFFERED: '1',
      MPT_CONFIG_FILE: join(this.home, 'config.toml'),
      MPT_STORAGE_DIR: join(this.home, 'storage'),
    }
  }
}

/** @param {unknown} value */
function sanitizeSettings(value) {
  const record = isRecord(value) ? value : {}
  return {
    deepseekApiKey: typeof record.deepseekApiKey === 'string' ? record.deepseekApiKey : '',
    pexelsApiKey: typeof record.pexelsApiKey === 'string' ? record.pexelsApiKey : '',
  }
}

/** @param {unknown} value */
function parseSubject(value) {
  if (typeof value !== 'string') throw new VideoPluginError('请先写一个视频主题')
  const subject = value.trim()
  if (subject.length === 0) throw new VideoPluginError('请先写一个视频主题')
  if (subject.length > SUBJECT_MAX) throw new VideoPluginError('主题太长了，请缩短到 200 字以内')
  return subject
}

/** @param {unknown} value */
function parseAspect(value) {
  if (value === '9:16' || value === '16:9' || value === '1:1') return value
  throw new VideoPluginError('画幅不正确')
}

/** @param {string} stderr */
function lastLine(stderr) {
  return (stderr.trim().split('\n').at(-1)?.trim() ?? '').slice(0, 300)
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
