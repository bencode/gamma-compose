/// <reference lib="dom" />

import type { RuntimeManifest } from './runtime.js'

const localDbPortKey = '__GAMMA_COMPOSE_LOCAL_DB_PORT__'

function bootPreview(portKey: string, entry: string) {
  let started = false
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  function truncate(value: string) {
    const bytes = encoder.encode(value)
    return bytes.byteLength <= 8 * 1024
      ? value
      : `${decoder.decode(bytes.slice(0, 8 * 1024 - 32))}\n[Message truncated]`
  }
  function format(value: unknown) {
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
    } catch (error) {
      console.error('Could not serialize preview console output.', error)
      return Object.prototype.toString.call(value)
    }
  }
  function post(message: unknown) {
    window.parent.postMessage(message, '*')
  }
  function report(phase: 'load' | 'runtime', source: string, value: unknown, fatal = true) {
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
      post({ type: 'preview:console', level, message: truncate(values.map(format).join(' ')) })
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
    report(
      'runtime',
      'security-policy',
      `${event.violatedDirective} blocked ${event.blockedURI || 'a restricted resource'}.`,
      false,
    )
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
      value.type !== 'preview:start'
    )
      return
    const databasePort = event.ports[0]
    if (!databasePort)
      return report('load', 'module', 'The preview database bridge is unavailable.')
    started = true
    Reflect.set(window, portKey, databasePort)
    try {
      await import(entry)
      post({ type: 'preview:loaded' })
    } catch (error) {
      report('load', 'module', error)
    }
  })
}

export const createPreviewDocument = (
  entry: string,
  runtime: RuntimeManifest,
  hasStyles: boolean,
) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<script type="importmap">${JSON.stringify(runtime)}</script>
${hasStyles ? '<link rel="stylesheet" href="./styles.css">' : ''}
<style>html,body,#root{min-height:100%;margin:0}body{font-family:system-ui,sans-serif}</style>
</head><body><div id="root"></div><script>const __name=target=>target;(${bootPreview.toString()})(${JSON.stringify(localDbPortKey)},${JSON.stringify(`./${entry}`)})</script></body></html>`
