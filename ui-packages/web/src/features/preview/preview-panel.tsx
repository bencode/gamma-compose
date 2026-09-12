import { useEffect, useRef } from 'react'
import { isPreviewMessage, type PreviewMessage } from './preview-document'
import type { PreviewState } from './use-preview'

type PreviewPanelProps = {
  state: PreviewState
  retry: () => void
  onMessage: (message: PreviewMessage) => void
  openDatabaseBridge: (port: MessagePort) => () => void
  retryDisabled?: boolean
}

const errorTitles = {
  compile: 'Compilation failed',
  load: 'Preview could not load',
  runtime: 'Page runtime error',
}

export const PreviewPanel = ({
  state,
  retry,
  onMessage,
  openDatabaseBridge,
  retryDisabled = false,
}: PreviewPanelProps) => {
  const frame = useRef<HTMLIFrameElement>(null)
  const closeDatabaseBridge = useRef<() => void>(undefined)
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (
        frame.current &&
        event.source === frame.current.contentWindow &&
        isPreviewMessage(event.data)
      ) {
        onMessage(event.data)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [onMessage])
  useEffect(
    () => () => {
      closeDatabaseBridge.current?.()
    },
    [],
  )

  const renderPreview = () => {
    if (!state.frame) return
    closeDatabaseBridge.current?.()
    const channel = new MessageChannel()
    closeDatabaseBridge.current = openDatabaseBridge(channel.port1)
    frame.current?.contentWindow?.postMessage({ type: 'preview:start' }, '*', [channel.port2])
  }

  return (
    <section className="preview-surface" aria-label="Page preview">
      {(state.status === 'compiling' || state.status === 'compiled') && (
        <p className="preview-progress" role="status">
          {state.status === 'compiling' ? 'Compiling preview…' : 'Build ready…'}
        </p>
      )}
      {state.frame && (
        <>
          <iframe
            key={state.frame.buildId}
            ref={frame}
            title="Project preview"
            sandbox="allow-scripts"
            src={state.frame.result.build.previewUrl}
            className="preview-frame"
            onLoad={renderPreview}
          />
          {state.status === 'loading' && (
            <p className="preview-progress" role="status">
              Loading preview…
            </p>
          )}
          {state.frame.result.warnings.length > 0 && (
            <details className="preview-warnings">
              <summary>Compilation warnings ({state.frame.result.warnings.length})</summary>
              <pre>{state.frame.result.warnings.map(warning => warning.message).join('\n\n')}</pre>
            </details>
          )}
        </>
      )}
      {state.status === 'error' && (
        <div className="preview-error absolute inset-0 bg-panel">
          <div role="alert">
            <h2>{errorTitles[state.phase]}</h2>
            <pre>
              {state.errors
                .map(error =>
                  [
                    error.path
                      ? `${error.path}${error.line ? `:${error.line}:${error.column ?? 1}` : ''}`
                      : '',
                    error.message,
                  ]
                    .filter(Boolean)
                    .join('\n'),
                )
                .join('\n\n')}
            </pre>
          </div>
          <button type="button" className="preview-retry" onClick={retry} disabled={retryDisabled}>
            Retry
          </button>
        </div>
      )}
    </section>
  )
}
