import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { readAgentConfig } from './agent/config.js'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3301)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const webRoot =
  process.env.NODE_ENV === 'production'
    ? fileURLToPath(new URL('../../../ui-packages/web/dist/', import.meta.url))
    : undefined

if (webRoot) await access(`${webRoot}/index.html`)

const hostname = process.env.HOST ?? '127.0.0.1'
serve({ fetch: createApp(webRoot, readAgentConfig(process.env)).fetch, port, hostname }, info => {
  console.info(`Gamma Compose: http://${hostname}:${info.port}`)
})
