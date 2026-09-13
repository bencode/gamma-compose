import type { AgentTool } from '@earendil-works/pi-agent-core'
import { describe, expect, it, vi } from 'vitest'
import { createProjectRepository } from '../project/repository'
import { createProjectStore } from '../project/store'
import { createFileTools } from './file-tools'
import { createProjectEnv } from './project-env'

const setup = (
  files: Readonly<Record<string, string>> = {
    'src/main.tsx': 'const first = 1\nconst second = 2\n',
  },
) => {
  const project = createProjectStore({ entry: 'src/main.tsx', files })
  const repository = createProjectRepository(
    'test-project',
    project,
    { getStoredFileContent: async () => undefined, saveStoredFiles: async () => undefined },
    [],
  )
  const tools: AgentTool[] = createFileTools(repository)
  const call = (name: string, args: unknown, signal?: AbortSignal) => {
    const tool = tools.find(tool => tool.name === name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool.execute('test', args, signal)
  }
  return { project, repository, call }
}

describe('browser project tools', () => {
  it('lists paths, reads a range, applies native multi-edit once and creates a file', async () => {
    const { project, call } = setup()
    const changed = vi.fn()
    const unsubscribe = project.subscribe(changed)
    const original = project.getSnapshot()
    expect((await call('read', { path: 'src/main.tsx', limit: 1 })).content).toEqual([
      { type: 'text', text: expect.stringContaining('Use offset=2 to continue.') },
    ])
    await call('edit', {
      path: '/project/src/main.tsx',
      edits: [
        { oldText: 'first = 1', newText: 'first = 3' },
        { oldText: 'second = 2', newText: 'second = 4' },
      ],
    })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(original.files['src/main.tsx']).toContain('first = 1')
    expect(project.getSnapshot().files['src/main.tsx']).toBe('const first = 3\nconst second = 4\n')
    await call('write', {
      path: 'src/components/card.tsx',
      content: 'export const Card = () => null',
    })
    expect((await call('list', {})).content).toEqual([
      { type: 'text', text: 'src/components/card.tsx\nsrc/main.tsx' },
    ])
    expect((await call('list', { path: 'src/components' })).content).toEqual([
      { type: 'text', text: 'src/components/card.tsx' },
    ])
    unsubscribe()
  })

  it('preserves the original snapshot after missing, ambiguous or overlapping edits', async () => {
    const { project, call } = setup({ 'src/main.tsx': 'const first = 1\nconst firstCopy = 1\n' })
    const original = project.getSnapshot()
    const invalidEdits = [
      [
        { oldText: 'first = 1', newText: 'first = 2' },
        { oldText: 'missing', newText: 'found' },
      ],
      [{ oldText: 'const', newText: 'let' }],
      [
        { oldText: 'first = 1', newText: 'first = 2' },
        { oldText: 'const first = 1', newText: 'let first = 3' },
      ],
    ]
    for (const edits of invalidEdits) {
      await expect(call('edit', { path: 'src/main.tsx', edits })).rejects.toThrow()
      expect(project.getSnapshot()).toBe(original)
    }
  })

  it('copies files without overwriting unless the model explicitly requests it', async () => {
    const { project, call } = setup({
      'src/main.tsx': 'export {}',
      'src/source.ts': 'export const value = 1',
      'src/target.ts': 'export const value = 0',
    })
    await expect(
      call('copy', { source: 'src/source.ts', destination: 'src/target.ts' }),
    ).rejects.toThrow('already exists')
    await call('copy', {
      source: 'src/source.ts',
      destination: 'src/target.ts',
      overwrite: true,
    })
    expect(project.getSnapshot().files['src/target.ts']).toBe('export const value = 1')
    expect(project.getSnapshot().files['src/source.ts']).toBe('export const value = 1')
  })

  it('rejects escapes, missing paths and file-directory collisions without changing files', async () => {
    const { project, call } = setup()
    const original = project.getSnapshot()
    for (const path of [
      '../secret',
      '/etc/passwd',
      '/project/../secret',
      'src\\secret',
      'src',
      'src/main.tsx/child',
    ]) {
      await expect(call('write', { path, content: 'invalid' })).rejects.toThrow()
      expect(project.getSnapshot()).toBe(original)
    }
    await expect(call('read', { path: 'missing.ts' })).rejects.toThrow('not found')
    await expect(call('list', { path: 'missing' })).rejects.toThrow('not found')
    await expect(call('list', { path: 'src/main.tsx' })).rejects.toThrow('Not a directory')
  })

  it('enforces the compiler file and serialized UTF-8 byte limits before publishing', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 1_023 }, (_, index) => [`src/${index}.ts`, '']),
    )
    const { project, call } = setup({ ...files, 'src/main.tsx': 'export {}' })
    const original = project.getSnapshot()
    await expect(call('write', { path: 'extra.ts', content: '' })).rejects.toThrow('1024')
    await expect(
      call('write', { path: 'src/main.tsx', content: '界'.repeat(5_600_000) }),
    ).rejects.toThrow('16 MiB')
    expect(project.getSnapshot()).toBe(original)
    await expect(
      call('edit', {
        path: 'src/main.tsx',
        edits: [{ oldText: 'export {}', newText: '界'.repeat(5_600_000) }],
      }),
    ).rejects.toThrow('16 MiB')
    expect(project.getSnapshot()).toBe(original)
  })

  it('does not publish cancelled writes and rejects unsupported environment operations', async () => {
    const { project, call } = setup()
    const original = project.getSnapshot()
    const controller = new AbortController()
    controller.abort()
    await expect(
      call('write', { path: 'new.ts', content: '' }, controller.signal),
    ).rejects.toThrow()
    expect(project.getSnapshot()).toBe(original)
    const { repository } = setup(project.getSnapshot().files)
    const env = createProjectEnv(repository)
    expect(await env.exec('ls')).toMatchObject({ ok: false, error: { code: 'shell_unavailable' } })
    expect(await env.writeFile('image', new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: 'not_supported' },
    })
    expect(await env.remove('src/main.tsx')).toMatchObject({
      ok: false,
      error: { code: 'not_supported' },
    })
    await env.cleanup()
    expect(project.getSnapshot()).toBe(original)
  })

  it('keeps Pi truncation guidance without recommending a browser shell', async () => {
    const { call } = setup({ 'src/main.tsx': `${'x'.repeat(52_000)}\nexport {}` })
    const result = await call('read', { path: 'src/main.tsx' })
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('content was omitted') },
    ])
    expect(JSON.stringify(result.content)).not.toContain('Use bash')
  })

  it('exposes the built-in skill as a read-only virtual file without listing it as project source', async () => {
    const project = createProjectStore({
      entry: 'src/main.tsx',
      files: { 'src/main.tsx': 'export {}' },
    })
    const skillPath = '.gamma/skills/local-db/SKILL.md'
    const repository = createProjectRepository(
      'test-project',
      project,
      { getStoredFileContent: async () => undefined, saveStoredFiles: async () => undefined },
      [],
    )
    const env = createProjectEnv(repository, { [skillPath]: '# Local database' })
    const tools: AgentTool[] = createFileTools(repository, env)
    const call = (name: string, args: unknown) => {
      const tool = tools.find(tool => tool.name === name)
      if (!tool) throw new Error(`Unknown tool: ${name}`)
      return tool.execute('test', args)
    }
    expect((await call('read', { path: `/project/${skillPath}` })).content).toEqual([
      { type: 'text', text: expect.stringContaining('# Local database') },
    ])
    await expect(
      call('write', { path: `/project/${skillPath}`, content: 'replace' }),
    ).rejects.toThrow('Read-only')
    expect((await call('list', {})).content).toEqual([{ type: 'text', text: 'src/main.tsx' }])
    expect(project.getSnapshot().files).toEqual({ 'src/main.tsx': 'export {}' })
  })

  it('lists uploaded files with source and reads Markdown through the standard read tool', async () => {
    const project = createProjectStore({
      entry: 'src/main.tsx',
      files: { 'src/main.tsx': 'export {}' },
    })
    const markdown = new Blob(['# Product requirements'], { type: 'text/markdown' })
    const repository = createProjectRepository(
      'test-project',
      project,
      {
        getStoredFileContent: async id => (id === 'requirements' ? markdown : undefined),
        saveStoredFiles: async () => undefined,
      },
      [
        {
          id: 'requirements',
          projectId: 'test-project',
          path: 'attachments/requirements.md',
          mediaType: 'text/markdown',
          size: markdown.size,
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        },
      ],
    )
    const tools: AgentTool[] = createFileTools(repository)
    const call = (name: string, args: unknown) => {
      const tool = tools.find(item => item.name === name)
      if (!tool) throw new Error(`Unknown tool: ${name}`)
      return tool.execute('test', args)
    }

    expect((await call('list', {})).content).toEqual([
      { type: 'text', text: 'attachments/requirements.md\nsrc/main.tsx' },
    ])
    expect((await call('read', { path: 'attachments/requirements.md' })).content).toEqual([
      { type: 'text', text: '# Product requirements' },
    ])
  })
})
