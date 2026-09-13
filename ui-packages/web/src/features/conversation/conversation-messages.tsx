import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import type { ProjectRepository } from '../../core/project/repository'
import type { RepositoryFile } from '../../core/project/repository-files'
import { ActivityBlock, ActivityStep } from './conversation-activity'
import {
  type ConversationItem,
  type ConversationStreamItem,
  groupConversationActivity,
} from './conversation-transcript'
import { MessageAttachmentList } from './message-attachments'

type ConversationMessagesProps = {
  messages: ConversationItem[]
  running: boolean
  repository: ProjectRepository
  repositoryFiles: readonly RepositoryFile[]
  onOpenRepositoryFile: (path: string) => void
}

const MarkdownContent = lazy(async () => {
  const module = await import('../../components/markdown-content')
  return { default: module.MarkdownContent }
})

const DrawnItem = ({
  item,
  repository,
  repositoryFiles,
  onOpenRepositoryFile,
}: {
  item: ConversationStreamItem
  repository: ProjectRepository
  repositoryFiles: readonly RepositoryFile[]
  onOpenRepositoryFile: (path: string) => void
}) => {
  if (item.kind === 'activity-group') return <ActivityBlock group={item} />
  if (item.kind === 'thinking' || item.kind === 'tool') return <ActivityStep item={item} />
  if (item.kind === 'notice')
    return (
      <p className="conversation-notice" role={item.failed ? 'alert' : 'status'}>
        {item.text}
      </p>
    )

  return (
    <article
      className="conversation-message"
      aria-label={item.kind === 'user' ? 'You' : 'Assistant'}
    >
      <h2>{item.kind === 'user' ? 'You' : 'Assistant'}</h2>
      {item.kind === 'user' ? (
        <>
          {item.text && <p className="conversation-user-text">{item.text}</p>}
          <MessageAttachmentList
            repository={repository}
            files={item.attachments.flatMap(path => {
              const file = repositoryFiles.find(candidate => candidate.path === path)
              return file ? [file] : []
            })}
            onOpen={onOpenRepositoryFile}
          />
        </>
      ) : (
        <Suspense fallback={<p className="conversation-markdown-fallback">{item.text}</p>}>
          <MarkdownContent text={item.text} />
        </Suspense>
      )}
    </article>
  )
}

export const ConversationMessages = ({
  messages,
  running,
  repository,
  repositoryFiles,
  onOpenRepositoryFile,
}: ConversationMessagesProps) => {
  const container = useRef<HTMLElement>(null)
  const follow = useRef(true)
  const stream = useMemo(() => groupConversationActivity(messages, running), [messages, running])
  const lastItem = stream.at(-1)
  const waiting = running && lastItem?.kind !== 'assistant' && lastItem?.kind !== 'activity-group'

  useEffect(() => {
    if (!messages.length && !running) return
    const element = container.current
    if (follow.current && element) element.scrollTop = element.scrollHeight
  }, [messages, running])

  return (
    <section
      ref={container}
      className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 min-[900px]:px-4"
      aria-label="Conversation"
      onScroll={event => {
        const element = event.currentTarget
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
      }}
    >
      {stream.map(item => (
        <DrawnItem
          item={item}
          key={item.key}
          repository={repository}
          repositoryFiles={repositoryFiles}
          onOpenRepositoryFile={onOpenRepositoryFile}
        />
      ))}
      {waiting && (
        <p role="status" className="my-4 text-xs text-muted">
          Thinking…
        </p>
      )}
    </section>
  )
}
