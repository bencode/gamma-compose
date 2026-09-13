import type { useSessions } from './use-sessions'

type SessionPersistenceStatusProps = {
  sessions: ReturnType<typeof useSessions>
  running: boolean
}

export const SessionPersistenceStatus = ({ sessions, running }: SessionPersistenceStatusProps) => {
  if (sessions.saveError)
    return (
      <button
        type="button"
        className="persistence-status persistence-status-error"
        title={sessions.saveError}
        disabled={running || sessions.saving}
        onClick={() => void sessions.retrySave()}
      >
        Chat save failed · Retry
      </button>
    )
  if (sessions.error && !sessions.loaded)
    return (
      <button
        type="button"
        className="persistence-status persistence-status-error"
        title={sessions.error}
        disabled={sessions.busy}
        onClick={sessions.retryLoad}
      >
        Chat load failed · Retry
      </button>
    )
  if (sessions.saving)
    return (
      <span className="persistence-status" role="status">
        Saving chat…
      </span>
    )
  return null
}
