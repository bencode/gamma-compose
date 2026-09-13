import type {
  CompileBuildInput,
  CompileBuildResult,
  CompileDiagnostic,
  CompiledFile,
  CompiledTree,
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

const isCompiledFile = (value: unknown): value is CompiledFile =>
  isRecord(value) &&
  (value.kind === 'module' || value.kind === 'style' || value.kind === 'asset') &&
  typeof value.sourceHash === 'string' &&
  Number.isSafeInteger(value.sourceBytes) &&
  typeof value.outputHash === 'string' &&
  typeof value.outputPath === 'string'

const isCompiledTree = (value: unknown): value is CompiledTree =>
  isRecord(value) &&
  typeof value.projectId === 'string' &&
  typeof value.buildId === 'string' &&
  typeof value.compilerVersion === 'string' &&
  typeof value.entry === 'string' &&
  isRecord(value.files) &&
  Object.values(value.files).every(isCompiledFile) &&
  typeof value.previewUrl === 'string'

const isCompileResult = (value: unknown): value is CompileBuildResult =>
  isRecord(value) &&
  ((value.ok === true && isCompiledTree(value.build) && isDiagnostics(value.warnings)) ||
    (value.ok === false &&
      (value.reason === 'invalid-input' ||
        value.reason === 'stale-tree' ||
        value.reason === 'compile') &&
      isDiagnostics(value.errors) &&
      value.errors.length > 0))

const readJson = async (response: Response) => {
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(`The compilation service returned an unexpected response (${response.status}).`)
  return response.json() as Promise<unknown>
}

export const getCompiledTree = async (
  projectId: string,
  signal: AbortSignal,
): Promise<CompiledTree | undefined> => {
  const response = await fetch(`/api/compiler/projects/${encodeURIComponent(projectId)}/tree`, {
    signal,
    cache: 'no-store',
  })
  const value = await readJson(response)
  if (response.status === 404) return undefined
  if (!response.ok || !isRecord(value) || value.ok !== true || !isCompiledTree(value.build))
    throw new Error(`Could not read the compiled project tree (${response.status}).`)
  return value.build
}

export const compileFiles = async (
  projectId: string,
  input: CompileBuildInput,
  signal: AbortSignal,
): Promise<CompileBuildResult> => {
  const response = await fetch(`/api/compiler/projects/${encodeURIComponent(projectId)}/builds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (response.status >= 500)
    throw new Error(`The compilation service failed (HTTP ${response.status}). Please retry.`)
  const result = await readJson(response)
  if (!isCompileResult(result))
    throw new Error(`The compilation service returned an invalid result (${response.status}).`)
  const validStatus = result.ok
    ? response.status === 200
    : result.reason === 'stale-tree'
      ? response.status === 409
      : result.reason === 'compile'
        ? response.status === 422
        : response.status === 400 || response.status === 413
  if (!validStatus)
    throw new Error(`The compilation service returned an invalid status (${response.status}).`)
  return result
}
