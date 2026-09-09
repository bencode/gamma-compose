import type { LocalDbBridgeRequestInput, LocalDbBridgeResponse } from './bridge-contract.js'
import { isBridgeResponse, LOCAL_DB_PORT_KEY } from './bridge-contract.js'
import { LocalDbError } from './errors.js'
import type { DataRecord, ListQuery, LocalDb, OpenLocalDbOptions, Page } from './types.js'

type Pending = {
  resolve: (value: unknown) => void
  reject: (cause: Error) => void
}

const clients = new WeakMap<MessagePort, ReturnType<typeof createClient>>()

const bridgePort = () => {
  const port = Reflect.get(globalThis, LOCAL_DB_PORT_KEY)
  if (!(port instanceof MessagePort))
    throw new LocalDbError('STORAGE_UNAVAILABLE', 'The preview database bridge is unavailable.')
  return port
}

const createClient = (port: MessagePort) => {
  const pending = new Map<string, Pending>()
  const failAll = () => {
    const error = new LocalDbError('DATABASE_CLOSED', 'The preview database bridge is closed.')
    pending.forEach(request => {
      request.reject(error)
    })
    pending.clear()
  }
  port.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!isBridgeResponse(event.data)) return
    const response: LocalDbBridgeResponse = event.data
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.ok) request.resolve(response.value)
    else
      request.reject(
        new LocalDbError(response.error.code, response.error.message, response.error.details),
      )
  })
  port.addEventListener('messageerror', failAll)
  port.start()
  const request = <T>(message: LocalDbBridgeRequestInput): Promise<T> => {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: value => resolve(value as T), reject })
      try {
        port.postMessage({ ...message, id })
      } catch (cause) {
        pending.delete(id)
        reject(cause instanceof Error ? cause : new Error('Could not send a database request.'))
      }
    })
  }
  const notifyClose = (handle: string) => {
    try {
      port.postMessage({ id: crypto.randomUUID(), method: 'close', handle })
    } catch (cause) {
      console.error('Could not close the preview database handle.', cause)
    }
  }
  return { request, notifyClose }
}

const client = () => {
  const port = bridgePort()
  const existing = clients.get(port)
  if (existing) return existing
  const created = createClient(port)
  clients.set(port, created)
  return created
}

export const openLocalDb = async (options: OpenLocalDbOptions): Promise<LocalDb> => {
  const rpc = client()
  const handle = await rpc.request<string>({ method: 'open', options })
  let closed = false
  const active = () => {
    if (closed) throw new LocalDbError('DATABASE_CLOSED', 'The database connection is closed.')
  }
  return {
    create: async (resource, data) => {
      active()
      return rpc.request<DataRecord>({ method: 'create', handle, resource, data })
    },
    get: async (resource, recordId) => {
      active()
      return rpc.request<DataRecord | undefined>({ method: 'get', handle, resource, recordId })
    },
    list: async (resource, query?: ListQuery): Promise<Page> => {
      active()
      return rpc.request<Page>({ method: 'list', handle, resource, ...(query ? { query } : {}) })
    },
    update: async (resource, recordId, changes) => {
      active()
      return rpc.request<DataRecord>({
        method: 'update',
        handle,
        resource,
        recordId,
        changes,
      })
    },
    remove: async (resource, recordId) => {
      active()
      return rpc.request<void>({ method: 'remove', handle, resource, recordId })
    },
    close: () => {
      if (closed) return
      closed = true
      rpc.notifyClose(handle)
    },
  }
}

export { LocalDbError, type LocalDbErrorCode, type ValidationIssue } from './errors.js'
export type {
  DataRecord,
  FieldCondition,
  Filter,
  JsonScalar,
  JsonValue,
  ListQuery,
  LocalDb,
  OpenLocalDbOptions,
  Page,
  ResourceDefinition,
} from './types.js'
