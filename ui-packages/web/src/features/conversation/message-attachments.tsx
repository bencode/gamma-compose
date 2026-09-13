import { FileText, Image as ImageIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ProjectRepository } from '../../core/project/repository'
import { formatBytes, type RepositoryFile } from '../../core/project/repository-files'

const useImageUrl = (repository: ProjectRepository, file: RepositoryFile) => {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (file.kind !== 'image') return
    let active = true
    let objectUrl: string | undefined
    void repository
      .readBlob(file.path)
      .then(blob => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(error => {
        console.error(`Could not load attachment preview: ${file.path}`, error)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, repository])
  return url
}

const AttachmentIcon = ({
  repository,
  file,
}: {
  repository: ProjectRepository
  file: RepositoryFile
}) => {
  const imageUrl = useImageUrl(repository, file)
  if (imageUrl) return <img className="message-attachment-thumbnail" src={imageUrl} alt="" />
  return file.kind === 'image' ? (
    <ImageIcon aria-hidden="true" size={15} />
  ) : (
    <FileText aria-hidden="true" size={15} />
  )
}

type MessageAttachmentsProps = {
  repository: ProjectRepository
  files: readonly RepositoryFile[]
  onOpen?: (path: string) => void
  onRemove?: (path: string) => void
}

export const MessageAttachmentList = ({
  repository,
  files,
  onOpen,
  onRemove,
}: MessageAttachmentsProps) => {
  if (!files.length) return null
  return (
    <ul className="message-attachments" aria-label="Attachments">
      {files.map(file => (
        <li className="message-attachment-item" key={file.path}>
          <button
            type="button"
            className="message-attachment"
            title={file.path}
            onClick={() => onOpen?.(file.path)}
            disabled={!onOpen}
          >
            <AttachmentIcon repository={repository} file={file} />
            <span className="message-attachment-copy">
              <span>{file.path.split('/').at(-1)}</span>
              <small>{formatBytes(file.size)}</small>
            </span>
          </button>
          {onRemove && (
            <button
              type="button"
              className="message-attachment-remove"
              aria-label={`Remove ${file.path.split('/').at(-1)}`}
              onClick={() => onRemove(file.path)}
            >
              <X aria-hidden="true" size={13} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
