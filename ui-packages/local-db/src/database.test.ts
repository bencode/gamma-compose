import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type JsonValue,
  type LocalDb,
  LocalDbError,
  openLocalDb,
  type ResourceDefinition,
} from './index.js'

const tasks: ResourceDefinition = {
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
      settings: {
        type: 'object',
        additionalProperties: false,
        properties: {
          color: { type: 'string' },
          size: { type: 'number' },
        },
      },
    },
  },
}
const connections: LocalDb[] = []
const open = async (resources = [tasks], databaseName = 'test') => {
  const db = await openLocalDb({ databaseName, resources })
  connections.push(db)
  return db
}
const rawOpen = (name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(`gamma-compose:local-db:${name}`)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => {
  connections.splice(0).forEach(db => {
    db.close()
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('local database', () => {
  it('persists CRUD results, replaces nested values and isolates databases and resources', async () => {
    const resources = [tasks, { ...tasks, name: 'notes' }]
    const db = await open(resources)
    const input = { title: 'Read', status: 'todo', settings: { color: 'red', size: 2 } }
    const writing = db.create('tasks', input)
    input.settings.color = 'blue'
    const record = await writing
    expect(record.settings).toEqual({ color: 'red', size: 2 })
    expect(record.id).toEqual(expect.any(String))
    expect(await db.get('tasks', record.id)).toEqual(record)
    const updated = await db.update('tasks', record.id, { settings: { size: 3 } })
    expect(updated).toEqual({ ...record, settings: { size: 3 } })
    expect(await db.get('notes', record.id)).toBeUndefined()
    expect((await (await open(resources, 'other')).list('tasks')).total).toBe(0)
    db.close()
    const reopened = await open(resources)
    expect(await reopened.get('tasks', record.id)).toEqual(updated)
    await reopened.remove('tasks', record.id)
    await reopened.remove('tasks', record.id)
    expect(await reopened.get('tasks', record.id)).toBeUndefined()
  })

  it('validates whole writes without coercion, stripping fields or changing stored data', async () => {
    const db = await open()
    const record = await db.create('tasks', { title: 'Read', status: 'todo' })
    await expect(db.update('tasks', record.id, { title: '' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: expect.arrayContaining([expect.objectContaining({ path: '/title' })]),
    })
    await expect(db.create('tasks', { title: 42, status: 'todo' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(db.update('tasks', record.id, { extra: true })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(
      db.create('tasks', { id: 'custom', title: 'Read', status: 'todo' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(db.update('tasks', record.id, { id: 'custom' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(await db.get('tasks', record.id)).toEqual(record)
    expect((await db.list('tasks')).total).toBe(1)
  })

  it('reads old records and requires repairs only on their next write', async () => {
    const db = await open()
    const old = await db.create('tasks', { title: 'Read', status: 'todo' })
    db.close()
    const next = {
      ...tasks,
      schema: {
        ...tasks.schema,
        required: ['id', 'title', 'status', 'category'],
        properties: { ...(tasks.schema.properties as object), category: { type: 'string' } },
      },
    }
    const reopened = await open([next])
    expect(await reopened.get('tasks', old.id)).toEqual(old)
    expect((await reopened.list('tasks')).data).toEqual([old])
    await expect(reopened.update('tasks', old.id, { title: 'Edited' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(await reopened.get('tasks', old.id)).toEqual(old)
    expect(await reopened.update('tasks', old.id, { category: 'Books' })).toEqual({
      ...old,
      category: 'Books',
    })
  })

  it('only drops obsolete top-level fields when a repaired record successfully commits', async () => {
    const db = await open()
    const old = await db.create('tasks', { title: 'Read', status: 'todo' })
    const untouched = await db.create('tasks', { title: 'Keep', status: 'done' })
    db.close()
    const next = {
      ...tasks,
      schema: {
        ...tasks.schema,
        required: ['id', 'title', 'state'],
        properties: Object.fromEntries([
          ...Object.entries(tasks.schema.properties as object).filter(
            ([field]) => field !== 'status',
          ),
          ['state', { type: 'string', enum: ['todo', 'done'] }],
        ]),
      },
    }
    const reopened = await open([next])
    expect(await reopened.get('tasks', old.id)).toEqual(old)
    expect((await reopened.list('tasks')).total).toBe(2)
    await expect(reopened.update('tasks', old.id, { title: 'Edited' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(
      reopened.update('tasks', old.id, { state: 'todo', status: 'done' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(await reopened.get('tasks', old.id)).toEqual(old)
    expect(await reopened.update('tasks', old.id, { state: 'todo' })).toEqual({
      id: old.id,
      title: 'Read',
      state: 'todo',
    })
    expect(await reopened.get('tasks', untouched.id)).toEqual(untouched)
    reopened.close()
    const restored = await open([next])
    expect(await restored.get('tasks', old.id)).toEqual({
      id: old.id,
      title: 'Read',
      state: 'todo',
    })
    expect(await restored.get('tasks', untouched.id)).toEqual(untouched)
  })

  it('preserves obsolete fields if the repaired write is aborted', async () => {
    const db = await open()
    const old = await db.create('tasks', { title: 'Read', status: 'todo' })
    db.close()
    const next = {
      ...tasks,
      schema: {
        ...tasks.schema,
        required: ['id', 'title'],
        properties: Object.fromEntries(
          Object.entries(tasks.schema.properties as object).filter(([field]) => field !== 'status'),
        ),
      },
    }
    const reopened = await open([next])
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
    await expect(reopened.update('tasks', old.id, { title: 'Edited' })).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    })
    expect(await reopened.get('tasks', old.id)).toEqual(old)
  })

  it('adds stores and indexes without removing omitted resources or records', async () => {
    const db = await open()
    const record = await db.create('tasks', { title: 'Read', status: 'todo' })
    db.close()
    const indexed = { ...tasks, indexes: [['status'], ['status', 'title']] }
    const upgraded = await open([indexed, { ...tasks, name: 'notes' }])
    expect((await upgraded.list('tasks', { filter: { status: 'todo' } })).data).toEqual([record])
    await upgraded.create('notes', { title: 'Keep', status: 'done' })
    upgraded.close()
    const omitted = await open([indexed])
    await expect(omitted.list('notes')).rejects.toMatchObject({ code: 'UNKNOWN_RESOURCE' })
    omitted.close()
    const restored = await open([tasks, { ...tasks, name: 'notes' }])
    expect((await restored.list('notes')).total).toBe(1)
    expect(await restored.get('tasks', record.id)).toEqual(record)
  })

  it('does not lose independent partial updates to the same record', async () => {
    const db = await open()
    const record = await db.create('tasks', { title: 'Read', status: 'todo' })
    await Promise.all([
      db.update('tasks', record.id, { title: 'Edited' }),
      db.update('tasks', record.id, { status: 'done' }),
    ])
    expect(await db.get('tasks', record.id)).toEqual({ ...record, title: 'Edited', status: 'done' })
  })

  it('reports aborted writes rather than returning uncommitted success', async () => {
    const db = await open()
    const add = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request = add.call(this, value, key)
      this.transaction.abort()
      return request
    })
    await expect(db.create('tasks', { title: 'Read', status: 'todo' })).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    })
    expect((await db.list('tasks')).total).toBe(0)
  })

  it('rejects blocked upgrades and never applies them later in the background', async () => {
    const db = await open()
    db.close()
    const blocking = await rawOpen('test')
    try {
      await expect(open([tasks, { ...tasks, name: 'notes' }])).rejects.toMatchObject({
        code: 'STORAGE_BLOCKED',
      })
    } finally {
      blocking.close()
    }
    const inspected = await rawOpen('test')
    expect(inspected.version).toBe(1)
    expect(inspected.objectStoreNames.contains('notes')).toBe(false)
    inspected.close()
  })

  it('closes outdated connections on a storage upgrade', async () => {
    const first = await open()
    const second = await open([tasks, { ...tasks, name: 'notes' }])
    await expect(first.list('tasks')).rejects.toMatchObject({ code: 'DATABASE_CLOSED' })
    expect((await second.list('notes')).total).toBe(0)
  })

  it('reports missing records, unknown resources and closed or unavailable storage', async () => {
    const db = await open()
    await expect(db.update('tasks', 'missing', { title: 'Read' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(db.list('constructor')).rejects.toMatchObject({ code: 'UNKNOWN_RESOURCE' })
    db.close()
    db.close()
    await expect(db.get('tasks', 'missing')).rejects.toMatchObject({ code: 'DATABASE_CLOSED' })
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('Disabled', 'SecurityError')
    })
    await expect(open()).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      cause: expect.any(DOMException),
    })
    vi.stubGlobal('indexedDB', undefined)
    await expect(open()).rejects.toBeInstanceOf(LocalDbError)
  })

  it.each([
    { ...tasks, protocolVersion: 2 },
    { ...tasks, schema: { ...tasks.schema, $ref: 'https://example.com/schema' } },
    { ...tasks, schema: { ...tasks.schema, default: {} } },
    { ...tasks, indexes: [['missing']] },
    {
      ...tasks,
      schema: {
        ...tasks.schema,
        properties: {
          ...(tasks.schema.properties as object),
          'project.name': { type: 'string' },
        },
      },
      indexes: [['project.name']],
    },
  ])('rejects invalid model definitions before opening storage', async definition => {
    const opening = vi.spyOn(indexedDB, 'open')
    await expect(open([definition])).rejects.toMatchObject({ code: 'INVALID_MODEL' })
    expect(opening).not.toHaveBeenCalled()
  })

  it('rejects non-JSON values and duplicate models without silently sanitizing them', async () => {
    await expect(open([tasks, tasks])).rejects.toMatchObject({ code: 'INVALID_MODEL' })
    const db = await open()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const values = [undefined, Number.NaN, new Date(), cyclic, new Array(2)]
    for (const value of values) {
      await expect(
        db.create('tasks', { title: 'Read', status: 'todo', settings: value } as Record<
          string,
          JsonValue
        >),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
    expect((await db.list('tasks')).total).toBe(0)
  })
})
