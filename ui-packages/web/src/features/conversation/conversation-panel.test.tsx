import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../../core/project/demo-project'
import { createProjectStore } from '../../core/project/store'
import { ConversationPanel } from './conversation-panel'
import { useConversation } from './use-conversation'

const compile = async () => ({ ok: true as const, js: '', css: '', warnings: [] })
const refresh = async () => ({ refreshed: true as const, buildId: 1 })
const preview = {
  compile,
  refresh,
  readErrors: () => ({ buildId: 1, status: 'ready' as const, errors: [], dropped: 0 }),
  readConsole: () => ({ buildId: 1, entries: [], dropped: 0 }),
}
const ConnectedConversation = () => {
  const [project] = useState(() => createProjectStore(demoProject))
  return <ConversationPanel {...useConversation('test-project', project, preview)} />
}
const event = (delta: Record<string, unknown>, finishReason: string | null = null) =>
  new TextEncoder().encode(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`,
  )
let streams: ReadableStreamDefaultController<Uint8Array>[]
let signals: AbortSignal[]

beforeEach(() => {
  streams = []
  signals = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input) === '/api/agent/config') {
      return Response.json({ enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' })
    }
    const signal = init?.signal
    if (signal) signals.push(signal)
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller)
          signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  })
})
afterEach(() => vi.restoreAllMocks())

const sendMessage = async (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } })
  const send = screen.getByRole('button', { name: 'Send' })
  await waitFor(() => expect(send).toBeEnabled())
  fireEvent.click(send)
}

describe('conversation', () => {
  it.each([null, [], 7, 'invalid'].map(args => ({ args })))(
    'recovers from invalid tool arguments $args without losing the conversation',
    async ({ args }) => {
      render(<ConnectedConversation />)
      await sendMessage('Read the project')
      await waitFor(() => expect(streams).toHaveLength(1))
      const finishTool = (index: number, id: string, toolArgs: unknown) =>
        act(() => {
          streams[index]?.enqueue(
            event(
              {
                tool_calls: [
                  {
                    index: 0,
                    id,
                    type: 'function',
                    function: { name: 'read', arguments: JSON.stringify(toolArgs) },
                  },
                ],
              },
              'tool_calls',
            ),
          )
          streams[index]?.close()
        })
      finishTool(0, 'invalid-tool', args)
      await waitFor(() => expect(streams).toHaveLength(2))
      expect(screen.getByRole('list', { name: 'Tool activity' })).toHaveTextContent('Failed')
      const payload = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))
      expect(payload.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'tool', tool_call_id: 'invalid-tool' }),
          expect.objectContaining({
            role: 'assistant',
            tool_calls: [
              expect.objectContaining({
                function: expect.objectContaining({ arguments: JSON.stringify(args) }),
              }),
            ],
          }),
        ]),
      )
      finishTool(1, 'valid-tool', { path: 'src/main.tsx' })
      await waitFor(() => expect(streams).toHaveLength(3))
      expect(screen.getAllByRole('list', { name: 'Tool activity' }).at(-1)).toHaveTextContent(
        'Completed',
      )
      act(() => {
        streams[2]?.enqueue(event({ content: 'Read successfully.' }, 'stop'))
        streams[2]?.close()
      })
      await screen.findByText('Read successfully.')
      await sendMessage('Continue the discussion')
      await waitFor(() => expect(streams).toHaveLength(4))
      act(() => {
        streams[3]?.enqueue(event({ content: 'Continuing.' }, 'stop'))
        streams[3]?.close()
      })
      await screen.findByText('Continuing.')
      expect(screen.getAllByRole('article', { name: 'You' })).toHaveLength(2)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('shows tool status without file contents and can stop and resume after a completed write', async () => {
    render(<ConnectedConversation />)
    await sendMessage('Create a component')
    await waitFor(() => expect(streams).toHaveLength(1))
    act(() => {
      streams[0]?.enqueue(
        event(
          {
            tool_calls: [
              {
                index: 0,
                id: 'write-one',
                type: 'function',
                function: {
                  name: 'write',
                  arguments: JSON.stringify({
                    path: 'src/new.tsx',
                    content: 'export const hiddenFileContent = 42',
                  }),
                },
              },
            ],
          },
          'tool_calls',
        ),
      )
      streams[0]?.close()
    })
    expect(await screen.findByRole('list', { name: 'Tool activity' })).toHaveTextContent(
      'writesrc/new.tsxCompleted',
    )
    expect(screen.queryByText(/hiddenFileContent/)).not.toBeInTheDocument()
    await waitFor(() => expect(streams).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Stopping…' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('list', { name: 'Tool activity' })).toHaveTextContent('Completed')
    await sendMessage('Read the file')
    await waitFor(() => expect(streams).toHaveLength(3))
    act(() => {
      streams[2]?.enqueue(
        event(
          {
            tool_calls: [
              {
                index: 0,
                id: 'read-one',
                type: 'function',
                function: {
                  name: 'read',
                  arguments: JSON.stringify({ path: 'src/new.tsx' }),
                },
              },
            ],
          },
          'tool_calls',
        ),
      )
      streams[2]?.close()
    })
    await waitFor(() => expect(streams).toHaveLength(4))
    expect(screen.getAllByRole('list', { name: 'Tool activity' }).at(-1)).toHaveTextContent(
      'readsrc/new.tsxCompleted',
    )
    expect(screen.queryByText(/hiddenFileContent/)).not.toBeInTheDocument()
  })

  it('streams text without exposing reasoning and preserves the next draft', async () => {
    render(
      <StrictMode>
        <ConnectedConversation />
      </StrictMode>,
    )
    await sendMessage('Hello')
    await waitFor(() => expect(streams).toHaveLength(1))
    expect(screen.getByRole('article', { name: 'You' })).toHaveTextContent('Hello')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
    act(() => streams[0]?.enqueue(event({ reasoning_content: 'Private reasoning' })))
    expect(await screen.findByText('Thinking…')).toBeInTheDocument()
    expect(screen.queryByText('Private reasoning')).not.toBeInTheDocument()
    act(() => streams[0]?.enqueue(event({ content: 'First part' })))
    expect(await screen.findByText('First part')).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Next question' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(streams).toHaveLength(1)
    act(() => {
      streams[0]?.enqueue(event({ content: ' and the rest.' }))
      streams[0]?.enqueue(event({}, 'stop'))
      streams[0]?.close()
    })
    expect(await screen.findByText('First part and the rest.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    expect(input).toHaveValue('Next question')
  })

  it('stops generation, retains partial text and can send another message', async () => {
    render(<ConnectedConversation />)
    await sendMessage('Start')
    await waitFor(() => expect(streams).toHaveLength(1))
    act(() => streams[0]?.enqueue(event({ content: 'Partial answer' })))
    await screen.findByText('Partial answer')
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled()
    expect(await screen.findByText('Generation stopped.')).toBeInTheDocument()
    expect(signals[0]?.aborted).toBe(true)
    expect(screen.getByText('Partial answer')).toBeInTheDocument()
    await sendMessage('A new question')
    await waitFor(() => expect(streams).toHaveLength(2))
    act(() => {
      streams[1]?.enqueue(event({ content: 'New answer' }, 'stop'))
      streams[1]?.close()
    })
    expect(await screen.findByText('New answer')).toBeInTheDocument()
  })

  it('shows truncated-stream errors and allows a new request without replaying automatically', async () => {
    render(<ConnectedConversation />)
    await sendMessage('Start')
    await waitFor(() => expect(streams).toHaveLength(1))
    act(() => {
      streams[0]?.enqueue(event({ content: 'Unfinished' }))
      streams[0]?.close()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('finish_reason')
    expect(screen.getByText('Unfinished')).toBeInTheDocument()
    expect(streams).toHaveLength(1)
    await sendMessage('Try another question')
    await waitFor(() => expect(streams).toHaveLength(2))
  })

  it('does not send on Shift+Enter or IME confirmation and aborts on unmount', async () => {
    const view = render(<ConnectedConversation />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: '你好' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled())
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(streams).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(streams).toHaveLength(1))
    view.unmount()
    expect(signals[0]?.aborted).toBe(true)
  })

  it.each([
    [{ enabled: false }, 'Chat is not configured.'],
    [{ enabled: true, provider: 'zai-coding-cn', modelId: 'unknown' }, 'Unsupported GLM'],
  ])('disables sending for unavailable configuration', async (config, message) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(config))
    render(<ConnectedConversation />)
    expect(await screen.findByText(text => text.includes(message))).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Draft' },
    })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })
})
