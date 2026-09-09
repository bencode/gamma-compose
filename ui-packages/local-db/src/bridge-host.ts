import type {
  LocalDbBridgeError,
  LocalDbBridgeRequest,
  LocalDbBridgeResponse,
} from './bridge-contract.js'
import { LocalDbError } from './errors.js'
import type { LocalDb, OpenLocalDbOptions } from './types.js'

export { LOCAL_DB_PORT_KEY } from './bridge-contract.js'

export type LocalDbBridgeHostOptions = {
  port: MessagePort
  open: (options: OpenLocalDbOptions) => Promise<LocalDb>
}

const requestId = (value: unknown): string | undefined =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
    ? value.id
    : undefined

const asRequest = (value: unknown): LocalDbBridgeRequest => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('method' in value) ||
    typeof value.method !== 'string'
  )
    throw new LocalDbError('STORAGE_ERROR', 'The database bridge received an invalid request.')
  return value as LocalDbBridgeRequest
}

const bridgeError = (cause: unknown): LocalDbBridgeError =>
  cause instanceof LocalDbError
    ? {
        code: cause.code,
        message: cause.message,
        ...(cause.details ? { details: cause.details } : {}),
      }
    : {
        code: 'STORAGE_ERROR',
        message: cause instanceof Error ? cause.message : 'The database bridge operation failed.',
      }

export const createLocalDbBridgeHost = ({ port, open }: LocalDbBridgeHostOptions) => {
  const handles = new Map<string, LocalDb>()
  let closed = false
  const database = (handle: string) => {
    const db = handles.get(handle)
    if (!db) throw new LocalDbError('DATABASE_CLOSED', 'The database connection is closed.')
    return db
  }
  const execute = async (request: LocalDbBridgeRequest): Promise<unknown> => {
    if (request.method === 'open') {
      const handle = crypto.randomUUID()
      const db = await open(request.options)
      if (closed) {
        db.close()
        throw new LocalDbError('DATABASE_CLOSED', 'The preview database bridge is closed.')
      }
      handles.set(handle, db)
      return handle
    }
    if (request.method === 'close') {
      database(request.handle).close()
      handles.delete(request.handle)
      return undefined
    }
    const db = database(request.handle)
    if (request.method === 'get') return db.get(request.resource, request.recordId)
    if (request.method === 'list') return db.list(request.resource, request.query)
    if (request.method === 'create') return db.create(request.resource, request.data)
    if (request.method === 'update')
      return db.update(request.resource, request.recordId, request.changes)
    if (request.method === 'remove') return db.remove(request.resource, request.recordId)
    throw new LocalDbError('STORAGE_ERROR', 'The database bridge received an unknown method.')
  }
  const receive = (event: MessageEvent<unknown>) => {
    if (closed) return
    const id = requestId(event.data)
    if (!id) return
    Promise.resolve()
      .then(() => execute(asRequest(event.data)))
      .then(value => {
        if (!closed) port.postMessage({ id, ok: true, value } satisfies LocalDbBridgeResponse)
      })
      .catch(cause => {
        if (!closed)
          port.postMessage({
            id,
            ok: false,
            error: bridgeError(cause),
          } satisfies LocalDbBridgeResponse)
      })
  }
  port.addEventListener('message', receive)
  port.start()
  return {
    close: () => {
      if (closed) return
      closed = true
      port.removeEventListener('message', receive)
      handles.forEach(db => {
        db.close()
      })
      handles.clear()
      port.close()
    },
  }
}
