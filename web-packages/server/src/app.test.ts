import { describe, expect, it } from 'vitest'
import { readAgentConfig } from './agent/config.js'
import { createApp } from './app.js'

describe('HTTP API', () => {
  const app = createApp()

  it('disables unconfigured chat without disabling other APIs', async () => {
    const config = await app.request('/api/agent/config')
    expect(await config.json()).toEqual({ enabled: false })
    expect(config.headers.get('cache-control')).toBe('no-store')
    const response = await app.request('/api/agent/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(503)
  })

  it('exposes the configured model without exposing the secret', async () => {
    const configured = createApp(undefined, readAgentConfig({ GLM_API_KEY: 'server-secret' }))
    const response = await configured.request('/api/agent/config')
    expect(await response.json()).toEqual({
      enabled: true,
      provider: 'zai-coding-cn',
      modelId: 'glm-5.3',
    })
  })

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

  const requestCompile = (value: unknown) =>
    app.request('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })

  it('returns a JavaScript bundle for a valid file collection', async () => {
    const response = await requestCompile({
      entry: 'main.ts',
      files: { 'main.ts': 'export const answer = 42' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      js: expect.any(String),
      css: '',
      warnings: [],
    })
  })

  it.each([
    {},
    { entry: 'main.ts', files: { 'main.ts': 42 } },
    { entry: 'missing.ts', files: { 'main.ts': '' } },
    { entry: 'styles.css', files: { 'styles.css': 'body { margin: 0 }' } },
    { entry: '../main.ts', files: { '../main.ts': '' } },
    {
      entry: 'main.ts',
      files: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`file${index}.ts`, ''])),
    },
  ])('rejects invalid compilation input', async input => {
    const response = await requestCompile(input)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, errors: expect.any(Array) })
  })

  it('distinguishes malformed JSON, oversize requests and compilation failures', async () => {
    const malformed = await app.request('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    expect(malformed.status).toBe(400)
    const oversized = await requestCompile({
      entry: 'main.ts',
      files: { 'main.ts': 'x'.repeat(2 * 1024 * 1024) },
    })
    expect(oversized.status).toBe(413)
    const failed = await requestCompile({
      entry: 'main.ts',
      files: { 'main.ts': "import 'unknown-package'" },
    })
    expect(failed.status).toBe(422)
    expect(await failed.json()).toMatchObject({ ok: false, errors: expect.any(Array) })
  })
})
