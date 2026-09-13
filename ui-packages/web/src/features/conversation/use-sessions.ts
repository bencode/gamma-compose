import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectDatabase } from '../../core/project/database'
import {
  type ChatSession,
  type ChatSessionMetadata,
  emptyChatSession,
  sortChatSessions,
} from '../../core/session/records'
import { useSessionPersistence } from './use-session-persistence'

const errorText = (cause: unknown) =>
  cause instanceof Error || cause instanceof DOMException
    ? cause.message
    : 'Local chat storage failed.'

export const useSessions = (database: ProjectDatabase, projectId: string) => {
  const [initialSession, setInitialSession] = useState<ChatSession>()
  const [summaries, setSummaries] = useState<ChatSessionMetadata[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const current = useRef<ChatSession>(undefined)
  const persisted = useRef(false)
  const mounted = useRef(false)
  const working = useRef(false)

  const showSession = useCallback((session: ChatSession, saved: boolean) => {
    current.current = session
    persisted.current = saved
    setActiveId(session.id)
    setInitialSession(session)
  }, [])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setBusy(true)
      setError(undefined)
      try {
        const list = await database.listChatSessions(projectId)
        const latest = list[0]
        const session = latest
          ? await database.getChatSession(projectId, latest.id)
          : emptyChatSession(projectId)
        if (signal?.aborted || !mounted.current) return
        if (!session) throw new Error('Chat not found.')
        setSummaries(list)
        showSession(session, Boolean(latest))
        setLoaded(true)
      } catch (cause) {
        console.error('Could not load chats.', cause)
        if (!signal?.aborted && mounted.current) setError(errorText(cause))
      } finally {
        if (!signal?.aborted && mounted.current) setBusy(false)
      }
    },
    [database, projectId, showSession],
  )

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void load(controller.signal)
    return () => {
      controller.abort()
      mounted.current = false
    }
  }, [load])

  const publish = useCallback((session: ChatSession) => {
    if (!mounted.current) return
    const { messages: _messages, ...metadata } = session
    setActiveId(session.id)
    setSummaries(list =>
      sortChatSessions([...list.filter(item => item.id !== session.id), metadata]),
    )
  }, [])

  const persistence = useSessionPersistence(
    database,
    projectId,
    mounted,
    current,
    persisted,
    publish,
  )

  const runOperation = async (action: () => Promise<void>) => {
    if (working.current || persistence.failed) return false
    working.current = true
    setBusy(true)
    setError(undefined)
    try {
      await action()
      return mounted.current
    } catch (cause) {
      console.error('Chat operation failed.', cause)
      if (mounted.current) setError(errorText(cause))
      return false
    } finally {
      working.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const select = (id: string) =>
    runOperation(async () => {
      if (id === current.current?.id) return
      const session = await database.getChatSession(projectId, id)
      if (!session) throw new Error('Chat not found.')
      const opened = { ...session, lastOpenedAt: Date.now() }
      await database.saveChatSession(opened)
      if (!mounted.current) return
      publish(opened)
      showSession(opened, true)
    })

  const create = () =>
    runOperation(async () => {
      const session = await database.createChatSession(projectId)
      if (!mounted.current) return
      publish(session)
      showSession(session, true)
    })

  const remove = (id: string) =>
    runOperation(async () => {
      await database.deleteChatSession(projectId, id)
      if (!mounted.current) return
      const remaining = await database.listChatSessions(projectId)
      setSummaries(remaining)
      if (current.current?.id !== id) return
      const latest = remaining[0]
      const next = latest
        ? await database.getChatSession(projectId, latest.id)
        : emptyChatSession(projectId)
      if (!next) throw new Error('Chat not found.')
      if (mounted.current) showSession(next, Boolean(latest))
    })

  return {
    initialSession,
    summaries,
    activeId,
    loaded,
    busy,
    saving: persistence.saving,
    error,
    saveError: persistence.saveError,
    ensureSession: persistence.ensureSession,
    saveMessages: persistence.saveMessages,
    select,
    create,
    remove,
    retrySave: persistence.retrySave,
    retryLoad: () => {
      void load()
    },
  }
}
