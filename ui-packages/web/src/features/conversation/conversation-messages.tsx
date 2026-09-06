import { useEffect, useRef } from 'react'
import type { ConversationMessage } from './use-conversation'

type ConversationMessagesProps = {
  messages: ConversationMessage[]
  running: boolean
}

export const ConversationMessages = ({ messages, running }: ConversationMessagesProps) => {
  const container = useRef<HTMLElement>(null)
  const follow = useRef(true)
  const lastMessage = messages.at(-1)
  const waiting = running && (lastMessage?.role !== 'assistant' || !lastMessage.text)

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
      {messages.map(message => (
        <article
          key={message.id}
          className="my-5 min-w-0"
          aria-label={message.role === 'user' ? 'You' : 'Assistant'}
        >
          <h2 className="mb-1.5 text-xs font-medium text-muted">
            {message.role === 'user' ? 'You' : 'Assistant'}
          </h2>
          <p className="whitespace-pre-wrap text-[13px] leading-6 [overflow-wrap:anywhere]">
            {message.text}
          </p>
          {message.notice && (
            <p
              className="mt-2 text-xs text-muted [overflow-wrap:anywhere]"
              role={message.failed ? 'alert' : 'status'}
            >
              {message.notice}
            </p>
          )}
        </article>
      ))}
      {waiting && (
        <p role="status" className="my-4 text-xs text-muted">
          Thinking…
        </p>
      )}
    </section>
  )
}
