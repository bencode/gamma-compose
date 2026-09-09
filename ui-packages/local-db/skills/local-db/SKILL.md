---
name: local-db
description: Use when a Gamma Compose React application needs persistent structured data stored in the user's browser.
---

# Local database

Use `@gamma-compose/local-db` for structured application data that must persist in the browser. Do not create a server API, fetch a remote database, or store business records in project source files.

## Define resources

Create one model per resource at `data/<resource>.resource.json`. The file contains a versioned wrapper and a JSON Schema 2020-12 record schema:

```json
{
  "protocolVersion": 1,
  "name": "tasks",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["id", "title", "status"],
    "properties": {
      "id": { "type": "string" },
      "title": { "type": "string", "minLength": 1 },
      "status": { "type": "string", "enum": ["todo", "done"] }
    }
  },
  "indexes": [["status"]]
}
```

The root must require a string `id` and set `additionalProperties` to false. The database generates IDs; never submit `id` to create or update. Relationships are ordinary ID fields and application code owns their behavior. Do not add joins, cascades, migrations, subscriptions, or server endpoints.

Indexes are optional performance hints for declared top-level string, number, or integer fields. Do not index boolean, object, array, or nested fields, and do not use dotted paths. A boolean such as `done` can still be filtered without an index; omit its index or model the state as an indexed string such as `status`.

Supported schema keywords are `$schema`, `title`, `description`, `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minItems`, and `maxItems`. Do not use `$ref`, formats, patterns, defaults, or composition keywords.

## Open and use the database

Explicitly import every resource used by the application and open the single project database named `app`:

```ts
import { openLocalDb } from '@gamma-compose/local-db'
import tasks from '../data/tasks.resource.json'

export const db = await openLocalDb({ databaseName: 'app', resources: [tasks] })
```

Use the returned object directly:

```ts
await db.create('tasks', { title: 'Read', status: 'todo' })
await db.get('tasks', taskId)
await db.list('tasks', {
  filter: { status: 'todo', title: { $contains: 'Read' } },
  sort: { title: 1 },
  limit: 20,
  offset: 0
})
await db.update('tasks', taskId, { status: 'done' })
await db.remove('tasks', taskId)
```

Filters support equality, `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$contains`, `$and`, and `$or`. Queries address declared top-level scalar fields. Updates shallowly merge declared top-level fields and replace nested objects or arrays in full.

Load data in React effects or event handlers, store returned records in component state, and display loading and error states. Close the database during application teardown when practical.

## Agent workflow

Use `db_get`, `db_list`, `db_create`, `db_update`, and `db_remove` to inspect or change records in the current project's database. Their UI labels are `db.get`, `db.list`, `db.create`, `db.update`, and `db.remove`.

- After changing source or a resource model: call `compile`; only after it succeeds, call `refresh_preview`.
- After changing records only: do not compile; call `refresh_preview` once after all database operations finish.
- On compile or refresh failure, use the error details to repair the model, source, or submitted record, then repeat compile and refresh as required. Do not bypass validation or delete unrelated data.
