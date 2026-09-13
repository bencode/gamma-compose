import { Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Project } from '../../core/project/records'

type ProjectListProps = {
  projects: Project[]
  deleting?: string
  onDelete: (project: Project) => void
}

export const ProjectList = ({ projects, deleting, onDelete }: ProjectListProps) => (
  <section aria-labelledby="projects-heading" className="mt-12">
    <h2 id="projects-heading" className="mb-5 text-lg font-semibold">
      My projects
    </h2>
    {projects.length === 0 ? (
      <p className="border-t border-line py-7 text-sm text-muted">
        Nothing here yet. Start with a template above.
      </p>
    ) : (
      <ul className="divide-y divide-line border-y border-line">
        {projects.map(project => (
          <li key={project.id} className="flex min-w-0 items-center gap-2">
            <Link
              to={`/projects/${project.id}`}
              className="flex min-w-0 flex-1 items-center justify-between gap-4 px-2 py-5 hover:bg-workspace"
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
            <button
              type="button"
              className="mr-2 shrink-0 rounded-md p-2 text-muted hover:bg-workspace hover:text-syntax-invalid"
              aria-label={`Delete ${project.name}`}
              title={`Delete ${project.name}`}
              disabled={deleting !== undefined}
              onClick={() => onDelete(project)}
            >
              <Trash2 aria-hidden="true" size={15} />
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
)
