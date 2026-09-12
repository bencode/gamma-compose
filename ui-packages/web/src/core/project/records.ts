import type { CompiledTree } from '@gamma-compose/server/compile-contract'
import type { ProjectSnapshot } from './store'

export type Template = ProjectSnapshot & {
  id: string
  name: string
  description: string
}

export type Project = ProjectSnapshot & {
  id: string
  name: string
  updatedAt: number
}

export type ProjectCompileState = {
  projectId: string
  build: CompiledTree
  updatedAt: number
}
