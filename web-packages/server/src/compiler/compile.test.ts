import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProjectCompiler } from './compile.js'
import type { CompileBuildInput } from './contract.js'
import { runtimeVersion } from './runtime.js'

let dataRoot = ''
let compiler: ReturnType<typeof createProjectCompiler>
const runNode = promisify(execFile)

beforeAll(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'gamma-compose-compiler-'))
  compiler = createProjectCompiler(dataRoot)
})

afterAll(async () => {
  await rm(dataRoot, { recursive: true, force: true })
})

const descriptor = (contents: string) => ({
  hash: createHash('sha256').update(contents).digest('hex'),
  bytes: Buffer.byteLength(contents),
})

const request = (
  files: Record<string, string>,
  baseBuildId: string | null = null,
  changes: Record<string, string> = files,
): CompileBuildInput => ({
  baseBuildId,
  entry: Object.hasOwn(files, 'src/main.tsx') ? 'src/main.tsx' : 'main.ts',
  sourceTree: Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [path, descriptor(contents)]),
  ),
  changes,
})

const artifactPath = (projectId: string, buildId: string, path: string) =>
  join(dataRoot, 'public', 'projects', projectId, 'builds', buildId, path)

describe('project compilation', () => {
  it('publishes all sources as separate ESM files with shared runtime and project styles', async () => {
    const projectId = 'module-project'
    const files = {
      'src/main.tsx': `import React from 'react'
import { createRoot } from 'react-dom/client'
import { openLocalDb } from '@gamma-compose/local-db'
import '@gamma-compose/ui/styles.css'
import './styles.css'
const Settings = React.lazy(() => import('./pages/settings'))
console.log(openLocalDb, Settings)
createRoot(document.getElementById('root')!).render(<main className="p-8">Ready</main>)`,
      'src/pages/settings.tsx': 'export const Settings = () => <p>Settings</p>',
      'src/unused.ts': 'export const unused = true',
      'src/styles.css': '@import "tailwindcss"; .project-heading { letter-spacing: .0123em; }',
    }
    const result = await compiler.compile(projectId, request(files))
    if (!result.ok) throw new Error(result.errors.map(error => error.message).join('\n'))
    const root = (path: string) => artifactPath(projectId, result.build.buildId, path)
    const main = await readFile(root('modules/src/main.tsx.js'), 'utf8')
    const css = await readFile(root('styles.css'), 'utf8')
    const document = await readFile(root('index.html'), 'utf8')
    expect(main).toContain('import("./pages/settings")')
    expect(main).toContain('from "react-dom/client"')
    expect(await readFile(root('modules/src/unused.ts.js'), 'utf8')).toContain('unused')
    expect(css).toContain('.p-8')
    expect(css).toContain('.project-heading')
    expect(document).toContain('<script type="importmap">')
    expect(document).toContain(`/__preview/runtime/${runtimeVersion}/`)
    const runtimeManifest = JSON.parse(
      await readFile(join(dataRoot, 'public', 'runtime', runtimeVersion, 'manifest.json'), 'utf8'),
    ) as { imports: Record<string, string> }
    const runtimePath = join(
      dataRoot,
      'public',
      runtimeManifest.imports['react/jsx-runtime']?.replace('/__preview/', '') ?? '',
    )
    const jsxRuntime = await import(pathToFileURL(runtimePath).href)
    expect(typeof jsxRuntime.jsx).toBe('function')
    const uiRuntimePath = join(
      dataRoot,
      'public',
      runtimeManifest.imports['@gamma-compose/ui']?.replace('/__preview/', '') ?? '',
    )
    await expect(
      runNode(process.execPath, [
        '--input-type=module',
        '--eval',
        `const runtime = await import(${JSON.stringify(pathToFileURL(uiRuntimePath).href)}); runtime.Table({ children: 'Ready' })`,
      ]),
    ).resolves.toBeDefined()
    expect(result.build.previewUrl).toContain(`/projects/${projectId}/builds/`)
  }, 20_000)

  it('hard-links unchanged modules in a project with more than 100 files', async () => {
    const projectId = 'incremental-project'
    const firstFiles = {
      'main.ts': `export { answer } from './answer'`,
      'answer.ts': 'export const answer = 1',
      ...Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `unused/${index}.ts`,
          `export const value${index} = ${index}`,
        ]),
      ),
    }
    const first = await compiler.compile(projectId, request(firstFiles))
    if (!first.ok) throw new Error('Initial compilation failed')
    const nextFiles = { ...firstFiles, 'answer.ts': 'export const answer = 2' }
    const restarted = createProjectCompiler(dataRoot)
    const second = await restarted.compile(
      projectId,
      request(nextFiles, first.build.buildId, { 'answer.ts': nextFiles['answer.ts'] }),
    )
    if (!second.ok) throw new Error('Incremental compilation failed')
    const firstMain = await stat(artifactPath(projectId, first.build.buildId, 'modules/main.ts.js'))
    const secondMain = await stat(
      artifactPath(projectId, second.build.buildId, 'modules/main.ts.js'),
    )
    const firstAnswer = await stat(
      artifactPath(projectId, first.build.buildId, 'modules/answer.ts.js'),
    )
    const secondAnswer = await stat(
      artifactPath(projectId, second.build.buildId, 'modules/answer.ts.js'),
    )
    expect(second.build.buildId).not.toBe(first.build.buildId)
    expect(secondMain.ino).toBe(firstMain.ino)
    expect(secondAnswer.ino).not.toBe(firstAnswer.ino)
    expect(
      await readFile(artifactPath(projectId, first.build.buildId, 'modules/answer.ts.js'), 'utf8'),
    ).toContain('answer = 1')
  })

  it('accepts a CSS-only delta and reuses module artifacts', async () => {
    const projectId = 'style-delta'
    const firstFiles = {
      'main.ts': "import './styles.css'; document.body.className = 'text-red-500'",
      'styles.css': '@import "tailwindcss"; body { color: red; }',
    }
    const first = await compiler.compile(projectId, request(firstFiles))
    if (!first.ok) throw new Error('Initial compilation failed')
    const nextFiles = {
      ...firstFiles,
      'styles.css': '@import "tailwindcss"; body { color: blue; }',
    }
    const second = await compiler.compile(
      projectId,
      request(nextFiles, first.build.buildId, { 'styles.css': nextFiles['styles.css'] }),
    )
    if (!second.ok) throw new Error('CSS compilation failed')
    const firstModule = await stat(
      artifactPath(projectId, first.build.buildId, 'modules/main.ts.js'),
    )
    const secondModule = await stat(
      artifactPath(projectId, second.build.buildId, 'modules/main.ts.js'),
    )
    expect(secondModule.ino).toBe(firstModule.ino)
    expect(
      await readFile(artifactPath(projectId, second.build.buildId, 'styles.css'), 'utf8'),
    ).toContain('blue')
  })

  it('publishes image imports as local bridge modules and hard-links unchanged wrappers', async () => {
    const projectId = 'asset-incremental'
    const image = new TextEncoder().encode('first-image')
    const files = {
      'src/main.tsx': "import heroUrl from './assets/hero.png'; console.log(heroUrl)",
    }
    const firstRequest = request(files)
    firstRequest.sourceTree['src/assets/hero.png'] = {
      hash: createHash('sha256').update(image).digest('hex'),
      bytes: image.byteLength,
    }
    const first = await compiler.compile(projectId, firstRequest)
    if (!first.ok) throw new Error('Asset compilation failed')
    const asset = first.build.files['src/assets/hero.png']
    expect(asset).toMatchObject({ kind: 'asset' })
    if (asset?.kind !== 'asset') throw new Error('Compiled asset is missing')
    const wrapper = await readFile(
      artifactPath(projectId, first.build.buildId, asset.outputPath),
      'utf8',
    )
    expect(wrapper).toContain('__GAMMA_COMPOSE_ASSET_URL__')
    expect(wrapper).toContain('src/assets/hero.png')
    expect(wrapper).not.toContain('first-image')
    expect(
      await compiler.resolveModule(projectId, first.build.buildId, 'src/assets/hero.png'),
    ).toBe(asset.outputPath)

    const updatedFiles = { ...files, 'src/main.tsx': `${files['src/main.tsx']}\nexport {}` }
    const secondRequest = request(updatedFiles, first.build.buildId, {
      'src/main.tsx': updatedFiles['src/main.tsx'],
    })
    secondRequest.sourceTree['src/assets/hero.png'] = firstRequest.sourceTree['src/assets/hero.png']
    const second = await compiler.compile(projectId, secondRequest)
    if (!second.ok) throw new Error('Incremental asset compilation failed')
    const firstWrapper = await stat(artifactPath(projectId, first.build.buildId, asset.outputPath))
    const secondWrapper = await stat(
      artifactPath(projectId, second.build.buildId, asset.outputPath),
    )
    expect(secondWrapper.ino).toBe(firstWrapper.ino)
  })

  it('recompiles module metadata when source paths change import resolution', async () => {
    const projectId = 'structural-delta'
    const firstFiles = {
      'main.ts': "import './foo'",
      'foo.ts': "import './old.css'",
      'old.css': '.old { color: red; }',
    }
    const first = await compiler.compile(projectId, request(firstFiles))
    if (!first.ok) throw new Error('Initial compilation failed')

    const addedFiles = {
      ...firstFiles,
      'foo.tsx': "import './new.css'; export const Foo = () => null",
      'new.css': '.new { color: blue; }',
    }
    const added = await compiler.compile(
      projectId,
      request(addedFiles, first.build.buildId, {
        'main.ts': addedFiles['main.ts'],
        'foo.ts': addedFiles['foo.ts'],
        'foo.tsx': addedFiles['foo.tsx'],
        'new.css': addedFiles['new.css'],
      }),
    )
    if (!added.ok) throw new Error('Structural addition compilation failed')
    expect(await compiler.resolveModule(projectId, added.build.buildId, 'foo')).toBe(
      'modules/foo.tsx.js',
    )
    const addedStyles = await readFile(
      artifactPath(projectId, added.build.buildId, 'styles.css'),
      'utf8',
    )
    expect(addedStyles).toContain('.new')
    expect(addedStyles).not.toContain('.old')

    const removed = await compiler.compile(
      projectId,
      request(firstFiles, added.build.buildId, {
        'main.ts': firstFiles['main.ts'],
        'foo.ts': firstFiles['foo.ts'],
      }),
    )
    if (!removed.ok) throw new Error('Structural deletion compilation failed')
    expect(removed.build.buildId).toBe(first.build.buildId)
    expect(await compiler.resolveModule(projectId, removed.build.buildId, 'foo')).toBe(
      'modules/foo.ts.js',
    )
    const removedStyles = await readFile(
      artifactPath(projectId, removed.build.buildId, 'styles.css'),
      'utf8',
    )
    expect(removedStyles).toContain('.old')
    expect(removedStyles).not.toContain('.new')
  })

  it('keeps the last successful build and rejects stale baselines', async () => {
    const projectId = 'repair-project'
    const files = { 'main.ts': 'export const value = 1' }
    const first = await compiler.compile(projectId, request(files))
    if (!first.ok) throw new Error('Initial compilation failed')
    const broken = { 'main.ts': 'const broken =' }
    const failed = await compiler.compile(projectId, request(broken, first.build.buildId, broken))
    expect(failed).toMatchObject({ ok: false, reason: 'compile' })
    expect((await compiler.getTree(projectId))?.buildId).toBe(first.build.buildId)
    const stale = await compiler.compile(projectId, request(files, null, {}))
    expect(stale).toMatchObject({ ok: false, reason: 'stale-tree' })
  })

  it('requires contents for every changed hash and verifies uploaded descriptors', async () => {
    const files = { 'main.ts': 'export const value = 1' }
    const missing = await compiler.compile('missing-content', request(files, null, {}))
    expect(missing).toMatchObject({ ok: false, reason: 'invalid-input' })
    const mismatched = request(files)
    mismatched.sourceTree['main.ts'] = descriptor('different')
    const invalid = await compiler.compile('bad-hash', mismatched)
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid-input' })
  })

  it('fully rebuilds from client source after derived storage is deleted', async () => {
    const isolatedRoot = await mkdtemp(join(tmpdir(), 'gamma-compose-recovery-'))
    try {
      const files = { 'main.ts': 'export const recovered = true' }
      const firstCompiler = createProjectCompiler(isolatedRoot)
      const first = await firstCompiler.compile('recoverable', request(files))
      if (!first.ok) throw new Error('Initial compilation failed')
      await rm(join(isolatedRoot, 'public'), { recursive: true, force: true })
      const restarted = createProjectCompiler(isolatedRoot)
      expect(await restarted.getTree('recoverable')).toBeUndefined()
      const rebuilt = await restarted.compile('recoverable', request(files))
      expect(rebuilt).toMatchObject({ ok: true })
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true })
    }
  }, 20_000)

  it.each([
    ["import './missing'", 'File not found'],
    ["import '../../private.ts'", 'escape the project'],
    ["import '/etc/passwd'", 'not allowed'],
    ["import 'node:fs'", 'not allowed'],
    ["import 'ramda'", 'not allowed'],
    ["const name = './page'; import(name)", 'string literal'],
  ])('rejects unavailable or unsafe imports: %s', async (source, message) => {
    const result = await compiler.compile(
      `invalid-${Math.random().toString(36).slice(2)}`,
      request({ 'main.ts': source }),
    )
    expect(result).toMatchObject({
      ok: false,
      reason: 'compile',
      errors: [
        expect.objectContaining({ message: expect.stringContaining(message), path: 'main.ts' }),
      ],
    })
  })

  it.each([
    ['@plugin "./plugin.js";', 'plugins'],
    ['@config "./config.js";', 'configuration'],
    ['@source "/private/**";', '@source'],
    ['@import "/etc/passwd";', 'not allowed'],
    ['@import "https://example.com/styles.css";', 'not allowed'],
  ])('rejects external stylesheet capabilities: %s', async (css, message) => {
    const files = { 'main.ts': "import './styles.css'", 'styles.css': css }
    const result = await compiler.compile(
      `style-${Math.random().toString(36).slice(2)}`,
      request(files),
    )
    expect(result).toMatchObject({
      ok: false,
      reason: 'compile',
      errors: [expect.objectContaining({ message: expect.stringContaining(message) })],
    })
  })
})
