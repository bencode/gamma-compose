import type { AgentMessage } from '@earendil-works/pi-agent-core'

export type ToolStatus = 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Stopped'

export type ToolExecutionState = {
  status: ToolStatus
  output?: string
}

export type ConversationItem =
  | { kind: 'user'; key: string; text: string; attachments: readonly string[] }
  | { kind: 'assistant'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string }
  | {
      kind: 'tool'
      key: string
      callId: string
      name: string
      input: unknown
      output?: string
      status: ToolStatus
      failed: boolean
    }
  | { kind: 'notice'; key: string; text: string; failed: boolean }

export type ProcessItem = Extract<ConversationItem, { kind: 'thinking' | 'tool' }>

export type ActivityGroup = {
  kind: 'activity-group'
  key: string
  items: ProcessItem[]
  live: boolean
}

export type ConversationStreamItem = ConversationItem | ActivityGroup

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const contentText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap(block =>
    isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
  )
  return parts.length > 0 ? parts.join('') : undefined
}

const attachmentBlock = /\n*<attached_project_files>\n(\[[\s\S]*\])\n<\/attached_project_files>\s*$/

export const createUserPrompt = (text: string, attachments: readonly string[]) => {
  if (!attachments.length) return text
  const prefix = text ? `${text}\n\n` : ''
  return `${prefix}<attached_project_files>\n${JSON.stringify(attachments)}\n</attached_project_files>`
}

const userPrompt = (text: string) => {
  const match = text.match(attachmentBlock)
  if (!match) return { text, attachments: [] as readonly string[] }
  try {
    const value: unknown = JSON.parse(match[1] ?? '[]')
    if (!Array.isArray(value) || !value.every(path => typeof path === 'string'))
      return { text, attachments: [] as readonly string[] }
    return { text: text.slice(0, match.index).trimEnd(), attachments: value }
  } catch (error) {
    console.error('Could not parse the attachment manifest.', error)
    return { text, attachments: [] as readonly string[] }
  }
}

export const toolOutputText = (result: unknown): string | undefined =>
  isRecord(result) ? contentText(result.content) : undefined

const noticeFor = (
  message: Extract<AgentMessage, { role: 'assistant' }>,
  key: string,
): Extract<ConversationItem, { kind: 'notice' }> | undefined => {
  if (message.stopReason === 'aborted')
    return { kind: 'notice', key, text: 'Generation stopped.', failed: false }
  if (message.stopReason === 'error')
    return {
      kind: 'notice',
      key,
      text: message.errorMessage || 'Generation failed. Please send a new message to try again.',
      failed: true,
    }
  if (message.stopReason === 'length')
    return {
      kind: 'notice',
      key,
      text: 'The response reached its output limit.',
      failed: false,
    }
  return undefined
}

type TranscriptInput = {
  messages: readonly AgentMessage[]
  streamingMessage?: AgentMessage
  toolLabels: ReadonlyMap<string, string>
  executions: ReadonlyMap<string, ToolExecutionState>
  running: boolean
}

export const createConversationItems = ({
  messages,
  streamingMessage,
  toolLabels,
  executions,
  running,
}: TranscriptInput): ConversationItem[] => {
  const source = streamingMessage ? [...messages, streamingMessage] : [...messages]
  const callIds = new Set(
    source.flatMap(message =>
      message.role === 'assistant'
        ? message.content.flatMap(block => (block.type === 'toolCall' ? [block.id] : []))
        : [],
    ),
  )
  const results = new Map(
    source.flatMap(message =>
      message.role === 'toolResult' ? ([[message.toolCallId, message]] as const) : [],
    ),
  )

  return source.flatMap((message, messageIndex): ConversationItem[] => {
    if (message.role === 'user') {
      const text = contentText(message.content)
      if (!text) return []
      return [{ kind: 'user', key: `message:${messageIndex}`, ...userPrompt(text) }]
    }
    if (message.role === 'toolResult') {
      if (callIds.has(message.toolCallId)) return []
      const output = contentText(message.content)
      return [
        {
          kind: 'tool',
          key: `tool:${message.toolCallId}`,
          callId: message.toolCallId,
          name: toolLabels.get(message.toolName) ?? message.toolName,
          input: undefined,
          ...(output === undefined ? {} : { output }),
          status: message.isError ? 'Failed' : 'Completed',
          failed: message.isError,
        },
      ]
    }
    if (message.role !== 'assistant') return []

    const items = message.content.flatMap((block, blockIndex): ConversationItem[] => {
      const key = `message:${messageIndex}:block:${blockIndex}`
      if (block.type === 'text')
        return block.text ? [{ kind: 'assistant', key, text: block.text }] : []
      if (block.type === 'thinking')
        return block.thinking ? [{ kind: 'thinking', key, text: block.thinking }] : []
      if (block.type !== 'toolCall') return []
      const result = results.get(block.id)
      const execution = executions.get(block.id)
      const output = result ? contentText(result.content) : execution?.output
      const status = result
        ? result.isError
          ? 'Failed'
          : 'Completed'
        : (execution?.status ?? (running ? 'Pending' : 'Stopped'))
      return [
        {
          kind: 'tool',
          key: `tool:${block.id}`,
          callId: block.id,
          name: toolLabels.get(block.name) ?? block.name,
          input: block.arguments,
          ...(output === undefined ? {} : { output }),
          status,
          failed: status === 'Failed',
        },
      ]
    })
    const notice = noticeFor(message, `message:${messageIndex}:notice`)
    return notice ? [...items, notice] : items
  })
}

const isProcess = (item: ConversationItem): item is ProcessItem =>
  item.kind === 'thinking' || item.kind === 'tool'

export const groupConversationActivity = (
  items: readonly ConversationItem[],
  running: boolean,
): ConversationStreamItem[] => {
  const stream: ConversationStreamItem[] = []
  let pending: ProcessItem[] = []
  const flush = (live: boolean) => {
    if (pending.length === 0) return
    if (pending.length === 1 && !live && pending[0]) stream.push(pending[0])
    else
      stream.push({
        kind: 'activity-group',
        key: `activity:${pending[0]?.key}`,
        items: pending,
        live,
      })
    pending = []
  }

  items.forEach(item => {
    if (isProcess(item)) pending.push(item)
    else {
      flush(false)
      stream.push(item)
    }
  })
  flush(running)
  return stream
}

export const summarizeActivity = (group: ActivityGroup) => {
  const counts = new Map<string, number>()
  group.items.forEach(item => {
    const label = item.kind === 'thinking' ? 'thinking' : item.name
    counts.set(label, (counts.get(label) ?? 0) + 1)
  })
  const thinking = counts.get('thinking')
  counts.delete('thinking')
  const parts = [...counts].map(([name, count]) => `${count} ${name}`)
  if (thinking !== undefined) parts.push(`${thinking} thinking`)
  return {
    steps: group.items.length,
    parts,
    failed: group.items.filter(item => item.kind === 'tool' && item.failed).length,
  }
}
