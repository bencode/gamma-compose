import { LocalDbError } from './errors.js'
import { assertJson, isObject, type Resource, typesOf } from './model.js'
import type { DataRecord, JsonScalar, ListQuery, Page } from './types.js'

const invalidQuery = (message: string): never => {
  throw new LocalDbError('INVALID_QUERY', message)
}

const isScalar = (value: unknown): value is JsonScalar =>
  value === null || ['string', 'boolean', 'number'].includes(typeof value)

const accepts = (schema: Record<string, unknown>, value: unknown): value is JsonScalar =>
  isScalar(value) &&
  typesOf(schema).some(type =>
    type === 'null'
      ? value === null
      : type === 'integer'
        ? typeof value === 'number' && Number.isInteger(value)
        : value !== null && typeof value === type,
  )

const fieldSchema = (resource: Resource, field: string) => {
  if (!Object.hasOwn(resource.fields, field)) return invalidQuery(`Unknown field: ${field}.`)
  return resource.fields[field] as Record<string, unknown>
}

const compare = (left: string | number, right: string | number): number =>
  left === right ? 0 : left < right ? -1 : 1

const operatorPredicate = (
  schema: Record<string, unknown>,
  operator: string,
  operand: unknown,
): ((value: JsonScalar) => boolean) => {
  const check = (value: unknown) => {
    if (!accepts(schema, value)) invalidQuery('Filter value does not match the field type.')
  }
  if (operator === '$ne') {
    check(operand)
    return value => value !== operand
  }
  if (operator === '$in' || operator === '$nin') {
    if (!Array.isArray(operand)) return invalidQuery(`${operator} requires an array.`)
    operand.forEach(check)
    return value => operand.includes(value) === (operator === '$in')
  }
  if (operator === '$contains') {
    if (typeof operand !== 'string' || !typesOf(schema).includes('string'))
      return invalidQuery('$contains requires a string field and string operand.')
    return value => typeof value === 'string' && value.includes(operand)
  }
  if (!['$gt', '$gte', '$lt', '$lte'].includes(operator))
    return invalidQuery(`Unsupported filter operator: ${operator}.`)
  if (typeof operand !== 'string' && typeof operand !== 'number')
    return invalidQuery(`${operator} requires a string or number.`)
  check(operand)
  return value => {
    if ((typeof value !== 'string' && typeof value !== 'number') || typeof value !== typeof operand)
      return false
    const order = compare(value, operand)
    const results: Record<string, boolean> = {
      $gt: order > 0,
      $gte: order >= 0,
      $lt: order < 0,
      $lte: order <= 0,
    }
    return results[operator] ?? false
  }
}

const fieldPredicate = (resource: Resource, field: string, condition: unknown) => {
  const schema = fieldSchema(resource, field)
  if (isScalar(condition)) {
    if (!accepts(schema, condition)) return invalidQuery(`Invalid filter value for ${field}.`)
    return (record: DataRecord) => Object.hasOwn(record, field) && record[field] === condition
  }
  if (!isObject(condition) || Object.keys(condition).length === 0)
    return invalidQuery('A field condition must be a scalar or a nonempty operator object.')
  const predicates = Object.entries(condition).map(([operator, operand]) =>
    operatorPredicate(schema, operator, operand),
  )
  return (record: DataRecord) => {
    const value = Object.hasOwn(record, field) ? record[field] : undefined
    return accepts(schema, value) && predicates.every(predicate => predicate(value))
  }
}

const filterPredicate = (
  resource: Resource,
  filter: unknown,
): ((record: DataRecord) => boolean) => {
  if (!isObject(filter)) return invalidQuery('filter must be an object.')
  const predicates = Object.entries(filter).map(([field, condition]) => {
    if (field !== '$and' && field !== '$or') return fieldPredicate(resource, field, condition)
    if (!Array.isArray(condition)) return invalidQuery(`${field} requires an array of filters.`)
    const children = condition.map(child => filterPredicate(resource, child))
    return (record: DataRecord) =>
      field === '$and'
        ? children.every(predicate => predicate(record))
        : children.some(predicate => predicate(record))
  })
  return record => predicates.every(predicate => predicate(record))
}

const sortComparator = (resource: Resource, sort: unknown) => {
  if (!isObject(sort)) return invalidQuery('sort must be an object.')
  const fields = Object.entries(sort).map(([field, direction]) => {
    const schema = fieldSchema(resource, field)
    if (
      ![1, -1].includes(direction as number) ||
      !typesOf(schema).some(type => ['string', 'number', 'integer'].includes(type)) ||
      typesOf(schema).some(type => !['string', 'number', 'integer', 'null'].includes(type))
    )
      return invalidQuery('Sort requires string or numeric fields and directions of 1 or -1.')
    return { field, direction: direction as number, schema }
  })
  return (left: DataRecord, right: DataRecord): number => {
    const orders = fields.map(({ field, direction, schema }) => {
      const a = Object.hasOwn(left, field) ? left[field] : undefined
      const b = Object.hasOwn(right, field) ? right[field] : undefined
      const validA = accepts(schema, a) && (typeof a === 'string' || typeof a === 'number')
      const validB = accepts(schema, b) && (typeof b === 'string' || typeof b === 'number')
      if (!validA || !validB) return Number(validB) - Number(validA)
      return compare(a, b) * direction
    })
    return orders.find(order => order !== 0) ?? compare(left.id, right.id)
  }
}

export const indexName = (fields: readonly string[]): string => JSON.stringify(fields)

const candidateIndex = (resource: Resource, filter: Record<string, unknown>) => {
  const keys = resource.indexes.find(fields =>
    fields.every(
      field =>
        Object.hasOwn(filter, field) &&
        (typeof filter[field] === 'string' || typeof filter[field] === 'number'),
    ),
  )
  if (!keys) return undefined
  const values = keys.map(field => filter[field] as string | number)
  return { name: indexName(keys), key: keys.length === 1 ? (values[0] as string | number) : values }
}

export const prepareQuery = (resource: Resource, query: ListQuery) => {
  assertJson(query, 'INVALID_QUERY')
  if (
    !isObject(query) ||
    Object.keys(query).some(key => !['filter', 'sort', 'limit', 'offset'].includes(key))
  )
    return invalidQuery('Unsupported query option.')
  const { filter = {}, sort = {}, limit = 20, offset = 0 } = structuredClone(query)
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > 1000 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    return invalidQuery('limit must be 0–1000 and offset must be a nonnegative safe integer.')
  const matches = filterPredicate(resource, filter)
  const order = sortComparator(resource, sort)
  return {
    index: candidateIndex(resource, filter),
    page: (records: DataRecord[]): Page => {
      const matching = records.filter(matches)
      return {
        data: limit === 0 ? [] : matching.sort(order).slice(offset, offset + limit),
        total: matching.length,
        limit,
        offset,
      }
    },
  }
}
