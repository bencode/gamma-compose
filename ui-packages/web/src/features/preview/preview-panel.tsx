import { useEffect, useRef, useState } from 'react'
import { createPreviewDocument, isPreviewMessage, type PreviewMessage } from './preview-document'
import type { PreviewState } from './use-preview'

type PreviewPanelProps = {
  state: PreviewState
  retry: () => void
  onMessage: (message: PreviewMessage) => void
}

const errorTitles = {
  compile: 'Compilation failed',
  load: 'Preview could not load',
  runtime: 'Page runtime error',
}

export const PreviewPanel = ({ state, retry, onMessage }: PreviewPanelProps) => {
  const frame = useRef<HTMLIFrameElement>(null)
  const [document] = useState(createPreviewDocument)
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

  return (
    <section className="preview-surface" aria-label="Page preview">
      {state.status === 'compiling' && (
        <p className="preview-progress" role="status">
          Compiling preview…
        </p>
      )}
      {(state.status === 'loading' || state.status === 'ready') && (
        <>
          <iframe
            ref={frame}
            title="Project preview"
            sandbox="allow-scripts"
            srcDoc={document}
            className="preview-frame"
            onLoad={() =>
              frame.current?.contentWindow?.postMessage(
                { type: 'preview:render', js: state.result.js, css: state.result.css },
                '*',
              )
            }
          />
          {state.status === 'loading' && (
            <p className="preview-progress" role="status">
              Loading preview…
            </p>
          )}
          {state.result.warnings.length > 0 && (
            <details className="preview-warnings">
              <summary>Compilation warnings ({state.result.warnings.length})</summary>
              <pre>{state.result.warnings.map(warning => warning.message).join('\n\n')}</pre>
            </details>
          )}
        </>
      )}
      {state.status === 'error' && (
        <div className="preview-error">
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
          <button type="button" className="preview-retry" onClick={retry}>
            Retry
          </button>
        </div>
      )}
    </section>
  )
}
