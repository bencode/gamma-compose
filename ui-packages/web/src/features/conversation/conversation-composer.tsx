import { ArrowUp, Check, Square } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { ModelOption } from './model-control'
import { ModelControl } from './model-control'
import type { ConversationPhase } from './use-conversation'

type SaveStatus = 'saving' | 'saved' | 'error'

type ConversationComposerProps = {
  draft: string
  phase: ConversationPhase
  status?: string
  error?: string
  model?: ModelOption
  saveStatus: SaveStatus
  saveError?: string
  setDraft: (draft: string) => void
  send: () => Promise<void>
  stop: () => void
  onRetrySave: () => void
}

const resizeTextarea = (textarea: HTMLTextAreaElement) => {
  textarea.style.height = '0px'
  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 56), 192)}px`
  textarea.style.overflowY = textarea.scrollHeight > 192 ? 'auto' : 'hidden'
}

const PersistenceStatus = ({
  status,
  error,
  onRetry,
}: {
  status: SaveStatus
  error?: string
  onRetry: () => void
}) => {
  if (status === 'error')
    return (
      <button
        type="button"
        className="persistence-status persistence-status-error"
        title={error}
        aria-label="Save failed. Retry save"
        onClick={onRetry}
      >
        <span className="persistence-error-prefix">Save failed · </span>Retry
      </button>
    )
  if (status === 'saving')
    return (
      <span className="persistence-status" role="status">
        Saving…
      </span>
    )
  return (
    <span
      className="persistence-status persistence-status-saved"
      role="status"
      aria-label="Saved in this browser"
      title="Saved in this browser"
    >
      Local
      <Check aria-hidden="true" size={13} strokeWidth={2} />
    </span>
  )
}

export const ConversationComposer = ({
  draft,
  phase,
  status,
  error,
  model,
  saveStatus,
  saveError,
  setDraft,
  send,
  stop,
  onRetrySave,
}: ConversationComposerProps) => {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const running = phase === 'running' || phase === 'stopping'
  const inputDisabled = phase === 'initializing' || phase === 'unavailable' || phase === 'error'

  useLayoutEffect(() => {
    const current = textarea.current
    if (current?.value === draft) resizeTextarea(current)
  }, [draft])

  return (
    <section className="conversation-dock" aria-label="Message composer">
      <div className="conversation-status">
        {status && (
          <p role="status" className="[overflow-wrap:anywhere]">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="[overflow-wrap:anywhere]">
            {error}
          </p>
        )}
      </div>
      <div className="composer-surface">
        <label className="sr-only" htmlFor="draft">
          Message
        </label>
        <textarea
          ref={textarea}
          className="composer-textarea"
          id="draft"
          value={draft}
          disabled={inputDisabled}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (
              event.key !== 'Enter' ||
              event.shiftKey ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return
            event.preventDefault()
            if (phase === 'ready') void send()
          }}
          placeholder="Describe what you want to build…"
          rows={1}
          spellCheck={false}
        />
        <div className="composer-actions">
          <div className="composer-context">
            <PersistenceStatus status={saveStatus} error={saveError} onRetry={onRetrySave} />
            {model && <ModelControl value={model.id} options={[model]} disabled />}
          </div>
          <button
            className="composer-submit"
            type="button"
            aria-label={phase === 'stopping' ? 'Stopping…' : running ? 'Stop' : 'Send'}
            title={phase === 'stopping' ? 'Stopping…' : running ? 'Stop' : 'Send'}
            onClick={() => {
              if (running) stop()
              else void send()
            }}
            disabled={phase === 'stopping' || (!running && (phase !== 'ready' || !draft.trim()))}
          >
            {running ? (
              <Square aria-hidden="true" size={12} fill="currentColor" />
            ) : (
              <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
    </section>
  )
}
