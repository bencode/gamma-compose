import { build, type Message } from 'esbuild'
import { type BuildManifest, createArtifactStore } from './artifact-store.js'
import type {
  CompileBuildInput,
  CompileBuildResult,
  CompileDiagnostic,
  CompiledTree,
} from './contract.js'
import {
  type BuildFileMetadata,
  collectReachableStyles,
  compileModule,
  compileStyle,
  hashText,
  ModuleCompileError,
} from './module-graph.js'
import { createPreviewDocument } from './preview-document.js'
import { projectStylesPlugin } from './resolve.js'
import { createRuntimeLoader, runtimeVersion } from './runtime.js'
import { compileStyles, StyleCompileError } from './styles.js'

export const compilerVersion = '4'

const diagnostic = ({ text, location }: Message): CompileDiagnostic => ({
  message: text,
  ...(location
    ? {
        path: location.file.replace(/^project-style:/, ''),
        line: location.line,
        column: location.column + 1,
      }
    : {}),
})

const compileProjectStyles = async (
  stylePaths: readonly string[],
  styleSources: Readonly<Record<string, string>>,
  moduleSources: Readonly<Record<string, string>>,
) => {
  if (stylePaths.length === 0) return ''
  let errors: Message[] = []
  try {
    const result = await build({
      entryPoints: ['gamma-compose:styles'],
      bundle: true,
      write: false,
      outfile: 'styles.css',
      conditions: ['style', 'source'],
      logLevel: 'silent',
      plugins: [
        projectStylesPlugin(styleSources, stylePaths),
        {
          name: 'style-diagnostics',
          setup(builder) {
            builder.onEnd(result => {
              errors = result.errors
            })
          },
        },
      ],
    })
    const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text
    if (css === undefined) throw new Error('Compiler did not produce project styles')
    return compileStyles(css, moduleSources)
  } catch (error) {
    if (errors.length > 0) throw new ModuleCompileError(errors.map(diagnostic))
    throw error
  }
}

const sameSource = (
  previous: BuildFileMetadata | undefined,
  next: { hash: string; bytes: number },
) => previous?.sourceHash === next.hash && previous.sourceBytes === next.bytes

const sameSourcePaths = (
  previous: Readonly<Record<string, BuildFileMetadata>> | undefined,
  next: Readonly<Record<string, unknown>>,
) =>
  previous !== undefined &&
  Object.keys(previous).length === Object.keys(next).length &&
  Object.keys(next).every(path => Object.hasOwn(previous, path))

const validateChanges = (input: CompileBuildInput) => {
  const errors = Object.entries(input.changes).flatMap(([path, contents]) => {
    const expected = input.sourceTree[path]
    const actualHash = hashText(contents)
    const actualBytes = Buffer.byteLength(contents)
    return !expected || expected.hash !== actualHash || expected.bytes !== actualBytes
      ? [{ message: 'Changed file contents do not match sourceTree hash and byte count', path }]
      : []
  })
  return errors
}

const validateReferences = (files: Readonly<Record<string, BuildFileMetadata>>) => {
  const errors = Object.entries(files).flatMap(([path, file]) => {
    if (file.kind !== 'module') return []
    const missing = [
      ...file.dependencies.filter(dependency => !files[dependency]),
      ...file.styles.filter(style => style !== '@gamma-compose/ui/styles.css' && !files[style]),
    ]
    return missing.map(dependency => ({ message: `File not found: ${dependency}`, path }))
  })
  if (errors.length > 0) throw new ModuleCompileError(errors)
}

const buildIdFor = (
  entry: string,
  files: Readonly<Record<string, BuildFileMetadata>>,
  styles: string,
) =>
  hashText(
    JSON.stringify({
      compilerVersion,
      runtimeVersion,
      entry,
      files: Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, file]) => [path, file]),
      stylesHash: hashText(styles),
    }),
  )

const publicTreeMatches = (current: BuildManifest, input: CompileBuildInput) =>
  current.tree.compilerVersion === compilerVersion &&
  current.tree.entry === input.entry &&
  Object.keys(current.files).length === Object.keys(input.sourceTree).length &&
  Object.entries(input.sourceTree).every(([path, descriptor]) =>
    sameSource(current.files[path], descriptor),
  )

const staleResult = (): CompileBuildResult => ({
  ok: false,
  reason: 'stale-tree',
  errors: [{ message: 'The compiled tree changed. Read the current tree and retry once.' }],
})

export const createProjectCompiler = (dataRoot: string) => {
  const store = createArtifactStore(dataRoot)
  const loadRuntime = createRuntimeLoader(store.publicRoot)
  const queues = new Map<string, Promise<void>>()

  const run = async (projectId: string, input: CompileBuildInput): Promise<CompileBuildResult> => {
    const stored = await store.loadCurrent(projectId)
    const previous = stored?.tree.compilerVersion === compilerVersion ? stored : undefined
    if ((previous?.tree.buildId ?? null) !== input.baseBuildId) return staleResult()
    const contentErrors = validateChanges(input)
    if (contentErrors.length > 0)
      return { ok: false, reason: 'invalid-input', errors: contentErrors }
    try {
      if (previous && publicTreeMatches(previous, input))
        return { ok: true, build: previous.tree, warnings: previous.warnings }

      const changedSourcePaths = Object.entries(input.sourceTree)
        .filter(([path, descriptor]) => !sameSource(previous?.files[path], descriptor))
        .map(([path]) => path)
      const changedSourceSet = new Set(changedSourcePaths)
      const compilePaths = sameSourcePaths(previous?.files, input.sourceTree)
        ? changedSourcePaths
        : Object.keys(input.sourceTree).filter(
            path => !path.endsWith('.css') || changedSourceSet.has(path),
          )
      const missing = compilePaths.filter(path => input.changes[path] === undefined)
      if (missing.length > 0)
        return {
          ok: false,
          reason: 'invalid-input',
          errors: missing.map(path => ({ message: 'Changed file contents are required', path })),
        }

      const compiled = await Promise.all(
        compilePaths.map(path =>
          path.endsWith('.css')
            ? compileStyle(path, input.changes[path] ?? '', input.sourceTree)
            : compileModule(path, input.changes[path] ?? '', input.sourceTree),
        ),
      )
      const artifacts = Object.fromEntries(compiled.map(artifact => [artifact.path, artifact]))
      const files = Object.fromEntries(
        Object.keys(input.sourceTree).map(path => {
          const file = artifacts[path]?.metadata ?? previous?.files[path]
          if (!file) throw new Error(`Missing compiled metadata: ${path}`)
          return [path, file]
        }),
      ) as Record<string, BuildFileMetadata>
      validateReferences(files)
      const stylePaths = collectReachableStyles(input.entry, files)
      const styleSources = Object.fromEntries(
        await Promise.all(
          Object.entries(files)
            .filter(
              (entry): entry is [string, Extract<BuildFileMetadata, { kind: 'style' }>] =>
                entry[1].kind === 'style',
            )
            .map(
              async ([path, file]) =>
                [
                  path,
                  artifacts[path]?.contents ??
                    (await store.readArtifact(projectId, previous?.tree.buildId, file.outputPath)),
                ] as const,
            ),
        ),
      )
      const moduleSources = Object.fromEntries(
        await Promise.all(
          Object.entries(files)
            .filter(
              (entry): entry is [string, Extract<BuildFileMetadata, { kind: 'module' }>] =>
                entry[1].kind === 'module',
            )
            .map(
              async ([path, file]) =>
                [
                  path,
                  artifacts[path]?.contents ??
                    (await store.readArtifact(projectId, previous?.tree.buildId, file.outputPath)),
                ] as const,
            ),
        ),
      )
      const [runtime, styles] = await Promise.all([
        loadRuntime(),
        compileProjectStyles(stylePaths, styleSources, moduleSources),
      ])
      const entry = files[input.entry]
      if (entry?.kind !== 'module') throw new Error('Compiled entry is unavailable')
      const buildId = buildIdFor(input.entry, files, styles)
      const warnings = compiled.flatMap(artifact => artifact.warnings)
      const manifest = await store.publish({
        projectId,
        buildId,
        compilerVersion,
        entry: input.entry,
        files,
        artifacts,
        warnings,
        document: createPreviewDocument(entry.outputPath, runtime, styles.length > 0),
        styles,
        previous,
      })
      return { ok: true, build: manifest.tree, warnings }
    } catch (error) {
      if (error instanceof ModuleCompileError)
        return { ok: false, reason: 'compile', errors: error.diagnostics }
      if (error instanceof StyleCompileError)
        return { ok: false, reason: 'compile', errors: [{ message: error.message }] }
      throw error
    }
  }

  const compile = (projectId: string, input: CompileBuildInput): Promise<CompileBuildResult> => {
    const previous = queues.get(projectId) ?? Promise.resolve()
    const task = previous.then(() => run(projectId, input))
    const settled = task.then(
      () => undefined,
      error => {
        console.error('Project compilation failed.', error)
      },
    )
    queues.set(projectId, settled)
    void settled.finally(() => {
      if (queues.get(projectId) === settled) queues.delete(projectId)
    })
    return task
  }

  const getTree = async (projectId: string): Promise<CompiledTree | undefined> => {
    const current = await store.loadCurrent(projectId)
    return current?.tree.compilerVersion === compilerVersion ? current.tree : undefined
  }

  return {
    compile,
    getTree,
    resolveModule: store.resolveModule,
    publicRoot: store.publicRoot,
  }
}
