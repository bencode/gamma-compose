export type CompileInput = {
  entry: string
  files: Record<string, string>
}

export type CompileDiagnostic = {
  message: string
  path?: string
  line?: number
  column?: number
}

export type CompileResult =
  | { ok: true; js: string; css: string; warnings: CompileDiagnostic[] }
  | { ok: false; errors: CompileDiagnostic[] }
