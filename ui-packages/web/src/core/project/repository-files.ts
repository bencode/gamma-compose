export const maximumImageBytes = 10 * 1024 * 1024
export const maximumMarkdownBytes = 1024 * 1024
export const maximumRepositoryUploadBytes = 50 * 1024 * 1024

export type RepositoryFileKind = 'text' | 'markdown' | 'image'

export type StoredFileMetadata = {
  id: string
  contentId?: string
  projectId: string
  path: string
  mediaType: string
  size: number
  createdAt: number
  updatedAt: number
  revision: number
}

export type StoredFileContent = {
  id: string
  blob: Blob
}

export type RepositoryFile = {
  path: string
  kind: RepositoryFileKind
  mediaType: string
  size: number
  updatedAt: number
}

export type ImportRejectionReason =
  | 'unsupported-type'
  | 'file-too-large'
  | 'repository-full'
  | 'storage-unavailable'

export type ImportResult = {
  imported: RepositoryFile[]
  rejected: Array<{ name: string; reason: ImportRejectionReason }>
}

export type PlannedRepositoryImport = {
  writes: Array<{ metadata: StoredFileMetadata; blob: Blob }>
  rejected: ImportResult['rejected']
  addedBytes: number
}

export const storedFileContentId = (metadata: StoredFileMetadata) =>
  metadata.contentId ?? metadata.id

const imageMediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const imageMediaTypeByExtension: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

const extensionOf = (path: string) => path.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''

export const repositoryFileKind = (path: string, mediaType = ''): RepositoryFileKind => {
  const extension = extensionOf(path)
  if (extension === 'md' || extension === 'markdown' || mediaType === 'text/markdown')
    return 'markdown'
  if (imageExtensions.has(extension) || imageMediaTypes.has(mediaType)) return 'image'
  return 'text'
}

export const acceptedUpload = (file: File) => {
  const kind = repositoryFileKind(file.name, file.type)
  if (kind === 'markdown')
    return { kind, mediaType: 'text/markdown', maximumBytes: maximumMarkdownBytes } as const
  if (kind === 'image' && (imageMediaTypes.has(file.type) || !file.type))
    return {
      kind,
      mediaType: file.type || imageMediaTypeByExtension[extensionOf(file.name)] || 'image/png',
      maximumBytes: maximumImageBytes,
    } as const
  return undefined
}

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export const blobBytes = (blob: Blob): Promise<ArrayBuffer> => {
  if ('arrayBuffer' in blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read local file data.'))
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new Error('Could not read local file data.'))
    reader.readAsArrayBuffer(blob)
  })
}

export const attachmentPath = (name: string) => {
  const path = `attachments/${name}`
  validateProjectPath(path)
  return path
}

const nextPath = (requested: string, occupied: ReadonlySet<string>) => {
  const slash = requested.lastIndexOf('/')
  const directory = requested.slice(0, slash + 1)
  const name = requested.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  let number = 2
  let candidate = `${directory}${stem} (${number})${extension}`
  while (occupied.has(candidate)) {
    number += 1
    candidate = `${directory}${stem} (${number})${extension}`
  }
  return candidate
}

export const decodeUtf8 = async (blob: Blob) =>
  new TextDecoder('utf-8', { fatal: true }).decode(await blobBytes(blob))

export const hasBrowserCapacity = async (bytes: number) => {
  if (bytes <= 0 || !navigator.storage?.estimate) return true
  try {
    const estimate = await navigator.storage.estimate()
    return (
      estimate.quota === undefined ||
      estimate.usage === undefined ||
      estimate.quota - estimate.usage >= bytes
    )
  } catch (error) {
    console.error('Could not estimate browser storage capacity.', error)
    return true
  }
}

const uploadBytes = (files: readonly RepositoryFile[]) =>
  files
    .filter(file => file.path.startsWith('attachments/'))
    .reduce((total, file) => total + file.size, 0)

export const planRepositoryImport = async ({
  selected,
  duplicateMode,
  files,
  storedFiles,
  projectId,
}: {
  selected: readonly File[]
  duplicateMode: 'replace' | 'keep'
  files: readonly RepositoryFile[]
  storedFiles: readonly StoredFileMetadata[]
  projectId: string
}): Promise<PlannedRepositoryImport> => {
  const occupied = new Set(files.map(file => file.path))
  const stored = new Map(storedFiles.map(file => [file.path, file]))
  const writes = new Map<string, { metadata: StoredFileMetadata; blob: Blob }>()
  const rejected: ImportResult['rejected'] = []
  const plannedSizes = new Map(files.map(file => [file.path, file.size]))
  const originalBytes = uploadBytes(files)
  const physicalBytes = (items: Iterable<StoredFileMetadata>) => {
    const contents = [...items].reduce(
      (sizes, item) => sizes.set(storedFileContentId(item), item.size),
      new Map<string, number>(),
    )
    return [...contents.values()].reduce((total, size) => total + size, 0)
  }
  const originalPhysicalBytes = physicalBytes(stored.values())
  let totalBytes = originalBytes

  for (const file of selected) {
    const accepted = acceptedUpload(file)
    if (!accepted) {
      rejected.push({ name: file.name, reason: 'unsupported-type' })
      continue
    }
    if (file.size > accepted.maximumBytes) {
      rejected.push({ name: file.name, reason: 'file-too-large' })
      continue
    }
    try {
      if (accepted.kind === 'markdown') await decodeUtf8(file)
    } catch (error) {
      console.error(`Could not decode Markdown upload: ${file.name}`, error)
      rejected.push({ name: file.name, reason: 'unsupported-type' })
      continue
    }
    const requested = attachmentPath(file.name)
    const duplicate = occupied.has(requested)
    const path = duplicate && duplicateMode === 'keep' ? nextPath(requested, occupied) : requested
    const previous = duplicate && duplicateMode === 'replace' ? (plannedSizes.get(path) ?? 0) : 0
    if (totalBytes - previous + file.size > maximumRepositoryUploadBytes) {
      rejected.push({ name: file.name, reason: 'repository-full' })
      continue
    }
    const previousStored = stored.get(path)
    const now = Date.now()
    const metadata: StoredFileMetadata = {
      id: previousStored?.id ?? crypto.randomUUID(),
      contentId: crypto.randomUUID(),
      projectId,
      path,
      mediaType: accepted.mediaType,
      size: file.size,
      createdAt: previousStored?.createdAt ?? now,
      updatedAt: now,
      revision: (previousStored?.revision ?? 0) + 1,
    }
    totalBytes += file.size - previous
    occupied.add(path)
    plannedSizes.set(path, file.size)
    stored.set(path, metadata)
    writes.set(path, { metadata, blob: file.slice(0, file.size, accepted.mediaType) })
  }
  return {
    writes: [...writes.values()],
    rejected,
    addedBytes: Math.max(0, physicalBytes(stored.values()) - originalPhysicalBytes),
  }
}

import { validateProjectPath } from './store'
