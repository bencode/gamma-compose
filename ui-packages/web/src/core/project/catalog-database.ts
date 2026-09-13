import type { Project, Template } from './records'
import { templates } from './templates'

const completed = <T>(transaction: IDBTransaction, request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Database transaction aborted.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Database transaction failed.'))
  })

export const createCatalogDatabase = (
  db: IDBDatabase,
  saveProject: (project: Project) => Promise<void>,
) => ({
  listTemplates: async (): Promise<Template[]> => {
    const transaction = db.transaction('templates', 'readonly')
    const stored: Template[] = await completed(
      transaction,
      transaction.objectStore('templates').getAll(),
    )
    return templates.flatMap(template => stored.filter(item => item.id === template.id))
  },
  listProjects: async (): Promise<Project[]> => {
    const transaction = db.transaction('projects', 'readonly')
    const projects: Project[] = await completed(
      transaction,
      transaction.objectStore('projects').getAll(),
    )
    return projects.sort((left, right) => right.updatedAt - left.updatedAt)
  },
  createProject: async (templateId: string): Promise<Project> => {
    const transaction = db.transaction('templates', 'readonly')
    const template: Template | undefined = await completed(
      transaction,
      transaction.objectStore('templates').get(templateId),
    )
    if (!template) throw new Error('Template not found.')
    const project: Project = {
      id: crypto.randomUUID(),
      name: template.name,
      updatedAt: Date.now(),
      entry: template.entry,
      files: { ...template.files },
    }
    await saveProject(project)
    return project
  },
})
