import { useEffect, useRef } from 'react'
import type { Project } from '../../core/project/records'

type DeleteProjectDialogProps = {
  project?: Project
  deleting: boolean
  error?: string
  onCancel: () => void
  onConfirm: (project: Project) => Promise<void>
}

export const DeleteProjectDialog = ({
  project,
  deleting,
  error,
  onCancel,
  onConfirm,
}: DeleteProjectDialogProps) => {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | undefined>(undefined)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (project && !element.open) {
      returnFocus.current = (document.activeElement as HTMLElement | null) ?? undefined
      element.showModal()
      cancel.current?.focus()
    }
    if (!project && element.open) element.close()
  }, [project])

  return (
    <dialog
      ref={dialog}
      aria-labelledby="delete-project-title"
      aria-describedby="delete-project-description"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-0 text-ink backdrop:bg-ink/30"
      onCancel={event => {
        if (deleting) event.preventDefault()
        else onCancel()
      }}
      onClose={() => {
        if (project && !deleting) onCancel()
        returnFocus.current?.focus()
      }}
    >
      <div className="p-6">
        <h2 id="delete-project-title" className="text-lg font-semibold">
          Delete project?
        </h2>
        <p id="delete-project-description" className="mt-3 text-sm leading-relaxed text-muted">
          “{project?.name}” and its local files, chats, app data, and preview state will be
          permanently deleted from this browser.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-syntax-invalid [overflow-wrap:anywhere]">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancel}
            type="button"
            disabled={deleting}
            className="rounded-md px-3 py-2 text-sm hover:bg-workspace disabled:opacity-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting || !project}
            className="rounded-md px-3 py-2 text-sm font-medium text-syntax-invalid hover:bg-workspace disabled:opacity-50"
            onClick={() => {
              if (project) void onConfirm(project)
            }}
          >
            {deleting ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
