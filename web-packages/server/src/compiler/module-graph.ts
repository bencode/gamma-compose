import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { parse } from 'es-module-lexer'
import { type Message, transform } from 'esbuild'
import type { CompileDiagnostic, CompiledFile, SourceTree } from './contract.js'
import { isAssetPath } from './input.js'
import {
  ProjectResolveError,
  resolveProjectImport,
  runtimePackages,
  sourceLoaders,
} from './resolve.js'

export type ModuleMetadata = CompiledFile & {
  kind: 'module'
  dependencies: string[]
  styles: string[]
}

export type StyleMetadata = CompiledFile & { kind: 'style' }
export type AssetMetadata = CompiledFile & { kind: 'asset' }
export type BuildFileMetadata = ModuleMetadata | StyleMetadata | AssetMetadata

export type CompiledArtifact = {
  path: string
  metadata: BuildFileMetadata
  contents: string
  warnings: CompileDiagnostic[]
}

export class ModuleCompileError extends Error {
  constructor(readonly diagnostics: CompileDiagnostic[]) {
    super(diagnostics.map(item => item.message).join('\n'))
  }
}

export const hashText = (value: string) => createHash('sha256').update(value).digest('hex')
export const moduleOutputPath = (path: string) => `modules/${path}.js`
export const styleOutputPath = (path: string) => `styles/${path}`
export const previewAssetUrlKey = '__GAMMA_COMPOSE_ASSET_URL__'

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

type Edit = { start: number; end: number; value: string }

const applyEdits = (source: string, edits: readonly Edit[]) =>
  [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) => `${current.slice(0, edit.start)}${edit.value}${current.slice(edit.end)}`,
      source,
    )

const transformSource = async (path: string, source: string) => {
  const loader = sourceLoaders[extname(path)]
  if (!loader)
    throw new ModuleCompileError([{ message: `Unsupported source format: ${path}`, path }])
  try {
    return await transform(source, {
      loader,
      sourcefile: `project:${path}`,
      format: loader === 'css' ? undefined : 'esm',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      sourcemap: loader === 'css' ? false : 'inline',
      define: { 'process.env.NODE_ENV': '"development"' },
      logLevel: 'silent',
    })
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'errors' in error &&
      Array.isArray(error.errors)
    )
      throw new ModuleCompileError((error.errors as Message[]).map(diagnostic))
    throw error
  }
}

export const compileModule = async (
  path: string,
  source: string,
  sourceTree: SourceTree,
): Promise<CompiledArtifact> => {
  const transformed = await transformSource(path, source)
  const [imports] = await parse(transformed.code)
  const dependencies: string[] = []
  const styles: string[] = []
  const edits: Edit[] = []
  imports.forEach(item => {
    if (item.n === undefined)
      throw new ModuleCompileError([
        { message: 'Dynamic imports must use a string literal in preview builds', path },
      ])
    let resolved: string
    try {
      resolved = resolveProjectImport(path, item.n, sourceTree)
    } catch (error) {
      if (!(error instanceof ProjectResolveError)) throw error
      throw new ModuleCompileError([{ message: error.message, path }])
    }
    const isStyle = resolved.endsWith('.css') || resolved === '@gamma-compose/ui/styles.css'
    if (isStyle) {
      if (item.d !== -1)
        throw new ModuleCompileError([
          { message: 'Stylesheets cannot be loaded with dynamic import', path },
        ])
      styles.push(resolved)
      edits.push({ start: item.ss, end: item.se, value: '' })
      return
    }
    if (!runtimePackages.has(resolved)) dependencies.push(resolved)
  })
  const contents = applyEdits(transformed.code, edits)
  const descriptor = sourceTree[path]
  if (!descriptor) throw new ModuleCompileError([{ message: `File not found: ${path}` }])
  return {
    path,
    contents,
    metadata: {
      kind: 'module',
      sourceHash: descriptor.hash,
      sourceBytes: descriptor.bytes,
      outputHash: hashText(contents),
      outputPath: moduleOutputPath(path),
      dependencies: [...new Set(dependencies)],
      styles: [...new Set(styles)],
    },
    warnings: transformed.warnings.map(diagnostic),
  }
}

export const compileAsset = (path: string, sourceTree: SourceTree): CompiledArtifact => {
  const descriptor = sourceTree[path]
  if (!descriptor || !isAssetPath(path))
    throw new ModuleCompileError([{ message: `Unsupported asset: ${path}`, path }])
  const contents = `const resolveAsset = globalThis[${JSON.stringify(previewAssetUrlKey)}];
if (typeof resolveAsset !== "function") throw new Error("The local asset bridge is unavailable.");
export default await resolveAsset(${JSON.stringify(path)}, ${JSON.stringify(descriptor.hash)});\n`
  return {
    path,
    contents,
    metadata: {
      kind: 'asset',
      sourceHash: descriptor.hash,
      sourceBytes: descriptor.bytes,
      outputHash: hashText(contents),
      outputPath: moduleOutputPath(path),
    },
    warnings: [],
  }
}

export const compileStyle = async (
  path: string,
  source: string,
  sourceTree: SourceTree,
): Promise<CompiledArtifact> => {
  const transformed = await transformSource(path, source)
  const descriptor = sourceTree[path]
  if (!descriptor) throw new ModuleCompileError([{ message: `File not found: ${path}` }])
  return {
    path,
    contents: transformed.code,
    metadata: {
      kind: 'style',
      sourceHash: descriptor.hash,
      sourceBytes: descriptor.bytes,
      outputHash: hashText(transformed.code),
      outputPath: styleOutputPath(path),
    },
    warnings: transformed.warnings.map(diagnostic),
  }
}

export const collectReachableStyles = (
  entry: string,
  files: Readonly<Record<string, BuildFileMetadata>>,
) => {
  const visited = new Set<string>()
  const visit = (path: string) => {
    if (visited.has(path)) return
    visited.add(path)
    const file = files[path]
    if (file?.kind !== 'module')
      throw new ModuleCompileError([{ message: `Compiled module is unavailable: ${path}`, path }])
    file.dependencies.forEach(dependency => {
      const dependencyFile = files[dependency]
      if (!dependencyFile)
        throw new ModuleCompileError([{ message: `File not found: ${dependency}`, path }])
      if (dependencyFile.kind === 'module') visit(dependency)
    })
  }
  visit(entry)
  return [
    ...new Set(
      [...visited].flatMap(path => {
        const file = files[path]
        return file?.kind === 'module' ? file.styles : []
      }),
    ),
  ]
}
