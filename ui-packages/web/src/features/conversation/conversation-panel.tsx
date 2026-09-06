import { ConversationMessages } from './conversation-messages'
import type { useConversation } from './use-conversation'

type ConversationPanelProps = ReturnType<typeof useConversation>

export const ConversationPanel = ({
  draft,
  setDraft,
  messages,
  phase,
  error,
  send,
  stop,
}: ConversationPanelProps) => {
  const running = phase === 'running' || phase === 'stopping'
  const status =
    phase === 'initializing'
      ? 'Connecting…'
      : phase === 'unavailable'
        ? 'Chat is not configured. Set GLM_API_KEY on the server.'
        : undefined

  return (
    <>
      <ConversationMessages messages={messages} running={running} />
      <section className="shrink-0 p-3 min-[900px]:p-4" aria-label="Message composer">
        {status && (
          <p role="status" className="mb-2 text-xs text-muted [overflow-wrap:anywhere]">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 text-xs text-muted [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
        <label className="sr-only" htmlFor="draft">
          Message
        </label>
        <div className="rounded-lg border border-line p-2.5 focus-within:border-accent">
          <textarea
            className="block h-16 w-full resize-none border-0 bg-transparent p-0.5 text-[13px] leading-[1.8] text-ink placeholder:text-muted min-[900px]:h-24"
            id="draft"
            value={draft}
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
            placeholder="Send a message…"
            spellCheck={false}
          />
          <div className="mt-2 flex justify-end">
            <button
              className="flex items-center gap-3.5 rounded-md bg-accent px-2.5 py-1.5 text-xs text-white enabled:hover:brightness-95 disabled:bg-workspace disabled:text-muted"
              type="button"
              onClick={() => {
                if (running) stop()
                else void send()
              }}
              disabled={phase === 'stopping' || (!running && (phase !== 'ready' || !draft.trim()))}
            >
              {phase === 'stopping' ? 'Stopping…' : running ? 'Stop' : 'Send'}
              {!running && <span aria-hidden="true">↑</span>}
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
