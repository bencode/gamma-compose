import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type JsonValue,
  type ListQuery,
  type LocalDb,
  openLocalDb,
  type ResourceDefinition,
} from './index.js'

const items: ResourceDefinition = {
  protocolVersion: 1,
  name: 'items',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'title', 'group', 'active'],
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      group: { type: 'string' },
      active: { type: 'boolean' },
      score: { type: ['number', 'null'] },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
}
const connections: LocalDb[] = []
const open = async (indexes: string[][] = []) => {
  const db = await openLocalDb({ databaseName: 'query', resources: [{ ...items, indexes }] })
  connections.push(db)
  return db
}
const seed = async (db: LocalDb) => {
  const records: Record<string, JsonValue>[] = [
    { title: 'React basics', group: 'a', active: true, score: 2 },
    { title: 'React advanced', group: 'a', active: true, score: 5 },
    { title: 'Browser tools', group: 'b', active: false, score: 5 },
    { title: 'Other', group: 'b', active: true, score: null },
    { title: 'Missing', group: 'b', active: false },
  ]
  return Promise.all(records.map(data => db.create('items', data)))
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => {
  connections.splice(0).forEach(db => {
    db.close()
  })
  vi.unstubAllGlobals()
})

describe('list', () => {
  it('combines typed filters, contains, boolean logic, sorting and pagination', async () => {
    const db = await open()
    await seed(db)
    const query: ListQuery = {
      filter: {
        active: true,
        $or: [{ title: { $contains: 'React' } }, { group: 'b', score: { $gt: 0 } }],
      },
      sort: { score: -1 },
      limit: 1,
      offset: 1,
    }
    const page = await db.list('items', query)
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1, data: [{ title: 'React basics' }] })
    expect((await db.list('items', { filter: { title: { $contains: 'react' } } })).total).toBe(0)
    expect(
      (
        await db.list('items', {
          filter: { $and: [{ group: { $in: ['a'] } }, { score: { $gte: 2, $lt: 5 } }] },
        })
      ).total,
    ).toBe(1)
    expect(
      (await db.list('items', { filter: { group: { $nin: ['a'] }, score: { $lte: 5 } } })).total,
    ).toBe(1)
    expect((await db.list('items', { filter: { title: { $gt: 'Q' } } })).total).toBe(2)
  })

  it('distinguishes null from missing and keeps nulls last for either sort direction', async () => {
    const db = await open()
    await seed(db)
    expect(
      (await db.list('items', { filter: { score: null } })).data.map(record => record.title),
    ).toEqual(['Other'])
    expect((await db.list('items', { filter: { score: { $ne: null } } })).total).toBe(3)
    expect((await db.list('items', { filter: { score: { $nin: [null] } } })).total).toBe(3)
    const asc = (await db.list('items', { sort: { score: 1, title: 1 } })).data.map(
      record => record.title,
    )
    const desc = (await db.list('items', { sort: { score: -1, title: 1 } })).data.map(
      record => record.title,
    )
    expect(asc).toEqual(['React basics', 'Browser tools', 'React advanced', 'Missing', 'Other'])
    expect(desc).toEqual(['Browser tools', 'React advanced', 'React basics', 'Missing', 'Other'])
  })

  it('returns deterministic default pages, counts and empty pages', async () => {
    const db = await open()
    const records = await seed(db)
    const page = await db.list('items')
    expect(page).toEqual({
      data: records.sort((a, b) => (a.id < b.id ? -1 : 1)),
      total: 5,
      limit: 20,
      offset: 0,
    })
    expect(await db.list('items', { limit: 0 })).toEqual({
      data: [],
      total: 5,
      limit: 0,
      offset: 0,
    })
    expect(await db.list('items', { offset: 100 })).toEqual({
      data: [],
      total: 5,
      limit: 20,
      offset: 100,
    })
    expect((await db.list('items', { filter: { $or: [] } })).total).toBe(0)
    expect((await db.list('items', { filter: { $and: [] } })).total).toBe(5)
  })

  it('produces the same results with no index, a compound index, or a single-field index', async () => {
    const db = await open()
    await seed(db)
    const query: ListQuery = { filter: { group: 'a', title: 'React basics' }, limit: 1 }
    const baseline = await db.list('items', query)
    db.close()
    const compound = await open([['group', 'title']])
    expect(await compound.list('items', query)).toEqual(baseline)
    compound.close()
    const single = await open([['group']])
    expect(await single.list('items', query)).toEqual(baseline)
    expect(
      (await single.list('items', { filter: { $or: [{ group: 'a' }, { group: 'b' }] } })).total,
    ).toBe(5)
  })

  it('captures query arguments before an asynchronous read completes', async () => {
    const db = await open()
    await seed(db)
    const groups = ['a']
    const result = db.list('items', { filter: { group: { $in: groups } } })
    groups[0] = 'b'
    expect((await result).total).toBe(2)
  })

  it.each([
    { filter: { missing: 'x' } },
    { filter: { 'nested.field': 'x' } },
    { filter: { $include: 'group' } },
    { filter: { score: { $gt: '2' } } },
    { filter: { title: { $regex: '.*' } } },
    { filter: { tags: 'a' } },
    { filter: { active: { $contains: 'true' } } },
    { filter: { group: { $in: [1] } } },
    { sort: { active: 1 } },
    { sort: { title: 0 } },
    { sort: { missing: 1 } },
    { limit: 1001 },
    { limit: -1 },
    { offset: 0.5 },
    { offset: Number.POSITIVE_INFINITY },
    { search: 'React' },
  ])('rejects unsupported or invalid query %#', async query => {
    const db = await open()
    await expect(db.list('items', query as ListQuery)).rejects.toMatchObject({
      code: 'INVALID_QUERY',
    })
  })
})
