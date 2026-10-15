/** Rewrite the MoneyPrinterTurbo config owned by the desktop plugin. */

const SECRET_TEXT = /^[\u0020-\u007e]{8,400}$/u

/** Quote one value for a TOML basic string. */
export function tomlString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Replace one top-level assignment. The example file owns these keys.
 * @param {string} text
 * @param {string} key
 * @param {string} literal
 */
export function replaceAssignment(text, key, literal) {
  const pattern = new RegExp(`^(${key}\\s*=\\s*).*$`, 'm')
  if (!pattern.test(text)) throw new Error(`配置里没有 ${key}`)
  return text.replace(pattern, (_match, prefix) => `${prefix}${literal}`)
}

/**
 * Force the API onto loopback and apply the keys the page saved.
 * @param {string} text
 * @param {{ deepseekApiKey?: string, pexelsApiKey?: string }} settings
 */
export function renderConfig(text, settings) {
  let next = replaceAssignment(text, 'listen_host', '"127.0.0.1"')
  next = replaceAssignment(next, 'listen_port', '8080')
  if (settings.deepseekApiKey) {
    next = replaceAssignment(next, 'llm_provider', '"deepseek"')
    next = replaceAssignment(next, 'deepseek_api_key', tomlString(settings.deepseekApiKey))
  }
  if (settings.pexelsApiKey) {
    next = replaceAssignment(next, 'video_source', '"pexels"')
    next = replaceAssignment(next, 'pexels_api_keys', `[${tomlString(settings.pexelsApiKey)}]`)
  }
  return next
}

/**
 * Accept a pasted API key, or an empty field meaning "keep the saved one".
 * @param {unknown} value
 * @param {string} label
 */
export function parseSecret(value, label) {
  if (typeof value !== 'string') throw new Error(`${label}不正确`)
  const secret = value.trim()
  if (secret.length === 0) return ''
  if (!SECRET_TEXT.test(secret) || secret.includes('"') || secret.includes('\\')) {
    throw new Error(`${label}格式不正确`)
  }
  return secret
}
