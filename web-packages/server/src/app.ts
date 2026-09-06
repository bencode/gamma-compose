import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compileProject } from './compiler/compile.js'
import { InvalidCompileInput, maxCompileBytes, readCompileInput } from './compiler/input.js'

type HealthResponse = {
  status: 'ok'
  service: 'gamma-compose'
}

export const createApp = (webRoot?: string) => {
  const app = new Hono()

  app.get('/api/health', c =>
    c.json({ status: 'ok', service: 'gamma-compose' } satisfies HealthResponse),
  )
  app.post(
    '/api/compile',
    bodyLimit({
      maxSize: maxCompileBytes,
      onError: c =>
        c.json({ ok: false, errors: [{ message: 'Compile requests cannot exceed 2 MiB' }] }, 413),
    }),
    async c => {
      if (
        c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
      ) {
        return c.json({ ok: false, errors: [{ message: 'Use application/json' }] }, 400)
      }
      let value: unknown
      try {
        value = await c.req.json()
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        return c.json({ ok: false, errors: [{ message: 'The request is not valid JSON' }] }, 400)
      }
      try {
        const result = await compileProject(readCompileInput(value))
        return c.json(result, result.ok ? 200 : 422)
      } catch (error) {
        if (error instanceof InvalidCompileInput) {
          return c.json({ ok: false, errors: [{ message: error.message }] }, 400)
        }
        console.error('Compilation failed', error)
        return c.json(
          { ok: false, errors: [{ message: 'The compilation service failed. Please retry.' }] },
          500,
        )
      }
    },
  )
  app.all('/api', c => c.json({ error: 'Not found' }, 404))
  app.all('/api/*', c => c.json({ error: 'Not found' }, 404))

  if (webRoot) {
    app.use('*', serveStatic({ root: webRoot }))
    app.get('*', (c, next) => {
      const isPage = c.req.header('accept')?.includes('text/html')
      const isAsset =
        c.req.path.startsWith('/assets/') || c.req.path.split('/').at(-1)?.includes('.')
      if (!isPage || isAsset) return next()
      return serveStatic({ path: `${webRoot}/index.html` })(c, next)
    })
  }

  app.onError((error, c) => {
    console.error('Request failed', error)
    return c.json({ error: 'Internal server error' }, 500)
  })

  return app
}
