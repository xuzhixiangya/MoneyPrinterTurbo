window.__ModuleLoader__.load({
  id: 'dsh-plugin-moneyprinter',
  factory(require) {
    const React = require('react')
    const { Button, Input, SegmentedControl } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const PREFIX = '/plugins/dsh-plugin-moneyprinter'
    const NS = 'moneyprinter'

    const zh = {
      panel: '生成视频',
      title: '生成视频',
      lead: '写一个主题。这台电脑会写文案、配音、找素材，然后合成一条短视频。',
      modelKey: 'DeepSeek API Key',
      pexelsKey: 'Pexels API Key',
      keyHint: '两把钥匙只保存在这台电脑上。保存之后，页面不会再显示它们。',
      keyPlaceholder: '粘贴钥匙',
      keyKeep: '已保存，留空则不修改',
      save: '保存并准备',
      subject: '主题',
      subjectPlaceholder: '例如：人工智能如何改变普通人的一天',
      aspect: '画幅',
      portrait: '竖屏 9:16',
      landscape: '横屏 16:9',
      square: '方形 1:1',
      generate: '生成视频',
      retry: '重试',
      editKeys: '修改钥匙',
      storage: '成片保存在',
      preparing: '正在准备视频引擎',
      result: '成片',
      progress: '生成进度',
    }

    const en = {
      panel: 'Generate video',
      title: 'Generate video',
      lead: 'Write a topic. This computer writes the script, records the voice, finds footage, and builds a short video.',
      modelKey: 'DeepSeek API key',
      pexelsKey: 'Pexels API key',
      keyHint: 'Both keys stay on this computer. After you save them, this page does not show them again.',
      keyPlaceholder: 'Paste a key',
      keyKeep: 'Saved. Leave blank to keep it',
      save: 'Save and prepare',
      subject: 'Topic',
      subjectPlaceholder: 'For example: how AI changes an ordinary day',
      aspect: 'Frame',
      portrait: 'Portrait 9:16',
      landscape: 'Landscape 16:9',
      square: 'Square 1:1',
      generate: 'Generate video',
      retry: 'Try again',
      editKeys: 'Change keys',
      storage: 'Videos are saved in',
      preparing: 'Preparing the video engine',
      result: 'Video',
      progress: 'Progress',
    }

    const css = `
      .mpt-page { box-sizing: border-box; height: 100%; overflow: auto; padding: 32px 36px 48px; color: var(--dsw-alias-label-primary); }
      .mpt-page * { box-sizing: border-box; }
      .mpt-sheet { max-width: 720px; display: flex; flex-direction: column; gap: 20px; }
      .mpt-title { margin: 0; font-size: 22px; line-height: 30px; font-weight: 600; }
      .mpt-lead, .mpt-note { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
      .mpt-field { display: flex; flex-direction: column; gap: 8px; }
      .mpt-label { font-size: 13px; line-height: 20px; font-weight: 600; }
      .mpt-topic { width: 100%; min-height: 96px; resize: vertical; padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; background: transparent; color: inherit; font: inherit; }
      .mpt-topic:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
      .mpt-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .mpt-detail { margin: 0; font-size: 14px; line-height: 22px; }
      .mpt-error { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 14px; line-height: 22px; }
      .mpt-bar { height: 6px; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-border-l2); overflow: hidden; }
      .mpt-bar > span { display: block; height: 100%; background: var(--dsw-alias-state-business-primary); }
      .mpt-video { width: 100%; max-height: 70vh; border-radius: 12px; background: var(--dsw-alias-bg-base); }
      .mpt-path { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; word-break: break-all; }
    `

    function call(path, init) {
      return fetch(`${PREFIX}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init && init.headers) },
      }).then(async (response) => {
        const text = await response.text()
        let body = {}
        try { body = text ? JSON.parse(text) : {} } catch { body = {} }
        if (!response.ok) throw new Error(typeof body.message === 'string' && body.message ? body.message : '视频插件没有正常响应')
        return body
      })
    }

    function messageOf(cause) {
      return cause instanceof Error ? cause.message : '视频插件没有正常响应'
    }

    function PanelIcon({ size }) {
      const edge = typeof size === 'number' ? size : 16
      return h('svg', {
        width: edge, height: edge, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
      },
      h('rect', { x: '1.5', y: '3', width: '13', height: '10', rx: '2', stroke: 'currentColor', strokeWidth: '1.25' }),
      h('path', { d: 'M6.5 6.15v3.7L10.4 8 6.5 6.15Z', fill: 'currentColor' }))
    }

    function Page({ t }) {
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState('')
      const [subject, setSubject] = React.useState('')
      const [aspect, setAspect] = React.useState('9:16')
      const [modelKey, setModelKey] = React.useState('')
      const [pexelsKey, setPexelsKey] = React.useState('')
      const [editing, setEditing] = React.useState(false)
      const [task, setTask] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const started = React.useRef(false)

      React.useEffect(() => {
        let stopped = false
        const tick = () => {
          call('/status').then((next) => { if (!stopped) setStatus(next) }).catch((cause) => {
            if (!stopped) setError(messageOf(cause))
          })
        }
        tick()
        const timer = window.setInterval(tick, 2000)
        return () => { stopped = true; window.clearInterval(timer) }
      }, [])

      React.useEffect(() => {
        if (!status || started.current) return undefined
        if (status.phase !== 'stopped' || !status.hasModelKey || !status.hasPexelsKey) return undefined
        started.current = true
        let stopped = false
        setBusy(true)
        call('/start', { method: 'POST', body: '{}' }).then((next) => {
          if (!stopped) setStatus(next)
        }).catch((cause) => {
          if (!stopped) setError(messageOf(cause))
        }).finally(() => { if (!stopped) setBusy(false) })
        return () => { stopped = true }
      }, [status])

      React.useEffect(() => {
        if (!task || task.phase !== 'running') return undefined
        let stopped = false
        const timer = window.setTimeout(() => {
          call(`/tasks/${task.taskId}`).then((next) => { if (!stopped) setTask(next) }).catch((cause) => {
            if (!stopped) setError(messageOf(cause))
          })
        }, 2000)
        return () => { stopped = true; window.clearTimeout(timer) }
      }, [task])

      const needsKeys = status === null || !status.hasModelKey || !status.hasPexelsKey
      const showKeys = needsKeys || editing
      const engineDetail = status && status.detail ? status.detail : status && (status.phase === 'installing' || status.phase === 'starting') ? t('preparing') : ''

      async function onSave() {
        setBusy(true)
        setError('')
        try {
          const next = await call('/settings', {
            method: 'POST',
            body: JSON.stringify({ deepseekApiKey: modelKey, pexelsApiKey: pexelsKey }),
          })
          started.current = true
          setStatus(next)
          setModelKey('')
          setPexelsKey('')
          setEditing(false)
        } catch (cause) {
          setError(messageOf(cause))
        } finally {
          setBusy(false)
        }
      }

      async function onStart() {
        setBusy(true)
        setError('')
        try {
          setStatus(await call('/start', { method: 'POST', body: '{}' }))
        } catch (cause) {
          setError(messageOf(cause))
        } finally {
          setBusy(false)
        }
      }

      async function onGenerate() {
        setBusy(true)
        setError('')
        setTask(null)
        try {
          setTask(await call('/generate', {
            method: 'POST',
            body: JSON.stringify({ subject, aspect }),
          }))
        } catch (cause) {
          setError(messageOf(cause))
        } finally {
          setBusy(false)
        }
      }

      const video = task && task.videos && task.videos.length > 0 ? task.videos[0] : ''
      return h('section', { className: 'mpt-page' }, h('div', { className: 'mpt-sheet' },
        h('h1', { className: 'mpt-title' }, t('title')),
        h('p', { className: 'mpt-lead' }, t('lead')),
        showKeys ? h('div', { className: 'mpt-field' },
          h('p', { className: 'mpt-note' }, t('keyHint')),
          h('label', { className: 'mpt-label', htmlFor: 'mpt-model-key' }, t('modelKey')),
          h(Input, {
            id: 'mpt-model-key', type: 'password', autoComplete: 'off', value: modelKey,
            placeholder: status && status.hasModelKey ? t('keyKeep') : t('keyPlaceholder'),
            onChange: (event) => { setModelKey(event.target.value) },
          }),
          h('label', { className: 'mpt-label', htmlFor: 'mpt-pexels-key' }, t('pexelsKey')),
          h(Input, {
            id: 'mpt-pexels-key', type: 'password', autoComplete: 'off', value: pexelsKey,
            placeholder: status && status.hasPexelsKey ? t('keyKeep') : t('keyPlaceholder'),
            onChange: (event) => { setPexelsKey(event.target.value) },
          }),
          h('div', { className: 'mpt-actions' }, h(Button, { variant: 'primary', disabled: busy, onClick: () => { void onSave() } }, t('save'))),
        ) : null,
        !showKeys ? h('div', { className: 'mpt-actions' }, h(Button, { variant: 'ghost', onClick: () => { setEditing(true) } }, t('editKeys'))) : null,
        engineDetail ? h('p', { className: 'mpt-detail' }, engineDetail) : null,
        status && (status.phase === 'failed' || status.phase === 'needs-runtime')
          ? h('div', { className: 'mpt-actions' }, h(Button, { variant: 'outline', disabled: busy, onClick: () => { void onStart() } }, t('retry')))
          : null,
        h('div', { className: 'mpt-field' },
          h('label', { className: 'mpt-label', htmlFor: 'mpt-subject' }, t('subject')),
          h('textarea', {
            id: 'mpt-subject', className: 'mpt-topic', value: subject, maxLength: 200,
            placeholder: t('subjectPlaceholder'),
            onChange: (event) => { setSubject(event.target.value) },
          }),
        ),
        h('div', { className: 'mpt-field' },
          h(SegmentedControl, {
            id: 'mpt-aspect',
            label: t('aspect'),
            value: aspect,
            onChange: setAspect,
            options: [
              { value: '9:16', label: t('portrait') },
              { value: '16:9', label: t('landscape') },
              { value: '1:1', label: t('square') },
            ],
          }),
        ),
        h('div', { className: 'mpt-actions' }, h(Button, {
          variant: 'primary',
          disabled: busy || !status || status.phase !== 'ready' || subject.trim().length === 0 || (task && task.phase === 'running'),
          onClick: () => { void onGenerate() },
        }, t('generate'))),
        task ? h('div', { className: 'mpt-field' },
          h('span', { className: 'mpt-label' }, t('progress')),
          h('div', { className: 'mpt-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': task.progress },
            h('span', { style: { width: `${task.progress}%` } })),
          task.detail ? h('p', { className: 'mpt-error' }, task.detail) : null,
        ) : null,
        video ? h('video', { className: 'mpt-video', controls: true, src: video, 'aria-label': t('result') }) : null,
        error ? h('p', { className: 'mpt-error' }, error) : null,
        status && status.storage ? h('p', { className: 'mpt-path' }, `${t('storage')} ${status.storage}`) : null,
      ))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'moneyprinter: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-moneyprinter', '')
          style.textContent = css
          document.head.append(style)
          return () => { style.remove() }
        }, 'moneyprinter: styles')
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'moneyprinter',
          order: 30,
          label: () => t('panel'),
          locale: NS,
        }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'moneyprinter',
          locale: NS,
        }, Page))
      },
    }
  },
})
