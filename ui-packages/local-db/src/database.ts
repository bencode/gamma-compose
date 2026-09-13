import { LocalDbError } from './errors.js'
import { assertJson, isObject, prepareResources, type Resource } from './model.js'
import { prepareQuery } from './query.js'
import { deleteStorage, openStorage, transact } from './storage.js'
import type { DataRecord, LocalDb, OpenLocalDbOptions } from './types.js'

const checkInput = (value: unknown, model: Resource) => {
  assertJson(value, 'VALIDATION_FAILED')
  if (!isObject(value) || Object.hasOwn(value, 'id'))
    throw new LocalDbError('VALIDATION_FAILED', 'Submit an object without the managed id field.')
  const unknown = Object.keys(value).filter(field => !Object.hasOwn(model.fields, field))
  if (unknown.length)
    throw new LocalDbError('VALIDATION_FAILED', `Unknown fields: ${unknown.join(', ')}.`)
}

const checkId = (id: string) => {
  if (typeof id !== 'string' || !id.length)
    throw new LocalDbError('VALIDATION_FAILED', 'id must be a nonempty string.')
}

const checkDatabaseName = (databaseName: unknown) => {
  if (typeof databaseName !== 'string' || !databaseName.trim())
    throw new LocalDbError('INVALID_MODEL', 'A nonempty databaseName is required.')
  return databaseName
}

export const openLocalDb = async (options: OpenLocalDbOptions): Promise<LocalDb> => {
  if (!isObject(options))
    throw new LocalDbError('INVALID_MODEL', 'A nonempty databaseName is required.')
  const databaseName = checkDatabaseName(options.databaseName)
  const resources = prepareResources(options.resources)
  const storage = await openStorage(databaseName, [...resources.values()])
  const resource = (name: string): Resource => {
    const found = resources.get(name)
    if (!found) throw new LocalDbError('UNKNOWN_RESOURCE', `Unknown resource: ${name}.`)
    return found
  }
  return {
    close: storage.close,
    create: async (name, data) => {
      const model: Resource = resource(name)
      checkInput(data, model)
      const record = structuredClone({ ...data, id: crypto.randomUUID() })
      model.validate(record)
      return transact(storage, name, 'readwrite', (store, result) => {
        store.add(record)
        result(record)
      })
    },
    get: async (name, id) => {
      resource(name)
      checkId(id)
      return transact(storage, name, 'readonly', (store, result) => {
        const request = store.get(id)
        request.onsuccess = () => result(request.result as DataRecord | undefined)
      })
    },
    list: async (name, query = {}) => {
      const prepared = prepareQuery(resource(name), query)
      const records = await transact<DataRecord[]>(storage, name, 'readonly', (store, result) => {
        const request = prepared.index
          ? store.index(prepared.index.name).getAll(prepared.index.key)
          : store.getAll()
        request.onsuccess = () => result(request.result as DataRecord[])
      })
      return prepared.page(records)
    },
    update: async (name, id, changes) => {
      const model: Resource = resource(name)
      checkId(id)
      checkInput(changes, model)
      const patch = structuredClone(changes)
      return transact<DataRecord>(storage, name, 'readwrite', (store, result, fail) => {
        const request = store.get(id)
        request.onsuccess = () => {
          try {
            if (!request.result) throw new LocalDbError('NOT_FOUND', `Record not found: ${id}.`)
            const retained = Object.fromEntries(
              Object.entries(request.result as DataRecord).filter(([field]) =>
                Object.hasOwn(model.fields, field),
              ),
            )
            const record = { ...retained, ...patch, id }
            model.validate(record)
            store.put(record)
            result(record)
          } catch (cause) {
            fail(cause)
          }
        }
      })
    },
    remove: async (name, id) => {
      resource(name)
      checkId(id)
      return transact<void>(storage, name, 'readwrite', (store, result) => {
        store.delete(id)
        result(undefined)
      })
    },
  }
}

export const deleteLocalDb = async (databaseName: string): Promise<void> =>
  deleteStorage(checkDatabaseName(databaseName))
