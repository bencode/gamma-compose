import type { ProjectRepository } from '../../core/project/repository'
import { ConversationComposer } from './conversation-composer'
import { ConversationMessages } from './conversation-messages'
import type { useConversation } from './use-conversation'
import type { MessageAttachments } from './use-message-attachments'
import type { useSessions } from './use-sessions'

type ConversationPanelProps = ReturnType<typeof useConversation> & {
  saveStatus: 'saving' | 'saved' | 'error'
  saveError?: string
  onRetrySave: () => void
  repository: ProjectRepository
  attachments: MessageAttachments
  sessions: ReturnType<typeof useSessions>
  onOpenRepositoryFile: (path: string) => void
}

export const ConversationPanel = ({
  draft,
  setDraft,
  messages,
  phase,
  error,
  send,
  stop,
  saveStatus,
  saveError,
  onRetrySave,
  repository,
  attachments,
  sessions,
  onOpenRepositoryFile,
}: ConversationPanelProps) => {
  const running = phase === 'running' || phase === 'stopping'
  const status =
    phase === 'initializing'
      ? sessions.loaded
        ? 'Connecting…'
        : 'Loading chats…'
      : phase === 'unavailable'
        ? 'Chat is temporarily unavailable.'
        : undefined

  return (
    <>
      <ConversationMessages
        messages={messages}
        running={running}
        repository={repository}
        repositoryFiles={attachments.files}
        onOpenRepositoryFile={onOpenRepositoryFile}
      />
      <ConversationComposer
        draft={draft}
        phase={phase}
        status={status}
        error={error}
        repository={repository}
        attachments={attachments}
        sessions={sessions}
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
