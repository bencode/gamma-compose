import type {
  CompileBuildResult,
  CompiledTree,
  SourceFileDescriptor,
  SourceTree,
} from '@gamma-compose/server/compile-contract'
import type { ProjectCompileState } from '../project/records'
import type { ProjectRepository } from '../project/repository'
import { blobBytes } from '../project/repository-files'
import type { ProjectSnapshot } from '../project/store'
import { compileFiles, getCompiledTree } from './client'

const sourcePattern = /\.(?:tsx?|jsx?|json|css)$/
const assetPattern = /^src\/assets\/.+\.(?:png|jpe?g|webp|gif)$/i
const encoder = new TextEncoder()

const hashBytes = async (bytes: Uint8Array<ArrayBuffer>) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return {
    hash: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''),
    bytes: bytes.byteLength,
  } satisfies SourceFileDescriptor
}

const hash = (contents: string) => hashBytes(encoder.encode(contents))

const describeSources = async (snapshot: ProjectSnapshot, repository: ProjectRepository) => {
  const textEntries = await Promise.all(
    Object.entries(snapshot.files)
      .filter(([path]) => sourcePattern.test(path))
      .map(async ([path, contents]) => [path, await hash(contents)] as const),
  )
  const assetEntries = await Promise.all(
    repository
      .getFiles()
      .filter(file => file.kind === 'image' && assetPattern.test(file.path))
      .map(async file => {
        const blob = await repository.readBlob(file.path)
        const bytes = new Uint8Array(await blobBytes(blob))
        return [file.path, { blob, descriptor: await hashBytes(bytes) }] as const
      }),
  )
  return Object.fromEntries([
    ...textEntries,
    ...assetEntries.map(([path, asset]) => [path, asset.descriptor] as const),
  ]) satisfies SourceTree
}

const changedContents = (
  snapshot: ProjectSnapshot,
  sourceTree: SourceTree,
  baseline: CompiledTree | undefined,
) => {
  const sourcePathsChanged =
    !baseline ||
    Object.keys(sourceTree).length !== Object.keys(baseline.files).length ||
    Object.keys(sourceTree).some(path => !Object.hasOwn(baseline.files, path))
  return Object.fromEntries(
    Object.entries(sourceTree)
      .filter(([path, descriptor]) => {
        const previous = baseline?.files[path]
        const sourceChanged =
          previous?.sourceHash !== descriptor.hash || previous.sourceBytes !== descriptor.bytes
        return sourceChanged || (sourcePathsChanged && !path.endsWith('.css'))
      })
      .filter(([path]) => Object.hasOwn(snapshot.files, path))
      .map(([path]) => [path, snapshot.files[path] ?? '']),
  )
}

const matches = (snapshot: ProjectSnapshot, sourceTree: SourceTree, build: CompiledTree) =>
  snapshot.entry === build.entry &&
  Object.keys(sourceTree).length === Object.keys(build.files).length &&
  Object.entries(sourceTree).every(([path, descriptor]) => {
    const file = build.files[path]
    return file?.sourceHash === descriptor.hash && file.sourceBytes === descriptor.bytes
  })

type CompilePersistence = {
  load: () => Promise<ProjectCompileState | undefined>
  save: (state: ProjectCompileState) => Promise<void>
}

export const createCompileCoordinator = (
  projectId: string,
  persistence: CompilePersistence,
  repository: ProjectRepository,
) => {
  let baseline: CompiledTree | undefined
  let initialized = false

  const initialize = async (signal: AbortSignal) => {
    if (initialized) return
    const [local, remote] = await Promise.all([
      persistence.load(),
      getCompiledTree(projectId, signal),
    ])
    baseline = local && local.build.buildId === remote?.buildId ? local.build : remote
    initialized = true
  }

  const persist = async (build: CompiledTree) => {
    try {
      await persistence.save({ projectId, build, updatedAt: Date.now() })
    } catch (error) {
      console.error('Could not save the compiled project state.', error)
    }
  }

  const compile = async (
    snapshot: ProjectSnapshot,
    signal: AbortSignal,
  ): Promise<CompileBuildResult> => {
    await initialize(signal)
    const sourceTree = await describeSources(snapshot, repository)
    if (baseline && matches(snapshot, sourceTree, baseline))
      return { ok: true, build: baseline, warnings: [] }

    const request = () =>
      compileFiles(
        projectId,
        {
          baseBuildId: baseline?.buildId ?? null,
          entry: snapshot.entry,
          sourceTree,
          changes: changedContents(snapshot, sourceTree, baseline),
        },
        signal,
      )
    let result = await request()
    if (!result.ok && result.reason === 'stale-tree') {
      baseline = await getCompiledTree(projectId, signal)
      result = await request()
    }
    if (result.ok) {
      baseline = result.build
      await persist(result.build)
    }
    return result
  }

  return { compile }
}
