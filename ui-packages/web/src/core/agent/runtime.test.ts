import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileFiles } from '../compile/client'
import { demoProject } from '../project/demo-project'
import { createProjectStore } from '../project/store'
import { createCompileTool } from './compile-tool'
import { createConversationAgent } from './runtime'

const config = { enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' } as const
const createAgent = (modelConfig = config) =>
  createConversationAgent(modelConfig, createProjectStore(demoProject), async () => ({
    ok: true,
    js: '',
    css: '',
    warnings: [],
  }))
const event = (delta: Record<string, unknown>, finishReason: string | null = null) =>
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
  it.each([
    [500, 'service'],
    [503, 'service'],
    [400, 'compile'],
    [413, 'compile'],
    [422, 'compile'],
  ] as const)('classifies HTTP %i from the compilation client as %s', async (status, phase) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: false, errors: [{ message: 'Request failed' }] }, { status }),
    )
    const tool = createCompileTool(signal =>
      compileFiles(demoProject, signal ?? new AbortController().signal),
    )
    await expect(tool.execute('compile-error', {})).rejects.toThrow(`"phase":"${phase}"`)
  })

  it('feeds compile errors back to Pi, repairs the project and keeps compiled bundles out of model context', async () => {
    const project = createProjectStore({
      entry: 'src/main.tsx',
      files: { 'src/main.tsx': 'export const value = 1' },
    })
    const payloads: string[] = []
    let compilations = 0
    const toolReply = (calls: { name: string; arguments: unknown }[]) =>
      new Response(
        `${event(
          {
            tool_calls: calls.map((call, index) => ({
              index,
              id: `call-${payloads.length}-${index}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          },
          'tool_calls',
        )}data: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === '/api/compile') {
        compilations += 1
        expect(JSON.parse(String(init?.body)).files['src/main.tsx']).toBe(
          compilations === 1 ? 'export const value =' : 'export const value = 2',
        )
        return compilations === 1
          ? Response.json(
              {
                ok: false,
                errors: [
                  { message: 'Unexpected end of file', path: 'src/main.tsx', line: 1, column: 21 },
                ],
              },
              { status: 422 },
            )
          : Response.json({
              ok: true,
              js: 'BUNDLE_MUST_STAY_IN_PREVIEW',
              css: 'CSS_MUST_STAY_IN_PREVIEW',
              warnings: [],
            })
      }
      payloads.push(String(init?.body))
      if (payloads.length === 1)
        return toolReply([
          {
            name: 'edit',
            arguments: {
              path: 'src/main.tsx',
              edits: [{ oldText: 'value = 1', newText: 'value =' }],
            },
          },
          { name: 'compile', arguments: {} },
        ])
      if (payloads.length === 2)
        return toolReply([
          {
            name: 'edit',
            arguments: {
              path: 'src/main.tsx',
              edits: [{ oldText: 'value =', newText: 'value = 2' }],
            },
          },
          { name: 'compile', arguments: {} },
        ])
      return reply()
    })
    const agent = createConversationAgent(config, project, signal =>
      compileFiles(project.getSnapshot(), signal ?? new AbortController().signal),
    )
    await agent.prompt('Update the value and compile.')
    expect(compilations).toBe(2)
    expect(project.getSnapshot().files['src/main.tsx']).toBe('export const value = 2')
    expect(agent.state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'toolResult',
          toolName: 'compile',
          isError: true,
          content: [{ type: 'text', text: expect.stringContaining('Unexpected end of file') }],
        }),
        expect.objectContaining({
          role: 'toolResult',
          toolName: 'compile',
          isError: false,
          content: [{ type: 'text', text: expect.stringContaining('"compiled":true') }],
        }),
      ]),
    )
    expect(payloads[1]).toContain('Unexpected end of file')
    expect(payloads[2]).toContain('previewRefreshRequested')
    expect(JSON.stringify([payloads, agent.state.messages])).not.toContain('MUST_STAY_IN_PREVIEW')
  })

  it('distinguishes service failures and bounds model-visible diagnostics', async () => {
    const unavailable = createCompileTool(async () => {
      throw new Error('Service offline')
    })
    await expect(unavailable.execute('offline', {})).rejects.toThrow('"phase":"service"')
    const tool = createCompileTool(async () => ({
      ok: false,
      errors: [{ message: '界'.repeat(30_000) }],
    }))
    try {
      await tool.execute('large', {})
      expect.unreachable('Compilation must fail')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toContain('Diagnostics truncated')
      expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(50 * 1024)
    }
  })

  it('uses the same-origin GLM adapter and preserves a successful conversation and reasoning', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push({ url: String(input), init })
      return reply()
    })
    const agent = createAgent()
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
    expect(agent.state.tools.map(tool => tool.name)).toEqual([
      'list',
      'read',
      'edit',
      'write',
      'compile',
    ])
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
    const agent = createAgent()
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
    const agent = createAgent()
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
    expect(() =>
      createConversationAgent(
        { ...config, modelId: 'unknown' },
        createProjectStore(demoProject),
        vi.fn(),
      ),
    ).toThrow('Unsupported GLM')
  })
})
