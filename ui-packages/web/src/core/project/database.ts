import type { Project, ProjectCompileState, Template } from './records'
import type { StoredFileContent, StoredFileMetadata } from './repository-files'
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

const transactionCompleted = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
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
  const getCompileState = async (projectId: string): Promise<ProjectCompileState | undefined> => {
    const transaction = db.transaction('compileStates', 'readonly')
    return completed(transaction, transaction.objectStore('compileStates').get(projectId))
  }
  const saveCompileState = async (state: ProjectCompileState): Promise<void> => {
    const transaction = db.transaction('compileStates', 'readwrite')
    await completed(transaction, transaction.objectStore('compileStates').put(state))
  }
  const listStoredFiles = async (projectId: string): Promise<StoredFileMetadata[]> => {
    const transaction = db.transaction('files', 'readonly')
    return completed(
      transaction,
      transaction.objectStore('files').index('by-project-id').getAll(projectId),
    )
  }
  const getStoredFileContent = async (id: string): Promise<Blob | undefined> => {
    const transaction = db.transaction('contents', 'readonly')
    const content: StoredFileContent | undefined = await completed(
      transaction,
      transaction.objectStore('contents').get(id),
    )
    return content?.blob
  }
  const saveStoredFiles = async (
    files: ReadonlyArray<{ metadata: StoredFileMetadata; blob: Blob }>,
    deleteContentIds: readonly string[] = [],
  ): Promise<void> => {
    if (!files.length && !deleteContentIds.length) return
    const transaction = db.transaction(['files', 'contents'], 'readwrite')
    files.forEach(({ metadata, blob }) => {
      transaction.objectStore('files').put(metadata)
      transaction
        .objectStore('contents')
        .put({ id: metadata.contentId ?? metadata.id, blob } satisfies StoredFileContent)
    })
    deleteContentIds.forEach(id => {
      transaction.objectStore('contents').delete(id)
    })
    await transactionCompleted(transaction)
  }
  const saveStoredFileMetadata = async (
    metadata: StoredFileMetadata,
    deleteContentIds: readonly string[] = [],
  ): Promise<void> => {
    const transaction = db.transaction(['files', 'contents'], 'readwrite')
    transaction.objectStore('files').put(metadata)
    deleteContentIds.forEach(id => {
      transaction.objectStore('contents').delete(id)
    })
    await transactionCompleted(transaction)
  }
  const deleteStoredFile = async (id: string, contentId: string | null = id): Promise<void> => {
    const transaction = db.transaction(['files', 'contents'], 'readwrite')
    transaction.objectStore('files').delete(id)
    if (contentId) transaction.objectStore('contents').delete(contentId)
    await transactionCompleted(transaction)
  }
  return {
    close: () => db.close(),
    getProject,
    saveProject,
    getCompileState,
    saveCompileState,
    listStoredFiles,
    getStoredFileContent,
    saveStoredFiles,
    saveStoredFileMetadata,
    deleteStoredFile,
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
    const request = indexedDB.open('gamma-compose', 3)
    let blocked = false
    request.onupgradeneeded = event => {
      const db = request.result
      if (event.oldVersion < 1) {
        const store = db.createObjectStore('templates', { keyPath: 'id' })
        db.createObjectStore('projects', { keyPath: 'id' })
        templates.forEach(template => {
          store.add(template)
        })
      }
      if (event.oldVersion < 2) db.createObjectStore('compileStates', { keyPath: 'projectId' })
      if (event.oldVersion < 3) {
        const files = db.createObjectStore('files', { keyPath: 'id' })
        files.createIndex('by-project-id', 'projectId')
        files.createIndex('by-project-path', ['projectId', 'path'], { unique: true })
        db.createObjectStore('contents', { keyPath: 'id' })
      }
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
