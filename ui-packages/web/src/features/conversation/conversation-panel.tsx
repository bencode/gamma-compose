type ConversationPanelProps = {
  draft: string
  onDraftChange: (draft: string) => void
}

export const ConversationPanel = ({ draft, onDraftChange }: ConversationPanelProps) => (
  <>
    <section className="min-h-0 flex-1 overflow-auto" aria-label="Conversation" />
    <section className="shrink-0 p-3 min-[900px]:p-4" aria-label="Message composer">
      <label className="sr-only" htmlFor="draft">
        Message
      </label>
      <div className="rounded-lg border border-line p-2.5 focus-within:border-accent">
        <textarea
          className="block h-16 w-full resize-none border-0 bg-transparent p-0.5 text-[13px] leading-[1.8] text-ink placeholder:text-muted min-[900px]:h-24"
          id="draft"
          value={draft}
          onChange={event => onDraftChange(event.target.value)}
          placeholder="Send a message…"
          spellCheck={false}
        />
        <div className="mt-2 flex justify-end">
          <span id="agent-unavailable" className="sr-only">
            Agent is not connected yet
          </span>
          <button
            className="flex items-center gap-3.5 rounded-md bg-workspace px-2.5 py-1.5 text-xs text-muted"
            type="button"
            title="Agent is not connected yet"
            aria-describedby="agent-unavailable"
            disabled
          >
            Send <span aria-hidden="true">↑</span>
          </button>
        </div>
      </div>
    </section>
  </>
)
