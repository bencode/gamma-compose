import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_DB_PORT_KEY } from './bridge-contract.js'
import { createLocalDbBridgeHost } from './bridge-host.js'
import { openLocalDb as openNativeLocalDb } from './database.js'
import { openLocalDb as openPreviewLocalDb } from './preview.js'
import type { LocalDb, ResourceDefinition } from './types.js'

const tasks: ResourceDefinition = {
  protocolVersion: 1,
  name: 'tasks',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'title'],
    properties: { id: { type: 'string' }, title: { type: 'string', minLength: 1 } },
  },
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => {
  Reflect.deleteProperty(globalThis, LOCAL_DB_PORT_KEY)
  vi.unstubAllGlobals()
})

describe('preview database bridge', () => {
  it('proxies CRUD and reconstructs validation errors', async () => {
    const channel = new MessageChannel()
    const host = createLocalDbBridgeHost({
      port: channel.port1,
      open: options =>
        openNativeLocalDb({ ...options, databaseName: `preview:${options.databaseName}` }),
    })
    Reflect.set(globalThis, LOCAL_DB_PORT_KEY, channel.port2)
    const db = await openPreviewLocalDb({ databaseName: 'app', resources: [tasks] })
    const created = await db.create('tasks', { title: 'Read' })
    expect(await db.get('tasks', created.id)).toEqual(created)
    expect((await db.list('tasks')).data).toEqual([created])
    await expect(db.update('tasks', created.id, { title: '' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: expect.any(Array),
    })
    expect(await db.update('tasks', created.id, { title: 'Write' })).toMatchObject({
      title: 'Write',
    })
    await db.remove('tasks', created.id)
    expect(await db.get('tasks', created.id)).toBeUndefined()
    db.close()
    await expect(db.list('tasks')).rejects.toMatchObject({ code: 'DATABASE_CLOSED' })
    host.close()
  })

  it('closes hosted handles when the iframe bridge is disposed', async () => {
    const channel = new MessageChannel()
    let hosted: Awaited<ReturnType<typeof openNativeLocalDb>> | undefined
    const host = createLocalDbBridgeHost({
      port: channel.port1,
      open: async options => {
        hosted = await openNativeLocalDb(options)
        return hosted
      },
    })
    Reflect.set(globalThis, LOCAL_DB_PORT_KEY, channel.port2)
    await openPreviewLocalDb({ databaseName: 'closed', resources: [tasks] })
    host.close()
    await expect(hosted?.list('tasks')).rejects.toMatchObject({ code: 'DATABASE_CLOSED' })
  })

  it('closes a database that finishes opening after its bridge is disposed', async () => {
    const channel = new MessageChannel()
    let finishOpen: ((db: LocalDb) => void) | undefined
    const close = vi.fn()
    const hosted: LocalDb = {
      close,
      create: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    }
    const open = vi.fn(
      () =>
        new Promise<LocalDb>(resolve => {
          finishOpen = resolve
        }),
    )
    const host = createLocalDbBridgeHost({ port: channel.port1, open })
    channel.port2.postMessage({
      id: 'opening',
      method: 'open',
      options: { databaseName: 'app', resources: [tasks] },
    })
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    host.close()
    finishOpen?.(hosted)
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    channel.port2.close()
  })
})
