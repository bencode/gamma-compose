import Ajv2020 from 'ajv/dist/2020.js'
import { LocalDbError, type LocalDbErrorCode } from './errors.js'
import type { DataRecord, JsonValue, ResourceDefinition } from './types.js'

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))

const isJson = (value: unknown, parents = new Set<object>()): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || (!Array.isArray(value) && !isObject(value))) return false
  if (parents.has(value)) return false
  parents.add(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const valid =
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.entries(descriptors).every(
      ([key, descriptor]) =>
        (Array.isArray(value) && key === 'length') ||
        ('value' in descriptor && descriptor.enumerable && isJson(descriptor.value, parents)),
    ) &&
    (!Array.isArray(value) ||
      (Object.keys(value).length === value.length &&
        Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(
          Boolean,
        )))
  parents.delete(value)
  return valid
}

export const assertJson = (value: unknown, code: LocalDbErrorCode): void => {
  if (!isJson(value)) throw new LocalDbError(code, 'Expected finite, acyclic JSON data.')
}

const keywords = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
])
const schemaTypes = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']
export const typesOf = (schema: Record<string, unknown>): string[] =>
  (Array.isArray(schema.type) ? schema.type : [schema.type]) as string[]

const invalidModel: (message: string) => never = message => {
  throw new LocalDbError('INVALID_MODEL', message)
}

const checkSchema = (schema: unknown): void => {
  if (!isObject(schema)) invalidModel('Each schema must be an object with a type.')
  if (Object.keys(schema).some(key => !keywords.has(key)))
    invalidModel('The schema contains an unsupported keyword.')
  const types = typesOf(schema)
  if (
    !types.every(type => schemaTypes.includes(type)) ||
    (Array.isArray(schema.type) &&
      (types.length !== 2 || !types.includes('null') || new Set(types).size !== 2))
  )
    invalidModel('Use a single JSON type, optionally combined with null.')
  if (
    schema.$schema !== undefined &&
    schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
  )
    invalidModel('Only JSON Schema 2020-12 is supported.')
  if (schema.properties !== undefined) {
    if (!isObject(schema.properties)) invalidModel('properties must be an object.')
    Object.entries(schema.properties).forEach(([field, child]) => {
      if (field.startsWith('$')) invalidModel('Field names cannot start with $.')
      checkSchema(child)
    })
  }
  if (schema.items !== undefined) checkSchema(schema.items)
  if (typeof schema.additionalProperties !== 'boolean' && schema.additionalProperties !== undefined)
    checkSchema(schema.additionalProperties)
}

export type Resource = {
  name: string
  fields: Record<string, Record<string, unknown>>
  indexes: readonly (readonly string[])[]
  validate: (data: unknown) => asserts data is DataRecord
}

const prepareResource = (definition: ResourceDefinition, ajv: Ajv2020): Resource => {
  if (
    !isObject(definition) ||
    definition.protocolVersion !== 1 ||
    typeof definition.name !== 'string' ||
    !/^[a-z][a-z0-9-]*$/.test(definition.name) ||
    Object.keys(definition).some(
      key => !['protocolVersion', 'name', 'schema', 'indexes'].includes(key),
    )
  )
    return invalidModel('Expected a version 1 resource with a lowercase, kebab-case name.')
  const { name, schema } = definition
  checkSchema(schema)
  const fields = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (
    schema.type !== 'object' ||
    schema.additionalProperties !== false ||
    !fields ||
    !Object.hasOwn(fields, 'id') ||
    fields.id?.type !== 'string' ||
    !Array.isArray(schema.required) ||
    !schema.required.includes('id')
  )
    return invalidModel('A resource must require a string id and reject additional properties.')
  const indexes = definition.indexes === undefined ? [] : definition.indexes
  if (!Array.isArray(indexes)) return invalidModel('indexes must be an array.')
  indexes.forEach(keys => {
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      new Set(keys).size !== keys.length ||
      !keys.every(
        key =>
          typeof key === 'string' &&
          /^[$_\p{ID_Start}](?:[$\p{ID_Continue}]|\u200c|\u200d)*$/u.test(key) &&
          Object.hasOwn(fields, key) &&
          typesOf(fields[key] as Record<string, unknown>).some(type =>
            ['string', 'number', 'integer'].includes(type),
          ) &&
          typesOf(fields[key] as Record<string, unknown>).every(type =>
            ['string', 'number', 'integer', 'null'].includes(type),
          ),
      )
    )
      invalidModel(
        'Indexes require distinct string or numeric fields with identifier names, not paths.',
      )
  })
  const validate = ajv.compile(schema)
  return {
    name,
    fields,
    indexes,
    validate: (data: unknown): asserts data is DataRecord => {
      assertJson(data, 'VALIDATION_FAILED')
      if (!validate(data))
        throw new LocalDbError(
          'VALIDATION_FAILED',
          `Record does not satisfy resource ${name}.`,
          validate.errors?.map(error => ({
            path: error.instancePath,
            message: `${error.message ?? 'Invalid value'}${error.keyword === 'required' ? `: ${error.params.missingProperty}` : ''}`,
          })),
        )
    },
  }
}

export const prepareResources = (
  definitions: readonly ResourceDefinition[],
): Map<string, Resource> => {
  assertJson(definitions, 'INVALID_MODEL')
  if (!Array.isArray(definitions)) return invalidModel('resources must be an array.')
  try {
    const ajv = new Ajv2020({
      strict: true,
      strictRequired: true,
      ownProperties: true,
      allErrors: true,
    })
    const resources = structuredClone(definitions).map(definition =>
      prepareResource(definition, ajv),
    )
    if (new Set(resources.map(resource => resource.name)).size !== resources.length)
      return invalidModel('Resource names must be unique.')
    return new Map(resources.map(resource => [resource.name, resource]))
  } catch (cause) {
    if (cause instanceof LocalDbError) throw cause
    throw new LocalDbError(
      'INVALID_MODEL',
      'Could not compile the resource schema. Runtime compilation requires CSP unsafe-eval.',
      undefined,
      { cause },
    )
  }
}
