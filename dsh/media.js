/** Task files the page is allowed to play. The browser never talks to port 8080. */

const TASK_FILE = /^\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/[A-Za-z0-9._~-]+)+$/iu
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const PREFIX = '/plugins/dsh-plugin-moneyprinter'

/** @param {unknown} value */
export function parseTaskId(value) {
  if (typeof value !== 'string' || !TASK_ID.test(value)) return null
  return value.toLowerCase()
}

/** @param {unknown} value */
export function mediaPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null
  if (value.includes('\\') || value.includes('..') || value.includes('%') || value.includes('?') || value.includes('#')) {
    return null
  }
  return TASK_FILE.test(value) ? value : null
}

/**
 * Keep a task file path from the engine response.
 * Absolute addresses are accepted only from the local engine.
 * @param {unknown} value
 */
export function playbackPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  if (value.startsWith('http://') || value.startsWith('https://')) {
    let url
    try {
      url = new URL(value)
    } catch {
      return null
    }
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    if (!local || url.port !== '8080' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      return null
    }
    try {
      return mediaPath(decodeURI(url.pathname))
    } catch {
      return null
    }
  }
  return mediaPath(value.startsWith('/') ? value : `/${value}`)
}

/** @param {string} pathname */
export function mediaUrl(pathname) {
  return `${PREFIX}/media?path=${encodeURIComponent(pathname)}`
}

/**
 * Turn one MoneyPrinterTurbo task record into the page's view.
 * @param {unknown} data
 */
export function normalizeTask(data) {
  if (!isRecord(data) || typeof data.task_id !== 'string') throw new Error('视频引擎没有返回任务')
  const videos = taskVideos(data)
  const error = typeof data.error === 'string' ? data.error.trim() : ''
  const state = typeof data.state === 'number' && Number.isFinite(data.state) ? data.state : 0
  const progress = clampProgress(data.progress)
  const phase = error.length > 0 || state < 0 ? 'failed' : state === 1 || progress >= 100 ? 'complete' : 'running'
  const taskId = parseTaskId(data.task_id)
  if (taskId === null) throw new Error('任务编号无效')
  return {
    taskId,
    phase,
    progress,
    detail: phase === 'failed' ? error.slice(0, 400) : '',
    videos,
  }
}

/** @param {Record<string, unknown>} data */
function taskVideos(data) {
  const combined = readStrings(data.combined_videos)
  const source = combined.length > 0 ? combined : readStrings(data.videos)
  const videos = []
  for (const item of source) {
    const pathname = playbackPath(item)
    if (pathname !== null && !videos.includes(mediaUrl(pathname))) videos.push(mediaUrl(pathname))
    if (videos.length === 5) break
  }
  return videos
}

/** @param {unknown} value */
function readStrings(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.length > 0)
}

/** @param {unknown} value */
function clampProgress(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export { PREFIX }
