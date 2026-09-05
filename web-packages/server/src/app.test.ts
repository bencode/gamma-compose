import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('HTTP API', () => {
  const app = createApp()

  it('reports health without external services', async () => {
    const response = await app.request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', service: 'gamma-compose' })
  })

  it.each(['/api', '/api/missing'])('returns JSON 404 for %s', async path => {
    const response = await app.request(path, { headers: { accept: 'text/html' } })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })
})
