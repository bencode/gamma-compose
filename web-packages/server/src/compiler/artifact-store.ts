import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CompileDiagnostic, CompiledFile, CompiledTree } from './contract.js'
import type { BuildFileMetadata, CompiledArtifact } from './module-graph.js'
import { resolveProjectPath } from './resolve.js'

export type BuildManifest = {
  tree: CompiledTree
  files: Record<string, BuildFileMetadata>
  warnings: CompileDiagnostic[]
}

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const isExistingTarget = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T

const publicFiles = (files: Readonly<Record<string, BuildFileMetadata>>) =>
  Object.fromEntries(
    Object.entries(files).map(([path, file]) => {
      const compiled: CompiledFile = {
        kind: file.kind,
        sourceHash: file.sourceHash,
        sourceBytes: file.sourceBytes,
        outputHash: file.outputHash,
        outputPath: file.outputPath,
      }
      return [path, compiled]
    }),
  )

export const createArtifactStore = (dataRoot: string) => {
  const publicRoot = join(dataRoot, 'public')
  mkdirSync(publicRoot, { recursive: true })
  const projectRoot = (projectId: string) => join(publicRoot, 'projects', projectId)
  const buildRoot = (projectId: string, buildId: string) =>
    join(projectRoot(projectId), 'builds', buildId)
  const currentPath = (projectId: string) => join(projectRoot(projectId), 'current.json')
  const manifestPath = (projectId: string, buildId: string) =>
    join(buildRoot(projectId, buildId), 'manifest.json')

  const loadBuild = async (
    projectId: string,
    buildId: string,
  ): Promise<BuildManifest | undefined> => {
    try {
      return await readJson<BuildManifest>(manifestPath(projectId, buildId))
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
  }

  const loadCurrent = async (projectId: string): Promise<BuildManifest | undefined> => {
    try {
      const current = await readJson<{ buildId: string }>(currentPath(projectId))
      return loadBuild(projectId, current.buildId)
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
  }

  const readArtifact = async (
    projectId: string,
    buildId: string | undefined,
    outputPath: string,
  ) => {
    if (!buildId) throw new Error(`Compiled artifact is unavailable: ${outputPath}`)
    return readFile(join(buildRoot(projectId, buildId), outputPath), 'utf8')
  }

  const publishCurrent = async (projectId: string, buildId: string) => {
    const target = currentPath(projectId)
    const temporary = `${target}.${randomUUID()}.tmp`
    await mkdir(dirname(target), { recursive: true })
    await writeFile(temporary, JSON.stringify({ buildId }), 'utf8')
    await rename(temporary, target)
  }

  const publish = async (options: {
    projectId: string
    buildId: string
    compilerVersion: string
    entry: string
    files: Record<string, BuildFileMetadata>
    artifacts: Readonly<Record<string, CompiledArtifact>>
    warnings: CompileDiagnostic[]
    document: string
    styles: string
    previous?: BuildManifest
  }): Promise<BuildManifest> => {
    const previewUrl = `/__preview/projects/${options.projectId}/builds/${options.buildId}/index.html`
    const tree: CompiledTree = {
      projectId: options.projectId,
      buildId: options.buildId,
      compilerVersion: options.compilerVersion,
      entry: options.entry,
      files: publicFiles(options.files),
      previewUrl,
    }
    const manifest: BuildManifest = { tree, files: options.files, warnings: options.warnings }
    const target = buildRoot(options.projectId, options.buildId)
    const staging = `${target}.${randomUUID()}.tmp`
    await mkdir(staging, { recursive: true })
    try {
      await Promise.all(
        Object.entries(options.files).map(async ([path, file]) => {
          const output = join(staging, file.outputPath)
          await mkdir(dirname(output), { recursive: true })
          const artifact = options.artifacts[path]
          if (artifact) return writeFile(output, artifact.contents, 'utf8')
          const previousFile = options.previous?.files[path]
          if (!options.previous || previousFile?.outputHash !== file.outputHash)
            throw new Error(`Missing compiled artifact: ${path}`)
          return link(
            join(
              buildRoot(options.projectId, options.previous.tree.buildId),
              previousFile.outputPath,
            ),
            output,
          )
        }),
      )
      await Promise.all([
        writeFile(join(staging, 'styles.css'), options.styles, 'utf8'),
        writeFile(join(staging, 'index.html'), options.document, 'utf8'),
        writeFile(join(staging, 'tree.json'), JSON.stringify(tree), 'utf8'),
        writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest), 'utf8'),
      ])
      await mkdir(dirname(target), { recursive: true })
      await rename(staging, target)
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      if (!isExistingTarget(error) || !(await loadBuild(options.projectId, options.buildId)))
        throw error
    }
    await publishCurrent(options.projectId, options.buildId)
    return manifest
  }

  const resolveModule = async (projectId: string, buildId: string, requestPath: string) => {
    const manifest = await loadBuild(projectId, buildId)
    if (!manifest) return undefined
    const modules = Object.fromEntries(
      Object.entries(manifest.files).filter(([, file]) => file.kind === 'module'),
    )
    const sourcePath = resolveProjectPath(requestPath, modules)
    return sourcePath ? manifest.files[sourcePath]?.outputPath : undefined
  }

  return { publicRoot, loadBuild, loadCurrent, readArtifact, publish, resolveModule }
}
