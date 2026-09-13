import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectCompileState } from '../project/records'
import { createProjectRepository } from '../project/repository'
import { createProjectStore } from '../project/store'
import { createCompileCoordinator } from './coordinator'

afterEach(() => vi.restoreAllMocks())

describe('compile coordinator', () => {
  const repository = () => {
    const project = createProjectStore({ entry: 'main.ts', files: { 'main.ts': '' } })
    return createProjectRepository(
      'test-project',
      project,
      { getStoredFileContent: async () => undefined, saveStoredFiles: async () => undefined },
      [],
    )
  }
  it('rebuilds every source after a server tree is erased and then reuses memory state', async () => {
    const saved = vi.fn(async (_state: ProjectCompileState) => undefined)
    const local = {
      projectId: 'project-1',
      updatedAt: 1,
      build: {
        projectId: 'project-1',
        buildId: 'a'.repeat(64),
        compilerVersion: '1',
        entry: 'main.ts',
        files: {},
        previewUrl: '/old',
      },
    }
    const requests: Record<string, unknown>[] = []
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method !== 'POST')
        return Response.json(
          { ok: false, reason: 'not-found', error: { message: 'Missing' } },
          { status: 404 },
        )
      const input = JSON.parse(String(init.body)) as {
        entry: string
        sourceTree: Record<string, { hash: string; bytes: number }>
      }
      requests.push(input)
      return Response.json({
        ok: true,
        build: {
          projectId: 'project-1',
          buildId: 'b'.repeat(64),
          compilerVersion: '1',
          entry: input.entry,
          files: Object.fromEntries(
            Object.entries(input.sourceTree).map(([path, descriptor]) => [
              path,
              {
                kind: path.endsWith('.css') ? 'style' : 'module',
                sourceHash: descriptor.hash,
                sourceBytes: descriptor.bytes,
                outputHash: 'c'.repeat(64),
                outputPath: `modules/${path}.js`,
              },
            ]),
          ),
          previewUrl: '/new',
        },
        warnings: [],
      })
    })
    const coordinator = createCompileCoordinator(
      'project-1',
      {
        load: async () => local,
        save: saved,
      },
      repository(),
    )
    const snapshot = {
      entry: 'main.ts',
      files: { 'main.ts': 'export {}', 'page.tsx': 'export const Page = () => <main />' },
    }
    const first = await coordinator.compile(snapshot, new AbortController().signal)
    const second = await coordinator.compile(snapshot, new AbortController().signal)
    expect(first.ok && first.build.previewUrl).toBe('/new')
    expect(second.ok && second.build.previewUrl).toBe('/new')
    expect(requests[0]).toMatchObject({ baseBuildId: null, changes: snapshot.files })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(saved).toHaveBeenCalledOnce()
  })

  it('uploads every module for path changes and only changed files otherwise', async () => {
    const requests: Array<{
      entry: string
      sourceTree: Record<string, { hash: string; bytes: number }>
      changes: Record<string, string>
    }> = []
    const buildIds = ['b', 'c', 'd'].map(value => value.repeat(64))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method !== 'POST')
        return Response.json(
          { ok: false, reason: 'not-found', error: { message: 'Missing' } },
          { status: 404 },
        )
      const input = JSON.parse(String(init.body)) as (typeof requests)[number]
      requests.push(input)
      return Response.json({
        ok: true,
        build: {
          projectId: 'project-2',
          buildId: buildIds[requests.length - 1],
          compilerVersion: '1',
          entry: input.entry,
          files: Object.fromEntries(
            Object.entries(input.sourceTree).map(([path, descriptor]) => [
              path,
              {
                kind: path.endsWith('.css') ? 'style' : 'module',
                sourceHash: descriptor.hash,
                sourceBytes: descriptor.bytes,
                outputHash: 'e'.repeat(64),
                outputPath: path.endsWith('.css') ? `styles/${path}` : `modules/${path}.js`,
              },
            ]),
          ),
          previewUrl: `/build-${requests.length}`,
        },
        warnings: [],
      })
    })
    const coordinator = createCompileCoordinator(
      'project-2',
      {
        load: async () => undefined,
        save: async () => undefined,
      },
      repository(),
    )
    const firstFiles = {
      'main.ts': "import './foo'",
      'foo.ts': 'export const value = 1',
      'styles.css': 'body { color: red; }',
    }
    await coordinator.compile({ entry: 'main.ts', files: firstFiles }, new AbortController().signal)
    const addedFiles = {
      ...firstFiles,
      'foo.tsx': 'export const value = 2',
      'new.css': 'body { color: blue; }',
    }
    await coordinator.compile({ entry: 'main.ts', files: addedFiles }, new AbortController().signal)
    await coordinator.compile(
      {
        entry: 'main.ts',
        files: { ...addedFiles, 'foo.tsx': 'export const value = 3' },
      },
      new AbortController().signal,
    )

    expect(requests[1]?.changes).toEqual({
      'main.ts': addedFiles['main.ts'],
      'foo.ts': addedFiles['foo.ts'],
      'foo.tsx': addedFiles['foo.tsx'],
      'new.css': addedFiles['new.css'],
    })
    expect(requests[2]?.changes).toEqual({ 'foo.tsx': 'export const value = 3' })
  })

  it('describes local images without putting their bytes in the compile request', async () => {
    const image = new Blob(['private-image-bytes'], { type: 'image/png' })
    const project = createProjectStore({
      entry: 'src/main.tsx',
      files: {
        'src/main.tsx': "import heroUrl from './assets/hero.png'; console.log(heroUrl)",
      },
    })
    const localRepository = createProjectRepository(
      'asset-project',
      project,
      { getStoredFileContent: async () => image, saveStoredFiles: async () => undefined },
      [
        {
          id: 'hero',
          projectId: 'asset-project',
          path: 'src/assets/hero.png',
          mediaType: 'image/png',
          size: image.size,
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        },
        {
          id: 'reference',
          projectId: 'asset-project',
          path: 'attachments/reference.png',
          mediaType: 'image/png',
          size: image.size,
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        },
      ],
    )
    let requestBody = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method !== 'POST')
        return Response.json(
          { ok: false, reason: 'not-found', error: { message: 'Missing' } },
          { status: 404 },
        )
      requestBody = String(init.body)
      const input = JSON.parse(requestBody) as {
        entry: string
        sourceTree: Record<string, { hash: string; bytes: number }>
      }
      return Response.json({
        ok: true,
        build: {
          projectId: 'asset-project',
          buildId: 'f'.repeat(64),
          compilerVersion: '5',
          entry: input.entry,
          files: Object.fromEntries(
            Object.entries(input.sourceTree).map(([path, descriptor]) => [
              path,
              {
                kind: path.endsWith('.png') ? 'asset' : 'module',
                sourceHash: descriptor.hash,
                sourceBytes: descriptor.bytes,
                outputHash: 'e'.repeat(64),
                outputPath: `modules/${path}.js`,
              },
            ]),
          ),
          previewUrl: '/asset-build',
        },
        warnings: [],
      })
    })
    const coordinator = createCompileCoordinator(
      'asset-project',
      { load: async () => undefined, save: async () => undefined },
      localRepository,
    )

    await coordinator.compile(project.getSnapshot(), new AbortController().signal)
    const request = JSON.parse(requestBody) as {
      sourceTree: Record<string, unknown>
      changes: Record<string, string>
    }
    expect(request.sourceTree).toHaveProperty('src/assets/hero.png')
    expect(request.sourceTree).not.toHaveProperty('attachments/reference.png')
    expect(request.changes).not.toHaveProperty('src/assets/hero.png')
    expect(requestBody).not.toContain('private-image-bytes')
  })
})
