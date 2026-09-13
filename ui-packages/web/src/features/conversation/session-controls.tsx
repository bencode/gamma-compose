import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ChatSessionMetadata } from '../../core/session/records'
import type { useSessions } from './use-sessions'

type Sessions = ReturnType<typeof useSessions>
type SessionControlsProps = { sessions: Sessions; running: boolean }

const positionPopover = (anchor: HTMLElement, panel: HTMLElement) => {
  const bounds = anchor.getBoundingClientRect()
  const width = Math.min(320, window.innerWidth - 16)
  const top = bounds.bottom + 8
  Object.assign(panel.style, {
    width: `${width}px`,
    left: `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`,
    top: `${top}px`,
    maxHeight: `${Math.max(0, Math.min(420, window.innerHeight - top - 8))}px`,
  })
}

export const SessionControls = ({ sessions, running }: SessionControlsProps) => {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState<ChatSessionMetadata>()
  const disabled =
    running || sessions.busy || sessions.saving || !sessions.loaded || Boolean(sessions.saveError)
  const hasError = Boolean(sessions.error || sessions.saveError)

  useEffect(() => {
    if (deleting) cancelDelete.current?.focus()
  }, [deleting])

  useEffect(() => {
    if (!open) return
    const reposition = () => {
      if (trigger.current && panel.current) positionPopover(trigger.current, panel.current)
    }
    reposition()
    const observer = new ResizeObserver(reposition)
    const header = trigger.current?.closest('header')
    if (header) observer.observe(header)
    window.addEventListener('resize', reposition)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const closeAfter = async (operation: () => Promise<boolean>) => {
    if (!(await operation()) || !panel.current?.isConnected) return
    panel.current.hidePopover()
    requestAnimationFrame(() => document.getElementById('draft')?.focus())
  }

  const finishDeleting = () => {
    setDeleting(undefined)
    requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLButtonElement>('[data-new-chat]')?.focus(),
    )
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Chats"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        title={hasError ? 'Chats — storage error' : 'Chats'}
        popoverTarget={id}
        className="relative flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-workspace hover:text-accent aria-expanded:bg-workspace aria-expanded:text-accent"
      >
        <MessageSquare aria-hidden="true" size={16} />
        {hasError && (
          <span
            className="absolute -top-1 -right-1 text-[11px] font-semibold text-syntax-invalid"
            aria-hidden="true"
          >
            !
          </span>
        )}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Chats"
        className="fixed m-0 overflow-auto overscroll-contain rounded-lg border border-line bg-panel p-2 text-xs text-ink"
        onBeforeToggle={event => {
          if (event.newState === 'open' && trigger.current && panel.current)
            positionPopover(trigger.current, panel.current)
        }}
        onToggle={event => {
          const isOpen = event.newState === 'open'
          setOpen(isOpen)
          if (isOpen) {
            const selected =
              panel.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')
            const first = panel.current?.querySelector<HTMLButtonElement>('[data-new-chat]')
            const focusTarget = selected && !selected.disabled ? selected : first
            focusTarget?.focus()
          } else {
            setDeleting(undefined)
            if (panel.current?.contains(document.activeElement)) trigger.current?.focus()
          }
        }}
      >
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <h2 className="font-semibold">Chats</h2>
          <button
            type="button"
            data-new-chat
            disabled={disabled || Boolean(deleting)}
            className="flex items-center gap-1 rounded px-2 py-2 text-accent hover:bg-workspace disabled:text-muted"
            onClick={() => void closeAfter(sessions.create)}
          >
            <Plus aria-hidden="true" size={14} /> New chat
          </button>
        </div>
        {!sessions.summaries.length && sessions.loaded && (
          <p className="px-2 py-3 text-muted">No saved chats yet.</p>
        )}
        <ul aria-label="Chat sessions" className="space-y-1">
          {sessions.summaries.map(session => (
            <li
              key={session.id}
              className="flex min-w-0 items-center gap-1 rounded hover:bg-workspace"
            >
              <button
                type="button"
                aria-current={session.id === sessions.activeId ? 'true' : undefined}
                title={session.title}
                disabled={disabled || Boolean(deleting)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-2.5 text-left aria-current:bg-workspace aria-current:text-accent disabled:text-muted"
                onClick={() => void closeAfter(() => sessions.select(session.id))}
              >
                <span className="w-2 shrink-0" aria-hidden="true">
                  {session.id === sessions.activeId ? '•' : ''}
                </span>
                <span className="truncate">{session.title}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete chat: ${session.title}`}
                disabled={disabled || Boolean(deleting)}
                className="shrink-0 rounded p-2.5 text-muted hover:text-syntax-invalid disabled:opacity-50"
                onClick={() => setDeleting(session)}
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </li>
          ))}
        </ul>
        {deleting && (
          <div className="mt-2 border-t border-line px-2 pt-3 [overflow-wrap:anywhere]">
            <p>Delete “{deleting.title}”?</p>
            <p className="mt-1 text-muted">Project files will not change.</p>
            <div className="mt-2 flex justify-end gap-3">
              <button
                ref={cancelDelete}
                type="button"
                className="px-2 py-2"
                onClick={finishDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-2 py-2 text-syntax-invalid disabled:text-muted"
                disabled={disabled}
                onClick={async () => {
                  if (await sessions.remove(deleting.id)) finishDeleting()
                }}
              >
                Delete chat
              </button>
            </div>
          </div>
        )}
        {running && <p className="px-2 pt-2 text-muted">Stop generation to manage chats.</p>}
        {!sessions.loaded && !sessions.error && (
          <p className="px-2 py-2 text-muted">Loading chats…</p>
        )}
        {sessions.error && (
          <p role="alert" className="px-2 py-2 text-syntax-invalid [overflow-wrap:anywhere]">
            {sessions.error}
          </p>
        )}
      </div>
    </>
  )
}
