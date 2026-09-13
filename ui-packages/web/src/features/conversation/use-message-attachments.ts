import { useState, useSyncExternalStore } from 'react'
import type { ProjectRepository } from '../../core/project/repository'

const rejectionText = {
  'unsupported-type': 'Only Markdown, PNG, JPEG, WebP, and GIF files are supported.',
  'file-too-large': 'One or more files exceed the upload size limit.',
  'repository-full': 'This project has reached its 50 MB upload limit.',
  'storage-unavailable': 'There is not enough browser storage for these files.',
} as const

const genericClipboardImage = /^image\.(png|jpe?g|webp|gif)$/i

export const prepareClipboardFiles = (files: readonly File[]) =>
  files.map(file => {
    if (!genericClipboardImage.test(file.name)) return file
    const extension = file.name.split('.').at(-1)?.toLowerCase() ?? 'png'
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 6)
    return new File([file], `image-${suffix}.${extension}`, {
      type: file.type,
      lastModified: file.lastModified,
    })
  })

export type MessageAttachments = ReturnType<typeof useMessageAttachments>

export const useMessageAttachments = (repository: ProjectRepository) => {
  const files = useSyncExternalStore(repository.subscribe, repository.getFiles)
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([])
  const [notice, setNotice] = useState<string>()

  const attachPaths = (paths: readonly string[]) =>
    setSelectedPaths(current => [...new Set([...current, ...paths])])

  const selectFiles = async (
    selected: readonly File[],
    source: 'files' | 'clipboard' = 'files',
  ) => {
    if (!selected.length) return
    setNotice(undefined)
    try {
      const prepared = source === 'clipboard' ? prepareClipboardFiles(selected) : selected
      const result = await repository.importFiles(prepared, 'keep')
      attachPaths(result.imported.map(file => file.path))
      if (result.rejected.length)
        setNotice([...new Set(result.rejected.map(item => rejectionText[item.reason]))].join(' '))
    } catch (error) {
      console.error('Could not import repository files.', error)
      setNotice(error instanceof Error ? error.message : 'Could not import these files.')
    }
  }

  const selectedFiles = selectedPaths.flatMap(path => {
    const file = files.find(item => item.path === path)
    return file ? [file] : []
  })

  return {
    files,
    selectedFiles,
    selectedPaths,
    notice,
    selectFiles,
    attachPaths,
    detachPath: (path: string) =>
      setSelectedPaths(current => current.filter(item => item !== path)),
    clearSelection: () => setSelectedPaths([]),
  }
}
