import {
  type ExecutionEnv,
  ExecutionError,
  FileError,
  type FileInfo,
} from '@earendil-works/pi-agent-core'
import { type ProjectStore, validateProjectPath } from '../project/store'

const root = '/project'

export const projectRelativePath = (path: string) => {
  if (path === '.' || path === root || path === `${root}/`) return ''
  const relative = path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path.replace(/^\.\//, '')
  validateProjectPath(relative)
  return relative
}

const attempt = async <T>(action: () => T, signal?: AbortSignal) => {
  try {
    if (signal?.aborted) throw new FileError('aborted', 'Operation aborted.')
    return { ok: true as const, value: action() }
  } catch (cause) {
    return {
      ok: false as const,
      error:
        cause instanceof FileError
          ? cause
          : new FileError(
              'unknown',
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

export const createProjectEnv = (project: ProjectStore): ExecutionEnv => {
  const modified = new Map(Object.keys(project.getSnapshot().files).map(path => [path, Date.now()]))
  const info = (path: string): FileInfo => {
    const relative = projectRelativePath(path)
    const files = project.getSnapshot().files
    const file = Object.hasOwn(files, relative)
    if (!file && relative && !Object.keys(files).some(key => key.startsWith(`${relative}/`)))
      throw new FileError('not_found', `Path not found: ${path}`, path)
    return {
      name: relative.split('/').at(-1) || 'project',
      path: relative ? `${root}/${relative}` : root,
      kind: file ? 'file' : 'directory',
      size: file ? new TextEncoder().encode(files[relative]).byteLength : 0,
      mtimeMs: modified.get(relative) ?? 0,
    }
  }
  const read = (path: string) => {
    if (info(path).kind !== 'file') throw new FileError('is_directory', `Not a file: ${path}`, path)
    return project.getSnapshot().files[projectRelativePath(path)] as string
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
        const files = project.getSnapshot().files
        return (
          !relative ||
          Object.hasOwn(files, relative) ||
          Object.keys(files).some(key => key.startsWith(`${relative}/`))
        )
      }, signal),
    fileInfo: (path, signal) => attempt(() => info(path), signal),
    readTextFile: (path, signal) => attempt(() => read(path), signal),
    readBinaryFile: (path, signal) => attempt(() => new TextEncoder().encode(read(path)), signal),
    writeFile: (path, content, signal) =>
      attempt(() => {
        if (typeof content !== 'string')
          throw new FileError('not_supported', 'Only text files are supported.', path)
        const relative = projectRelativePath(path)
        project.writeFile(relative, content)
        modified.set(relative, Date.now())
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
      modified.clear()
    },
  }
}
