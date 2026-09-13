export type ProjectSaveStatus = 'saving' | 'saved' | 'error'

type ProjectPersistenceStatusProps = {
  status: ProjectSaveStatus
  error?: string
  onRetry: () => void
}

export const ProjectPersistenceStatus = ({
  status,
  error,
  onRetry,
}: ProjectPersistenceStatusProps) => {
  if (status === 'error')
    return (
      <button
        type="button"
        className="persistence-status persistence-status-error"
        title={error}
        aria-label="Save failed. Retry save"
        onClick={onRetry}
      >
        <span className="persistence-error-prefix">Save failed · </span>Retry
      </button>
    )
  if (status === 'saving')
    return (
      <span className="persistence-status" role="status">
        Saving…
      </span>
    )
  return null
}
