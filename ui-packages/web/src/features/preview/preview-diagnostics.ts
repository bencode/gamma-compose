export type PreviewRuntimeStatus = 'not-loaded' | 'loading' | 'ready' | 'failed'

export type PreviewErrorSource =
  | 'module'
  | 'window'
  | 'promise'
  | 'form'
  | 'security-policy'
  | 'harness'

export type PreviewRuntimeError = {
  sequence: number
  phase: 'load' | 'runtime'
  source: PreviewErrorSource
  fatal: boolean
  message: string
  stack?: string
  occurredAt: number
}

export type PreviewConsoleLevel = 'debug' | 'log' | 'info' | 'warn' | 'error'

export type PreviewConsoleEntry = {
  sequence: number
  level: PreviewConsoleLevel
  message: string
  occurredAt: number
}

export type PreviewErrorsResult = {
  buildId: number | null
  status: PreviewRuntimeStatus
  errors: PreviewRuntimeError[]
  dropped: number
}

export type PreviewConsoleResult = {
  buildId: number | null
  entries: PreviewConsoleEntry[]
  dropped: number
}

type RuntimeErrorInput = Omit<PreviewRuntimeError, 'sequence' | 'occurredAt'>
type ConsoleInput = Omit<PreviewConsoleEntry, 'sequence' | 'occurredAt'>
type Bounded<T> = { entries: T[]; dropped: number }

const maxEntries = 100
const maxBytes = 40 * 1024
const encoder = new TextEncoder()

const bounded = <T>(entries: T[]): Bounded<T> => {
  const tail = entries.slice(-maxEntries)
  let bytes = 0
  let dropped = entries.length - tail.length
  const retained = tail.reduceRight<T[]>((result, entry) => {
    const entryBytes = encoder.encode(JSON.stringify(entry)).byteLength
    if (bytes + entryBytes > maxBytes) {
      dropped += 1
      return result
    }
    bytes += entryBytes
    result.push(entry)
    return result
  }, [])
  return { entries: retained.reverse(), dropped }
}

export const createPreviewDiagnostics = () => {
  let buildId: number | null = null
  let status: PreviewRuntimeStatus = 'not-loaded'
  let nextSequence = 1
  let errors: PreviewRuntimeError[] = []
  let consoleEntries: PreviewConsoleEntry[] = []
  let droppedErrors = 0
  let droppedConsoleEntries = 0

  const appendError = (input: RuntimeErrorInput) => {
    const next = bounded([
      ...errors,
      { ...input, sequence: nextSequence++, occurredAt: Date.now() },
    ])
    errors = next.entries
    droppedErrors += next.dropped
    if (input.fatal) status = 'failed'
  }

  const appendConsole = (input: ConsoleInput) => {
    const next = bounded([
      ...consoleEntries,
      { ...input, sequence: nextSequence++, occurredAt: Date.now() },
    ])
    consoleEntries = next.entries
    droppedConsoleEntries += next.dropped
  }

  return {
    startBuild: (id: number) => {
      buildId = id
      status = 'loading'
      nextSequence = 1
      errors = []
      consoleEntries = []
      droppedErrors = 0
      droppedConsoleEntries = 0
    },
    markReady: (id: number) => {
      if (buildId === id && status === 'loading') status = 'ready'
    },
    appendError,
    appendConsole,
    readErrors: (): PreviewErrorsResult => ({
      buildId,
      status,
      errors: errors.map(error => ({ ...error })),
      dropped: droppedErrors,
    }),
    readConsole: (): PreviewConsoleResult => ({
      buildId,
      entries: consoleEntries.map(entry => ({ ...entry })),
      dropped: droppedConsoleEntries,
    }),
  }
}

export type PreviewDiagnostics = ReturnType<typeof createPreviewDiagnostics>
