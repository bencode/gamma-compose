import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { type AgentServerConfig, readAgentConfig } from './agent/config.js'
import { createAgentRoutes } from './agent/proxy.js'
import { createProjectCompiler } from './compiler/compile.js'
import {
  InvalidCompileInput,
  isProjectId,
  maxCompileBytes,
  readCompileInput,
} from './compiler/input.js'

type HealthResponse = {
  status: 'ok'
  service: 'gamma-compose'
}

const invalidProject = {
  ok: false,
  reason: 'invalid-input' as const,
  errors: [{ message: 'Invalid project ID' }],
}

export const createApp = (
  webRoot?: string,
  agentConfig: AgentServerConfig = readAgentConfig({}),
  dataRoot = '.gamma-data',
) => {
  const app = new Hono()
  const compiler = createProjectCompiler(dataRoot)
  app.route('/api/agent', createAgentRoutes(agentConfig))

  app.get('/api/health', c => c.json<HealthResponse>({ status: 'ok', service: 'gamma-compose' }))

  app.get('/api/compiler/projects/:projectId/tree', async c => {
    c.header('Cache-Control', 'no-store')
    const projectId = c.req.param('projectId')
    if (!isProjectId(projectId)) return c.json(invalidProject, 400)
    const tree = await compiler.getTree(projectId)
    return tree
      ? c.json({ ok: true as const, build: tree }, 200)
      : c.json(
          {
            ok: false as const,
            reason: 'not-found' as const,
            error: { message: 'No compiled tree exists for this project.' },
          },
          404,
        )
  })

  app.post(
    '/api/compiler/projects/:projectId/builds',
    bodyLimit({
      maxSize: maxCompileBytes,
      onError: c =>
        c.json(
          {
            ok: false as const,
            reason: 'invalid-input' as const,
            errors: [{ message: 'Compile requests cannot exceed 17 MiB' }],
          },
          413,
        ),
    }),
    async c => {
      const projectId = c.req.param('projectId')
      if (!isProjectId(projectId)) return c.json(invalidProject, 400)
      if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json'))
        return c.json(
          {
            ok: false as const,
            reason: 'invalid-input' as const,
            errors: [{ message: 'Use application/json for compilation requests' }],
          },
          415,
        )
      let value: unknown
      try {
        value = await c.req.json()
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        return c.json(
          {
            ok: false as const,
            reason: 'invalid-input' as const,
            errors: [{ message: 'The request is not valid JSON' }],
          },
          400,
        )
      }
      try {
        const result = await compiler.compile(projectId, readCompileInput(value))
        const status = result.ok
          ? 200
          : result.reason === 'stale-tree'
            ? 409
            : result.reason === 'compile'
              ? 422
              : 400
        return c.json(result, status)
      } catch (error) {
        if (error instanceof InvalidCompileInput)
          return c.json(
            {
              ok: false as const,
              reason: 'invalid-input' as const,
              errors: [{ message: error.message }],
            },
            400,
          )
        console.error('Compilation failed', error)
        return c.json(
          {
            ok: false as const,
            reason: 'compile' as const,
            errors: [{ message: 'The compilation service failed. Please retry.' }],
          },
          500,
        )
      }
    },
  )

  app.get('/__preview/projects/:projectId/builds/:buildId/modules/*', async (c, next) => {
    const { projectId, buildId } = c.req.param()
    if (!isProjectId(projectId) || !/^[a-f0-9]{64}$/.test(buildId)) return next()
    const prefix = `/__preview/projects/${projectId}/builds/${buildId}/modules/`
    const requestPath = c.req.path.slice(prefix.length)
    const outputPath = await compiler.resolveModule(projectId, buildId, requestPath)
    if (!outputPath) return next()
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Cross-Origin-Resource-Policy', 'cross-origin')
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    return c.redirect(`/__preview/projects/${projectId}/builds/${buildId}/${outputPath}`, 307)
  })

  app.use('/__preview/*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Cross-Origin-Resource-Policy', 'cross-origin')
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    await next()
  })
  app.use(
    '/__preview/*',
    serveStatic({
      root: compiler.publicRoot,
      rewriteRequestPath: path => path.slice('/__preview/'.length),
    }),
  )

  app.all('/api', c => c.json({ error: 'Not found' }, 404))
  app.all('/api/*', c => c.json({ error: 'Not found' }, 404))

  if (webRoot) {
    app.use('*', serveStatic({ root: webRoot }))
    app.get('*', (c, next) => {
      if (c.req.path.includes('.')) return next()
      return serveStatic({ root: webRoot, path: 'index.html' })(c, next)
    })
  }

  return app
}
