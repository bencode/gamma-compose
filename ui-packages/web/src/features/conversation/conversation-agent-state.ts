import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import {
  type ConversationItem,
  createConversationItems,
  type ToolExecutionState,
  toolOutputText,
} from './conversation-transcript'

export const conversationSnapshot = (
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

export const updateToolStatus = (
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
