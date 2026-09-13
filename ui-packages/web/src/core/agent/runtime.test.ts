import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileFiles } from '../compile/client'
import { demoProject } from '../project/demo-project'
import { createProjectRepository } from '../project/repository'
import { createProjectStore } from '../project/store'
import { createAnalyzeImageTool } from './analyze-image-tool'
import { createCompileTool } from './compile-tool'
import { type AgentPreview, createConversationAgent } from './runtime'

const config = { enabled: true, provider: 'zai-coding-cn', modelId: 'glm-5.3' } as const
const compileInput = (files: typeof demoProject) => ({
  baseBuildId: null,
  entry: files.entry,
  sourceTree: {},
  changes: { ...files.files },
})
const build = {
  projectId: 'test-project',
  buildId: 'a'.repeat(64),
  compilerVersion: '1',
  entry: 'src/main.tsx',
  files: {},
  previewUrl: '/__preview/test-project/1',
}
const createPreview = (changes: Partial<AgentPreview> = {}): AgentPreview => ({
  compile: async () => ({
    ok: true,
    build,
    warnings: [],
  }),
  refresh: async () => ({ refreshed: true, buildId: 1 }),
  readErrors: () => ({ buildId: 1, status: 'ready', errors: [], dropped: 0 }),
  readConsole: () => ({ buildId: 1, entries: [], dropped: 0 }),
  ...changes,
})
const repositoryFor = (project: ReturnType<typeof createProjectStore>) =>
  createProjectRepository(
    'test-project',
    project,
    { getStoredFileContent: async () => undefined, saveStoredFiles: async () => undefined },
    [],
  )
const chatSession = (messages: Parameters<typeof createConversationAgent>[5]['messages'] = []) => ({
  id: 'test-chat',
  messages,
})
const createAgent = (modelConfig = config, messages = chatSession().messages) => {
  const project = createProjectStore(demoProject)
  return createConversationAgent(
    modelConfig,
    'test-project',
    project,
    repositoryFor(project),
    createPreview(),
    chatSession(messages),
  )
}
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
  it('exposes the stable image-analysis contract without pretending analysis is available', async () => {
    const project = createProjectStore(demoProject)
    const repository = createProjectRepository(
      'test-project',
      project,
      { getStoredFileContent: async () => undefined, saveStoredFiles: async () => undefined },
      [
        {
          id: 'reference',
          projectId: 'test-project',
          path: 'attachments/reference.png',
          mediaType: 'image/png',
          size: 5,
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        },
      ],
    )
    const tool = createAnalyzeImageTool(repository)

    await expect(
      tool.execute('analyze', { path: 'attachments/reference.png', question: 'What is shown?' }),
    ).rejects.toThrow('not available yet')
  })

  it.each([
    [500, 'service'],
    [503, 'service'],
    [400, 'compile'],
    [413, 'compile'],
    [422, 'compile'],
  ] as const)('classifies HTTP %i from the compilation client as %s', async (status, phase) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          ok: false,
          reason: status === 400 || status === 413 ? 'invalid-input' : 'compile',
          errors: [{ message: 'Request failed' }],
        },
        { status },
      ),
    )
    const tool = createCompileTool(signal =>
      compileFiles(
        'test-project',
        compileInput(demoProject),
        signal ?? new AbortController().signal,
      ),
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
      if (String(input) === '/api/compiler/projects/test-project/builds') {
        compilations += 1
        expect(JSON.parse(String(init?.body)).changes['src/main.tsx']).toBe(
          compilations === 1 ? 'export const value =' : 'export const value = 2',
        )
        return compilations === 1
          ? Response.json(
              {
                ok: false,
                reason: 'compile',
                errors: [
                  { message: 'Unexpected end of file', path: 'src/main.tsx', line: 1, column: 21 },
                ],
              },
              { status: 422 },
            )
          : Response.json({
              ok: true,
              build: { ...build, previewUrl: '/__preview/BUNDLE_MUST_STAY_IN_PREVIEW' },
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
      if (payloads.length === 3) return toolReply([{ name: 'refresh_preview', arguments: {} }])
      return reply()
    })
    const refresh = vi.fn(async () => ({ refreshed: true as const, buildId: 1 }))
    const agent = createConversationAgent(
      config,
      'test-project',
      project,
      repositoryFor(project),
      createPreview({
        compile: signal =>
          compileFiles(
            'test-project',
            compileInput(project.getSnapshot()),
            signal ?? new AbortController().signal,
          ),
        refresh,
      }),
      chatSession(),
    )
    await agent.prompt('Update the value and compile.')
    expect(compilations).toBe(2)
    expect(refresh).toHaveBeenCalledOnce()
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
    expect(payloads[2]).toContain('refreshRequired')
    expect(payloads[3]).toContain('refreshed')
    expect(JSON.stringify([payloads, agent.state.messages])).not.toContain('MUST_STAY_IN_PREVIEW')
  })

  it('feeds preview initialization errors back to Pi before the model finishes', async () => {
    const payloads: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      payloads.push(String(init?.body))
      if (payloads.length === 1)
        return new Response(
          `${event(
            {
              tool_calls: [
                {
                  index: 0,
                  id: 'refresh-failed',
                  type: 'function',
                  function: { name: 'refresh_preview', arguments: '{}' },
                },
              ],
            },
            'tool_calls',
          )}data: [DONE]\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      return reply()
    })
    const refresh = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Indexes require distinct string or numeric fields with identifier names, not paths.',
        ),
      )
    const project = createProjectStore(demoProject)
    const agent = createConversationAgent(
      config,
      'test-project',
      project,
      repositoryFor(project),
      createPreview({ refresh }),
      chatSession(),
    )
    await agent.prompt('Refresh the preview.')
    expect(refresh).toHaveBeenCalledOnce()
    expect(agent.state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'toolResult',
          toolName: 'refresh_preview',
          isError: true,
          content: [{ type: 'text', text: expect.stringContaining('Indexes require distinct') }],
        }),
      ]),
    )
    expect(payloads).toHaveLength(2)
    expect(payloads[1]).toContain('Indexes require distinct')
  })

  it('distinguishes service failures and bounds model-visible diagnostics', async () => {
    const unavailable = createCompileTool(async () => {
      throw new Error('Service offline')
    })
    await expect(unavailable.execute('offline', {})).rejects.toThrow('"phase":"service"')
    const tool = createCompileTool(async () => ({
      ok: false,
      reason: 'compile',
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
    expect(agent.state.systemPrompt).toContain('/project/.gamma/skills/local-db/SKILL.md')
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
      'copy',
      'edit',
      'write',
      'analyze_image',
      'db_get',
      'db_list',
      'db_create',
      'db_update',
      'db_remove',
      'compile',
      'refresh_preview',
      'read_preview_errors',
      'read_preview_console',
    ])
    expect(agent.state.tools.find(tool => tool.name === 'db_get')?.label).toBe('db.get')
  })

  it('restores a saved Pi transcript before sending the next prompt', async () => {
    const requests: RequestInit[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requests.push(init ?? {})
      return reply()
    })
    const saved = [
      { role: 'user' as const, content: 'Keep the blue header', timestamp: 1 },
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'I will keep it.' }],
        api: 'openai-completions' as const,
        provider: 'zai-coding-cn',
        model: 'glm-5.3',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop' as const,
        timestamp: 2,
      },
    ]
    const agent = createAgent(config, saved)

    expect(agent.sessionId).toBe('test-chat')
    expect(agent.state.messages).toEqual(saved)
    await agent.prompt('Add a footer')
    const payload = JSON.parse(String(requests[0]?.body))
    expect(payload.messages.map((message: { role: string }) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ])
    expect(JSON.stringify(payload.messages)).toContain('Keep the blue header')
    expect(JSON.stringify(payload.messages)).toContain('Add a footer')
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
      (() => {
        const project = createProjectStore(demoProject)
        return createConversationAgent(
          { ...config, modelId: 'unknown' },
          'test-project',
          project,
          repositoryFor(project),
          createPreview(),
          chatSession(),
        )
      })(),
    ).toThrow('Unsupported GLM')
  })
})
