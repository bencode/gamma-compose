import { ArrowUp, Paperclip, Square } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ProjectRepository } from '../../core/project/repository'
import { MessageAttachmentList } from './message-attachments'
import type { ConversationPhase } from './use-conversation'
import type { MessageAttachments } from './use-message-attachments'

type SaveStatus = 'saving' | 'saved' | 'error'

type ConversationComposerProps = {
  draft: string
  phase: ConversationPhase
  status?: string
  error?: string
  repository: ProjectRepository
  attachments: MessageAttachments
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
  return null
}

export const ConversationComposer = ({
  draft,
  phase,
  status,
  error,
  repository,
  attachments,
  saveStatus,
  saveError,
  setDraft,
  send,
  stop,
  onRetrySave,
}: ConversationComposerProps) => {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [draggingFiles, setDraggingFiles] = useState(false)
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
      <fieldset
        className="composer-surface"
        data-dragging={draggingFiles || undefined}
        onDragEnter={event => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDraggingFiles(true)
        }}
        onDragOver={event => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDraggingFiles(false)
        }}
        onDrop={event => {
          event.preventDefault()
          setDraggingFiles(false)
          void attachments.selectFiles([...event.dataTransfer.files])
        }}
      >
        <legend className="sr-only">Message input</legend>
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
          onPaste={event => {
            const files = [...event.clipboardData.files]
            if (!files.length) return
            event.preventDefault()
            void attachments.selectFiles(files, 'clipboard')
          }}
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
        <MessageAttachmentList
          repository={repository}
          files={attachments.selectedFiles}
          onRemove={attachments.detachPath}
        />
        {attachments.notice && (
          <p className="attachment-notice" role="status">
            {attachments.notice}
          </p>
        )}
        <div className="composer-actions">
          <div className="composer-context">
            <PersistenceStatus status={saveStatus} error={saveError} onRetry={onRetrySave} />
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept=".md,.markdown,image/png,image/jpeg,image/webp,image/gif"
              multiple
              tabIndex={-1}
              onChange={event => {
                void attachments.selectFiles([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <button
              type="button"
              className="composer-attach"
              aria-label="Attach files"
              title="Attach Markdown or images"
              disabled={inputDisabled}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip aria-hidden="true" size={15} />
            </button>
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
            disabled={
              phase === 'stopping' ||
              (!running &&
                (phase !== 'ready' || (!draft.trim() && !attachments.selectedPaths.length)))
            }
          >
            {running ? (
              <Square aria-hidden="true" size={12} fill="currentColor" />
            ) : (
              <ArrowUp aria-hidden="true" size={16} strokeWidth={2} />
            )}
          </button>
        </div>
      </fieldset>
    </section>
  )
}
