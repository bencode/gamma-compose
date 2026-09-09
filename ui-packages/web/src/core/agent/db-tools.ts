import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { JsonValue, ListQuery } from '@gamma-compose/local-db'
import { LocalDbError } from '@gamma-compose/local-db'
import { Type } from 'typebox'
import { withProjectDb } from '../data/project-db'
import type { ProjectStore } from '../project/store'

const maxResultBytes = 50 * 1024
const object = Type.Record(Type.String(), Type.Unknown())
const target = { resource: Type.String(), id: Type.String() }

const errorText = (cause: unknown) =>
  cause instanceof LocalDbError
    ? JSON.stringify({ code: cause.code, message: cause.message, details: cause.details })
    : cause instanceof Error
      ? cause.message
      : 'The database operation failed.'

const resultText = (value: unknown, committed = false) => {
  const text = JSON.stringify(value)
  if (new TextEncoder().encode(text).byteLength <= maxResultBytes) return text
  if (
    committed &&
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  )
    return JSON.stringify({
      committed: true,
      id: value.id,
      recordOmitted: 'Result exceeds 50 KiB.',
    })
  throw new Error('The database result exceeds 50 KiB. Narrow the query or lower its limit.')
}

const run = async <T>(
  projectId: string,
  project: ProjectStore,
  action: Parameters<typeof withProjectDb<T>>[2],
) => {
  try {
    return await withProjectDb(projectId, project, action)
  } catch (cause) {
    throw new Error(errorText(cause), { cause: cause instanceof Error ? cause : undefined })
  }
}

export const createDbTools = (projectId: string, project: ProjectStore) => {
  const getParameters = Type.Object(target)
  const listParameters = Type.Object({
    resource: Type.String(),
    query: Type.Optional(object),
  })
  const createParameters = Type.Object({ resource: Type.String(), data: object })
  const updateParameters = Type.Object({ ...target, changes: object })
  const removeParameters = Type.Object(target)
  const get: AgentTool<typeof getParameters, undefined> = {
    name: 'db_get',
    label: 'db.get',
    description: 'Get one record by id from the current project database.',
    parameters: getParameters,
    executionMode: 'sequential',
    execute: async (_id, { resource, id }, signal) => {
      signal?.throwIfAborted()
      const value = await run(projectId, project, db => db.get(resource, id))
      return { content: [{ type: 'text', text: resultText(value ?? null) }], details: undefined }
    },
  }
  const list: AgentTool<typeof listParameters, undefined> = {
    name: 'db_list',
    label: 'db.list',
    description: 'Query records in the current project database using filter, sort and pagination.',
    parameters: listParameters,
    executionMode: 'sequential',
    execute: async (_id, { resource, query }, signal) => {
      signal?.throwIfAborted()
      const value = await run(projectId, project, db =>
        db.list(resource, query as ListQuery | undefined),
      )
      return { content: [{ type: 'text', text: resultText(value) }], details: undefined }
    },
  }
  const create: AgentTool<typeof createParameters, undefined> = {
    name: 'db_create',
    label: 'db.create',
    description: 'Create a validated record in the current project database.',
    parameters: createParameters,
    executionMode: 'sequential',
    execute: async (_id, { resource, data }, signal) => {
      signal?.throwIfAborted()
      const value = await run(projectId, project, db =>
        db.create(resource, data as Record<string, JsonValue>),
      )
      return { content: [{ type: 'text', text: resultText(value, true) }], details: undefined }
    },
  }
  const update: AgentTool<typeof updateParameters, undefined> = {
    name: 'db_update',
    label: 'db.update',
    description: 'Update and validate one record in the current project database.',
    parameters: updateParameters,
    executionMode: 'sequential',
    execute: async (_id, { resource, id, changes }, signal) => {
      signal?.throwIfAborted()
      const value = await run(projectId, project, db =>
        db.update(resource, id, changes as Record<string, JsonValue>),
      )
      return { content: [{ type: 'text', text: resultText(value, true) }], details: undefined }
    },
  }
  const remove: AgentTool<typeof removeParameters, undefined> = {
    name: 'db_remove',
    label: 'db.remove',
    description: 'Remove one record by id from the current project database.',
    parameters: removeParameters,
    executionMode: 'sequential',
    execute: async (_id, { resource, id }, signal) => {
      signal?.throwIfAborted()
      await run(projectId, project, db => db.remove(resource, id))
      return {
        content: [{ type: 'text', text: JSON.stringify({ removed: true, id }) }],
        details: undefined,
      }
    },
  }
  return [get, list, create, update, remove]
}
