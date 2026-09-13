import {
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type FileInfo,
} from '@earendil-works/pi-agent-core'
import { type ProjectRepository, RepositoryError } from '../project/repository'
import { blobBytes } from '../project/repository-files'
import { validateProjectPath } from '../project/store'

const root = '/project'

export const projectRelativePath = (path: string) => {
  if (path === '.' || path === root || path === `${root}/`) return ''
  const relative = path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path.replace(/^\.\//, '')
  validateProjectPath(relative)
  return relative
}

const attempt = async <T>(action: () => T | Promise<T>, signal?: AbortSignal) => {
  try {
    if (signal?.aborted) throw new FileError('aborted', 'Operation aborted.')
    const value = await action()
    if (signal?.aborted) throw new FileError('aborted', 'Operation aborted.')
    return { ok: true as const, value }
  } catch (cause) {
    return {
      ok: false as const,
      error:
        cause instanceof FileError
          ? cause
          : new FileError(
              cause instanceof RepositoryError && cause.code !== 'invalid_content'
                ? cause.code
                : 'unknown',
              cause instanceof Error ? cause.message : 'Project operation failed.',
              undefined,
              cause instanceof Error ? cause : undefined,
            ),
    }
  }
}

const unsupported = async () => ({
  ok: false as const,
  error: new FileError('not_supported', 'This operation is not available in the browser project.'),
})

export const createProjectEnv = (
  repository: ProjectRepository,
  readonlyFiles: Readonly<Record<string, string>> = {},
): ExecutionEnv => {
  const readonlyModified = new Map(Object.keys(readonlyFiles).map(path => [path, Date.now()]))
  const info = (path: string): FileInfo => {
    const relative = projectRelativePath(path)
    const file = repository.getFiles().find(item => item.path === relative)
    const readonly = Object.hasOwn(readonlyFiles, relative)
    const paths = [...repository.getFiles().map(item => item.path), ...Object.keys(readonlyFiles)]
    if (!file && !readonly && relative && !paths.some(key => key.startsWith(`${relative}/`)))
      throw new FileError('not_found', `Path not found: ${path}`, path)
    return {
      name: relative.split('/').at(-1) || 'project',
      path: relative ? `${root}/${relative}` : root,
      kind: file || readonly ? 'file' : 'directory',
      size:
        file?.size ?? (readonly ? new TextEncoder().encode(readonlyFiles[relative]).byteLength : 0),
      mtimeMs: file?.updatedAt ?? readonlyModified.get(relative) ?? 0,
    }
  }
  const read = async (path: string) => {
    if (info(path).kind !== 'file') throw new FileError('is_directory', `Not a file: ${path}`, path)
    const relative = projectRelativePath(path)
    return Object.hasOwn(readonlyFiles, relative)
      ? (readonlyFiles[relative] as string)
      : repository.readText(relative)
  }
  return {
    cwd: root,
    absolutePath: (path, signal) =>
      attempt(() => {
        const relative = projectRelativePath(path)
        return relative ? `${root}/${relative}` : root
      }, signal),
    canonicalPath: (path, signal) => attempt(() => info(path).path, signal),
    exists: (path, signal) =>
      attempt(() => {
        const relative = projectRelativePath(path)
        const paths = [
          ...repository.getFiles().map(item => item.path),
          ...Object.keys(readonlyFiles),
        ]
        return (
          !relative || paths.includes(relative) || paths.some(key => key.startsWith(`${relative}/`))
        )
      }, signal),
    fileInfo: (path, signal) => attempt(() => info(path), signal),
    readTextFile: (path, signal) => attempt(() => read(path), signal),
    readBinaryFile: (path, signal) =>
      attempt(async () => {
        const relative = projectRelativePath(path)
        if (Object.hasOwn(readonlyFiles, relative))
          return new TextEncoder().encode(readonlyFiles[relative])
        return new Uint8Array(await blobBytes(await repository.readBlob(relative)))
      }, signal),
    writeFile: (path, content, signal) =>
      attempt(() => {
        if (typeof content !== 'string')
          throw new FileError('not_supported', 'Only text files are supported.', path)
        const relative = projectRelativePath(path)
        if (Object.hasOwn(readonlyFiles, relative))
          throw new FileError('permission_denied', `Read-only file: ${path}`, path)
        return repository.writeText(relative, content)
      }, signal),
    joinPath: unsupported,
    readTextLines: unsupported,
    appendFile: unsupported,
    renameFile: unsupported,
    listDir: unsupported,
    createDir: unsupported,
    remove: unsupported,
    createTempDir: unsupported,
    createTempFile: unsupported,
    exec: async () => ({
      ok: false,
      error: new ExecutionError(
        'shell_unavailable',
        'No shell is available in the browser project.',
      ),
    }),
    cleanup: async () => {
      readonlyModified.clear()
    },
  }
}
