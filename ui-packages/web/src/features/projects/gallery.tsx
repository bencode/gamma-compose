import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { openProjectDatabase, type ProjectDatabase } from '../../core/project/database'
import type { Project, Template } from '../../core/project/records'
import { DeleteProjectDialog } from './delete-project-dialog'
import { ProjectList } from './project-list'
import { TemplateList } from './template-list'

const GalleryContent = ({ onRetry }: { onRetry: () => void }) => {
  const navigate = useNavigate()
  const database = useRef<ProjectDatabase | undefined>(undefined)
  const creatingRef = useRef(false)
  const deletingRef = useRef(false)
  const [catalog, setCatalog] = useState<{ templates: Template[]; projects: Project[] }>()
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState<string>()
  const [pendingDelete, setPendingDelete] = useState<Project>()
  const [deleting, setDeleting] = useState<string>()
  const [deleteError, setDeleteError] = useState<string>()

  useEffect(() => {
    let active = true
    let connection: ProjectDatabase | undefined
    setError(undefined)
    setCatalog(undefined)
    const load = async () => {
      try {
        connection = await openProjectDatabase()
        if (!active) {
          connection.close()
          return
        }
        const [templates, projects] = await Promise.all([
          connection.listTemplates(),
          connection.listProjects(),
        ])
        if (active) {
          database.current = connection
          setCatalog({ templates, projects })
        }
      } catch (cause) {
        console.error('Could not load the gallery.', cause)
        if (active)
          setError(
            cause instanceof Error || cause instanceof DOMException
              ? cause.message
              : 'Could not load your local projects.',
          )
      }
    }
    void load()
    return () => {
      active = false
      database.current = undefined
      connection?.close()
    }
  }, [])

  const create = async (templateId: string) => {
    const connection = database.current
    if (!connection || creatingRef.current) return
    creatingRef.current = true
    setCreating(templateId)
    setError(undefined)
    try {
      const project = await connection.createProject(templateId)
      if (database.current === connection) navigate(`/projects/${project.id}`)
    } catch (cause) {
      console.error('Could not create the project.', cause)
      if (database.current === connection)
        setError(
          cause instanceof Error || cause instanceof DOMException
            ? cause.message
            : 'Could not create the project.',
        )
    } finally {
      creatingRef.current = false
      if (database.current === connection) setCreating(undefined)
    }
  }

  const deleteProject = async (project: Project) => {
    const connection = database.current
    if (!connection || deletingRef.current) return
    deletingRef.current = true
    setDeleting(project.id)
    setDeleteError(undefined)
    try {
      await connection.deleteProject(project.id)
      if (database.current === connection) {
        setCatalog(current =>
          current
            ? { ...current, projects: current.projects.filter(item => item.id !== project.id) }
            : current,
        )
        setPendingDelete(undefined)
      }
    } catch (cause) {
      console.error(`Could not delete project: ${project.id}`, cause)
      if (database.current === connection)
        setDeleteError(
          cause instanceof Error || cause instanceof DOMException
            ? cause.message
            : 'Could not delete this project.',
        )
    } finally {
      deletingRef.current = false
      if (database.current === connection) setDeleting(undefined)
    }
  }

  return (
    <div className="min-h-dvh bg-panel">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
          <span className="brand">
            Gamma Compose<span aria-hidden="true">.</span>
          </span>
          <span className="text-xs text-muted">Your browser. Your workspace.</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          What will you make?
        </h1>
        <p className="mt-3 max-w-xl text-base text-muted">
          Pick a starting point, then shape it through conversation.
        </p>
        {error && (
          <div
            role="alert"
            className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-line p-4 text-sm"
          >
            <p className="min-w-0 [overflow-wrap:anywhere]">{error}</p>
            {!catalog && (
              <button type="button" className="text-accent underline" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        )}
        {!catalog && !error && (
          <p role="status" className="mt-10 text-sm text-muted">
            Loading your workspace…
          </p>
        )}
        {catalog && (
          <>
            <TemplateList
              templates={catalog.templates}
              creating={creating}
              onCreate={templateId => void create(templateId)}
            />
            <ProjectList
              projects={catalog.projects}
              deleting={deleting}
              onDelete={project => {
                setDeleteError(undefined)
                setPendingDelete(project)
              }}
            />
          </>
        )}
        <p className="mt-10 text-xs leading-relaxed text-muted">
          Projects are saved in this browser, not in the cloud. Clearing site data removes them.
        </p>
      </main>
      <DeleteProjectDialog
        project={pendingDelete}
        deleting={deleting !== undefined}
        error={deleteError}
        onCancel={() => {
          setPendingDelete(undefined)
          setDeleteError(undefined)
        }}
        onConfirm={deleteProject}
      />
    </div>
  )
}

export const Gallery = () => {
  const [attempt, setAttempt] = useState(0)
  return <GalleryContent key={attempt} onRetry={() => setAttempt(value => value + 1)} />
}
