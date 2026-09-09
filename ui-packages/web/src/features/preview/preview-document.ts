import { LOCAL_DB_PORT_KEY } from '@gamma-compose/local-db/bridge'
import type { PreviewConsoleLevel, PreviewErrorSource } from './preview-diagnostics'

export type PreviewMessage =
  | { type: 'preview:loaded' }
  | {
      type: 'preview:error'
      phase: 'load' | 'runtime'
      source: PreviewErrorSource
      fatal: boolean
      message: string
      stack?: string
    }
  | { type: 'preview:console'; level: PreviewConsoleLevel; message: string }

const errorSources: readonly PreviewErrorSource[] = [
  'module',
  'window',
  'promise',
  'form',
  'security-policy',
  'harness',
]
const consoleLevels: readonly PreviewConsoleLevel[] = ['debug', 'log', 'info', 'warn', 'error']

export const isPreviewMessage = (value: unknown): value is PreviewMessage => {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  if (value.type === 'preview:loaded') return true
  if (
    value.type === 'preview:error' &&
    'phase' in value &&
    (value.phase === 'load' || value.phase === 'runtime') &&
    'source' in value &&
    errorSources.includes(value.source as PreviewErrorSource) &&
    'fatal' in value &&
    typeof value.fatal === 'boolean' &&
    'message' in value &&
    typeof value.message === 'string' &&
    (!('stack' in value) || value.stack === undefined || typeof value.stack === 'string')
  )
    return true
  return (
    value.type === 'preview:console' &&
    'level' in value &&
    consoleLevels.includes(value.level as PreviewConsoleLevel) &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

// Serialized into the isolated document: keep every runtime dependency inside this function.
function bootPreview(portKey: string) {
  let started = false
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const truncate = (value: string) => {
    const bytes = encoder.encode(value)
    return bytes.byteLength <= 8 * 1024
      ? value
      : `${decoder.decode(bytes.slice(0, 8 * 1024 - 32))}\n[Message truncated]`
  }
  const format = (value: unknown) => {
    if (typeof value === 'string') return value
    if (value instanceof Error)
      return [value.name, value.message, value.stack].filter(Boolean).join(': ')
    if (typeof value === 'bigint') return `${value}n`
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
    if (typeof value === 'symbol') return String(value)
    if (value === undefined) return 'undefined'
    const seen = new WeakSet<object>()
    try {
      const serialized = JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === 'bigint') return `${item}n`
        if (typeof item === 'function') return `[Function ${item.name || 'anonymous'}]`
        if (typeof item === 'symbol') return String(item)
        if (typeof item !== 'object' || item === null) return item
        if (seen.has(item)) return '[Circular]'
        seen.add(item)
        return item
      })
      return serialized ?? String(value)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }
  const post = (message: PreviewMessage) => window.parent.postMessage(message, '*')
  const report = (
    phase: 'load' | 'runtime',
    source: PreviewErrorSource,
    value: unknown,
    fatal = true,
  ) => {
    const message = value instanceof Error ? value.message : String(value)
    const stack = value instanceof Error ? value.stack : undefined
    post({
      type: 'preview:error',
      phase,
      source,
      fatal,
      message: truncate(message),
      ...(stack ? { stack: truncate(stack) } : {}),
    })
  }
  ;(['debug', 'log', 'info', 'warn', 'error'] as const).forEach(level => {
    const original = console[level].bind(console)
    Reflect.set(console, level, (...values: unknown[]) => {
      original(...values)
      post({
        type: 'preview:console',
        level,
        message: truncate(values.map(format).join(' ')),
      })
    })
  })
  window.addEventListener('error', event => {
    const value =
      event.error ??
      `${event.message}${event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : ''}`
    report('runtime', 'window', value)
  })
  window.addEventListener('unhandledrejection', event => report('runtime', 'promise', event.reason))
  document.addEventListener('securitypolicyviolation', event => {
    const target = event.blockedURI || 'a restricted resource'
    report('runtime', 'security-policy', `${event.violatedDirective} blocked ${target}.`, false)
  })
  document.addEventListener('submit', event => {
    if (event.defaultPrevented) return
    event.preventDefault()
    report(
      'runtime',
      'form',
      new Error(
        'Native form submission is not supported. Handle the form with onSubmit and call event.preventDefault() synchronously.',
      ),
    )
  })
  window.addEventListener('message', async event => {
    if (event.source !== window.parent || started) return
    const value: unknown = event.data
    if (
      typeof value !== 'object' ||
      value === null ||
      !('type' in value) ||
      value.type !== 'preview:render'
    )
      return
    if (
      !('js' in value) ||
      typeof value.js !== 'string' ||
      !('css' in value) ||
      typeof value.css !== 'string'
    )
      return
    const databasePort = event.ports[0]
    if (!databasePort)
      return report('load', 'module', 'The preview database bridge is unavailable.')
    started = true
    Reflect.set(window, portKey, databasePort)
    const style = document.createElement('style')
    style.textContent = value.css
    document.head.append(style)
    const url = URL.createObjectURL(new Blob([value.js], { type: 'text/javascript' }))
    try {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.type = 'module'
        script.src = url
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('The compiled module could not load.'))
        document.body.append(script)
      })
      post({ type: 'preview:loaded' })
    } catch (error) {
      report('load', 'module', error)
    } finally {
      URL.revokeObjectURL(url)
    }
  })
}

export const createPreviewDocument = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body,#root{min-height:100%;margin:0}body{font-family:system-ui,sans-serif}</style>
</head><body><div id="root"></div><script>(${bootPreview.toString()})(${JSON.stringify(LOCAL_DB_PORT_KEY)})</script></body></html>`
