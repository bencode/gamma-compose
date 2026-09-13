export type ProjectSnapshot = {
  entry: string
  files: Readonly<Record<string, string>>
}

export type ProjectStore = {
  getSnapshot: () => ProjectSnapshot
  subscribe: (listener: () => void) => () => void
  writeFile: (path: string, content: string) => void
  removeFile: (path: string) => void
}

const maxProjectFiles = 1_024
const maxProjectBytes = 16 * 1024 * 1024

export const validateProjectPath = (path: string) => {
  if (
    !path ||
    /[\\:?#]/.test(path) ||
    [...path].some(character => character.charCodeAt(0) < 32) ||
    path.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error('Use a canonical project-relative path without parent traversal.')
  }
}

const validateSnapshot = (snapshot: ProjectSnapshot) => {
  const paths = Object.keys(snapshot.files)
  validateProjectPath(snapshot.entry)
  paths.forEach(validateProjectPath)
  if (!Object.hasOwn(snapshot.files, snapshot.entry) || !/\.(tsx?|jsx?)$/.test(snapshot.entry))
    throw new Error('The project entry must be an existing JavaScript or TypeScript file.')
  if (!paths.length || paths.length > maxProjectFiles)
    throw new Error(`The project allows 1 to ${maxProjectFiles} files.`)
  if (paths.some(path => paths.some(other => other.startsWith(`${path}/`))))
    throw new Error('A file cannot also be a directory.')
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > maxProjectBytes)
    throw new Error('The serialized project must not exceed 16 MiB.')
}

export const createProjectStore = (initial: ProjectSnapshot): ProjectStore => {
  validateSnapshot(initial)
  let snapshot: ProjectSnapshot = Object.freeze({
    entry: initial.entry,
    files: Object.freeze({ ...initial.files }),
  })
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    writeFile: (path, content) => {
      validateProjectPath(path)
      if (Object.hasOwn(snapshot.files, path) && snapshot.files[path] === content) return
      const next = { entry: snapshot.entry, files: { ...snapshot.files, [path]: content } }
      validateSnapshot(next)
      snapshot = Object.freeze({ ...next, files: Object.freeze(next.files) })
      listeners.forEach(notify => {
        notify()
      })
    },
    removeFile: path => {
      validateProjectPath(path)
      if (!Object.hasOwn(snapshot.files, path)) return
      if (path === snapshot.entry) throw new Error('The project entry cannot be removed.')
      const files = Object.fromEntries(
        Object.entries(snapshot.files).filter(([current]) => current !== path),
      )
      const next = { entry: snapshot.entry, files }
      validateSnapshot(next)
      snapshot = Object.freeze({ ...next, files: Object.freeze(files) })
      listeners.forEach(notify => {
        notify()
      })
    },
  }
}
