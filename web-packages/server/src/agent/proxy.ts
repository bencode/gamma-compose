import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { type AgentServerConfig, publicAgentConfig } from './config.js'

const endpoint = 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'
const maxRequestBytes = 2 * 1024 * 1024
const requestTimeoutMs = 5 * 60 * 1000

const errorResponse = (status: number, message: string) =>
  Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } })

const validRequest = (value: unknown, modelId: string): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  'model' in value &&
  value.model === modelId &&
  'stream' in value &&
  value.stream === true &&
  'messages' in value &&
  Array.isArray(value.messages)

const forwardRequest = async (
  body: Record<string, unknown>,
  config: AgentServerConfig,
  clientSignal: AbortSignal,
) => {
  const timeout = AbortSignal.timeout(requestTimeoutMs)
  const signal = AbortSignal.any([clientSignal, timeout])
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!upstream.ok) {
      await upstream.body?.cancel()
      console.warn('Model request rejected', { status: upstream.status })
      return errorResponse(upstream.status, `Model provider returned HTTP ${upstream.status}.`)
    }
    if (!upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) {
      await upstream.body?.cancel()
      console.warn('Model provider returned a non-streaming response')
      return errorResponse(502, 'The model provider did not return an event stream.')
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    if (clientSignal.aborted) return errorResponse(499, 'The request was cancelled.')
    if (timeout.aborted) return errorResponse(504, 'The model request timed out.')
    console.error('Model connection failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return errorResponse(502, 'Could not connect to the model provider.')
  }
}

export const createAgentRoutes = (config: AgentServerConfig) => {
  const routes = new Hono()
  routes.get('/config', c => {
    c.header('Cache-Control', 'no-store')
    return c.json(publicAgentConfig(config))
  })
  routes.post(
    '/chat/completions',
    bodyLimit({
      maxSize: maxRequestBytes,
      onError: () => errorResponse(413, 'Model requests cannot exceed 2 MiB.'),
    }),
    async c => {
      if (!config.apiKey) return errorResponse(503, 'Chat is not configured on this server.')
      if (c.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') {
        return errorResponse(400, 'Use application/json.')
      }
      let body: unknown
      try {
        body = await c.req.json()
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        return errorResponse(400, 'The request is not valid JSON.')
      }
      if (!validRequest(body, config.modelId)) {
        return errorResponse(400, 'Use the configured model, a messages array and stream: true.')
      }
      return forwardRequest(body, config, c.req.raw.signal)
    },
  )
  return routes
}
