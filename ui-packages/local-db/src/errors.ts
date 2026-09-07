export type LocalDbErrorCode =
  | 'INVALID_MODEL'
  | 'UNKNOWN_RESOURCE'
  | 'INVALID_QUERY'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'DATABASE_CLOSED'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_BLOCKED'
  | 'STORAGE_ERROR'

export type ValidationIssue = { path: string; message: string }

export class LocalDbError extends Error {
  override readonly name = 'LocalDbError'

  constructor(
    public readonly code: LocalDbErrorCode,
    message: string,
    public readonly details?: readonly ValidationIssue[],
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export const storageError = (cause: unknown): LocalDbError => {
  if (cause instanceof LocalDbError) return cause
  const unavailable =
    cause instanceof DOMException && ['SecurityError', 'NotSupportedError'].includes(cause.name)
  return new LocalDbError(
    unavailable ? 'STORAGE_UNAVAILABLE' : 'STORAGE_ERROR',
    unavailable ? 'Browser storage is unavailable.' : 'The database operation failed.',
    undefined,
    { cause },
  )
}
