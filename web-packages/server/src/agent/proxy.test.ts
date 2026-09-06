import { request } from 'node:http'
import { serve } from '@hono/node-server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'

const config = { apiKey: 'server-secret', modelId: 'glm-5.3' }
const body = { model: config.modelId, messages: [{ role: 'user', content: 'Hello' }], stream: true }
const app = createApp(undefined, config)
const post = (value: unknown = body) =>
  app.request('/api/agent/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-placeholder' },
    body: JSON.stringify(value),
  })

afterEach(() => vi.restoreAllMocks())

describe('model proxy', () => {
  it('forwards provider fields and the first chunk without buffering or browser credentials', async () => {
    const stream = new TransformStream<Uint8Array, Uint8Array>()
    const fetchModel = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(stream.readable, { headers: { 'Content-Type': 'text/event-stream' } }),
      )
    const response = await post({ ...body, thinking: { type: 'enabled' }, tool_stream: true })
    const [url, options] = fetchModel.mock.calls[0] ?? []
    expect(url).toBe('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions')
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer server-secret')
    expect(options?.redirect).toBe('error')
    expect(JSON.parse(String(options?.body))).toMatchObject({
      thinking: { type: 'enabled' },
      tool_stream: true,
    })
    const reader = response.body?.getReader()
    const writer = stream.writable.getWriter()
    const write = writer.write(new TextEncoder().encode('data: first\n\n'))
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe('data: first\n\n')
    await write
    await writer.close()
    expect((await reader?.read())?.done).toBe(true)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects malformed, non-JSON, mismatched and oversized input before contacting the provider', async () => {
    const fetchModel = vi.spyOn(globalThis, 'fetch')
    expect((await post({ ...body, model: 'another-model' })).status).toBe(400)
    expect((await post({ ...body, stream: false })).status).toBe(400)
    expect((await post({ ...body, messages: null })).status).toBe(400)
    expect((await post({ ...body, extra: 'x'.repeat(2 * 1024 * 1024) })).status).toBe(413)
    expect(
      (await app.request('/api/agent/chat/completions', { method: 'POST', body: '{}' })).status,
    ).toBe(400)
    const malformed = await app.request('/api/agent/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    expect(malformed.status).toBe(400)
    expect(fetchModel).not.toHaveBeenCalled()
  })

  it('returns safe upstream errors and distinguishes connection failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchModel = vi.spyOn(globalThis, 'fetch')
    fetchModel.mockResolvedValueOnce(new Response('private upstream diagnostic', { status: 429 }))
    const rejected = await post()
    expect(rejected.status).toBe(429)
    expect(await rejected.text()).not.toContain('private upstream diagnostic')
    fetchModel.mockResolvedValueOnce(Response.json({ unexpected: true }))
    expect((await post()).status).toBe(502)
    fetchModel.mockRejectedValueOnce(new TypeError('private connection diagnostic'))
    const failed = await post()
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain('private connection diagnostic')
    expect(warn).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('Model connection failed', { name: 'TypeError' })
  })

  it('aborts the upstream when a real HTTP client disconnects during streaming', async () => {
    let aborted = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: first\n\n'))
          options?.signal?.addEventListener(
            'abort',
            () => {
              controller.error(new DOMException('Aborted', 'AbortError'))
              aborted = true
            },
            { once: true },
          )
        },
      })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
    try {
      await new Promise<void>(resolve => server.once('listening', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a TCP address')
      const port = address.port
      await new Promise<void>((resolve, reject) => {
        const client = request(
          `http://127.0.0.1:${port}/api/agent/chat/completions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          response => {
            response.once('data', () => {
              response.destroy()
              resolve()
            })
            response.once('error', reject)
          },
        )
        client.once('error', reject)
        client.end(JSON.stringify(body))
      })
      await vi.waitFor(() => expect(aborted).toBe(true))
    } finally {
      if ('closeAllConnections' in server) server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      )
    }
  })
})
