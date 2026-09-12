export type SourceFileDescriptor = {
  hash: string
  bytes: number
}

export type SourceTree = Record<string, SourceFileDescriptor>

export type CompileBuildInput = {
  baseBuildId: string | null
  entry: string
  sourceTree: SourceTree
  changes: Record<string, string>
}

export type CompileDiagnostic = {
  message: string
  path?: string
  line?: number
  column?: number
}

export type CompiledFile = {
  kind: 'module' | 'style'
  sourceHash: string
  sourceBytes: number
  outputHash: string
  outputPath: string
}

export type CompiledTree = {
  projectId: string
  buildId: string
  compilerVersion: string
  entry: string
  files: Record<string, CompiledFile>
  previewUrl: string
}

export type CompileBuildResult =
  | { ok: true; build: CompiledTree; warnings: CompileDiagnostic[] }
  | {
      ok: false
      reason: 'invalid-input' | 'stale-tree' | 'compile'
      errors: CompileDiagnostic[]
    }

export type CompileResult = CompileBuildResult
