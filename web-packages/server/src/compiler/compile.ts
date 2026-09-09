import { build, type Message } from 'esbuild'
import type { CompileDiagnostic, CompileInput, CompileResult } from './contract.js'
import { projectPlugin } from './resolve.js'
import { compileStyles, StyleCompileError } from './styles.js'

const diagnostic = ({ text, location }: Message): CompileDiagnostic => ({
  message: text,
  ...(location?.file.startsWith('project:')
    ? {
        path: location.file.slice('project:'.length),
        line: location.line,
        column: location.column + 1,
      }
    : {}),
})

export const compileProject = async (input: CompileInput): Promise<CompileResult> => {
  // esbuild's structured diagnostics are collected separately from unexpected service errors.
  let errors: Message[] = []
  try {
    const result = await build({
      entryPoints: ['gamma-compose:entry'],
      bundle: true,
      write: false,
      outfile: 'app.js',
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      conditions: ['style', 'source'],
      minify: true,
      sourcemap: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
        projectPlugin(input),
        {
          name: 'diagnostics',
          setup(builder) {
            builder.onEnd(result => {
              errors = result.errors
            })
          },
        },
      ],
    })
    const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text
    if (js === undefined) throw new Error('Compiler did not produce JavaScript')
    const css = await compileStyles(
      result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '',
      input.files,
    )
    return { ok: true, js, css, warnings: result.warnings.map(diagnostic) }
  } catch (error) {
    if (errors.length) return { ok: false, errors: errors.map(diagnostic) }
    if (error instanceof StyleCompileError)
      return { ok: false, errors: [{ message: error.message }] }
    throw error
  }
}
