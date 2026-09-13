import { openLocalDb } from '@gamma-compose/local-db'
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

  it('upgrades version 1 without replacing projects and persists compile state', async () => {
    const project = {
      id: 'legacy-project',
      name: 'Legacy',
      updatedAt: 1,
      entry: 'main.ts',
      files: { 'main.ts': 'export {}' },
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('gamma-compose', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('templates', { keyPath: 'id' })
        request.result.createObjectStore('projects', { keyPath: 'id' }).add(project)
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })

    const database = await open()
    expect(await database.getProject(project.id)).toEqual(project)
    const state = {
      projectId: project.id,
      updatedAt: 2,
      build: {
        projectId: project.id,
        buildId: 'a'.repeat(64),
        compilerVersion: '1',
        entry: project.entry,
        files: {},
        previewUrl: '/__preview/projects/legacy/builds/a/index.html',
      },
    }
    await database.saveCompileState(state)
    expect(await database.getCompileState(project.id)).toEqual(state)
    expect(await database.listStoredFiles(project.id)).toEqual([])
  })

  it('stores, isolates and atomically deletes repository metadata and contents', async () => {
    const database = await open()
    const first = await database.createProject('blank')
    const second = await database.createProject('blank')
    const metadata = {
      id: 'reference-image',
      projectId: first.id,
      path: 'attachments/reference.png',
      mediaType: 'image/png',
      size: 5,
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
    }
    await database.saveStoredFiles([{ metadata, blob: new Blob(['image'], { type: 'image/png' }) }])

    expect(await database.listStoredFiles(first.id)).toEqual([metadata])
    expect(await database.listStoredFiles(second.id)).toEqual([])
    expect(await database.getStoredFileContent(metadata.id)).toBeDefined()

    await database.deleteStoredFile(metadata.id)
    expect(await database.listStoredFiles(first.id)).toEqual([])
    expect(await database.getStoredFileContent(metadata.id)).toBeUndefined()
  })

  it('stores copied metadata against shared content and deletes content only when requested', async () => {
    const database = await open()
    const project = await database.createProject('blank')
    const source = {
      id: 'source-file',
      contentId: 'shared-content',
      projectId: project.id,
      path: 'attachments/reference.png',
      mediaType: 'image/png',
      size: 5,
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    }
    const copy = {
      ...source,
      id: 'copied-file',
      path: 'src/assets/reference.png',
    }
    await database.saveStoredFiles([
      { metadata: source, blob: new Blob(['image'], { type: 'image/png' }) },
    ])
    await database.saveStoredFileMetadata(copy)

    expect(await database.getStoredFileContent('shared-content')).toBeDefined()
    await database.deleteStoredFile(source.id, null)
    expect(await database.listStoredFiles(project.id)).toEqual([copy])
    expect(await database.getStoredFileContent('shared-content')).toBeDefined()
    await database.deleteStoredFile(copy.id, 'shared-content')
    expect(await database.getStoredFileContent('shared-content')).toBeUndefined()
  })

  it('deletes a project with its compiled state, repository contents and application database', async () => {
    const database = await open()
    const first = await database.createProject('blank')
    const second = await database.createProject('blank')
    const compileState = (projectId: string) => ({
      projectId,
      updatedAt: 1,
      build: {
        projectId,
        buildId: projectId === first.id ? 'a'.repeat(64) : 'b'.repeat(64),
        compilerVersion: '5',
        entry: 'src/main.tsx',
        files: {},
        previewUrl: `/__preview/projects/${projectId}/builds/current/index.html`,
      },
    })
    await database.saveCompileState(compileState(first.id))
    await database.saveCompileState(compileState(second.id))
    const firstFile = {
      id: 'first-file',
      contentId: 'first-content',
      projectId: first.id,
      path: 'attachments/reference.png',
      mediaType: 'image/png',
      size: 5,
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    }
    const firstCopy = {
      ...firstFile,
      id: 'first-copy',
      path: 'src/assets/reference.png',
    }
    const secondFile = {
      ...firstFile,
      id: 'second-file',
      contentId: 'second-content',
      projectId: second.id,
    }
    await database.saveStoredFiles([
      { metadata: firstFile, blob: new Blob(['first']) },
      { metadata: secondFile, blob: new Blob(['second']) },
    ])
    await database.saveStoredFileMetadata(firstCopy)
    const resource = {
      protocolVersion: 1,
      name: 'items',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title'],
        properties: { id: { type: 'string' }, title: { type: 'string' } },
      },
    }
    const application = await openLocalDb({
      databaseName: `project:${first.id}`,
      resources: [resource],
    })
    await application.create('items', { title: 'Private project data' })

    await database.deleteProject(first.id)
    await database.deleteProject(first.id)

    expect(await database.getProject(first.id)).toBeUndefined()
    expect(await database.getCompileState(first.id)).toBeUndefined()
    expect(await database.listStoredFiles(first.id)).toEqual([])
    expect(await database.getStoredFileContent('first-content')).toBeUndefined()
    expect(await database.getProject(second.id)).toEqual(second)
    expect(await database.getCompileState(second.id)).toEqual(compileState(second.id))
    expect(await database.listStoredFiles(second.id)).toEqual([secondFile])
    expect(await database.getStoredFileContent('second-content')).toBeDefined()
    const reopened = await openLocalDb({
      databaseName: `project:${first.id}`,
      resources: [resource],
    })
    expect((await reopened.list('items')).total).toBe(0)
    reopened.close()
  })
})
