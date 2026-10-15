/**
 * Host half of the video plugin.
 * It starts MoneyPrinterTurbo and answers the sidebar page on the desktop server.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, executableDirs, findExecutable, userDirectory, VideoPluginError } from './engine.js'
import { mediaPath, parseTaskId, PREFIX } from './media.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const home = userDirectory()

export const inject = ['webServer']

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const engine = new Engine({ root, home, io: nodeIO() })
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (req, res) => handle(ctx, engine, req, res),
    })
    return () => {
      dispose()
      engine.stop()
    }
  }, 'dsh-plugin-moneyprinter: route')
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Engine} engine
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handle(ctx, engine, req, res) {
  if (reject(ctx, req, res)) return
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  try {
    if (url.pathname === `${PREFIX}/media`) {
      await proxyMedia(req, res, url)
      return
    }
    if (req.method === 'GET' && url.pathname === `${PREFIX}/status`) {
      send(res, 200, engine.status())
      return
    }
    if (req.method === 'POST' && url.pathname === `${PREFIX}/start`) {
      send(res, 200, await engine.start())
      return
    }
    if (req.method === 'POST' && url.pathname === `${PREFIX}/settings`) {
      const body = await readJson(req)
      send(res, 200, await engine.saveSettings(body.deepseekApiKey, body.pexelsApiKey))
      return
    }
    if (req.method === 'POST' && url.pathname === `${PREFIX}/generate`) {
      const body = await readJson(req)
      send(res, 200, await engine.generate(body.subject, body.aspect))
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith(`${PREFIX}/tasks/`)) {
      const taskId = parseTaskId(url.pathname.slice(`${PREFIX}/tasks/`.length))
      if (taskId === null) throw new VideoPluginError('任务编号无效')
      send(res, 200, await engine.task(taskId))
      return
    }
    send(res, 404, { message: '没有这个地址' })
  } catch (cause) {
    const message = cause instanceof VideoPluginError ? cause.message : '视频插件没有完成这个请求'
    if (!(cause instanceof VideoPluginError)) ctx.logger?.error?.(cause)
    if (!res.headersSent) send(res, cause instanceof VideoPluginError ? 400 : 500, { message })
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function reject(ctx, req, res) {
  const connection = ctx.get('connection')
  const rejection = typeof connection?.requestRejection === 'function' ? connection.requestRejection(req) : undefined
  if (rejection !== undefined) {
    res.writeHead(rejection)
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return true
  }
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string' && origin.length > 0 && typeof host === 'string') {
    const protocol = ctx.webServer.protocol === 'https:' ? 'https:' : 'http:'
    if (origin !== `${protocol}//${host}`) {
      res.writeHead(403)
      res.end('forbidden')
      return true
    }
  }
  return false
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {URL} url
 */
function proxyMedia(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { message: '不能这样读取视频' })
    return
  }
  const pathname = mediaPath(url.searchParams.get('path'))
  if (pathname === null) {
    send(res, 400, { message: '视频地址无效' })
    return
  }
  const headers = {}
  if (typeof req.headers.range === 'string') headers.range = req.headers.range
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: 8080,
    path: pathname,
    method: req.method,
    headers,
  }, (incoming) => {
    if (res.headersSent) {
      incoming.destroy()
      return
    }
    const responseHeaders = {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'accept-ranges': incoming.headers['accept-ranges'] ?? 'bytes',
      'content-type': incoming.headers['content-type'] ?? 'video/mp4',
    }
    if (incoming.headers['content-length'] !== undefined) responseHeaders['content-length'] = incoming.headers['content-length']
    if (incoming.headers['content-range'] !== undefined) responseHeaders['content-range'] = incoming.headers['content-range']
    res.writeHead(incoming.statusCode ?? 502, responseHeaders)
    if (req.method === 'HEAD') {
      incoming.destroy()
      res.end()
      return
    }
    incoming.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) send(res, 502, { message: '视频文件读不出来' })
  })
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy()
  })
  upstream.end()
}

/** @param {import('node:http').IncomingMessage} req */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let failed = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 32_000) {
        failed = true
        reject(new VideoPluginError('请求太大'))
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => {
      if (failed) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        const body = text.length === 0 ? {} : JSON.parse(text)
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          reject(new VideoPluginError('请求格式不正确'))
          return
        }
        resolve(body)
      } catch {
        reject(new VideoPluginError('请求格式不正确'))
      }
    })
    req.on('error', () => { reject(new VideoPluginError('请求中断')) })
  })
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function nodeIO() {
  const platform = process.platform
  const pathValue = platform === 'win32' ? process.env.Path ?? process.env.PATH ?? '' : process.env.PATH ?? ''
  const dirs = executableDirs(platform, pathValue)
  return {
    exists: (path) => existsSync(path),
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, text) => { writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 }) },
    mkdir: (path) => { mkdirSync(path, { recursive: true, mode: 0o700 }) },
    readSettings: () => readSettings(),
    writeSettings: (settings) => { writeSettings(settings) },
    find: (name) => findExecutable(name, { platform, dirs, exists: existsSync }),
    spawn: (command, args, options) => nodeChild(spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })),
    fetch: (input, init) => globalThis.fetch(input, init),
    platform,
    env: process.env,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms) }),
  }
}

function readSettings() {
  const path = settingsPath()
  if (!existsSync(path)) return { deepseekApiKey: '', pexelsApiKey: '' }
  try {
    const body = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof body !== 'object' || body === null) return { deepseekApiKey: '', pexelsApiKey: '' }
    return {
      deepseekApiKey: typeof body.deepseekApiKey === 'string' ? body.deepseekApiKey : '',
      pexelsApiKey: typeof body.pexelsApiKey === 'string' ? body.pexelsApiKey : '',
    }
  } catch {
    return { deepseekApiKey: '', pexelsApiKey: '' }
  }
}

/** @param {{ deepseekApiKey: string, pexelsApiKey: string }} settings */
function writeSettings(settings) {
  mkdirSync(home, { recursive: true, mode: 0o700 })
  writeFileSync(settingsPath(), JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 })
}

function settingsPath() {
  return join(home, 'settings.json')
}

/** @param {import('node:child_process').ChildProcess} child */
function nodeChild(child) {
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-2000)
  })
  return {
    kill: () => { child.kill() },
    onExit: (listener) => { child.once('exit', (code) => { listener(code) }) },
    onError: (listener) => {
      child.once('error', (error) => { listener(error instanceof Error ? error : new Error(String(error))) })
    },
    readStderr: () => stderr,
  }
}
