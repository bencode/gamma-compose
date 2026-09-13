import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import { useEffect, useRef, useState } from 'react'
import {
  type AgentPreview,
  createConversationAgent,
  loadAgentConfig,
} from '../../core/agent/runtime'
import type { ProjectRepository } from '../../core/project/repository'
import type { ProjectStore } from '../../core/project/store'
import {
  type ConversationItem,
  createConversationItems,
  createUserPrompt,
  type ToolExecutionState,
  toolOutputText,
} from './conversation-transcript'
import type { MessageAttachments } from './use-message-attachments'

export type ConversationPhase =
  | 'initializing'
  | 'ready'
  | 'unavailable'
  | 'error'
  | 'running'
  | 'stopping'

const conversationSnapshot = (
  agent: Agent,
  executions: ReadonlyMap<string, ToolExecutionState>,
): ConversationItem[] => {
  const toolLabels = new Map(agent.state.tools.map(tool => [tool.name, tool.label]))
  return createConversationItems({
    messages: agent.state.messages,
    streamingMessage: agent.state.streamingMessage,
    toolLabels,
    executions,
    running: agent.state.isStreaming,
  })
}

const updateToolStatus = (
  event: AgentEvent,
  executions: Map<string, ToolExecutionState>,
  signal: AbortSignal,
) => {
  if (event.type === 'tool_execution_start') executions.set(event.toolCallId, { status: 'Running' })
  if (event.type === 'tool_execution_update') {
    const output = toolOutputText(event.partialResult)
    const previousOutput = executions.get(event.toolCallId)?.output
    const nextOutput = output ?? previousOutput
    executions.set(
      event.toolCallId,
      nextOutput === undefined ? { status: 'Running' } : { status: 'Running', output: nextOutput },
    )
  }
  if (event.type === 'tool_execution_end') {
    const output = toolOutputText(event.result)
    executions.set(event.toolCallId, {
      status: signal.aborted ? 'Stopped' : event.isError ? 'Failed' : 'Completed',
      ...(output === undefined ? {} : { output }),
    })
  }
}

export const useConversation = (
  projectId: string,
  project: ProjectStore,
  repository: ProjectRepository,
  attachments: MessageAttachments,
  { compile, refresh, readErrors, readConsole }: AgentPreview,
) => {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ConversationItem[]>([])
  const [phase, setPhase] = useState<ConversationPhase>('initializing')
  const [error, setError] = useState<string>()
  const agentRef = useRef<Agent>(undefined)
  const busyRef = useRef(false)
  const toolExecutions = useRef(new Map<string, ToolExecutionState>())

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
        const agent = createConversationAgent(config, projectId, project, repository, {
          compile,
          refresh,
          readErrors,
          readConsole,
        })
        agentRef.current = agent
        toolExecutions.current.clear()
        unsubscribe = agent.subscribe((event, signal) => {
          updateToolStatus(event, toolExecutions.current, signal)
          setMessages(conversationSnapshot(agent, toolExecutions.current))
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
  }, [projectId, project, repository, compile, refresh, readErrors, readConsole])

  const send = async () => {
    const agent = agentRef.current
    const text = draft.trim()
    const attachedPaths = attachments.selectedPaths
    if (!agent || busyRef.current || (!text && !attachedPaths.length)) return
    busyRef.current = true
    setPhase('running')
    setError(undefined)
    setDraft('')
    attachments.clearSelection()
    try {
      await agent.prompt(createUserPrompt(text, attachedPaths))
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

  return { draft, setDraft, messages, phase, error, send, stop }
}
