import type {
  CompileDiagnostic,
  CompileInput,
  CompileResult,
} from '@gamma-compose/server/compile-contract'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isDiagnostic = (value: unknown): value is CompileDiagnostic =>
  isRecord(value) &&
  typeof value.message === 'string' &&
  (value.path === undefined || typeof value.path === 'string') &&
  (value.line === undefined || (Number.isInteger(value.line) && Number(value.line) > 0)) &&
  (value.column === undefined || (Number.isInteger(value.column) && Number(value.column) > 0))

const isDiagnostics = (value: unknown): value is CompileDiagnostic[] =>
  Array.isArray(value) && value.every(isDiagnostic)

const isCompileResult = (value: unknown): value is CompileResult =>
  isRecord(value) &&
  ((value.ok === true &&
    typeof value.js === 'string' &&
    typeof value.css === 'string' &&
    isDiagnostics(value.warnings)) ||
    (value.ok === false && isDiagnostics(value.errors) && value.errors.length > 0))

export const compileFiles = async (
  input: CompileInput,
  signal: AbortSignal,
): Promise<CompileResult> => {
  const response = await fetch('/api/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`The compilation service returned an unexpected response (${response.status}).`)
  }
  const result: unknown = await response.json()
  if (!isCompileResult(result) || response.ok !== result.ok) {
    throw new Error(`The compilation service returned an invalid result (${response.status}).`)
  }
  return result
}
