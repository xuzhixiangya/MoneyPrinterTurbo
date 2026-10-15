import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderConfig } from './config-file.js'
import { Engine, findExecutable } from './engine.js'
import { mediaPath, normalizeTask, playbackPath } from './media.js'

const example = readFileSync(new URL('../config.example.toml', import.meta.url), 'utf8')

test('renders the example config onto loopback and the saved keys', () => {
  const next = renderConfig(example, {
    deepseekApiKey: 'sk-test-key',
    pexelsApiKey: 'pexels-test-key',
  })
  assert.match(next, /^listen_host = "127\.0\.0\.1"$/m)
  assert.match(next, /^listen_port = 8080$/m)
  assert.match(next, /^llm_provider = "deepseek"$/m)
  assert.match(next, /^deepseek_api_key = "sk-test-key"$/m)
  assert.match(next, /^pexels_api_keys = \["pexels-test-key"\]$/m)
  assert.match(next, /^video_source = "pexels"$/m)
  assert.equal(renderConfig(next, { deepseekApiKey: 'sk-test-key', pexelsApiKey: 'pexels-test-key' }), next)
})

test('accepts only local task files', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(mediaPath(`/tasks/${id}/final.mp4`), `/tasks/${id}/final.mp4`)
  assert.equal(mediaPath(`/tasks/${id}/../secret.mp4`), null)
  assert.equal(mediaPath('http://127.0.0.1:8080/tasks/x'), null)
  assert.equal(playbackPath(`http://127.0.0.1:8080/tasks/${id}/final.mp4`), `/tasks/${id}/final.mp4`)
  assert.equal(playbackPath(`http://example.com/tasks/${id}/final.mp4`), null)
  assert.equal(playbackPath(`/tasks/${id}/clip.mp4`), `/tasks/${id}/clip.mp4`)
})

test('turns a finished engine task into a same-origin video', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'
  const view = normalizeTask({
    task_id: id,
    state: 1,
    progress: 100,
    combined_videos: [`/tasks/${id}/final.mp4`],
  })
  assert.equal(view.phase, 'complete')
  assert.equal(view.videos[0], `/plugins/dsh-plugin-moneyprinter/media?path=${encodeURIComponent(`/tasks/${id}/final.mp4`)}`)
})

test('finds an executable in the extra search directories', () => {
  const found = findExecutable('ffmpeg', {
    platform: 'darwin',
    dirs: ['/opt/homebrew/bin'],
    exists: (path) => path === '/opt/homebrew/bin/ffmpeg',
  })
  assert.equal(found, '/opt/homebrew/bin/ffmpeg')
  assert.equal(findExecutable('ffmpeg', { platform: 'darwin', dirs: ['/usr/bin'], exists: () => false }), null)
})

test('asks for keys before starting the engine', async () => {
  const engine = new Engine({
    root: '/plugin',
    home: '/tmp/mpt-user',
    io: {
      exists: () => false,
      readFile: () => '',
      writeFile: () => {},
      mkdir: () => {},
      readSettings: () => ({ deepseekApiKey: '', pexelsApiKey: '' }),
      writeSettings: () => {},
      find: () => null,
      spawn: () => { throw new Error('should not spawn') },
      fetch: async () => { throw new Error('offline') },
      platform: 'darwin',
      env: {},
      now: () => 0,
      sleep: async () => {},
    },
  })
  const status = await engine.start()
  assert.equal(status.phase, 'needs-keys')
  assert.equal(status.hasModelKey, false)
})

test('the browser entry registers the sidebar page', () => {
  const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  assert.match(source, /id: 'dsh-plugin-moneyprinter'/)
  assert.match(source, /sidebar\.panellist/)
  assert.match(source, /key: 'moneyprinter'/)
  assert.match(source, /生成视频/)
})
