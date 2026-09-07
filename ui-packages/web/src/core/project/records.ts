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
