import type { AgentMessage } from '@earendil-works/pi-agent-core'

export type ChatSessionMetadata = {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

export type ChatTranscriptRecord = {
  sessionId: string
  messages: AgentMessage[]
}

export type ChatSession = ChatSessionMetadata & {
  messages: AgentMessage[]
}

export const emptyChatSession = (
  projectId: string,
  id: string = crypto.randomUUID(),
): ChatSession => {
  const now = Date.now()
  return {
    id,
    projectId,
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    messages: [],
  }
}

export const chatSessionMetadata = ({
  messages: _messages,
  ...metadata
}: ChatSession): ChatSessionMetadata => metadata

export const sortChatSessions = (sessions: readonly ChatSessionMetadata[]) =>
  sessions.toSorted(
    (left, right) => right.lastOpenedAt - left.lastOpenedAt || left.id.localeCompare(right.id),
  )

export const chatTitle = (text: string) =>
  Array.from(text.trim().replace(/\s+/g, ' ') || 'New chat')
    .slice(0, 60)
    .join('')
