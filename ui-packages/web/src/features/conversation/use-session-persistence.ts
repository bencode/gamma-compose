import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { useCallback, useRef, useState } from 'react'
import type { ProjectDatabase } from '../../core/project/database'
import { type ChatSession, chatTitle } from '../../core/session/records'

type MutableValue<T> = { current: T }

const errorText = (cause: unknown) =>
  cause instanceof Error || cause instanceof DOMException
    ? cause.message
    : 'Local chat storage failed.'

export const useSessionPersistence = (
  database: ProjectDatabase,
  projectId: string,
  mounted: MutableValue<boolean>,
  current: MutableValue<ChatSession | undefined>,
  persisted: MutableValue<boolean>,
  publish: (session: ChatSession) => void,
) => {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const failedSnapshot = useRef<ChatSession>(undefined)

  const persist = useCallback(
    async (session: ChatSession) => {
      if (mounted.current) setSaving(true)
      try {
        await database.saveChatSession(session)
        failedSnapshot.current = undefined
        if (mounted.current) setSaveError(undefined)
        publish(session)
      } catch (cause) {
        if (!mounted.current) return
        console.error('Could not save chat.', cause)
        failedSnapshot.current = session
        setSaveError(errorText(cause))
        throw cause
      } finally {
        if (mounted.current) setSaving(false)
      }
    },
    [database, mounted, publish],
  )

  const ensureSession = useCallback(
    async (titleSource: string) => {
      let session = current.current
      if (!session) throw new Error('Chat is not ready.')
      if (!persisted.current) {
        session = await database.createChatSession(projectId, session.id)
        persisted.current = true
      }
      const title = session.messages.length === 0 ? chatTitle(titleSource) : session.title
      if (title !== session.title) {
        session = { ...session, title, updatedAt: Date.now() }
        current.current = session
        await persist(session)
      } else {
        current.current = session
        publish(session)
      }
    },
    [current, database, persist, persisted, projectId, publish],
  )

  const saveMessages = useCallback(
    async (messages: AgentMessage[]) => {
      const session = current.current
      if (!session || !persisted.current) throw new Error('Create a chat before saving messages.')
      const next = { ...session, messages: structuredClone(messages), updatedAt: Date.now() }
      current.current = next
      if (failedSnapshot.current) {
        failedSnapshot.current = next
        throw new Error('Chat save failed.')
      }
      await persist(next)
    },
    [current, persist, persisted],
  )

  const retrySave = async () => {
    const session = failedSnapshot.current
    if (!session) return
    try {
      await persist(session)
    } catch (cause) {
      console.error('Chat save retry failed.', cause)
    }
  }

  return {
    saving,
    saveError,
    failed: Boolean(failedSnapshot.current),
    ensureSession,
    saveMessages,
    retrySave,
  }
}
