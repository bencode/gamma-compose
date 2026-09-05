import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'

type HealthResponse = {
  status: 'ok'
  service: 'gamma-compose'
}

export const createApp = (webRoot?: string) => {
  const app = new Hono()

  app.get('/api/health', c =>
    c.json({ status: 'ok', service: 'gamma-compose' } satisfies HealthResponse),
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
