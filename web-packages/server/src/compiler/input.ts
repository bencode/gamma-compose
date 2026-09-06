import { posix } from 'node:path'
import type { CompileInput } from './contract.js'

export const maxCompileBytes = 2 * 1024 * 1024

export class InvalidCompileInput extends Error {}

const isProjectPath = (path: string) =>
  path.length > 0 &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !/[:?#]/.test(path) &&
  [...path].every(character => character.charCodeAt(0) >= 32) &&
  !path.split('/').some(part => part === '..' || part === '.' || part === '') &&
  posix.normalize(path) === path

export const readCompileInput = (value: unknown): CompileInput => {
  if (typeof value !== 'object' || value === null || !('entry' in value) || !('files' in value)) {
    throw new InvalidCompileInput('Provide an entry and a files map')
  }
  const { entry, files } = value
  if (typeof entry !== 'string' || !isProjectPath(entry)) {
    throw new InvalidCompileInput('The entry must be a canonical project-relative path')
  }
  if (!/\.(?:tsx?|jsx?)$/.test(entry)) {
    throw new InvalidCompileInput('The entry must be a JavaScript or TypeScript file')
  }
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new InvalidCompileInput('Files must map paths to text contents')
  }
  const entries: [string, unknown][] = Object.entries(files)
  if (entries.length === 0 || entries.length > 128) {
    throw new InvalidCompileInput('Provide between 1 and 128 files')
  }
  if (entries.some(([path, content]) => !isProjectPath(path) || typeof content !== 'string')) {
    throw new InvalidCompileInput(
      'Files require canonical project-relative paths and text contents',
    )
  }
  if (!Object.hasOwn(files, entry)) throw new InvalidCompileInput('The entry file does not exist')
  return {
    entry,
    files: Object.fromEntries(entries.map(([path, content]) => [path, content as string])),
  }
}
