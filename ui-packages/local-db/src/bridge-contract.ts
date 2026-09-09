import type { LocalDbErrorCode, ValidationIssue } from './errors.js'
import type { JsonValue, ListQuery, OpenLocalDbOptions } from './types.js'

export const LOCAL_DB_PORT_KEY = '__GAMMA_COMPOSE_LOCAL_DB_PORT__'

export type LocalDbBridgeRequest =
  | { id: string; method: 'open'; options: OpenLocalDbOptions }
  | {
      id: string
      method: 'get'
      handle: string
      resource: string
      recordId: string
    }
  | {
      id: string
      method: 'list'
      handle: string
      resource: string
      query?: ListQuery
    }
  | {
      id: string
      method: 'create'
      handle: string
      resource: string
      data: Record<string, JsonValue>
    }
  | {
      id: string
      method: 'update'
      handle: string
      resource: string
      recordId: string
      changes: Record<string, JsonValue>
    }
  | {
      id: string
      method: 'remove'
      handle: string
      resource: string
      recordId: string
    }
  | { id: string; method: 'close'; handle: string }

export type LocalDbBridgeRequestInput = LocalDbBridgeRequest extends infer Request
  ? Request extends { id: string }
    ? Omit<Request, 'id'>
    : never
  : never

export type LocalDbBridgeError = {
  code: LocalDbErrorCode
  message: string
  details?: readonly ValidationIssue[]
}

export type LocalDbBridgeResponse =
  | { id: string; ok: true; value?: unknown }
  | { id: string; ok: false; error: LocalDbBridgeError }

export const isBridgeResponse = (value: unknown): value is LocalDbBridgeResponse => {
  if (typeof value !== 'object' || value === null || !('id' in value) || !('ok' in value))
    return false
  if (typeof value.id !== 'string' || typeof value.ok !== 'boolean') return false
  if (value.ok) return true
  return (
    'error' in value &&
    typeof value.error === 'object' &&
    value.error !== null &&
    'code' in value.error &&
    typeof value.error.code === 'string' &&
    'message' in value.error &&
    typeof value.error.message === 'string'
  )
}
