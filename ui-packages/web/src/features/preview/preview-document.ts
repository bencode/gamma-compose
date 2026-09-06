export type PreviewMessage =
  | { type: 'preview:loaded' }
  | { type: 'preview:error'; phase: 'load' | 'runtime'; message: string }

export const isPreviewMessage = (value: unknown): value is PreviewMessage => {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  if (value.type === 'preview:loaded') return true
  return (
    value.type === 'preview:error' &&
    'phase' in value &&
    (value.phase === 'load' || value.phase === 'runtime') &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

// Serialized into the isolated document: keep every runtime dependency inside this function.
function bootPreview() {
  let started = false
  const report = (phase: 'load' | 'runtime', value: unknown) => {
    const message = value instanceof Error ? value.message : String(value)
    window.parent.postMessage(
      { type: 'preview:error', phase, message: message.slice(0, 8000) },
      '*',
    )
  }
  window.addEventListener('error', event => report('runtime', event.error ?? event.message))
  window.addEventListener('unhandledrejection', event => report('runtime', event.reason))
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
    started = true
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
      window.parent.postMessage({ type: 'preview:loaded' }, '*')
    } catch (error) {
      report('load', error)
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
</head><body><div id="root"></div><script>(${bootPreview.toString()})()</script></body></html>`
