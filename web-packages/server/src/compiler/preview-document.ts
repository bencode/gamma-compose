/// <reference lib="dom" />

import { previewAssetUrlKey } from './module-graph.js'
import type { RuntimeManifest } from './runtime.js'

const localDbPortKey = '__GAMMA_COMPOSE_LOCAL_DB_PORT__'

function bootPreview(portKey: string, assetUrlKey: string, entry: string) {
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
  function createAssetResolver(port: MessagePort) {
    let requestId = 0
    const pending = new Map<
      number,
      { resolve: (blob: Blob) => void; reject: (error: Error) => void }
    >()
    const cache = new Map<string, Promise<string>>()
    const urls = new Set<string>()
    port.addEventListener('message', event => {
      const value: unknown = event.data
      if (
        typeof value !== 'object' ||
        value === null ||
        !('type' in value) ||
        value.type !== 'asset:result' ||
        !('id' in value) ||
        typeof value.id !== 'number'
      )
        return
      const request = pending.get(value.id)
      if (!request) return
      pending.delete(value.id)
      if ('blob' in value && value.blob instanceof Blob) request.resolve(value.blob)
      else
        request.reject(
          new Error(
            'error' in value && typeof value.error === 'string'
              ? value.error
              : 'The local image could not be loaded.',
          ),
        )
    })
    port.addEventListener('messageerror', () => {
      const error = new Error('The local asset bridge could not receive a response.')
      pending.forEach(request => {
        request.reject(error)
      })
      pending.clear()
    })
    port.start()
    window.addEventListener('pagehide', () => {
      urls.forEach(url => {
        URL.revokeObjectURL(url)
      })
      urls.clear()
      port.close()
    })
    return (path: string, hash: string) => {
      const key = `${path}:${hash}`
      const existing = cache.get(key)
      if (existing) return existing
      const request = new Promise<Blob>((resolve, reject) => {
        const id = ++requestId
        pending.set(id, { resolve, reject })
        port.postMessage({ type: 'asset:read', id, path, hash })
      }).then(blob => {
        const url = URL.createObjectURL(blob)
        urls.add(url)
        return url
      })
      cache.set(key, request)
      return request
    }
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
    const assetPort = event.ports[1]
    if (!databasePort || !assetPort)
      return report('load', 'module', 'The preview runtime bridges are unavailable.')
    started = true
    Reflect.set(window, portKey, databasePort)
    Reflect.set(window, assetUrlKey, createAssetResolver(assetPort))
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
</head><body><div id="root"></div><script>const __name=target=>target;(${bootPreview.toString()})(${JSON.stringify(localDbPortKey)},${JSON.stringify(previewAssetUrlKey)},${JSON.stringify(`./${entry}`)})</script></body></html>`
