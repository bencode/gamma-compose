import type { Project, Template } from './records'
import { createProjectStore } from './store'
import { templates } from './templates'

const completed = <T>(transaction: IDBTransaction, request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result)
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Database transaction aborted.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Database transaction failed.'))
  })

const projectDatabase = (db: IDBDatabase) => {
  const getProject = async (id: string): Promise<Project | undefined> => {
    const transaction = db.transaction('projects', 'readonly')
    const project: Project | undefined = await completed(
      transaction,
      transaction.objectStore('projects').get(id),
    )
    if (project) createProjectStore({ entry: project.entry, files: project.files })
    return project
  }
  const saveProject = async (project: Project): Promise<void> => {
    createProjectStore({ entry: project.entry, files: project.files })
    const transaction = db.transaction('projects', 'readwrite')
    await completed(transaction, transaction.objectStore('projects').put(project))
  }
  return {
    close: () => db.close(),
    getProject,
    saveProject,
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
  }
}

export type ProjectDatabase = ReturnType<typeof projectDatabase>

export const openProjectDatabase = (): Promise<ProjectDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('gamma-compose', 1)
    let blocked = false
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.createObjectStore('templates', { keyPath: 'id' })
      db.createObjectStore('projects', { keyPath: 'id' })
      templates.forEach(template => {
        store.add(template)
      })
    }
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the project database.'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('Close other Gamma Compose tabs and retry opening the database.'))
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      if (blocked) db.close()
      else resolve(projectDatabase(db))
    }
  })
