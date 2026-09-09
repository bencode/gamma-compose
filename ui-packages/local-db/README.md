# @gamma-compose/local-db

A browser-local JSON database with schema-validated writes and composable CRUD functions. No React dependency, HTTP server, relations, or business-rule engine.

This package is developed in the Gamma Compose pnpm workspace. Build it with `pnpm --filter @gamma-compose/local-db build`. It exports ESM JavaScript and TypeScript declarations from `dist/`; use a frontend bundler to consume its dependencies. It has not been published to npm yet.

## Declare a resource

Create `data/tasks.resource.json`:

```json
{
  "protocolVersion": 1,
  "name": "tasks",
  "schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": false,
    "required": ["id", "title", "status"],
    "properties": {
      "id": { "type": "string" },
      "title": { "type": "string", "minLength": 1 },
      "status": { "type": "string", "enum": ["todo", "doing", "done"] },
      "projectId": { "type": "string" }
    }
  },
  "indexes": [["projectId"], ["status"]]
}
```

`projectId` is an ordinary string. The application decides whether it references another resource and what to do when that resource changes.

## Open once, then compose operations

```ts
import { LocalDbError, openLocalDb } from '@gamma-compose/local-db'
import tasks from './data/tasks.resource.json'

const db = await openLocalDb({
  databaseName: 'reading-tracker',
  resources: [tasks],
})

try {
  const task = await db.create('tasks', { title: 'Read a chapter', status: 'todo' })
  const saved = await db.get('tasks', task.id)
  const page = await db.list('tasks', {
    filter: { status: 'todo', title: { $contains: 'chapter' } },
    sort: { title: 1 },
    limit: 20,
    offset: 0,
  })
  console.log(saved, page.data, page.total)
  await db.update('tasks', task.id, { status: 'done' })
  await db.remove('tasks', task.id)
} catch (error) {
  if (error instanceof LocalDbError && error.code === 'VALIDATION_FAILED') {
    console.error(error.message, error.details)
  } else {
    throw error
  }
} finally {
  db.close()
}
```

Initialize outside React rendering and share the instance through an ordinary module or props. Keep it open while the application uses it. Reopening the same database name on the same browser origin retains records; closing does not delete anything.

The model must include `id`, but callers cannot submit or modify it. The runtime generates it with `crypto.randomUUID()`; use a secure browser context such as HTTPS or localhost. `get` returns `undefined` for a missing record. `remove` succeeds even if the record is already absent.

Inside a Gamma Compose generated application, use the logical database name `app`.
The compiler substitutes the package's preview client, while the workbench host runs
the native implementation against the current project's IndexedDB namespace. The
same function API is available in both environments. Resource definitions remain
ordinary imported JSON; they are not discovered implicitly by application code.

## Validation and model changes

Models use a documented subset of JSON Schema 2020-12. Ajv compiles each model during initialization and validates complete records before `create` and `update` commit. Unknown fields in submitted input are rejected, not silently stripped; values are not coerced or filled with defaults. Updates replace submitted top-level fields, including entire nested objects or arrays.

Reads do not validate or clean historical records. On `update`, the library retains only the old record's top-level fields declared in the current model, merges the submitted changes, and validates the complete result. Obsolete top-level fields are removed only if that write commits; validation or storage failure preserves the entire old record. Other records remain untouched. Nested objects are not recursively cleaned: submit a complete replacement for a changed nested object. No migration or version-based validation bypass is provided. Close and reopen to apply new definitions.

## Browser requirements and limits

- IndexedDB and a secure context for UUID generation are required. Disabled or unavailable storage reports an error, not an in-memory fallback.
- Ajv runtime compilation requires CSP `script-src` to allow `'unsafe-eval'`. The package does not modify CSP. Strict-CSP precompiled validators are not included in this iteration.
- Same-origin application code is the trust boundary, not the database name. This package is not an isolation mechanism for untrusted code.
- IndexedDB persistence is subject to browser storage policies and user deletion. It is not a backup or a guarantee against eviction.
- Queries use indexes for direct equality candidates, otherwise scan the resource and filter/sort in memory. This is intended for local applications, not unbounded datasets.
- No joins, cascades, subscriptions, cross-call transactions, or React hooks are included.

The package ships `skills/local-db/SKILL.md` for Gamma Compose's browser Agent and
exports host bridge and preview-client entry points for workbench integration. These
integration entries are infrastructure APIs; generated applications should import
only `@gamma-compose/local-db`.

See the [complete protocol](../../docs/local-db.md) in this repository for supported schema keywords, query behavior, lifecycle, and error codes.
