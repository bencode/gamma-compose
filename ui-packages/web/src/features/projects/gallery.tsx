import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { openProjectDatabase, type ProjectDatabase } from '../../core/project/database'
import type { Project, Template } from '../../core/project/records'

const GalleryContent = ({ onRetry }: { onRetry: () => void }) => {
  const navigate = useNavigate()
  const database = useRef<ProjectDatabase | undefined>(undefined)
  const creatingRef = useRef(false)
  const [catalog, setCatalog] = useState<{ templates: Template[]; projects: Project[] }>()
  const [error, setError] = useState<string>()
  const [creating, setCreating] = useState<string>()

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
            <section aria-labelledby="templates-heading" className="mt-10">
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="templates-heading" className="text-lg font-semibold">
                  Templates
                </h2>
                <p className="text-xs text-muted">Each template starts a new project.</p>
              </div>
              <div className="grid gap-5 md:grid-cols-3">
                {catalog.templates.map(template => (
                  <button
                    type="button"
                    key={template.id}
                    aria-label={`Start with ${template.name}`}
                    disabled={creating !== undefined}
                    onClick={() => {
                      void create(template.id)
                    }}
                    className="group overflow-hidden rounded-xl border border-line text-left transition-colors hover:border-accent disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
                  >
                    <img
                      src={`/templates/${template.id}.png`}
                      alt=""
                      width="1000"
                      height="625"
                      className="aspect-[8/5] w-full border-b border-line object-cover object-top"
                    />
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold">{template.name}</h3>
                        <span aria-hidden="true" className="text-accent">
                          ↗
                        </span>
                      </div>
                      <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted">
                        {template.description}
                      </p>
                      <p className="mt-5 text-xs font-medium text-accent">
                        {creating === template.id ? 'Creating…' : 'Use template'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section aria-labelledby="projects-heading" className="mt-12">
              <h2 id="projects-heading" className="mb-5 text-lg font-semibold">
                My projects
              </h2>
              {catalog.projects.length === 0 ? (
                <p className="border-t border-line py-7 text-sm text-muted">
                  Nothing here yet. Start with a template above.
                </p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {catalog.projects.map(project => (
                    <li key={project.id}>
                      <Link
                        to={`/projects/${project.id}`}
                        className="flex items-center justify-between gap-4 px-2 py-5 hover:bg-workspace"
                      >
                        <div className="min-w-0">
                          <h3 className="truncate font-medium">{project.name}</h3>
                          <p className="mt-1 text-xs text-muted">
                            Edited{' '}
                            {new Date(project.updatedAt).toLocaleString('en', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm text-accent">
                          Open <span aria-hidden="true">↗</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
        <p className="mt-10 text-xs leading-relaxed text-muted">
          Projects are saved in this browser, not in the cloud. Clearing site data removes them.
        </p>
      </main>
    </div>
  )
}

export const Gallery = () => {
  const [attempt, setAttempt] = useState(0)
  return <GalleryContent key={attempt} onRetry={() => setAttempt(value => value + 1)} />
}
