import { Paperclip, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ProjectRepository } from '../../core/project/repository'
import type { RepositoryFile } from '../../core/project/repository-files'
import { RepositoryPreview } from './repository-preview'

type RepositoryBrowserProps = {
  repository: ProjectRepository
  files: readonly RepositoryFile[]
  selectedPath: string
  expandedDirectories: readonly string[]
  onSelectFile: (path: string) => void
  onToggleDirectory: (path: string) => void
  onAttach: (path: string) => void
  onDelete: (path: string) => Promise<void>
}

type DirectoryEntriesProps = RepositoryBrowserProps & {
  directory?: string
  pendingDeletePath?: string
  deletingPath?: string
  onRequestDelete: (path: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (path: string) => void
}

const FileActions = ({
  path,
  pendingDeletePath,
  deletingPath,
  onAttach,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: Pick<
  DirectoryEntriesProps,
  | 'pendingDeletePath'
  | 'deletingPath'
  | 'onAttach'
  | 'onRequestDelete'
  | 'onCancelDelete'
  | 'onConfirmDelete'
> & { path: string }) => {
  const confirming = pendingDeletePath === path
  const deleting = deletingPath === path
  if (confirming)
    return (
      <div className="file-entry-actions file-entry-confirmation">
        <button
          type="button"
          className="file-confirm-delete"
          aria-label={`Confirm delete ${path}`}
          disabled={deleting}
          onClick={() => onConfirmDelete(path)}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          className="file-cancel-delete"
          aria-label={`Cancel deleting ${path}`}
          disabled={deleting}
          onClick={onCancelDelete}
        >
          Cancel
        </button>
      </div>
    )
  return (
    <div className="file-entry-actions">
      <button
        type="button"
        className="file-entry-action"
        aria-label={`Attach ${path} to message`}
        title="Attach to message"
        onClick={() => onAttach(path)}
      >
        <Paperclip aria-hidden="true" size={13} />
      </button>
      {path.startsWith('attachments/') && (
        <button
          type="button"
          className="file-entry-action file-entry-delete"
          aria-label={`Delete ${path}`}
          title="Delete"
          onClick={() => onRequestDelete(path)}
        >
          <Trash2 aria-hidden="true" size={13} />
        </button>
      )}
    </div>
  )
}

const DirectoryEntries = ({ directory = '', ...props }: DirectoryEntriesProps) => {
  const entries = [
    ...new Set(
      props.files
        .map(file => file.path)
        .filter(path => path.startsWith(directory))
        .map(path => path.slice(directory.length).split('/')[0])
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort((left, right) => {
    const leftDirectory = props.files.some(file => file.path.startsWith(`${directory}${left}/`))
    const rightDirectory = props.files.some(file => file.path.startsWith(`${directory}${right}/`))
    return leftDirectory === rightDirectory ? left.localeCompare(right) : leftDirectory ? -1 : 1
  })

  return (
    <ul className="file-list">
      {entries.map(name => {
        const path = directory + name
        const isDirectory = props.files.some(file => file.path.startsWith(`${path}/`))
        const isExpanded = props.expandedDirectories.includes(path)
        const current = !isDirectory && props.selectedPath === path
        return (
          <li key={path}>
            <div
              className="file-entry-row"
              data-current={current || undefined}
              data-confirming={props.pendingDeletePath === path || undefined}
            >
              <button
                className="file-entry"
                type="button"
                aria-expanded={isDirectory ? isExpanded : undefined}
                aria-current={current ? 'true' : undefined}
                onClick={() =>
                  isDirectory ? props.onToggleDirectory(path) : props.onSelectFile(path)
                }
              >
                <span className="file-symbol" aria-hidden="true">
                  {isDirectory ? (isExpanded ? '⌄' : '›') : '·'}
                </span>
                <span className="file-name">{name}</span>
              </button>
              {!isDirectory && <FileActions {...props} path={path} />}
            </div>
            {isDirectory && isExpanded && <DirectoryEntries {...props} directory={`${path}/`} />}
          </li>
        )
      })}
    </ul>
  )
}

export const RepositoryBrowser = (props: RepositoryBrowserProps) => {
  const [pendingDeletePath, setPendingDeletePath] = useState<string>()
  const [deletingPath, setDeletingPath] = useState<string>()
  const [deleteError, setDeleteError] = useState<string>()

  const confirmDelete = async (path: string) => {
    setDeletingPath(path)
    setDeleteError(undefined)
    try {
      await props.onDelete(path)
      setPendingDeletePath(undefined)
    } catch (error) {
      console.error(`Could not delete repository file: ${path}`, error)
      setDeleteError(error instanceof Error ? error.message : 'Could not delete this file.')
    } finally {
      setDeletingPath(undefined)
    }
  }

  return (
    <section className="file-browser" aria-label="Repository browser">
      <nav className="file-navigation" aria-label="Repository files">
        <h2 className="file-navigation-title">Repository</h2>
        <DirectoryEntries
          {...props}
          pendingDeletePath={pendingDeletePath}
          deletingPath={deletingPath}
          onRequestDelete={path => {
            setDeleteError(undefined)
            setPendingDeletePath(path)
          }}
          onCancelDelete={() => setPendingDeletePath(undefined)}
          onConfirmDelete={path => void confirmDelete(path)}
        />
        {deleteError && (
          <p className="file-action-error" role="alert">
            {deleteError}
          </p>
        )}
      </nav>
      <RepositoryPreview
        repository={props.repository}
        file={props.files.find(file => file.path === props.selectedPath)}
      />
    </section>
  )
}
