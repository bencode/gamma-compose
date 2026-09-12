import { ConversationComposer } from './conversation-composer'
import { ConversationMessages } from './conversation-messages'
import type { useConversation } from './use-conversation'

type ConversationPanelProps = ReturnType<typeof useConversation> & {
  saveStatus: 'saving' | 'saved' | 'error'
  saveError?: string
  onRetrySave: () => void
}

export const ConversationPanel = ({
  draft,
  setDraft,
  messages,
  phase,
  error,
  model,
  send,
  stop,
  saveStatus,
  saveError,
  onRetrySave,
}: ConversationPanelProps) => {
  const running = phase === 'running' || phase === 'stopping'
  const status =
    phase === 'initializing'
      ? 'Connecting…'
      : phase === 'unavailable'
        ? 'Chat is temporarily unavailable.'
        : undefined

  return (
    <>
      <ConversationMessages messages={messages} running={running} />
      <ConversationComposer
        draft={draft}
        phase={phase}
        status={status}
        error={error}
        model={model}
        saveStatus={saveStatus}
        saveError={saveError}
        setDraft={setDraft}
        send={send}
        stop={stop}
        onRetrySave={onRetrySave}
      />
    </>
  )
}
