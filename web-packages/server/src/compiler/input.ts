import { posix } from 'node:path'
import type { CompileBuildInput, SourceFileDescriptor, SourceTree } from './contract.js'

export const maxCompileBytes = 17 * 1024 * 1024
export const maxProjectFiles = 1_024

export class InvalidCompileInput extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isProjectId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value)

export const isProjectPath = (path: string) =>
  path.length > 0 &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !/[\0?#:]/.test(path) &&
  !path.split('/').some(part => part === '..' || part === '.' || part === '') &&
  posix.normalize(path) === path

export const isAssetPath = (path: string) => /^src\/assets\/.+\.(?:png|jpe?g|webp|gif)$/i.test(path)
const isTextSourcePath = (path: string) => /\.(?:tsx?|jsx?|json|css)$/.test(path)
const isSourcePath = (path: string) => isTextSourcePath(path) || isAssetPath(path)
const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

const readDescriptor = (value: unknown): SourceFileDescriptor => {
  if (
    !isRecord(value) ||
    !isHash(value.hash) ||
    !Number.isSafeInteger(value.bytes) ||
    Number(value.bytes) < 0
  )
    throw new InvalidCompileInput('Source descriptors require a SHA-256 hash and byte count')
  return { hash: value.hash, bytes: Number(value.bytes) }
}

const readSourceTree = (value: unknown): SourceTree => {
  if (!isRecord(value)) throw new InvalidCompileInput('sourceTree must map paths to descriptors')
  const entries = Object.entries(value)
  if (entries.length === 0 || entries.length > maxProjectFiles)
    throw new InvalidCompileInput(`Provide between 1 and ${maxProjectFiles} source files`)
  if (entries.some(([path]) => !isProjectPath(path) || !isSourcePath(path)))
    throw new InvalidCompileInput('sourceTree contains an unsupported project path')
  return Object.fromEntries(entries.map(([path, descriptor]) => [path, readDescriptor(descriptor)]))
}

const readChanges = (value: unknown, sourceTree: SourceTree) => {
  if (!isRecord(value)) throw new InvalidCompileInput('changes must map paths to text contents')
  const entries = Object.entries(value)
  if (entries.length > maxProjectFiles)
    throw new InvalidCompileInput(`Provide no more than ${maxProjectFiles} changed files`)
  if (
    entries.some(
      ([path, contents]) =>
        !isProjectPath(path) ||
        !isTextSourcePath(path) ||
        typeof contents !== 'string' ||
        !Object.hasOwn(sourceTree, path),
    )
  )
    throw new InvalidCompileInput('changes must contain text for files declared in sourceTree')
  return Object.fromEntries(entries) as Record<string, string>
}

export const readCompileInput = (value: unknown): CompileBuildInput => {
  if (!isRecord(value)) throw new InvalidCompileInput('Provide a compilation request')
  if (value.baseBuildId !== null && !isHash(value.baseBuildId))
    throw new InvalidCompileInput('baseBuildId must be a build hash or null')
  if (typeof value.entry !== 'string' || !isProjectPath(value.entry))
    throw new InvalidCompileInput('The entry must be a canonical project-relative path')
  if (!/\.(?:tsx?|jsx?)$/.test(value.entry))
    throw new InvalidCompileInput('The entry must be a JavaScript or TypeScript file')
  const sourceTree = readSourceTree(value.sourceTree)
  if (!Object.hasOwn(sourceTree, value.entry))
    throw new InvalidCompileInput('The entry file does not exist')
  return {
    baseBuildId: value.baseBuildId,
    entry: value.entry,
    sourceTree,
    changes: readChanges(value.changes, sourceTree),
  }
}
