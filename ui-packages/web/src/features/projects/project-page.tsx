import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { openProjectDatabase, type ProjectDatabase } from '../../core/project/database'
import type { Project } from '../../core/project/records'
import { createProjectStore, type ProjectStore } from '../../core/project/store'
import { Workbench } from '../../shell/workbench'

type LoadedProject = { record: Project; project: ProjectStore; retrySave: () => void }

const ProjectSession = ({ id, onRetry }: { id: string; onRetry: () => void }) => {
  const [loaded, setLoaded] = useState<LoadedProject>()
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string>()
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved')
  const [saveError, setSaveError] = useState<string>()

  useEffect(() => {
    let active = true
    let connection: ProjectDatabase | undefined
    let unsubscribe: (() => void) | undefined
    setError(undefined)
    const load = async () => {
      try {
        const database = await openProjectDatabase()
        connection = database
        if (!active) {
          database.close()
          return
        }
        const record = await database.getProject(id)
        if (!active) return
        if (!record) {
          setMissing(true)
          return
        }
        const project = createProjectStore({ entry: record.entry, files: record.files })
        const save = async () => {
          const snapshot = project.getSnapshot()
          setSaveStatus('saving')
          setSaveError(undefined)
          try {
            await database.saveProject({ ...record, ...snapshot, updatedAt: Date.now() })
            if (active && project.getSnapshot() === snapshot) setSaveStatus('saved')
          } catch (cause) {
            console.error('Could not save the project.', cause)
            if (active && project.getSnapshot() === snapshot) {
              setSaveStatus('error')
              setSaveError(
                cause instanceof Error || cause instanceof DOMException
                  ? cause.message
                  : 'Could not save to this browser.',
              )
            }
          }
        }
        const retrySave = () => {
          void save()
        }
        unsubscribe = project.subscribe(retrySave)
        setLoaded({ record, project, retrySave })
      } catch (cause) {
        console.error('Could not load the project.', cause)
        if (active)
          setError(
            cause instanceof Error || cause instanceof DOMException
              ? cause.message
              : 'Could not load this project.',
          )
      }
    }
    void load()
    return () => {
      active = false
      unsubscribe?.()
      connection?.close()
    }
  }, [id])

  if (loaded)
    return (
      <Workbench
        projectId={loaded.record.id}
        project={loaded.project}
        projectName={loaded.record.name}
        saveStatus={saveStatus}
        saveError={saveError}
        onRetrySave={loaded.retrySave}
      />
    )
  return (
    <main className="not-found">
      <h1>
        {missing ? 'Project not found' : error ? 'Could not open project' : 'Opening project…'}
      </h1>
      {missing && (
        <p className="max-w-md text-sm text-muted">
          This project is not available in this browser. Choose a template to start a new one.
        </p>
      )}
      {error && (
        <>
          <p role="alert" className="max-w-md text-sm text-muted [overflow-wrap:anywhere]">
            {error}
          </p>
          <button type="button" className="text-accent underline" onClick={onRetry}>
            Retry
          </button>
        </>
      )}
      <Link to="/">Back to gallery</Link>
    </main>
  )
}

export const ProjectPage = () => {
  const { projectId = '' } = useParams()
  const [attempt, setAttempt] = useState(0)
  return (
    <ProjectSession
      key={`${projectId}:${attempt}`}
      id={projectId}
      onRetry={() => setAttempt(value => value + 1)}
    />
  )
}
