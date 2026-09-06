import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core'
import { useEffect, useRef, useState } from 'react'
import { createConversationAgent, loadAgentConfig } from '../../core/agent/runtime'

export type ConversationMessage = {
  id: number
  role: 'user' | 'assistant'
  text: string
  notice?: string
  failed?: boolean
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

const conversationSnapshot = (agent: Agent) => {
  const messages = agent.state.messages.flatMap(messageSnapshot)
  const streaming = agent.state.streamingMessage
  return streaming
    ? [...messages, ...messageSnapshot(streaming, agent.state.messages.length)]
    : messages
}

export const useConversation = () => {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [phase, setPhase] = useState<ConversationPhase>('initializing')
  const [error, setError] = useState<string>()
  const agentRef = useRef<Agent>(undefined)
  const busyRef = useRef(false)

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
        const agent = createConversationAgent(config)
        agentRef.current = agent
        unsubscribe = agent.subscribe(() => setMessages(conversationSnapshot(agent)))
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
  }, [])

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
        setMessages(conversationSnapshot(agent))
        setPhase('ready')
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
