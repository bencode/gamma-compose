import { LocalDbError, storageError } from './errors.js'
import type { Resource } from './model.js'
import { indexName } from './query.js'

const missingLayout = (db: IDBDatabase, resources: readonly Resource[]): boolean =>
  resources.some(resource => {
    if (!db.objectStoreNames.contains(resource.name)) return true
    const store = db.transaction(resource.name).objectStore(resource.name)
    return resource.indexes.some(fields => !store.indexNames.contains(indexName(fields)))
  })

const addLayout = (
  db: IDBDatabase,
  transaction: IDBTransaction,
  resources: readonly Resource[],
) => {
  resources.forEach(resource => {
    const store = db.objectStoreNames.contains(resource.name)
      ? transaction.objectStore(resource.name)
      : db.createObjectStore(resource.name, { keyPath: 'id' })
    resource.indexes.forEach(fields => {
      const name = indexName(fields)
      if (!store.indexNames.contains(name))
        store.createIndex(name, fields.length === 1 ? (fields[0] as string) : [...fields])
    })
  })
}

const openConnection = (
  name: string,
  resources: readonly Resource[],
  version?: number,
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    let cancelled = false
    let failure: unknown
    const request = indexedDB.open(name, version)
    request.onblocked = () => {
      cancelled = true
      reject(
        new LocalDbError('STORAGE_BLOCKED', 'Close other connections to upgrade this database.'),
      )
    }
    request.onupgradeneeded = () => {
      const transaction = request.transaction
      if (!transaction) return
      if (cancelled) return transaction.abort()
      try {
        addLayout(request.result, transaction, resources)
      } catch (cause) {
        failure = cause
        transaction.abort()
      }
    }
    request.onerror = () => reject(storageError(failure ?? request.error))
    request.onsuccess = () => {
      const db = request.result
      if (cancelled) return db.close()
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })

export const openStorage = async (name: string, resources: readonly Resource[]) => {
  if (typeof indexedDB === 'undefined')
    throw new LocalDbError('STORAGE_UNAVAILABLE', 'IndexedDB is not available in this environment.')
  let db: IDBDatabase | undefined
  try {
    db = await openConnection(`gamma-compose:local-db:${name}`, resources)
    if (missingLayout(db, resources)) {
      const version = db.version + 1
      db.close()
      db = await openConnection(`gamma-compose:local-db:${name}`, resources, version)
    }
    let closed = false
    const connection = db
    const close = () => {
      closed = true
      connection.close()
    }
    connection.onversionchange = close
    connection.onclose = () => {
      closed = true
    }
    return {
      close,
      transaction: (resource: string, mode: IDBTransactionMode) => {
        if (closed) throw new LocalDbError('DATABASE_CLOSED', 'The database connection is closed.')
        return connection.transaction(resource, mode)
      },
    }
  } catch (cause) {
    db?.close()
    throw storageError(cause)
  }
}

export type Storage = Awaited<ReturnType<typeof openStorage>>

export const transact = <T>(
  storage: Storage,
  resource: string,
  mode: IDBTransactionMode,
  action: (
    store: IDBObjectStore,
    result: (value: T) => void,
    fail: (cause: unknown) => void,
  ) => void,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let transaction: IDBTransaction | undefined
    let result: T
    let failure: unknown
    const fail = (cause: unknown) => {
      failure = cause
      if (transaction) transaction.abort()
      else reject(storageError(cause))
    }
    try {
      transaction = storage.transaction(resource, mode)
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(storageError(failure ?? transaction?.error))
      transaction.onerror = () => {
        failure ??= transaction?.error
      }
      action(
        transaction.objectStore(resource),
        value => {
          result = value
        },
        fail,
      )
    } catch (cause) {
      fail(cause)
    }
  })
