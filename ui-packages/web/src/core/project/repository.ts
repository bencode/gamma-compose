import type { ProjectDatabase } from './database'
import {
  decodeUtf8,
  hasBrowserCapacity,
  type ImportResult,
  planRepositoryImport,
  type RepositoryFile,
  repositoryFileKind,
  type StoredFileMetadata,
  storedFileContentId,
} from './repository-files'
import { type ProjectStore, validateProjectPath } from './store'

export class RepositoryError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_supported' | 'invalid_content',
    message: string,
  ) {
    super(message)
    this.name = 'RepositoryError'
  }
}

export type ProjectRepository = {
  getFiles: () => readonly RepositoryFile[]
  subscribe: (listener: () => void) => () => void
  readText: (path: string) => Promise<string>
  readBlob: (path: string) => Promise<Blob>
  writeText: (path: string, content: string) => Promise<void>
  copyFile: (options: { source: string; destination: string; overwrite?: boolean }) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  importFiles: (files: readonly File[], duplicateMode: 'replace' | 'keep') => Promise<ImportResult>
  dispose: () => void
}

const decodeMarkdown = async (blob: Blob) => {
  try {
    return await decodeUtf8(blob)
  } catch (cause) {
    throw new RepositoryError(
      'invalid_content',
      cause instanceof Error
        ? `Markdown must be valid UTF-8: ${cause.message}`
        : 'Markdown must be valid UTF-8.',
    )
  }
}

export const createProjectRepository = (
  projectId: string,
  project: ProjectStore,
  database: Pick<ProjectDatabase, 'getStoredFileContent' | 'saveStoredFiles'> &
    Partial<Pick<ProjectDatabase, 'deleteStoredFile' | 'saveStoredFileMetadata'>>,
  storedFiles: readonly StoredFileMetadata[],
): ProjectRepository => {
  const stored = new Map(storedFiles.map(file => [file.path, file]))
  const sourceModified = new Map(
    Object.keys(project.getSnapshot().files).map(path => [path, Date.now()]),
  )
  const listeners = new Set<() => void>()
  let files: readonly RepositoryFile[] = []

  const rebuild = () => {
    const source = Object.entries(project.getSnapshot().files).map(([path, content]) => ({
      path,
      kind: repositoryFileKind(path),
      mediaType: repositoryFileKind(path) === 'markdown' ? 'text/markdown' : 'text/plain',
      size: new TextEncoder().encode(content).byteLength,
      updatedAt: sourceModified.get(path) ?? 0,
    }))
    const persisted = [...stored.values()].map(file => ({
      path: file.path,
      kind: repositoryFileKind(file.path, file.mediaType),
      mediaType: file.mediaType,
      size: file.size,
      updatedAt: file.updatedAt,
    }))
    files = [...source, ...persisted]
      .filter((file, index, all) => all.findIndex(item => item.path === file.path) === index)
      .sort((left, right) => left.path.localeCompare(right.path))
    listeners.forEach(listener => {
      listener()
    })
  }

  rebuild()
  const unsubscribeProject = project.subscribe(() => {
    Object.keys(project.getSnapshot().files).forEach(path => {
      if (!sourceModified.has(path)) sourceModified.set(path, Date.now())
    })
    rebuild()
  })

  const storedBlob = async (path: string) => {
    const metadata = stored.get(path)
    if (!metadata) throw new RepositoryError('not_found', `File not found: ${path}`)
    const blob = await database.getStoredFileContent(storedFileContentId(metadata))
    if (!blob) throw new RepositoryError('not_found', `Stored file content is missing: ${path}`)
    return blob
  }

  const readText = async (path: string) => {
    const source = project.getSnapshot().files[path]
    if (source !== undefined) return source
    const metadata = stored.get(path)
    if (!metadata) throw new RepositoryError('not_found', `File not found: ${path}`)
    if (repositoryFileKind(path, metadata.mediaType) === 'image')
      throw new RepositoryError(
        'not_supported',
        `Image files are not readable as text: ${path}. Use analyze_image instead.`,
      )
    return decodeMarkdown(await storedBlob(path))
  }

  const writeText = async (path: string, content: string) => {
    validateProjectPath(path)
    const metadata = stored.get(path)
    if (!metadata) {
      project.writeFile(path, content)
      sourceModified.set(path, Date.now())
      return
    }
    if (repositoryFileKind(path, metadata.mediaType) === 'image')
      throw new RepositoryError('not_supported', `Cannot edit an image with a text tool: ${path}`)
    const blob = new Blob([content], { type: 'text/markdown' })
    const next = {
      ...metadata,
      mediaType: blob.type,
      size: blob.size,
      updatedAt: Date.now(),
      revision: metadata.revision + 1,
    }
    await database.saveStoredFiles([{ metadata: next, blob }])
    stored.set(path, next)
    rebuild()
  }

  const deleteFile = async (path: string) => {
    validateProjectPath(path)
    if (!path.startsWith('attachments/'))
      throw new RepositoryError(
        'not_supported',
        'Only files in the attachments directory can be deleted here.',
      )
    const snapshot = project.getSnapshot()
    const sourceExists = Object.hasOwn(snapshot.files, path)
    const metadata = stored.get(path)
    if (!sourceExists && !metadata)
      throw new RepositoryError('not_found', `File not found: ${path}`)
    if (path === snapshot.entry)
      throw new RepositoryError('not_supported', 'The project entry cannot be deleted.')
    if (metadata) {
      if (!database.deleteStoredFile)
        throw new RepositoryError('not_supported', 'Deleting stored files is not available.')
      const contentId = storedFileContentId(metadata)
      const shared = [...stored.values()].some(
        file => file.id !== metadata.id && storedFileContentId(file) === contentId,
      )
      await database.deleteStoredFile(metadata.id, shared ? null : contentId)
    }
    if (sourceExists) project.removeFile(path)
    stored.delete(path)
    sourceModified.delete(path)
    rebuild()
  }

  const importFiles = async (
    selected: readonly File[],
    duplicateMode: 'replace' | 'keep',
  ): Promise<ImportResult> => {
    const plan = await planRepositoryImport({
      selected,
      duplicateMode,
      files,
      storedFiles: [...stored.values()],
      projectId,
    })
    const storageRejections = () =>
      plan.writes.map(write => ({
        name: write.metadata.path,
        reason: 'storage-unavailable' as const,
      }))
    if (!(await hasBrowserCapacity(plan.addedBytes)))
      return {
        imported: [],
        rejected: [...plan.rejected, ...storageRejections()],
      }
    const plannedStored = new Map(stored)
    plan.writes.forEach(({ metadata }) => {
      plannedStored.set(metadata.path, metadata)
    })
    const replacedContentIds = plan.writes.flatMap(({ metadata }) => {
      const previous = stored.get(metadata.path)
      if (!previous) return []
      const contentId = storedFileContentId(previous)
      return [...plannedStored.values()].some(file => storedFileContentId(file) === contentId)
        ? []
        : [contentId]
    })
    try {
      await database.saveStoredFiles(plan.writes, replacedContentIds)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError')
        return {
          imported: [],
          rejected: [...plan.rejected, ...storageRejections()],
        }
      throw error
    }
    plan.writes.forEach(({ metadata }) => {
      if (Object.hasOwn(project.getSnapshot().files, metadata.path))
        project.removeFile(metadata.path)
      stored.set(metadata.path, metadata)
    })
    rebuild()
    void navigator.storage?.persist?.().catch(error => {
      console.error('Could not request persistent browser storage.', error)
    })
    return {
      imported: plan.writes.map(({ metadata }) => ({
        path: metadata.path,
        kind: repositoryFileKind(metadata.path, metadata.mediaType),
        mediaType: metadata.mediaType,
        size: metadata.size,
        updatedAt: metadata.updatedAt,
      })),
      rejected: plan.rejected,
    }
  }

  const copyFile = async ({
    source,
    destination,
    overwrite = false,
  }: {
    source: string
    destination: string
    overwrite?: boolean
  }) => {
    validateProjectPath(source)
    validateProjectPath(destination)
    if (source === destination)
      throw new RepositoryError('not_supported', 'Source and destination must be different files.')
    const sourceFile = files.find(file => file.path === source)
    if (!sourceFile) throw new RepositoryError('not_found', `File not found: ${source}`)
    const destinationFile = files.find(file => file.path === destination)
    if (destinationFile && !overwrite)
      throw new RepositoryError('not_supported', `File already exists: ${destination}`)
    if (files.some(file => file.path.startsWith(`${destination}/`)))
      throw new RepositoryError('not_supported', `Destination is a directory: ${destination}`)
    const parentFile = files.find(file => destination.startsWith(`${file.path}/`))
    if (parentFile)
      throw new RepositoryError('not_supported', `Destination parent is a file: ${parentFile.path}`)
    const destinationIsImage = repositoryFileKind(destination) === 'image'
    if ((sourceFile.kind === 'image') !== destinationIsImage)
      throw new RepositoryError(
        'not_supported',
        'Image files must be copied to an image path, and text files to a text path.',
      )

    const targetMetadata = stored.get(destination)
    if (sourceFile.kind !== 'image') {
      const content = await readText(source)
      if (!targetMetadata) {
        project.writeFile(destination, content)
        sourceModified.set(destination, Date.now())
        return
      }
      const oldContentId = storedFileContentId(targetMetadata)
      const contentId = crypto.randomUUID()
      const next: StoredFileMetadata = {
        ...targetMetadata,
        contentId,
        mediaType: repositoryFileKind(destination) === 'markdown' ? 'text/markdown' : 'text/plain',
        size: new TextEncoder().encode(content).byteLength,
        updatedAt: Date.now(),
        revision: targetMetadata.revision + 1,
      }
      const shared = [...stored.values()].some(
        file => file.id !== targetMetadata.id && storedFileContentId(file) === oldContentId,
      )
      await database.saveStoredFiles(
        [{ metadata: next, blob: new Blob([content], { type: next.mediaType }) }],
        shared ? [] : [oldContentId],
      )
      stored.set(destination, next)
      rebuild()
      return
    }

    const sourceMetadata = stored.get(source)
    if (!sourceMetadata)
      throw new RepositoryError('not_supported', `Image content is unavailable: ${source}`)
    if (!database.saveStoredFileMetadata)
      throw new RepositoryError('not_supported', 'Copying stored files is not available.')
    const now = Date.now()
    const next: StoredFileMetadata = {
      id: targetMetadata?.id ?? crypto.randomUUID(),
      contentId: storedFileContentId(sourceMetadata),
      projectId,
      path: destination,
      mediaType: sourceMetadata.mediaType,
      size: sourceMetadata.size,
      createdAt: targetMetadata?.createdAt ?? now,
      updatedAt: now,
      revision: (targetMetadata?.revision ?? 0) + 1,
    }
    const oldContentId = targetMetadata ? storedFileContentId(targetMetadata) : undefined
    const shared = oldContentId
      ? [...stored.values()].some(
          file => file.id !== targetMetadata?.id && storedFileContentId(file) === oldContentId,
        )
      : true
    await database.saveStoredFileMetadata(
      next,
      oldContentId && oldContentId !== next.contentId && !shared ? [oldContentId] : [],
    )
    if (Object.hasOwn(project.getSnapshot().files, destination)) project.removeFile(destination)
    stored.set(destination, next)
    sourceModified.delete(destination)
    rebuild()
  }

  return {
    getFiles: () => files,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    readText,
    readBlob: async path => {
      const source = project.getSnapshot().files[path]
      return source === undefined
        ? storedBlob(path)
        : new Blob([source], {
            type: repositoryFileKind(path) === 'markdown' ? 'text/markdown' : 'text/plain',
          })
    },
    writeText,
    copyFile,
    deleteFile,
    importFiles,
    dispose: unsubscribeProject,
  }
}
