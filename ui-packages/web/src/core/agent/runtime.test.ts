import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConversationAgent } from './runtime'

const config = { enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' } as const
const event = (delta: Record<string, string>, finishReason: string | null = null) =>
  `data: ${JSON.stringify({ id: 'completion', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
const reply = () =>
  new Response(
    event({ reasoning_content: 'Consider the request.' }) +
      event({ content: 'Hello' }) +
      event({}, 'stop') +
      'data: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

afterEach(() => vi.restoreAllMocks())

describe('browser Pi runtime', () => {
  it('uses the same-origin GLM adapter and preserves a successful conversation and reasoning', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push({ url: String(input), init })
      return reply()
    })
    const agent = createConversationAgent(config)
    await agent.prompt('First question')
    await agent.prompt('Second question')
    expect(requests).toHaveLength(2)
    expect(requests[0]?.url).toBe(new URL('/api/agent/chat/completions', location.origin).href)
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe(
      'Bearer gamma-compose-proxy',
    )
    const payload = JSON.parse(String(requests[1]?.init?.body))
    expect(payload).toMatchObject({ model: 'glm-5.3', stream: true, thinking: { type: 'enabled' } })
    expect(payload.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: [{ type: 'text', text: 'First question' }],
        }),
        expect.objectContaining({
          role: 'assistant',
          content: 'Hello',
          reasoning_content: 'Consider the request.',
        }),
        expect.objectContaining({
          role: 'user',
          content: [{ type: 'text', text: 'Second question' }],
        }),
      ]),
    )
    expect(agent.state.messages).toHaveLength(4)
    expect(agent.state.tools).toEqual([])
  })

  it('keeps partial text on abort, settles before reuse and excludes the aborted answer from replay', async () => {
    let receivedText = false
    const requests: { init?: RequestInit }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requests.push({ init })
      if (requests.length > 1) return reply()
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(event({ content: 'Partial response' })))
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    })
    const agent = createConversationAgent(config)
    agent.subscribe(update => {
      if (update.type === 'message_update' && update.assistantMessageEvent.type === 'text_delta')
        receivedText = true
    })
    const run = agent.prompt('Start')
    await vi.waitFor(() => expect(receivedText).toBe(true))
    agent.abort()
    await run
    expect(agent.state.isStreaming).toBe(false)
    expect(agent.state.messages.at(-1)).toMatchObject({
      stopReason: 'aborted',
      content: [expect.objectContaining({ text: 'Partial response' })],
    })
    await agent.prompt('Continue')
    expect(String(requests[1]?.init?.body)).not.toContain('Partial response')
  })

  it('surfaces HTTP and truncated-stream errors without automatic retries', async () => {
    const fetchModel = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ error: { message: 'Rate limited' } }, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(event({ content: 'Unfinished' }), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )
    const agent = createConversationAgent(config)
    await agent.prompt('Try')
    expect(agent.state.messages.at(-1)).toMatchObject({
      stopReason: 'error',
      errorMessage: expect.stringContaining('Rate limited'),
    })
    expect(fetchModel).toHaveBeenCalledTimes(1)
    await agent.prompt('Try again')
    expect(agent.state.messages.at(-1)).toMatchObject({
      stopReason: 'error',
      content: [expect.objectContaining({ text: 'Unfinished' })],
    })
    expect(fetchModel).toHaveBeenCalledTimes(2)
  })

  it('rejects unsupported configured models rather than silently replacing them', () => {
    expect(() => createConversationAgent({ ...config, modelId: 'unknown' })).toThrow(
      'Unsupported GLM',
    )
  })
})
