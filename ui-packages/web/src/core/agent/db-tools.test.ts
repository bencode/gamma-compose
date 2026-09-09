import type { AgentTool } from '@earendil-works/pi-agent-core'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectStore } from '../project/store'
import { createDbTools } from './db-tools'

const model = JSON.stringify({
  protocolVersion: 1,
  name: 'tasks',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'title', 'status'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: ['todo', 'done'] },
      notes: { type: 'string' },
    },
  },
  indexes: [['status']],
})

const setup = (projectId: string) => {
  const project = createProjectStore({
    entry: 'src/main.tsx',
    files: { 'src/main.tsx': 'export {}', 'data/tasks.resource.json': model },
  })
  const tools: AgentTool[] = createDbTools(projectId, project)
  const call = (name: string, args: unknown) => {
    const tool = tools.find(tool => tool.name === name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool.execute('test', args)
  }
  return { project, call }
}

const text = (result: Awaited<ReturnType<AgentTool['execute']>>) => {
  const content = result.content[0]
  if (content?.type !== 'text') throw new Error('Expected a text tool result.')
  return content.text
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Agent database tools', () => {
  it('validates and composes CRUD operations while isolating project databases', async () => {
    const first = setup('first-project')
    const second = setup('second-project')
    const created = JSON.parse(
      text(
        await first.call('db_create', {
          resource: 'tasks',
          data: { title: 'Read', status: 'todo' },
        }),
      ),
    ) as { id: string }
    expect(
      JSON.parse(text(await first.call('db_get', { resource: 'tasks', id: created.id }))),
    ).toMatchObject({
      id: created.id,
      title: 'Read',
    })
    expect(
      JSON.parse(
        text(
          await first.call('db_list', {
            resource: 'tasks',
            query: { filter: { status: 'todo' }, limit: 10, offset: 0 },
          }),
        ),
      ),
    ).toMatchObject({ total: 1, data: [{ id: created.id, title: 'Read' }] })
    expect(
      JSON.parse(
        text(
          await first.call('db_update', {
            resource: 'tasks',
            id: created.id,
            changes: { status: 'done' },
          }),
        ),
      ),
    ).toMatchObject({ id: created.id, status: 'done' })
    expect(
      JSON.parse(text(await second.call('db_get', { resource: 'tasks', id: created.id }))),
    ).toBeNull()
    await expect(
      first.call('db_create', { resource: 'tasks', data: { title: '', status: 'todo' } }),
    ).rejects.toThrow('VALIDATION_FAILED')
    await first.call('db_remove', { resource: 'tasks', id: created.id })
    expect(
      JSON.parse(text(await first.call('db_get', { resource: 'tasks', id: created.id }))),
    ).toBeNull()
  })

  it('bounds model-visible reads without hiding committed writes', async () => {
    const { call } = setup('large-result-project')
    const result = JSON.parse(
      text(
        await call('db_create', {
          resource: 'tasks',
          data: { title: 'Large', status: 'todo', notes: 'x'.repeat(60 * 1024) },
        }),
      ),
    ) as { committed: boolean; id: string }
    expect(result).toMatchObject({ committed: true, id: expect.any(String) })
    await expect(call('db_get', { resource: 'tasks', id: result.id })).rejects.toThrow('50 KiB')
  })
})
