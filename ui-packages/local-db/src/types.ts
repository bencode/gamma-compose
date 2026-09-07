export type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }
export type DataRecord = { id: string; [key: string]: JsonValue }

export type ResourceDefinition = {
  protocolVersion: number
  name: string
  schema: Record<string, unknown>
  indexes?: readonly (readonly string[])[]
}

export type FieldCondition = {
  $ne?: JsonScalar
  $in?: readonly JsonScalar[]
  $nin?: readonly JsonScalar[]
  $gt?: string | number
  $gte?: string | number
  $lt?: string | number
  $lte?: string | number
  $contains?: string
}

export type Filter = {
  $and?: readonly Filter[]
  $or?: readonly Filter[]
  [field: string]: JsonScalar | FieldCondition | readonly Filter[] | undefined
}

export type ListQuery = {
  filter?: Filter
  sort?: Record<string, 1 | -1>
  limit?: number
  offset?: number
}

export type Page = {
  data: DataRecord[]
  total: number
  limit: number
  offset: number
}

export type LocalDb = {
  create: (resource: string, data: Record<string, JsonValue>) => Promise<DataRecord>
  get: (resource: string, id: string) => Promise<DataRecord | undefined>
  list: (resource: string, query?: ListQuery) => Promise<Page>
  update: (resource: string, id: string, changes: Record<string, JsonValue>) => Promise<DataRecord>
  remove: (resource: string, id: string) => Promise<void>
  close: () => void
}

export type OpenLocalDbOptions = {
  databaseName: string
  resources: readonly ResourceDefinition[]
}
