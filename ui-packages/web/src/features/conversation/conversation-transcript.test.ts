import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import {
  createConversationItems,
  createUserPrompt,
  groupConversationActivity,
  summarizeActivity,
  type ToolExecutionState,
  toolOutputText,
} from './conversation-transcript'

type AssistantMessage = Extract<AgentMessage, { role: 'assistant' }>

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

const assistant = (
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage => ({
  role: 'assistant',
  content,
  api: 'openai-completions',
  provider: 'zai-coding-cn',
  model: 'test',
  usage,
  stopReason,
  timestamp: 2,
})

describe('conversation transcript', () => {
  it('keeps attachment paths in model context without exposing the manifest in the transcript', () => {
    const prompt = createUserPrompt('Use these references', [
      'attachments/requirements.md',
      'attachments/reference.png',
    ])
    const items = createConversationItems({
      messages: [{ role: 'user', content: prompt, timestamp: 1 }],
      toolLabels: new Map(),
      executions: new Map(),
      running: false,
    })

    expect(prompt).toContain('<attached_project_files>')
    expect(items).toEqual([
      {
        kind: 'user',
        key: 'message:0',
        text: 'Use these references',
        attachments: ['attachments/requirements.md', 'attachments/reference.png'],
      },
    ])
  })

  it('preserves Pi block order and pairs tool results without duplicating them', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'Build it', timestamp: 1 },
      assistant(
        [
          { type: 'thinking', thinking: 'Inspect the project first.' },
          { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'src/main.tsx' } },
        ],
        'toolUse',
      ),
      {
        role: 'toolResult',
        toolCallId: 'read-1',
        toolName: 'read',
        content: [{ type: 'text', text: 'export const App = () => null' }],
        isError: false,
        timestamp: 3,
      },
      assistant([{ type: 'text', text: '**Done.**' }]),
    ]
    const items = createConversationItems({
      messages,
      toolLabels: new Map([['read', 'Read']]),
      executions: new Map(),
      running: false,
    })

    expect(items.map(item => item.kind)).toEqual(['user', 'thinking', 'tool', 'assistant'])
    expect(items[2]).toMatchObject({
      kind: 'tool',
      callId: 'read-1',
      name: 'Read',
      output: 'export const App = () => null',
      status: 'Completed',
      failed: false,
    })
    const stream = groupConversationActivity(items, false)
    expect(stream.map(item => item.kind)).toEqual(['user', 'activity-group', 'assistant'])
  })

  it('keeps a trailing activity group live and summarizes failures outside its details', () => {
    const executions = new Map<string, ToolExecutionState>([
      ['edit-1', { status: 'Failed', output: 'Could not find the requested text.' }],
    ])
    const items = createConversationItems({
      messages: [
        assistant(
          [
            { type: 'thinking', thinking: 'Apply the requested change.' },
            { type: 'toolCall', id: 'edit-1', name: 'edit', arguments: { path: 'src/app.tsx' } },
          ],
          'toolUse',
        ),
      ],
      toolLabels: new Map(),
      executions,
      running: true,
    })
    const [group] = groupConversationActivity(items, true)
    expect(group).toMatchObject({ kind: 'activity-group', live: true })
    if (group?.kind !== 'activity-group') throw new Error('Expected an activity group')
    expect(summarizeActivity(group)).toEqual({
      steps: 2,
      parts: ['1 edit', '1 thinking'],
      failed: 1,
    })
    expect(toolOutputText({ content: [{ type: 'text', text: 'partial output' }] })).toBe(
      'partial output',
    )
  })
})
