import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openProjectDatabase, type ProjectDatabase } from './database'

const connections: ProjectDatabase[] = []
const open = async () => {
  const database = await openProjectDatabase()
  connections.push(database)
  return database
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})
afterEach(() => {
  connections.splice(0).forEach(database => {
    database.close()
  })
  vi.restoreAllMocks()
})

describe('local projects', () => {
  it('seeds once and restores isolated project copies after reopening', async () => {
    const database = await open()
    const templates = await database.listTemplates()
    expect(templates.map(template => template.id)).toEqual([
      'blank',
      'team-workspace',
      'product-showcase',
    ])
    const first = await database.createProject('blank')
    const second = await database.createProject('blank')
    expect(first.id).not.toBe(second.id)
    const changed = {
      ...first,
      updatedAt: second.updatedAt + 1000,
      files: { ...first.files, 'src/app.tsx': 'export const App = () => <h1>Changed</h1>' },
    }
    await database.saveProject(changed)
    database.close()

    const reopened = await open()
    expect(await reopened.listTemplates()).toEqual(templates)
    expect(await reopened.getProject(first.id)).toEqual(changed)
    expect(await reopened.getProject(second.id)).toEqual(second)
    expect((await reopened.listProjects()).map(project => project.id)).toEqual([
      first.id,
      second.id,
    ])
    expect(await reopened.getProject('missing')).toBeUndefined()
    await expect(reopened.createProject('missing')).rejects.toThrow('Template not found')
  })

  it('commits consecutive snapshots in order and preserves saved data on transaction abort', async () => {
    const database = await open()
    const project = await database.createProject('blank')
    const change = (text: string) => ({
      ...project,
      files: { ...project.files, 'src/app.tsx': text },
    })
    await Promise.all([
      database.saveProject(change('first')),
      database.saveProject(change('latest')),
    ])
    expect((await database.getProject(project.id))?.files['src/app.tsx']).toBe('latest')
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request = put.call(this, value, key)
      this.transaction.abort()
      return request
    })
    await expect(database.saveProject(change('not committed'))).rejects.toThrow()
    expect((await database.getProject(project.id))?.files['src/app.tsx']).toBe('latest')
  })

  it('reports unavailable storage rather than silently creating a temporary project', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError')
    })
    await expect(openProjectDatabase()).rejects.toThrow('Storage disabled')
  })
})
