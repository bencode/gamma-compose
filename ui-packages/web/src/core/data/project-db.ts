import type { LocalDb, ResourceDefinition } from '@gamma-compose/local-db'
import { openLocalDb } from '@gamma-compose/local-db'
import type { ProjectStore } from '../project/store'

const resourcePath = /^data\/[^/]+\.resource\.json$/

export const readProjectResources = (project: ProjectStore): ResourceDefinition[] => {
  const entries = Object.entries(project.getSnapshot().files)
    .filter(([path]) => resourcePath.test(path))
    .sort(([left], [right]) => left.localeCompare(right))
  if (!entries.length)
    throw new Error('No resource definitions were found in data/*.resource.json.')
  return entries.map(([path, content]) => {
    try {
      const value: unknown = JSON.parse(content)
      return value as ResourceDefinition
    } catch (cause) {
      throw new Error(`Could not parse resource model ${path}.`, { cause })
    }
  })
}

export const withProjectDb = async <T>(
  projectId: string,
  project: ProjectStore,
  action: (db: LocalDb) => Promise<T>,
): Promise<T> => {
  const db = await openLocalDb({
    databaseName: `project:${projectId}`,
    resources: readProjectResources(project),
  })
  try {
    return await action(db)
  } finally {
    db.close()
  }
}
