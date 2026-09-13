import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readAgentConfig } from './agent/config.js'
import { createApp } from './app.js'

let dataRoot = ''
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'gamma-compose-app-'))
  app = createApp(undefined, undefined, dataRoot)
})

afterAll(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

const compileInput = (files: Record<string, string>, baseBuildId: string | null = null) => ({
  baseBuildId,
  entry: 'main.ts',
  sourceTree: Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [
      path,
      {
        hash: createHash('sha256').update(contents).digest('hex'),
        bytes: Buffer.byteLength(contents),
      },
    ]),
  ),
  changes: files,
})

describe('HTTP API', () => {
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
    const configured = createApp(
      undefined,
      readAgentConfig({ GLM_API_KEY: 'server-secret' }),
      dataRoot,
    )
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

  const requestCompile = (projectId: string, value: unknown) =>
    app.request(`/api/compiler/projects/${projectId}/builds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })

  it('publishes and queries a compiled tree through static preview routes', async () => {
    const response = await requestCompile(
      'api-project',
      compileInput({
        'main.ts':
          "export { value } from './value'; import data from './data.json'; import './pages'; console.log(data)",
        'value.ts': 'export const value = 42',
        'data.json': '{"ready":true}',
        'pages/index.ts': 'export const page = true',
      }),
    )
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({ ok: true, build: { projectId: 'api-project' }, warnings: [] })
    const tree = await app.request('/api/compiler/projects/api-project/tree')
    expect(tree.status).toBe(200)
    expect(await tree.json()).toEqual({ ok: true, build: result.build })
    const preview = await app.request(result.build.previewUrl)
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toContain('text/html')
    expect(preview.headers.get('access-control-allow-origin')).toBe('*')
    const moduleRequest = result.build.previewUrl.replace('index.html', 'modules/value')
    const module = await app.request(moduleRequest)
    expect(module.status).toBe(307)
    expect(module.headers.get('location')).toContain('/modules/value.ts.js')
    const json = await app.request(
      result.build.previewUrl.replace('index.html', 'modules/data.json'),
    )
    expect(json.headers.get('location')).toContain('/modules/data.json.js')
    const index = await app.request(result.build.previewUrl.replace('index.html', 'modules/pages'))
    expect(index.headers.get('location')).toContain('/modules/pages/index.ts.js')
    const canonical = await app.request(index.headers.get('location') ?? '')
    expect(canonical.status).toBe(200)
    expect(canonical.headers.get('content-type')).toContain('javascript')
  }, 20_000)

  it('publishes imported images as local asset bridge modules without receiving image bytes', async () => {
    const asset = new TextEncoder().encode('image-bytes')
    const input = compileInput({
      'main.ts': "import imageUrl from './src/assets/pixel.png'; console.log(imageUrl)",
    })
    input.sourceTree['src/assets/pixel.png'] = {
      hash: createHash('sha256').update(asset).digest('hex'),
      bytes: asset.byteLength,
    }
    const response = await requestCompile('asset-project', input)
    expect(response.status).toBe(200)
    const result = await response.json()
    const file = result.build.files['src/assets/pixel.png']
    expect(file).toMatchObject({ kind: 'asset' })

    const module = await app.request(
      result.build.previewUrl.replace('index.html', 'modules/src/assets/pixel.png'),
    )
    expect(module.status).toBe(307)
    expect(module.headers.get('location')).toContain(file.outputPath)
    const wrapper = await app.request(module.headers.get('location') ?? '')
    expect(await wrapper.text()).toContain('__GAMMA_COMPOSE_ASSET_URL__')
  })

  it('returns 404 for an absent tree and 409 for a stale build baseline', async () => {
    const tree = await app.request('/api/compiler/projects/unknown-api-project/tree')
    expect(tree.status).toBe(404)
    const response = await requestCompile(
      'api-project',
      compileInput({ 'main.ts': 'export const answer = 1' }, null),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, reason: 'stale-tree' })
  })

  it.each([
    {},
    { baseBuildId: null, entry: 'main.ts', sourceTree: {}, changes: {} },
    {
      baseBuildId: null,
      entry: 'main.ts',
      sourceTree: { 'main.ts': { hash: 'invalid', bytes: 1 } },
      changes: { 'main.ts': 'x' },
    },
    { ...compileInput({ 'main.ts': '' }), baseBuildId: 'invalid' },
  ])('rejects invalid compilation input', async input => {
    const response = await requestCompile(`bad-${Math.random().toString(36).slice(2)}`, input)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, reason: 'invalid-input' })
  })

  it('distinguishes malformed JSON, oversize requests and compilation failures', async () => {
    const malformed = await app.request('/api/compiler/projects/malformed/builds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    expect(malformed.status).toBe(400)
    const oversizedSource = 'x'.repeat(17 * 1024 * 1024)
    const oversized = await requestCompile(
      'oversized',
      compileInput({ 'main.ts': oversizedSource }),
    )
    expect(oversized.status).toBe(413)
    const failed = await requestCompile(
      'failed',
      compileInput({ 'main.ts': "import 'unknown-package'" }),
    )
    expect(failed.status).toBe(422)
    expect(await failed.json()).toMatchObject({ ok: false, reason: 'compile' })
  })
})
