import type { Agent } from '@earendil-works/pi-agent-core'
import { useEffect, useRef, useState } from 'react'
import {
  type AgentPreview,
  createConversationAgent,
  loadAgentConfig,
} from '../../core/agent/runtime'
import type { ProjectRepository } from '../../core/project/repository'
import type { ProjectStore } from '../../core/project/store'
import { conversationSnapshot, updateToolStatus } from './conversation-agent-state'
import {
  type ConversationItem,
  createConversationItems,
  createUserPrompt,
  type ToolExecutionState,
} from './conversation-transcript'
import type { MessageAttachments } from './use-message-attachments'
import type { useSessions } from './use-sessions'

export type ConversationPhase =
  | 'initializing'
  | 'ready'
  | 'unavailable'
  | 'error'
  | 'running'
  | 'stopping'
  | 'blocked'

export const useConversation = (
  projectId: string,
  project: ProjectStore,
  repository: ProjectRepository,
  attachments: MessageAttachments,
  { compile, refresh, readErrors, readConsole }: AgentPreview,
  sessions: Pick<
    ReturnType<typeof useSessions>,
    'initialSession' | 'loaded' | 'busy' | 'saveError' | 'ensureSession' | 'saveMessages'
  >,
) => {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ConversationItem[]>([])
  const [phase, setPhase] = useState<ConversationPhase>('initializing')
  const [error, setError] = useState<string>()
  const agentRef = useRef<Agent>(undefined)
  const busyRef = useRef(false)
  const persistence = useRef(Promise.resolve())
  const persistenceFailure = useRef<unknown>(undefined)
  const toolExecutions = useRef(new Map<string, ToolExecutionState>())
  const clearAttachments = useRef(attachments.clearSelection)
  clearAttachments.current = attachments.clearSelection
  const sessionBlocked = !sessions.loaded || sessions.busy || Boolean(sessions.saveError)

  useEffect(() => {
    const session = sessions.initialSession
    if (!sessions.loaded || !session) return
    const controller = new AbortController()
    let unsubscribe: (() => void) | undefined
    persistence.current = Promise.resolve()
    persistenceFailure.current = undefined
    toolExecutions.current.clear()
    setDraft('')
    clearAttachments.current()
    setMessages(
      createConversationItems({
        messages: session.messages,
        toolLabels: new Map(),
        executions: toolExecutions.current,
        running: false,
      }),
    )
    setError(undefined)
    setPhase('initializing')
    busyRef.current = false
    const initialize = async () => {
      try {
        const config = await loadAgentConfig(controller.signal)
        if (controller.signal.aborted) return
        if (!config.enabled) {
          setPhase('unavailable')
          return
        }
        const agent = createConversationAgent(
          config,
          projectId,
          project,
          repository,
          {
            compile,
            refresh,
            readErrors,
            readConsole,
          },
          session,
        )
        agentRef.current = agent
        setMessages(conversationSnapshot(agent, toolExecutions.current))
        unsubscribe = agent.subscribe((event, signal) => {
          updateToolStatus(event, toolExecutions.current, signal)
          setMessages(conversationSnapshot(agent, toolExecutions.current))
          if (event.type !== 'message_end') return
          const snapshot = structuredClone(agent.state.messages)
          persistence.current = persistence.current
            .then(() => sessions.saveMessages(snapshot))
            .catch(cause => {
              persistenceFailure.current = cause
              console.error('Stopping Agent because chat could not be saved.', cause)
              agent.abort()
            })
        })
        setPhase('ready')
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'Could not initialize chat.')
        setPhase('error')
      }
    }
    void initialize()
    return () => {
      controller.abort()
      unsubscribe?.()
      agentRef.current?.abort()
      agentRef.current = undefined
    }
  }, [
    projectId,
    project,
    repository,
    compile,
    refresh,
    readErrors,
    readConsole,
    sessions.initialSession,
    sessions.loaded,
    sessions.saveMessages,
  ])

  const send = async () => {
    const agent = agentRef.current
    const text = draft.trim()
    const attachedPaths = attachments.selectedPaths
    if (!agent || busyRef.current || sessionBlocked || (!text && !attachedPaths.length)) return
    busyRef.current = true
    setPhase('running')
    setError(undefined)
    persistenceFailure.current = undefined
    try {
      await sessions.ensureSession(text)
      if (agentRef.current !== agent) return
      setDraft('')
      attachments.clearSelection()
      await agent.prompt(createUserPrompt(text, attachedPaths))
      await persistence.current
      if (persistenceFailure.current) throw persistenceFailure.current
    } catch (cause) {
      if (agentRef.current === agent) {
        setError(cause instanceof Error ? cause.message : 'Could not send the message.')
      }
    } finally {
      if (agentRef.current === agent) {
        busyRef.current = false
        setPhase('ready')
        toolExecutions.current.forEach((execution, id) => {
          if (execution.status === 'Running')
            toolExecutions.current.set(id, { ...execution, status: 'Stopped' })
        })
        try {
          setMessages(conversationSnapshot(agent, toolExecutions.current))
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not update the conversation.')
        }
      }
    }
  }

  const stop = () => {
    if (!busyRef.current) return
    setPhase('stopping')
    agentRef.current?.abort()
  }

  return {
    draft,
    setDraft,
    messages,
    phase: phase === 'ready' && sessionBlocked ? ('blocked' as const) : phase,
    error,
    send,
    stop,
  }
}
