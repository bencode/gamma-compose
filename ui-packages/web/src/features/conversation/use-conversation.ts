import type { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import { useEffect, useRef, useState } from 'react'
import type { CompileProject } from '../../core/agent/compile-tool'
import { createConversationAgent, loadAgentConfig } from '../../core/agent/runtime'
import type { ProjectStore } from '../../core/project/store'

type ToolStatus = 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Stopped'
type ToolActivity = { id: string; name: string; path?: string; status: ToolStatus }

export type ConversationMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  notice?: string
  failed?: boolean
  tools?: ToolActivity[]
}

type ConversationPhase = 'initializing' | 'ready' | 'unavailable' | 'error' | 'running' | 'stopping'

const messageSnapshot = (message: AgentMessage, id: number): ConversationMessage[] => {
  if (message.role !== 'user' && message.role !== 'assistant') return []
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
  if (message.role === 'user') return [{ id, role: 'user', text }]
  const notice =
    message.stopReason === 'aborted'
      ? 'Generation stopped.'
      : message.stopReason === 'error'
        ? message.errorMessage || 'Generation failed. Please send a new message to try again.'
        : message.stopReason === 'length'
          ? 'The response reached its output limit.'
          : undefined
  return [{ id, role: 'assistant', text, notice, failed: message.stopReason === 'error' }]
}

const conversationSnapshot = (agent: Agent, statuses: Map<string, ToolStatus>) => {
  const messages = agent.state.messages.flatMap((message, id) => {
    const snapshot = messageSnapshot(message, id)
    if (message.role !== 'assistant') return snapshot
    const tools = message.content.flatMap(block =>
      block.type === 'toolCall'
        ? [
            {
              id: block.id,
              name: block.name,
              path:
                typeof block.arguments === 'object' &&
                block.arguments !== null &&
                !Array.isArray(block.arguments) &&
                typeof block.arguments.path === 'string'
                  ? block.arguments.path
                  : undefined,
              status: statuses.get(block.id) ?? (agent.state.isStreaming ? 'Pending' : 'Stopped'),
            } satisfies ToolActivity,
          ]
        : [],
    )
    return snapshot.map(item => ({ ...item, tools }))
  })
  const streaming = agent.state.streamingMessage
  return streaming
    ? [...messages, ...messageSnapshot(streaming, agent.state.messages.length)]
    : messages
}

const updateToolStatus = (
  event: AgentEvent,
  statuses: Map<string, ToolStatus>,
  signal: AbortSignal,
) => {
  if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update')
    statuses.set(event.toolCallId, 'Running')
  if (event.type === 'tool_execution_end')
    statuses.set(
      event.toolCallId,
      signal.aborted ? 'Stopped' : event.isError ? 'Failed' : 'Completed',
    )
}

export const useConversation = (project: ProjectStore, compile: CompileProject) => {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [phase, setPhase] = useState<ConversationPhase>('initializing')
  const [error, setError] = useState<string>()
  const agentRef = useRef<Agent>(undefined)
  const busyRef = useRef(false)
  const toolStatuses = useRef(new Map<string, ToolStatus>())

  useEffect(() => {
    const controller = new AbortController()
    let unsubscribe: (() => void) | undefined
    const initialize = async () => {
      try {
        const config = await loadAgentConfig(controller.signal)
        if (controller.signal.aborted) return
        if (!config.enabled) {
          setPhase('unavailable')
          return
        }
        const agent = createConversationAgent(config, project, compile)
        agentRef.current = agent
        toolStatuses.current.clear()
        unsubscribe = agent.subscribe((event, signal) => {
          updateToolStatus(event, toolStatuses.current, signal)
          setMessages(conversationSnapshot(agent, toolStatuses.current))
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
  }, [project, compile])

  const send = async () => {
    const agent = agentRef.current
    const text = draft.trim()
    if (!agent || busyRef.current || !text) return
    busyRef.current = true
    setPhase('running')
    setError(undefined)
    setDraft('')
    try {
      await agent.prompt(text)
    } catch (cause) {
      if (agentRef.current === agent) {
        setError(cause instanceof Error ? cause.message : 'Could not send the message.')
      }
    } finally {
      if (agentRef.current === agent) {
        busyRef.current = false
        setPhase('ready')
        toolStatuses.current.forEach((status, id) => {
          if (status === 'Running') toolStatuses.current.set(id, 'Stopped')
        })
        try {
          setMessages(conversationSnapshot(agent, toolStatuses.current))
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

  return { draft, setDraft, messages, phase, error, send, stop }
}
